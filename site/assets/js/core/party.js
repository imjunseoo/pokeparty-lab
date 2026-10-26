// 파티 분석 · 자동 추천 · 카운터 탐색 (브라우저·Node 공용)
//
// 점수 = − Σ(공격 타입별 약점 겹침 벌점 × 위협도)   ← 방어 밸런스
//        + 커버리지 × COV_W                          ← 자속 기술로 메타 포켓몬에 효과 굉장
//        + Σ 개별 점수 (종족값, 실전 사용률)
//        + Σ 쌍 점수 (실전 동료 사용률 시너지 − 타입 중복)
// 빈 슬롯은 빔 서치로 채운다.

const COV_W = 7;
const BEAM = 6;
const TYPE_OVERLAP = 0.45;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// 배율 → 위험도 점수 (2배 +1, 4배 +2, 반감 −1, ¼·무효 −2)
const sc = m => (m === 0 ? -2 : clamp(Math.log2(m), -2, 2));
const covVal = m => (m >= 2 ? 1 : m >= 1 ? 0.3 : 0);

function typePenalty(net, weak, resist, size) {
  return Math.max(0, net) ** 1.5 + (resist === 0 && size >= 3 ? 0.4 : 0) + Math.max(0, weak - 2) * 1.2;
}

/**
 * 분석/추천에 필요한 사전 계산 묶음.
 * usage 가 있으면 실전 사용률 포켓몬만 후보로, 없으면 도감 전체에서 filters 로 후보를 고른다.
 */
/**
 * 「포켓몬 파티!」 게임에서 잡을 수 있는 포켓몬과 가중치.
 * 투어 맵은 지역 출현표(가중치 = 출현 빈도), 나머지 맵은 최종진화 전체(타입·세대·색깔별 구역).
 * legends: 미라클교환·레이드로만 얻는 전설·환상·UB·패러독스 포함 여부
 */
export function gamePool(engine, { data, map = 'tour', legends = false }) {
  const weight = new Map();
  if (map === 'tour') {
    for (const area of data.areas) for (const [id, w] of area.mons) {
      if (legends || !data.pool[id]?.l) weight.set(id, (weight.get(id) || 0) + w);
    }
  }
  for (const [id, v] of Object.entries(data.pool)) {
    if (map !== 'tour' ? legends || !v.l : legends && v.l) weight.set(+id, weight.get(+id) || 1);
  }
  return [...weight].map(([id, w]) => ({ mon: engine.byId.get(id), w })).filter(e => e.mon);
}

/** 진화 전 포켓몬의 최종 진화 후보 [{ mon, item(진화 도구 slug 또는 null) }] (게임 진화 데이터 기준, 최종 진화면 []) */
export function finalsOf(engine, data, mon) {
  return (data?.evo?.[mon.id] || []).map(([id, item]) => ({ mon: engine.byId.get(id), item })).filter(x => x.mon);
}

/**
 * 잡을 수 있는 포켓몬 → 최종 진화 기준 후보. 토너먼트(Lv.75)까지 진화하므로 진화 전 포켓몬은 최종 진화로 평가하고,
 * 가중치는 진화 갈래 수로 나눠 최종 진화에 모은다.
 * @returns [{ mon(최종 진화), w, from: [진화 전 mon], direct(최종 진화를 바로 잡을 수 있는지) }]
 */
function evolvePool(engine, data, entries) {
  const out = new Map();
  const get = mon => out.get(mon.id) || out.set(mon.id, { mon, w: 0, from: [], direct: false }).get(mon.id);
  for (const { mon, w } of entries) {
    const finals = finalsOf(engine, data, mon);
    if (!finals.length) { const e = get(mon); e.w += w; e.direct = true; continue; }
    for (const f of finals) {
      const e = get(f.mon);
      e.w += w / finals.length;
      if (!e.from.includes(mon)) e.from.push(mon);
    }
  }
  return [...out.values()];
}

export function createContext(engine, { usage = null, filters = {}, game = null } = {}) {
  const { dex, types, tIdx } = engine;
  const umap = usage?.mons || {};
  const f = { game: 'all', legend: false, mega: !!usage, minBst: 450, ...filters };
  const dexGame = f.game !== 'all' ? dex.games[f.game] : null;
  const gameSet = dexGame ? new Set(dexGame.species) : null;
  const gameEntries = game ? evolvePool(engine, game.data, gamePool(engine, game)) : null;

  let candidates;
  if (gameEntries) {
    candidates = gameEntries.map(e => e.mon);
  } else if (usage) {
    candidates = Object.keys(umap).map(id => engine.byId.get(+id)).filter(Boolean);
  } else {
    candidates = dex.pokemon.filter(p => p.final && !p.battle
      && (f.legend || (!p.legend && !p.myth))
      && engine.effectiveBst(p) >= f.minBst
      && (!gameSet || (gameSet.has(p.sp) && !(p.mega && dexGame.noMega))));
  }
  if (!f.mega && !gameEntries) candidates = candidates.filter(p => !p.mega);

  // 공격 커버리지를 재는 "메타" 포켓몬: 실전 사용률 / 게임 출현 빈도 가중치, 없으면 후보 전체 동일 가중
  const meta = usage
    ? Object.entries(umap).map(([id, u]) => ({ mon: engine.byId.get(+id), w: u.u, u })).filter(m => m.mon)
    : gameEntries ? gameEntries.map(e => ({ mon: e.mon, w: e.w }))
    : candidates.map(mon => ({ mon, w: 1 }));
  const metaW = meta.reduce((a, m) => a + m.w, 0) || 1;
  // eff[a][q]: 공격 타입 a 가 메타 포켓몬 q 에 주는 배율 (q 의 대표 특성 반영)
  const eff = types.map(() => new Float32Array(meta.length));
  meta.forEach((m, q) => {
    const prof = engine.defenseProfile(m.mon, { ability: engine.defaultAbility(m.mon, m.u) });
    prof.forEach((x, a) => { eff[a][q] = x; });
  });

  // 공격 타입별 위협도: 실전에서 그 타입 공격기가 얼마나 쓰이는지 (평균 1)
  const threat = new Float32Array(types.length).fill(1);
  if (usage) {
    const raw = new Float32Array(types.length);
    for (const m of meta) {
      for (const [slug, p] of m.u.mv || []) {
        const mv = usage.moves[slug];
        if (mv && mv[3] > 0 && tIdx[mv[2]] !== undefined) raw[tIdx[mv[2]]] += m.w * p;
      }
    }
    const mean = raw.reduce((a, b) => a + b, 0) / types.length || 1;
    raw.forEach((v, a) => { threat[a] = 0.5 + 0.5 * (v / mean); });
  }

  const ctx = { engine, usage, umap, filters: f, game, meta, metaW, eff, threat };
  // 게임이 원작과 다른 종족값을 쓰는 포켓몬 (예: 메가메타그로스)
  const changed = game?.data.changed || {};
  ctx.stats = mon => changed[mon.id]?.st || mon.st;

  /**
   * 분석용 멤버/후보. mon = 실제로 싸우는 모습(최종 진화·메가진화), base = 잡는(가진) 모습.
   * atk: 입력한 세팅의 공격 기술 타입 (없으면 자속 타입으로 공격 범위를 잰다)
   * from/direct: 진화 전 모습으로 잡는 후보, stone: 메가스톤 (메가진화 룰)
   */
  ctx.prep = (mon, { ability, tera = null, locked = false, atk = null, base = null, from = [], direct = true, stone = null } = {}) => {
    const u = umap[mon.id];
    const ab = ability === undefined ? engine.defaultAbility(mon, u) : ability;
    const def = engine.defenseProfile(mon, { ability: ab, tera });
    const stabs = engine.stabTypes(mon, tera);
    const atkTypes = atk?.length ? atk : stabs;
    const off = new Float32Array(meta.length);
    for (const s of atkTypes) {
      const row = eff[tIdx[s]];
      for (let q = 0; q < meta.length; q++) if (row[q] > off[q]) off[q] = row[q];
    }
    const total = engine.effectiveBst(mon) - engine.bst(mon) + ctx.stats(mon).reduce((a, b) => a + b, 0);
    const indiv = usage
      ? clamp((total - 500) / 100, -1, 1) * 0.25 + 0.55 * Math.log1p(u?.u || 0)
      : clamp((total - 500) / 100, -1.5, 1.2) * 0.9;
    return {
      mon, id: mon.id, sp: mon.sp, ability: ab, tera, locked, def, stabs, atk: atkTypes, moves: !!atk?.length, off, indiv, u,
      mega: !!mon.mega, base: base || mon, from, direct, stone,
    };
  };

  // 후보: 게임 모드는 최종 진화 기준 + 메가진화 룰이면 메가스톤을 살 수 있는 포켓몬의 메가진화 모습도 (파티당 1마리)
  const entries = gameEntries || candidates.map(mon => ({ mon, from: [], direct: true }));
  ctx.pool = entries.map(e => ctx.prep(e.mon, { from: e.from, direct: e.direct }));
  ctx.megaRule = !!game && (game.rule?.uses || []).includes('mega');
  if (ctx.megaRule) {
    for (const e of entries) for (const [mid, stone] of game.data.megas[e.mon.id] || []) {
      const mega = engine.byId.get(mid);
      if (mega) ctx.pool.push(ctx.prep(mega, { base: e.mon, from: e.from, direct: e.direct, stone }));
    }
  }
  return ctx;
}

/** 두 포켓몬의 실전 동료 시너지 (사용률 기반 lift) − 타입 중복 벌점 */
function pairScore(ctx, a, b) {
  let s = -TYPE_OVERLAP * a.mon.t.filter(t => b.mon.t.includes(t)).length;
  if (ctx.usage && a.u && b.u) {
    const ab = a.u.tm?.find(([id]) => id === b.id)?.[1];
    const ba = b.u.tm?.find(([id]) => id === a.id)?.[1];
    const lifts = [ab && ab / b.u.u, ba && ba / a.u.u].filter(Boolean);
    s += lifts.length ? 0.8 * clamp(Math.log(lifts.reduce((x, y) => x + y, 0) / lifts.length), -0.8, 1.2) : -0.08;
  }
  return s;
}

function emptyState(ctx) {
  const n = ctx.engine.types.length;
  return {
    members: [], net: new Float32Array(n), weak: new Uint8Array(n), resist: new Uint8Array(n),
    best: new Float32Array(ctx.meta.length), pair: 0, indiv: 0, megas: 0, species: new Set(),
  };
}

function addMember(ctx, st, c) {
  const next = {
    members: [...st.members, c], net: st.net.slice(), weak: st.weak.slice(), resist: st.resist.slice(),
    best: st.best.slice(), pair: st.pair, indiv: st.indiv + c.indiv, megas: st.megas + (c.mega ? 1 : 0),
    species: new Set(st.species).add(c.sp),
  };
  c.def.forEach((x, a) => { next.net[a] += sc(x); if (x > 1) next.weak[a]++; else if (x < 1) next.resist[a]++; });
  for (let q = 0; q < next.best.length; q++) if (c.off[q] > next.best[q]) next.best[q] = c.off[q];
  for (const m of st.members) next.pair += pairScore(ctx, m, c);
  return next;
}

const stateOf = (ctx, members) => members.reduce((st, m) => addMember(ctx, st, m), emptyState(ctx));

function defPenalty(ctx, st, extra = null) {
  const size = st.members.length + (extra ? 1 : 0);
  let pen = 0;
  for (let a = 0; a < st.net.length; a++) {
    const x = extra ? extra.def[a] : 1;
    pen += ctx.threat[a] * typePenalty(st.net[a] + (extra ? sc(x) : 0), st.weak[a] + (x > 1 ? 1 : 0), st.resist[a] + (x < 1 ? 1 : 0), size);
  }
  return pen;
}

function coverage(ctx, st, extra = null) {
  let cov = 0;
  for (let q = 0; q < ctx.meta.length; q++) {
    const b = extra && extra.off[q] > st.best[q] ? extra.off[q] : st.best[q];
    cov += ctx.meta[q].w * covVal(b);
  }
  return cov / ctx.metaW;
}

/** 상태 st 에 후보 c 를 넣었을 때의 총점 */
function scoreWith(ctx, st, c) {
  let pair = st.pair;
  for (const m of st.members) pair += pairScore(ctx, m, c);
  return -defPenalty(ctx, st, c) + COV_W * coverage(ctx, st, c) + st.indiv + c.indiv + pair;
}

const totalScore = (ctx, st) => -defPenalty(ctx, st) + COV_W * coverage(ctx, st) + st.indiv + st.pair;

function allowed(st, c) {
  return !st.species.has(c.sp) && !(c.mega && st.megas >= 1);
}

/**
 * 빈 슬롯 자동 추천.
 * @param members  prep 된 현재 파티 (locked 가 true 인 것만 유지)
 * @returns { party: prepped[], picks: Set<id>, alternatives: Map<id, [{c, score}]>, reasons: Map<id, reason[]> }
 */
export function recommend(ctx, members, size = 6) {
  const locked = members.filter(m => m.locked);
  const slots = Math.max(0, size - locked.length);
  let beam = [stateOf(ctx, locked)];
  for (let step = 0; step < slots; step++) {
    const next = [];
    for (const st of beam) {
      const scored = [];
      for (const c of ctx.pool) if (allowed(st, c)) scored.push([scoreWith(ctx, st, c), c]);
      scored.sort((a, b) => b[0] - a[0]);
      for (const [s, c] of scored.slice(0, BEAM)) next.push({ st, c, s });
    }
    if (!next.length) break;
    next.sort((a, b) => b.s - a.s);
    const seen = new Set();
    beam = [];
    for (const { st, c } of next) {
      const key = [...st.members.map(m => m.id), c.id].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(addMember(ctx, st, c));
      if (beam.length >= BEAM) break;
    }
  }
  const final = beam[0];
  const picked = final.members.filter(m => !locked.includes(m));
  // 사용자가 넣은 순서를 유지하고 추천은 뒤에 붙인다
  const party = [...locked, ...picked];
  const alternatives = new Map(), reasons = new Map();
  for (const c of picked) {
    const i = party.indexOf(c);
    alternatives.set(c.id, alternativesFor(ctx, party, i));
    reasons.set(c.id, explainSlot(ctx, party, i));
  }
  return { party, picks: new Set(picked.map(m => m.id)), alternatives, reasons };
}

/** i 번째 멤버 대신 넣을 수 있는 후보 (나머지 파티 기준 점수순) */
export function alternativesFor(ctx, members, i, limit = 6) {
  const rest = stateOf(ctx, members.filter((_, j) => j !== i));
  return ctx.pool.filter(x => x.id !== members[i].id && allowed(rest, x))
    .map(x => ({ c: x, score: scoreWith(ctx, rest, x) })).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** i 번째 멤버가 나머지 파티에 주는 보완점 */
export function explainSlot(ctx, members, i) {
  return explain(ctx, stateOf(ctx, members.filter((_, j) => j !== i)), members[i]);
}

/** 지금 파티에 후보 c 를 넣으면 무엇이 좋아지는지 (추천 예시 코멘트용) */
export const explainCandidate = (ctx, members, c) => explain(ctx, stateOf(ctx, members), c);

/**
 * 야생 칸 후보를 잡아 파티에 넣었을 때의 점수 상승폭. 파티가 6마리면 가장 덜 아까운 멤버와 바꾼 경우로 잰다.
 * @returns { gain, replace: 바꿀 멤버 번호 | null, blocked: 같은 종이 이미 있거나 메가진화가 이미 있음, reasons }
 */
export function catchValue(ctx, members, c, { prepared = prepareCatch(ctx, members), reasons = true } = {}) {
  const { st, base, rests } = prepared;
  if (st.species.has(c.sp)) return { gain: -Infinity, replace: null, blocked: true, reasons: [] };   // 같은 종이 이미 있음
  if (members.length < 6) {
    if (!allowed(st, c)) return { gain: -Infinity, replace: null, blocked: true, reasons: [] };
    return { gain: scoreWith(ctx, st, c) - base, replace: null, blocked: false, reasons: reasons ? explain(ctx, st, c) : [] };
  }
  let best = null;
  rests.forEach((rest, i) => {
    if (!allowed(rest, c)) return;
    const gain = scoreWith(ctx, rest, c) - base;
    if (!best || gain > best.gain) best = { gain, replace: i, rest };
  });
  if (!best) return { gain: -Infinity, replace: null, blocked: true, reasons: [] };
  return { gain: best.gain, replace: best.replace, blocked: false, reasons: reasons ? explain(ctx, best.rest, c) : [] };
}

/**
 * 멤버마다 파티 안에서의 몫: 그 멤버를 빼면 잃는 점수(종족값 몫 indiv 는 따로) · 빼면 약점이 몰리는 타입 · 보완 이유
 * @returns [{ synergy, indiv, exposed: [타입], reasons }]
 */
export function memberValues(ctx, members) {
  const { types } = ctx.engine;
  const st = stateOf(ctx, members);
  const base = totalScore(ctx, st);
  return members.map((m, i) => {
    const rest = stateOf(ctx, members.filter((_, j) => j !== i));
    const exposed = types.filter((_, a) => rest.weak[a] - rest.resist[a] >= 2 && st.weak[a] - st.resist[a] < 2);
    return { synergy: base - totalScore(ctx, rest) - m.indiv, indiv: m.indiv, exposed, reasons: explain(ctx, rest, m) };
  });
}

/** 후보를 많이 잴 때 쓰는 미리 계산 (지금 파티 상태 · 한 마리씩 뺀 상태) */
export function prepareCatch(ctx, members) {
  const st = stateOf(ctx, members);
  return {
    st, base: totalScore(ctx, st),
    rests: members.length >= 6 ? members.map((_, i) => stateOf(ctx, members.filter((__, j) => j !== i))) : [],
  };
}

/** 후보 c 가 나머지 파티 rest 에 무엇을 보완하는지 설명 */
export function explain(ctx, rest, c) {
  const { engine } = ctx;
  const { types, chart, tIdx } = engine;
  const out = [];
  // 방어: 나머지 파티가 약점 우세인 타입을 반감/무효
  const fixes = [];
  types.forEach((t, a) => {
    const exposed = rest.weak[a] - rest.resist[a];
    if (exposed > 0 && c.def[a] < 1) fixes.push({ type: t, mult: c.def[a], sev: exposed });
  });
  fixes.sort((x, y) => y.sev - x.sev || x.mult - y.mult);
  for (const fx of fixes.slice(0, 3)) out.push({ kind: 'def', type: fx.type, mult: fx.mult, sev: fx.sev });
  // 공격: 기존 자속으로 효과 굉장을 못 주던 단일 타입
  const restBest = types.map((_, d) => Math.max(0, ...rest.members.flatMap(m => m.atk.map(s => chart[tIdx[s]][d]))));
  const gains = types.filter((_, d) => restBest[d] < 2 && Math.max(...c.atk.map(s => chart[tIdx[s]][d])) >= 2);
  if (gains.length) out.push({ kind: 'off', types: gains.slice(0, 4) });
  const covGain = coverage(ctx, rest, c) - coverage(ctx, rest);
  if (covGain >= 0.03) out.push({ kind: 'cov', value: covGain });
  // 실전 동료 사용률
  if (ctx.usage && c.u) {
    let best = null;
    for (const m of rest.members) {
      const p = m.u?.tm?.find(([id]) => id === c.id)?.[1];
      if (p && (!best || p > best.pct)) best = { with: m.mon, pct: p };
    }
    if (best) out.push({ kind: 'mate', ...best });
    out.push({ kind: 'usage', u: c.u.u, rank: c.u.r });
  }
  // 상성 보완 이유가 없으면 능력치(종족값)로 뽑힌 것
  if (!out.some(r => r.kind === 'def' || r.kind === 'off' || r.kind === 'cov')) out.push({ kind: 'bst', value: engine.bst(c.mon) });
  // 게임 룰·진화: 메가진화로 싸우는 후보, 진화 전 모습으로 잡는 후보
  if (c.stone) out.push({ kind: 'mega', stone: c.stone, base: c.base, value: engine.bst(c.mon) });
  if (c.from?.length && !c.direct) out.push({ kind: 'evo', from: c.from });
  // 경고: 이 포켓몬을 넣으면 같은 약점이 3마리 이상
  types.forEach((t, a) => {
    if (c.def[a] > 1 && rest.weak[a] + 1 >= 3) out.push({ kind: 'warn', type: t, count: rest.weak[a] + 1 });
  });
  return out;
}

/** 파티 종합 분석 (표·진단·점수) */
export function analyze(ctx, members) {
  const { engine } = ctx;
  const { types, chart, tIdx } = engine;
  const st = stateOf(ctx, members);
  const rows = types.map((t, a) => {
    const mults = members.map(m => m.def[a]);
    const weak = st.weak[a], resist = st.resist[a];
    const immune = mults.filter(x => x === 0).length;
    const level = weak - resist >= 2 || (weak >= 3 && resist <= 1) ? 'danger'
      : weak > resist || weak >= 3 ? 'warn' : resist >= 2 && weak === 0 ? 'good' : 'ok';
    return { type: t, mults, weak, resist, immune, net: st.net[a], level };
  });
  const offense = types.map((d, di) => {
    let best = 0;
    const by = [];
    members.forEach((m, i) => {
      const x = Math.max(...m.atk.map(s => chart[tIdx[s]][di]));
      if (x > best) { best = x; by.length = 0; by.push(i); } else if (x === best) by.push(i);
    });
    return { type: d, best, by };
  });

  // 점수 보정: 무작위 6마리 파티 중앙값 ≈ 50점대, 추천 파티 ≈ 90점대
  const pen = defPenalty(ctx, st);
  const cov = members.length ? coverage(ctx, st) : 0;
  let se = 0; // 자속 효과 굉장을 줄 수 있는 메타 포켓몬 비율 (표시용)
  for (let q = 0; q < ctx.meta.length; q++) if (st.best[q] >= 2) se += ctx.meta[q].w;
  const seShare = se / ctx.metaW;
  const def = members.length ? Math.round(100 * Math.exp(-pen / 20)) : 0;
  const off = Math.round(100 * clamp((cov - 0.7) / 0.27, 0, 1));
  const total = members.length ? Math.round(0.6 * def + 0.4 * off) : 0;
  const grade = total >= 90 ? 'S' : total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';

  const diag = [];
  const nameList = idx => idx.map(i => members[i].mon.ko).join(', ');
  for (const r of rows) {
    const weakIdx = r.mults.map((x, i) => (x > 1 ? i : -1)).filter(i => i >= 0);
    if (r.level === 'danger') diag.push({ level: 'danger', type: r.type, text: `공격에 약한 포켓몬 ${r.weak}마리 (${nameList(weakIdx)}) · 받아줄 포켓몬 ${r.resist}마리` });
    else if (r.level === 'warn') diag.push({ level: 'warn', type: r.type, text: `약점 ${r.weak}마리 > 반감 ${r.resist}마리 (${nameList(weakIdx)})` });
  }
  members.forEach(m => m.def.forEach((x, a) => {
    if (x >= 4) diag.push({ level: 'info', type: types[a], text: `${m.mon.ko}의 4배 약점` });
  }));
  if (members.length >= 3) {
    const noResist = rows.filter(r => r.resist === 0).map(r => r.type);
    if (noResist.length) diag.push({ level: 'warn', types: noResist, text: '이 타입 공격을 반감 이하로 받아줄 포켓몬이 없습니다' });
    const uncovered = offense.filter(o => o.best < 2).map(o => o.type);
    if (uncovered.length) diag.push({ level: 'info', types: uncovered, text: '자속 기술로 효과가 굉장하지 않은 타입' });
  }
  if (ctx.usage) {
    for (let i = 0; i < members.length; i++) for (let j = 0; j < members.length; j++) {
      if (i === j) continue;
      const p = members[i].u?.tm?.find(([id]) => id === members[j].id)?.[1];
      if (p >= 25 && i < j) diag.push({ level: 'good', text: `${members[i].mon.ko} + ${members[j].mon.ko}: 실전에서 자주 함께 쓰는 조합 (동반 ${p}%)` });
    }
  }
  if (members.length >= 3 && !rows.some(r => r.level === 'danger')) diag.unshift({ level: 'good', text: '3마리 이상 겹치는 치명적 약점이 없습니다' });

  return { rows, offense, scores: { def, off, total, grade, coverage: cov, seShare }, diag };
}

/** 타깃 포켓몬을 상성으로 잡기 좋은 후보 (자속 효과 굉장 + 상대 자속을 반감) */
export function findCounters(ctx, target, { ability = null, tera = null } = {}, limit = 12) {
  const { engine } = ctx;
  const prof = engine.defenseProfile(target, { ability, tera });
  const tStabs = engine.stabTypes(target, tera).map(s => engine.tIdx[s]);
  return ctx.pool.filter(c => c.sp !== target.sp).map(c => {
    let off = 0, offType = null;
    for (const s of c.atk) { const x = prof[engine.tIdx[s]]; if (x > off) { off = x; offType = s; } }
    const def = Math.max(...tStabs.map(a => c.def[a]));
    const score = Math.log2(Math.max(off, 0.25)) * 1.6 - Math.log2(Math.max(def, 0.125)) * 1.1 + c.indiv * 0.4;
    return { c, off, offType, def, score };
  }).filter(r => r.off >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * 다음에 노릴 "속성(타입)" 추천 + 타입별 예시 포켓몬.
 * 원하는 포켓몬을 고를 수 없는 게임용: 후보 하나하나를 넣어 본 점수 상승폭을 타입별로 모아 순위를 매긴다.
 * @returns [{ type, score, reasons, list: [{ c, gain }] (점수순) }]
 */
export function recommendTypes(ctx, members, { limit = 6 } = {}) {
  const { engine } = ctx;
  const { types, chart, tIdx } = engine;
  const st = stateOf(ctx, members);
  const base = totalScore(ctx, st);
  const groups = new Map();
  for (const c of ctx.pool) {
    if (!allowed(st, c)) continue;
    const gain = scoreWith(ctx, st, c) - base;
    for (const t of c.mon.t) (groups.get(t) || groups.set(t, []).get(t)).push({ c, gain });
  }
  // 파티가 아직 못 받아내는(약점 우세) 공격 타입, 자속으로 효과 굉장을 못 주는 타입
  const exposed = types.map((t, a) => ({ t, sev: st.weak[a] - st.resist[a] + (st.resist[a] === 0 && st.members.length >= 2 ? 0.5 : 0) }))
    .filter(x => x.sev > 0).sort((a, b) => b.sev - a.sev);
  const restBest = types.map((_, d) => Math.max(0, ...st.members.flatMap(m => m.atk.map(s => chart[tIdx[s]][d]))));
  return [...groups].map(([type, list]) => {
    list.sort((a, b) => b.gain - a.gain);
    const top = list.slice(0, 3);
    const score = top.reduce((a, x) => a + x.gain, 0) / top.length;
    const reasons = [];
    for (const x of exposed) {
      const m = engine.effectiveness(x.t, [type]);
      if (m < 1) reasons.push({ kind: 'def', type: x.t, mult: m });
    }
    const gains = types.filter((_, d) => restBest[d] < 2 && chart[tIdx[type]][d] >= 2);
    if (gains.length) reasons.push({ kind: 'off', types: gains });
    const newWeak = types.filter((t, a) => engine.effectiveness(t, [type]) > 1 && st.weak[a] >= 2);
    if (newWeak.length) reasons.push({ kind: 'warn-types', types: newWeak });
    return { type, score, reasons: [...reasons.filter(r => r.kind === 'def').slice(0, 4), ...reasons.filter(r => r.kind !== 'def')], list };
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

const matchVal = m => (m >= 4 ? 2 : m >= 2 ? 1 : m >= 1 ? 0 : m >= 0.5 ? -0.6 : m > 0 ? -1 : -1.5);

/**
 * 상대 파티를 보고 내 선봉 고르기.
 * 각 포켓몬마다: 상대 전원에게 주는 자속 배율(공격) · 상대 자속에 받는 배율(방어) · 스피드 우위를 합산.
 * double 이면 함께 내보낼 선봉 2마리 조합도 고른다.
 */
export function leadAnalysis(ctx, mine, foes, { double = false } = {}) {
  const { engine } = ctx;
  const { tIdx } = engine;
  const spe = m => ctx.stats(m.mon)[5];
  const rows = mine.map(m => {
    const cells = foes.map(o => {
      let atk = 0, atkType = null;
      for (const s of m.atk) { const x = o.def[tIdx[s]]; if (x > atk) { atk = x; atkType = s; } }
      let recv = 0, recvType = null;
      for (const s of o.stabs) { const x = m.def[tIdx[s]]; if (x > recv) { recv = x; recvType = s; } }
      const faster = spe(m) > spe(o) ? 1 : spe(m) === spe(o) ? 0.5 : 0;
      return { atk, atkType, recv, recvType, faster };
    });
    const n = cells.length || 1;
    const offense = cells.reduce((a, c) => a + matchVal(c.atk), 0) / n;
    const defense = -cells.reduce((a, c) => a + matchVal(c.recv), 0) / n;
    const speed = cells.reduce((a, c) => a + c.faster, 0) / n;
    const score = offense * 1.0 + defense * 0.9 + speed * 0.6 + m.indiv * 0.15;
    return {
      m, cells, offense, defense, speed, score,
      se: cells.filter(c => c.atk >= 2).length,
      weakTo: cells.filter(c => c.recv >= 2).length,
      outspeed: cells.filter(c => c.faster === 1).length,
    };
  });
  const ranked = [...rows].sort((a, b) => b.score - a.score);

  let pair = null;
  if (double && rows.length >= 2) {
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      // 둘 중 하나라도 효과 굉장을 주는 상대 수, 둘 다 약점을 찔리는 상대 수
      const cover = foes.filter((_, k) => a.cells[k].atk >= 2 || b.cells[k].atk >= 2).length;
      const both = foes.filter((_, k) => a.cells[k].recv >= 2 && b.cells[k].recv >= 2).length;
      const s = a.score + b.score + 0.25 * cover - 0.35 * both;
      if (!pair || s > pair.score) pair = { rows: [a, b], score: s, cover, both };
    }
  }
  // 위협: 내 파티 여럿의 약점을 찌르고, 내가 효과 굉장을 주기 어려운 상대
  const threats = foes.map((o, k) => ({
    o, hitsMe: rows.filter(r => r.cells[k].recv >= 2).length, iHit: rows.filter(r => r.cells[k].atk >= 2).length,
  })).map(t => ({ ...t, danger: t.hitsMe - t.iHit * 0.7 })).sort((a, b) => b.danger - a.danger);
  return { rows, ranked, pair, threats };
}

/** 내 파티 각 포켓몬 vs 타깃 */
export function partyVersus(ctx, members, target, { ability = null, tera = null } = {}) {
  const { engine } = ctx;
  return members.map(m => {
    const atk = engine.bestStab(m.mon, target, { atkTera: m.tera, defAbility: ability, defTera: tera });
    const tStabs = engine.stabTypes(target, tera);
    let recv = 0, recvType = null;
    for (const s of tStabs) { const x = m.def[engine.tIdx[s]]; if (x > recv) { recv = x; recvType = s; } }
    const verdict = atk.mult >= 2 && recv <= 1 ? 'good' : recv >= 2 && atk.mult <= 1 ? 'bad' : atk.mult > recv ? 'good-ish' : atk.mult < recv ? 'bad-ish' : 'even';
    return { m, atk: atk.mult, atkType: atk.type, recv, recvType, verdict };
  });
}
