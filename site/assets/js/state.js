// 앱 상태 (데이터, 데이터 기준, 게임 설정, 파티, 상대 파티) + localStorage 저장
import { createEngine } from './core/engine.js';
import { createSearch } from './core/search.js';
import { createContext, finalsOf } from './core/party.js';
import { createMoveBook, createBuilder, NATURES, CHOICE, ITEM_MODES } from './core/build.js';
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
  moves: null,      // 게임 기술 표 + 습득표 (moves.json, 내 세팅을 쓸 때만 로드) → createMoveBook
  mode: TYPE_MODE,
  filters: { game: 'all', legend: false, mega: false, minBst: 450, usageMega: true },
  // relearn: 기술 떠올리기(기술 칸·학습장치의 교배·가르침·기술머신 기술)까지 추천·대체에 쓸지
  // items: 추천 세팅에 쓸 도구 'all' 전부 · 'nochoice' 구애 도구 빼기 · 'none' 도구 없이
  game: { map: 'tour', rule: 'normal', battle: 'single', legends: false, relearn: true, items: 'all' },
  party: [],        // [{ id, ability, tera, picked, evo(진화 목표 id), mega(메가진화 폼 id · 0 안 함 · null 자동 추천), set(내 세팅) }]
  opponents: [],    // 선봉 추천용 상대 파티 [id]
  wild: [],         // 포획 추천: 야생 칸에서 나온 후보 [id] (최대 3)
  ball: 'poke',     // 포획 추천: 지금 쓰는 볼 (라운드에 따라 바뀜)
  starter: { id: null, gens: [] },   // 스타팅 추천: 고른 스타팅(진화 전 id), 드래프트에 나온 세대
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
  store.wild = sanitizeIds(storage.get('ppl.wild', [])).slice(0, 3);
  store.ball = ['poke', 'great', 'ultra'].includes(storage.get('ppl.ball', 'poke')) ? storage.get('ppl.ball', 'poke') : 'poke';
  const starter = storage.get('ppl.starter', {});
  const starterIds = new Set(Object.values(store.gameData?.starters || {}).flat());
  store.starter = {
    id: starterIds.has(+starter.id) ? +starter.id : null,
    gens: (Array.isArray(starter.gens) ? starter.gens : []).map(Number).filter(g => store.gameData?.starters?.[g]),
  };
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
  storage.set('ppl.wild', store.wild);
  storage.set('ppl.ball', store.ball);
  storage.set('ppl.starter', store.starter);
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
/** 기술 떠올리기 ON/OFF (모든 추천 세팅 카드 공통) → 바뀐 값 */
export function toggleRelearn() {
  update(s => { s.game.relearn = s.game.relearn === false; });
  return store.game.relearn;
}
export const relearnToast = on => (on ? '기술 떠올리기 ON · 교배·가르침·기술머신 기술까지 추천·대체에 써요' : '기술 떠올리기 OFF · 레벨업 기술만으로 추천·대체해요');

/** 추천 세팅에 쓸 도구 기준 (core/build.js ITEM_MODES) */
export const itemMode = () => (ITEM_MODES.some(m => m.key === store.game.items) ? store.game.items : 'all');
export function setItemMode(mode) {
  update(s => { s.game.items = mode; });
  const m = ITEM_MODES.find(x => x.key === itemMode());
  return `추천 도구: ${m.name} · 최선 세팅·대체 도구를 다시 골랐어요`;
}

/** 추천 세팅 카드용 게임 정보. relearn: { on, of(mon) → 기술 떠올리기로만 배우는 기술 Set | null (기술 데이터 전) } */
export const gameOpts = () => (isGameMode() ? {
  data: store.gameData, rule: gameRule(),
  relearn: { on: store.game.relearn !== false, of: mon => getBuilder()?.relearnOnly(mon) || null },
  items: { mode: itemMode(), usable: usableItems() },
} : null);

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

let movesPromise = null;
/** 게임 기술 표·습득표 (약 70KB gzip): 내 세팅·최선 세팅을 보여 줄 때 받아서 도착하면 화면을 다시 그린다 */
export function loadMoves() {
  movesPromise ||= fetch('data/game/moves.json')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => { update(s => { s.moves = createMoveBook(data); }); return store.moves; })
    .catch(err => { movesPromise = null; console.warn('기술 데이터 로드 실패', err); return null; });
  return movesPromise;
}

/** 이 룰에서 손에 넣을 수 있는 지닌 도구 */
export function allowedItems(rule = gameRule()) {
  const it = store.gameData?.items;
  if (!it) return null;
  const uses = rule?.uses || [];
  return new Set([...it.battle, ...it.berry, ...it.signature,
    ...(uses.includes('mega') ? it.mega : []), ...(uses.includes('z') ? it.z : []),
    ...(uses.includes('tera') ? it.tera : []), ...(uses.includes('dynamax') ? it.dynamax : [])]);
}

/** 추천·최선 세팅에 쓰는 도구 = 구할 수 있는 도구 중 도구 기준(구애 빼기 · 도구 없이)에 맞는 것 */
export function usableItems(rule = gameRule()) {
  const all = allowedItems(rule);
  if (!all) return null;
  const mode = itemMode();
  if (mode === 'none') return new Set();
  return mode === 'nochoice' ? new Set([...all].filter(i => !CHOICE.has(i))) : all;
}

/** 이 포켓몬이 구할 수 있는 도구인지: 전용도구 칸은 쓸 수 있는 포켓몬을 가졌을 때만 팜 (플레이트 → 아르세우스, 전기구슬 → 피카츄 …) */
export function itemOkFor(mon, it) {
  const users = store.gameData?.signatureUsers?.[it];
  return !users || users.includes(mon.sp);
}

let builderCache = null, builderKey = '';
/** 세팅 평가기 (게임 모드 + 기술 데이터가 있을 때). 데이터 기준·배틀 방식·룰이 바뀌면 새로 만든다 */
export function getBuilder() {
  if (!isGameMode() || !store.moves) return null;
  const ctx = getContext();
  const key = `${ctxKey}|${store.game.battle}|${gameRule()?.key}|${!!store.sets}|${store.game.relearn !== false}|${itemMode()}`;
  if (key !== builderKey || !builderCache) {
    builderCache = createBuilder(ctx, store.moves, {
      level: store.gameData.finalLevel, battle: store.game.battle, sets: store.sets, items: usableItems(),
      relearn: store.game.relearn !== false, itemOk: itemOkFor,
    });
    builderKey = key;
  }
  return builderCache;
}

/** 내 세팅의 공격 기술 타입 (기술 데이터가 없거나 공격 기술이 없으면 null → 자속 타입으로 분석) */
export function attackTypes(set) {
  if (!set?.mv?.length || !store.moves) return null;
  const types = [...new Set(set.mv.map(s => store.moves.bySlug.get(s)).filter(mv => mv && mv.cat > 0).map(mv => mv.type))];
  return types.length ? types : null;
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
    const rule = gameRule();
    opts = { game: { data: store.gameData, map, legends, rule } };
    key = `game|${map}|${legends}|${rule?.key}`;
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

/** 진화 전 포켓몬의 최종 진화 후보 [{ mon, item }] (종족값 높은 순, 최종 진화면 []) */
export const evoOptions = mon => finalsOf(store.engine, store.gameData, mon)
  .sort((a, b) => store.engine.effectiveBst(b.mon) - store.engine.effectiveBst(a.mon));
/** 지금 게임 룰에서 쓸 수 있는 메가진화 [[메가 폼 id, 메가스톤]] (게임 모드 + 메가 룰일 때만) */
export const megaOptions = mon => (isGameMode() && gameRule()?.uses.includes('mega') ? store.gameData.megas[mon.id] || [] : []);

/**
 * 파티 멤버가 실제로 싸우는 모습: 최종 진화(evolve) → 메가진화. { mon, caught, stone, autoMega }
 * m.mega: 메가 폼 id = 직접 고름 · 0 = 메가진화 안 함 · null = 정하지 않음 → auto(자동 추천 { id })가 있으면 그것
 */
export function battleForm(m, { evolve = true, auto = null } = {}) {
  const caught = store.engine.byId.get(m.id);
  let mon = caught;
  if (evolve) {
    const finals = evoOptions(caught);
    mon = (finals.find(f => f.mon.id === m.evo) || finals[0])?.mon || caught;
  }
  const want = m.mega > 0 ? m.mega : m.mega === 0 ? null : auto?.id ?? null;
  const mega = megaOptions(mon).find(([id]) => id === want);
  return mega ? { mon: store.engine.byId.get(mega[0]), caught, stone: mega[1], autoMega: !(m.mega > 0) } : { mon, caught, stone: null, autoMega: false };
}

// 메가진화 자동 추천 (ui/mega.js 가 등록): 직접 고른 메가진화가 없을 때 { i, id } | null
let megaResolver = null, resolving = false;
export const setMegaResolver = fn => { megaResolver = fn; };
function megaAuto() {
  if (!megaResolver || resolving || !isGameMode() || !gameRule()?.uses.includes('mega')) return null;
  resolving = true;
  try { return megaResolver(); } finally { resolving = false; }
}

/** 야생 후보(잡는 모습) → 비교할 모습들: 최종 진화(갈래마다) + 메가진화 룰이면 메가진화 모습 */
export function catchForms(ctx, mon) {
  const finals = evoOptions(mon).map(f => f.mon);
  const out = [];
  for (const b of finals.length ? finals : [mon]) {
    const route = { base: b, from: b === mon ? [] : [mon], direct: b === mon };
    out.push(ctx.prep(b, route));
    for (const [mid, stone] of megaOptions(b)) {
      const mega = store.engine.byId.get(mid);
      if (mega) out.push(ctx.prep(mega, { ...route, stone }));
    }
  }
  return out;
}

/**
 * 저장된 파티 → 분석용 멤버 (진화 전 포켓몬은 최종 진화 기준, 메가진화를 켜면 메가 모습).
 * evolve: false 면 지금 모습 그대로 (선봉 추천처럼 당장의 배틀)
 */
// auto: 메가진화를 직접 고르지 않았으면 자동 추천 메가진화를 가정 (메가진화 추천을 계산할 때만 false)
export function partyMembers(ctx = getContext(), { evolve = true, auto = true } = {}) {
  const { engine } = store;
  const pick = auto ? megaAuto() : null;
  return store.party.map((m, i) => {
    const { mon, caught, stone, autoMega } = battleForm(m, { evolve, auto: pick?.i === i ? pick : null });
    const ability = engine.abilitiesOf(mon).includes(m.ability) ? m.ability : undefined;
    const pm = ctx.prep(mon, { ability, tera: m.tera || null, base: caught, stone, atk: attackTypes(m.set) });
    return autoMega ? { ...pm, autoMega } : pm;
  });
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
    const finals = store.gameData ? finalsOf(engine, store.gameData, mon) : [];
    const evo = finals.some(f => f.mon.id === +m.evo) ? +m.evo : null;
    const formIds = new Set([mon.id, ...finals.map(f => f.mon.id)]);
    const megas = [...formIds].flatMap(id => store.gameData?.megas[id] || []);
    out.push({
      id: mon.id,
      ability: m.ability && [...formIds].some(id => engine.abilitiesOf(engine.byId.get(id)).includes(m.ability)) ? m.ability : null,
      tera: dex.typeNames[m.tera] ? m.tera : null,
      picked: !!m.picked,
      evo,
      mega: m.mega === 0 ? 0 : megas.some(([id]) => id === +m.mega) ? +m.mega : null,   // 0 = 메가진화 안 함
      set: sanitizeSet(m.set),
    });
  }
  return out;
}

/** 내 세팅 { lv, mv: [기술 slug ≤4], it: 도구 slug, na: 성격, iv: [6 × 31이면 true] } (특성은 멤버의 ability) */
export function sanitizeSet(set) {
  if (!set || typeof set !== 'object') return null;
  const slug = s => typeof s === 'string' && /^[a-z0-9-]+$/.test(s);
  return {
    lv: Math.min(100, Math.max(1, Math.round(+set.lv) || store.gameData?.finalLevel || 75)),
    mv: [...new Set((Array.isArray(set.mv) ? set.mv : []).filter(slug))].slice(0, 4),
    it: slug(set.it) ? set.it : null,
    na: NATURES[set.na] ? set.na : null,
    iv: Array.from({ length: 6 }, (_, k) => !!set.iv?.[k]),
  };
}

const sanitizeIds = list => (Array.isArray(list) ? list : []).map(Number).filter(id => store.engine.byId.has(id)).slice(0, 6);
export const decodeIds = text => sanitizeIds(String(text).split(','));

/** 파티에 추가 (evo: 진화 목표 id, mega: 메가진화 폼 id). 실패 사유 문자열 또는 null */
export function addToParty(mon, { picked = false, evo = null, mega = null } = {}) {
  if (store.party.length >= 6) return '파티가 가득 찼어요 (최대 6마리)';
  if (store.party.some(m => store.engine.byId.get(m.id).sp === mon.sp)) return `${josa(mon.ko, '와과')} 같은 종이 이미 파티에 있어요`;
  update(s => { s.party.push({ id: mon.id, ability: null, tera: null, picked, evo, mega, set: null }); });
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
