// 앱 상태 (데이터, 데이터 기준, 게임 설정, 파티, 상대 파티) + localStorage 저장
import { createEngine } from './core/engine.js';
import { createSearch } from './core/search.js';
import { createContext } from './core/party.js';
import { josa, storage } from './ui/dom.js';

export const TYPE_MODE = 'type';
export const GAME_MODE = 'game';   // 「포켓몬 파티!」 게임 룰

export const store = {
  dex: null,
  engine: null,
  search: null,
  usageIndex: [],   // 사용 가능한 실전 데이터 포맷 목록
  usage: null,      // 현재 포맷의 실전 데이터 (타입·게임 모드면 null)
  sets: null,       // 전체 포켓몬 추천 세팅 (sets.json, 부팅 후 따로 로드)
  gameData: null,   // 「포켓몬 파티!」에서 뽑은 출현·아이템·룰 데이터
  mode: TYPE_MODE,
  filters: { game: 'all', legend: false, mega: false, minBst: 450, usageMega: true },
  game: { map: 'tour', rule: 'normal', battle: 'single', legends: false },
  party: [],        // [{ id, ability, tera, picked }]
  opponents: [],    // 선봉 추천용 상대 파티 [id]
  recent: [],
};

const listeners = new Set();
const usageCache = new Map();
let ctxCache = null;
let ctxKey = '';

export function initStore(dex, usageIndex, gameData) {
  store.dex = dex;
  store.engine = createEngine(dex);
  store.search = createSearch(dex.pokemon);
  store.usageIndex = usageIndex?.formats || [];
  store.gameData = gameData || null;
  const saved = storage.get('ppl.mode', null);
  const valid = k => (k === GAME_MODE && store.gameData) || k === TYPE_MODE || store.usageIndex.some(f => f.key === k);
  store.mode = valid(saved) ? saved : store.gameData ? GAME_MODE : store.usageIndex[0]?.key || TYPE_MODE;
  store.filters = { ...store.filters, ...storage.get('ppl.filters', {}) };
  store.game = { ...store.game, ...storage.get('ppl.game', {}) };
  store.party = sanitizeParty(storage.get('ppl.party', []));
  store.opponents = sanitizeIds(storage.get('ppl.opponents', []));
  store.recent = storage.get('ppl.recent', []).filter(id => store.engine.byId.has(id)).slice(0, 8);
}

export const subscribe = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

function persist() {
  storage.set('ppl.mode', store.mode);
  storage.set('ppl.filters', store.filters);
  storage.set('ppl.game', store.game);
  storage.set('ppl.party', store.party);
  storage.set('ppl.opponents', store.opponents);
  storage.set('ppl.recent', store.recent);
}

/** 상태 변경 → 저장 → 화면 갱신 */
export function update(fn) {
  fn(store);
  persist();
  emit();
}

export const usageInfo = () => store.usageIndex.find(f => f.key === store.mode) || null;
export const isGameMode = () => store.mode === GAME_MODE && !!store.gameData;
/** 현재 게임 기믹 룰 { key, name, uses: ['mega','z','dynamax','tera'] } */
export const gameRule = () => store.gameData?.rules.find(r => r.key === store.game.rule) || store.gameData?.rules[0];
/** 지금 기준의 배틀 방식 */
export const battleMode = () => (isGameMode() ? store.game.battle : store.mode === 'champions-doubles' ? 'double' : 'single');
/** 추천 세팅 우선순위 키 (ui/sets.js ORDER) */
export const setsOrder = () => (isGameMode() ? `game-${store.game.battle}` : store.mode);
/** 세팅 카드에 넘길 게임 정보 (게임 모드가 아니면 null) */
export const gameOpts = () => (isGameMode() ? { data: store.gameData, rule: gameRule() } : null);

export async function loadUsage() {
  const info = usageInfo();
  if (!info) { store.usage = null; return; }
  if (!usageCache.has(info.key)) {
    usageCache.set(info.key, fetch(`data/usage/${info.file}`).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).catch(err => { usageCache.delete(info.key); throw err; }));
  }
  store.usage = await usageCache.get(info.key);
}

let setsPromise = null;
/** 추천 세팅 데이터: 첫 화면을 막지 않도록 부팅 후 받아서 도착하면 화면을 다시 그린다 */
export function loadSets() {
  setsPromise ||= fetch('data/sets.json')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => { update(s => { s.sets = data; }); return data; })
    .catch(err => { setsPromise = null; console.warn('추천 세팅 로드 실패', err); return null; });
  return setsPromise;
}

export async function setMode(mode) {
  store.mode = mode;
  try {
    await loadUsage();
  } catch {
    store.mode = TYPE_MODE;
    store.usage = null;
  }
  update(() => {});
}

/** 현재 데이터 기준·필터에 맞는 분석 컨텍스트 (캐시) */
export function getContext() {
  const f = store.filters;
  let opts, key;
  if (isGameMode()) {
    const { map, legends } = store.game;
    opts = { game: { data: store.gameData, map, legends } };
    key = `game|${map}|${legends}`;
  } else {
    const filters = store.usage ? { mega: f.usageMega } : { game: f.game, legend: f.legend, mega: f.mega, minBst: f.minBst };
    opts = { usage: store.usage, filters };
    key = `${store.mode}|${store.usage?.month || ''}|${JSON.stringify(filters)}`;
  }
  if (key !== ctxKey) {
    ctxCache = createContext(store.engine, opts);
    ctxKey = key;
  }
  return ctxCache;
}

/** 저장된 파티 → 분석용 멤버 */
export function partyMembers(ctx = getContext()) {
  return store.party.map(m => ctx.prep(store.engine.byId.get(m.id), { ability: m.ability || undefined, tera: m.tera || null }));
}

export function addRecent(id) {
  store.recent = [id, ...store.recent.filter(x => x !== id)].slice(0, 8);
  persist();
}

// ── 파티 공유 링크: "195:unaware~poison,302" (id[:특성][~테라]) ──
export const encodeParty = party => party.map(m => `${m.id}${m.ability ? ':' + m.ability : ''}${m.tera ? '~' + m.tera : ''}`).join(',');

export function decodeParty(text) {
  return sanitizeParty(String(text).split(',').map(s => {
    const m = s.match(/^(\d+)(?::([a-z0-9-]+))?(?:~([a-z]+))?$/);
    return m && { id: +m[1], ability: m[2] || null, tera: m[3] || null, picked: false };
  }).filter(Boolean));
}

function sanitizeParty(list) {
  const { engine, dex } = store;
  const species = new Set();
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const mon = engine.byId.get(+m?.id);
    if (!mon || species.has(mon.sp) || out.length >= 6) continue;
    species.add(mon.sp);
    out.push({
      id: mon.id,
      ability: engine.abilitiesOf(mon).includes(m.ability) ? m.ability : null,
      tera: dex.typeNames[m.tera] ? m.tera : null,
      picked: !!m.picked,
    });
  }
  return out;
}

const sanitizeIds = list => (Array.isArray(list) ? list : []).map(Number).filter(id => store.engine.byId.has(id)).slice(0, 6);
export const decodeIds = text => sanitizeIds(String(text).split(','));

/** 파티에 추가. 실패 사유 문자열 또는 null */
export function addToParty(mon, { picked = false } = {}) {
  if (store.party.length >= 6) return '파티가 가득 찼어요 (최대 6마리)';
  if (store.party.some(m => store.engine.byId.get(m.id).sp === mon.sp)) return `${josa(mon.ko, '와과')} 같은 종이 이미 파티에 있어요`;
  update(s => { s.party.push({ id: mon.id, ability: null, tera: null, picked }); });
  return null;
}

/** 「포켓몬 파티!」에서 이 포켓몬을 어디서 만날 수 있는지 (맵 규칙에 따라) */
export function whereToFind(mon) {
  const data = store.gameData;
  if (!data) return '';
  const info = data.pool[mon.id];
  if (store.game.map === 'tour') {
    const areas = data.areas.map(a => [a.name, a.mons.find(([id]) => id === mon.id)?.[1] || 0]).filter(([, w]) => w)
      .sort((a, b) => b[1] - a[1]).map(([n]) => n);
    if (areas.length) return areas.slice(0, 3).join(' · ');
    return info?.l ? '미라클교환·레이드' : '';
  }
  if (!info) return '';
  if (info.l) return '미라클교환·레이드';
  if (store.game.map === 'board') return mon.t.map(t => `${store.dex.typeNames[t].ko} 칸`).join(' · ');
  if (store.game.map === 'island') return `${info.g}세대 구역`;
  if (store.game.map === 'maze') return info.c ? `${info.c} 구역` : '';
  return '어느 칸에서나';
}
