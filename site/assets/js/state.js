// 앱 상태 (데이터, 데이터 기준, 파티) + localStorage 저장
import { createEngine } from './core/engine.js';
import { createSearch } from './core/search.js';
import { createContext } from './core/party.js';
import { josa, storage } from './ui/dom.js';

export const TYPE_MODE = 'type';

export const store = {
  dex: null,
  engine: null,
  search: null,
  usageIndex: [],   // 사용 가능한 실전 데이터 포맷 목록
  usage: null,      // 현재 포맷의 실전 데이터 (타입 모드면 null)
  mode: TYPE_MODE,
  filters: { game: 'all', legend: false, mega: false, minBst: 450, usageMega: true },
  party: [],        // [{ id, ability, tera, locked, picked }]
  recent: [],
};

const listeners = new Set();
const usageCache = new Map();
let ctxCache = null;
let ctxKey = '';

export function initStore(dex, usageIndex) {
  store.dex = dex;
  store.engine = createEngine(dex);
  store.search = createSearch(dex.pokemon);
  store.usageIndex = usageIndex?.formats || [];
  const saved = storage.get('ppl.mode', null);
  const valid = k => k === TYPE_MODE || store.usageIndex.some(f => f.key === k);
  store.mode = valid(saved) ? saved : store.usageIndex[0]?.key || TYPE_MODE;
  store.filters = { ...store.filters, ...storage.get('ppl.filters', {}) };
  store.party = sanitizeParty(storage.get('ppl.party', []));
  store.recent = storage.get('ppl.recent', []).filter(id => store.engine.byId.has(id)).slice(0, 8);
}

export const subscribe = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn());

function persist() {
  storage.set('ppl.mode', store.mode);
  storage.set('ppl.filters', store.filters);
  storage.set('ppl.party', store.party);
  storage.set('ppl.recent', store.recent);
}

/** 상태 변경 → 저장 → 화면 갱신 */
export function update(fn) {
  fn(store);
  persist();
  emit();
}

export const usageInfo = () => store.usageIndex.find(f => f.key === store.mode) || null;

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
  const filters = store.usage ? { mega: f.usageMega } : { game: f.game, legend: f.legend, mega: f.mega, minBst: f.minBst };
  const key = `${store.mode}|${store.usage?.month || ''}|${JSON.stringify(filters)}`;
  if (key !== ctxKey) {
    ctxCache = createContext(store.engine, { usage: store.usage, filters });
    ctxKey = key;
  }
  return ctxCache;
}

/** 저장된 파티 → 분석용 멤버 */
export function partyMembers(ctx = getContext()) {
  return store.party.map(m => ctx.prep(store.engine.byId.get(m.id), { ability: m.ability || undefined, tera: m.tera || null, locked: m.locked }));
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
    return m && { id: +m[1], ability: m[2] || null, tera: m[3] || null, locked: true, picked: false };
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
      locked: m.locked !== false,
      picked: !!m.picked,
    });
  }
  return out;
}

/** 파티에 추가. 실패 사유 문자열 또는 null */
export function addToParty(mon) {
  if (store.party.length >= 6) return '파티가 가득 찼어요 (최대 6마리)';
  if (store.party.some(m => store.engine.byId.get(m.id).sp === mon.sp)) return `${josa(mon.ko, '와과')} 같은 종이 이미 파티에 있어요`;
  update(s => { s.party.push({ id: mon.id, ability: null, tera: null, locked: true, picked: false }); });
  return null;
}
