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
export function createContext(engine, { usage = null, filters = {} } = {}) {
  const { dex, types, tIdx } = engine;
  const umap = usage?.mons || {};
  const f = { game: 'all', legend: false, mega: !!usage, minBst: 450, ...filters };
  const game = f.game !== 'all' ? dex.games[f.game] : null;
  const gameSet = game ? new Set(game.species) : null;

  let candidates;
  if (usage) {
    candidates = Object.keys(umap).map(id => engine.byId.get(+id)).filter(Boolean);
  } else {
    candidates = dex.pokemon.filter(p => p.final && !p.battle
      && (f.legend || (!p.legend && !p.myth))
      && engine.effectiveBst(p) >= f.minBst
      && (!gameSet || (gameSet.has(p.sp) && !(p.mega && game.noMega))));
  }
  if (!f.mega) candidates = candidates.filter(p => !p.mega);

  // 공격 커버리지를 재는 "메타" 포켓몬: 실전 사용률 가중치, 없으면 후보 전체 동일 가중
  const meta = usage
    ? Object.entries(umap).map(([id, u]) => ({ mon: engine.byId.get(+id), w: u.u, u })).filter(m => m.mon)
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

  const ctx = { engine, usage, umap, filters: f, meta, metaW, eff, threat };

  ctx.prep = (mon, { ability, tera = null, locked = false } = {}) => {
    const u = umap[mon.id];
    const ab = ability === undefined ? engine.defaultAbility(mon, u) : ability;
    const def = engine.defenseProfile(mon, { ability: ab, tera });
    const stabs = engine.stabTypes(mon, tera);
    const off = new Float32Array(meta.length);
    for (const s of stabs) {
      const row = eff[tIdx[s]];
      for (let q = 0; q < meta.length; q++) if (row[q] > off[q]) off[q] = row[q];
    }
    const total = engine.effectiveBst(mon);
    const indiv = usage
      ? clamp((total - 500) / 100, -1, 1) * 0.25 + 0.55 * Math.log1p(u?.u || 0)
      : clamp((total - 500) / 100, -1.5, 1.2) * 0.9;
    return { mon, id: mon.id, sp: mon.sp, ability: ab, tera, locked, def, stabs, off, indiv, u, mega: !!mon.mega };
  };

  ctx.pool = candidates.map(mon => ctx.prep(mon));
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
  const restBest = types.map((_, d) => Math.max(0, ...rest.members.flatMap(m => m.stabs.map(s => chart[tIdx[s]][d]))));
  const gains = types.filter((_, d) => restBest[d] < 2 && Math.max(...c.stabs.map(s => chart[tIdx[s]][d])) >= 2);
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
      const x = Math.max(...m.stabs.map(s => chart[tIdx[s]][di]));
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
    for (const s of c.stabs) { const x = prof[engine.tIdx[s]]; if (x > off) { off = x; offType = s; } }
    const def = Math.max(...tStabs.map(a => c.def[a]));
    const score = Math.log2(Math.max(off, 0.25)) * 1.6 - Math.log2(Math.max(def, 0.125)) * 1.1 + c.indiv * 0.4;
    return { c, off, offType, def, score };
  }).filter(r => r.off >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
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
