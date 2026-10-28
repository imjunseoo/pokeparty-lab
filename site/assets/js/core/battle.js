// 전투 전략: 내 파티의 기술 세팅으로 실제 데미지를 계산해 상대마다 누구를 내보내고 어떤 기술을 쓸지 (브라우저/Node 공용)
//   대면(상대 한 마리) · 상대 타입별 대응(체육관 관장·트레이너) · 멤버별 운용법

const MAX_HITS = 9;
const hitsToKo = pct => (pct > 0 ? Math.min(MAX_HITS, Math.ceil(100 / Math.min(pct, 100) - 1e-9)) : Infinity);

/**
 * 상대 foe 한 마리에 대한 멤버별 대면 (rows: [{ i, mon, set }], foeSet: 상대 세팅)
 * 먼저 쓰러뜨리는 쪽이 이김: 내가 빠르면 내 타수 ≤ 상대 타수, 느리면 내 타수 < 상대 타수 (선제기로 끝낼 수 있으면 빠른 것으로)
 * 타수는 맞았을 때 데미지로, 명중은 sure(필요한 만큼 다 맞을 확률)로 따로 본다
 * @returns [{ i, best: { slug, pct, acc, prio }, myHits, foeHits, foeMove, taken, faster(1 · 0.5 · 0), win, hpLeft, sure, verdict, margin }] (유리한 순)
 */
export function duelRank(b, rows, foe, foeSet) {
  return rows.map(r => {
    const d = b.duel(r.mon, r.set, foe, foeSet);
    let best = d.mine.find(x => x.pct > 0) || null;   // 상성 무효(땅 → 비행)만 있으면 못 때림
    const foeHits = hitsToKo(d.taken);
    let faster = d.mySpeed > d.foeSpeed ? 1 : d.mySpeed === d.foeSpeed ? 0.5 : 0;
    let myHits = best ? hitsToKo(best.pct) : Infinity;
    // 느려도 선제기로 상대보다 먼저 끝낼 수 있으면 선제기
    const prio = d.mine.find(x => x.prio);
    if (faster < 1 && prio && hitsToKo(prio.pct) <= foeHits && hitsToKo(prio.pct) <= myHits + 1) {
      best = prio; myHits = hitsToKo(prio.pct); faster = 1;
    }
    const win = myHits < Infinity && (faster === 1 ? myHits <= foeHits : myHits < foeHits);
    // 이길 때 남는 HP: 상대가 공격하는 횟수 × 받는 피해
    const foeTurns = faster === 1 ? myHits - 1 : myHits;
    const hpLeft = win ? Math.max(0, 100 - d.taken * foeTurns) : 0;
    // 명중: 필요한 횟수만큼 다 맞을 확률 (기합구슬 70% 1타 → 70%)
    const sure = best ? best.acc ** Math.min(myHits, MAX_HITS) : 0;
    const verdict = !best ? 'stuck' : win ? (hpLeft >= 50 && sure >= 0.85 ? 'good' : 'close') : 'bad';
    const margin = (Math.min(foeHits, MAX_HITS) - Math.min(myHits, MAX_HITS)) + (faster - 0.5) + (win ? hpLeft / 100 - 2 * (1 - sure) : 0);
    const foeMove = [...d.theirs].sort((a, c) => c.pct - a.pct)[0] || null;
    return { i: r.i, best, myHits, foeHits, foeMove, taken: d.taken, faster, win, hpLeft, sure, verdict, margin, mine: d.mine };
  }).sort((a, b2) => b2.margin - a.margin);
}

/**
 * 평균 승률: 상대 플레이어 포켓몬 후보 하나하나와 1:1 로 붙었을 때 먼저 쓰러뜨리는 비율 (출현 가중치, 상대는 자속 위력 90)
 * table: builder.targetTable(...) — 내가 빠르면 내 타수 ≤ 상대 타수, 느리면 < 이면 이김
 */
export function winRate(ctx, table) {
  let win = 0;
  ctx.meta.forEach((m, q) => {
    const mine = hitsToKo(table.best[q]), theirs = hitsToKo(table.taken[q]);
    if (mine < Infinity && (table.faster[q] ? mine <= theirs : mine < theirs)) win += m.w;
  });
  return win / ctx.metaW;
}

/**
 * 상대 타입별 대응: 상대 플레이어 포켓몬 후보 중 그 타입을 가진 포켓몬들에게 (가중 평균)
 * 공격 = 내 기술 중 가장 센 데미지 %, 받기 = 상대 자속 공격에 받는 %, 선공 비율
 * tables: [{ i, t: builder.targetTable(...) }]
 * @returns [{ type, n, list: [{ i, off(평균 %, 100 상한), ko(1타 비율), taken, fast, move(slug), score }] (공격 순), tank: { i, taken }, hole, danger }]
 */
export function typeBoard(ctx, tables) {
  const { types } = ctx.engine;
  return types.map(type => {
    const qs = [];
    let W = 0;
    ctx.meta.forEach((m, q) => { if (m.mon.t.includes(type)) { qs.push(q); W += m.w; } });
    if (!qs.length) return { type, n: 0, list: [], tank: null, hole: false, danger: false };
    // Lv.75 에선 평균 데미지가 100% 근처로 몰려서 1타 비율(ko)로 가른다
    const list = tables.map(({ i, t }) => {
      let off = 0, ko = 0, taken = 0, fast = 0;
      const use = new Map();
      for (const q of qs) {
        const w = ctx.meta[q].w;
        off += w * Math.min(t.best[q], 100); ko += w * (t.best[q] >= 100 ? 1 : 0); taken += w * t.taken[q]; fast += w * t.faster[q];
        if (t.move[q] >= 0) use.set(t.move[q], (use.get(t.move[q]) || 0) + w);
      }
      const k = [...use].sort((a, b) => b[1] - a[1])[0]?.[0];
      off /= W; ko /= W; taken /= W; fast /= W;
      return { i, off, ko, taken, fast, move: k === undefined ? null : t.moves[k], score: 60 * ko + 0.5 * off - 0.5 * taken + 15 * fast };
    }).sort((a, b) => b.score - a.score);
    const tank = [...list].sort((a, b) => a.taken - b.taken)[0];
    // 구멍: 누구도 평균 40% 이상 못 줌 / 위험: 절반 넘는 멤버가 평균 60% 이상 받음
    const hole = !list.length || Math.max(...list.map(x => x.off)) < 40;
    const danger = list.filter(x => x.taken >= 60).length > list.length / 2;
    return { type, n: qs.length, list, tank: tank ? { i: tank.i, taken: tank.taken } : null, hole, danger };
  });
}

// 변화기 역할 이름
const GROUP_KO = {
  'setup-phys': '랭크업', 'setup-spec': '랭크업', 'setup-both': '랭크업', heal: '회복', hazard: '설치', pivot: '교체',
  status: '상태이상', screen: '벽', protect: '방어', doubles: '더블 보조',
};

/**
 * 멤버 운용법: 기술마다 할 일 (공격기 = 상대 플레이어 포켓몬 중 그 기술이 가장 센 비율 · 효과 굉장 타입, 변화기 = 역할),
 * 잘 잡는 타입(타입별 대응에서 1순위인 타입) · 조심할 타입(받는 배율 2배 이상) · 받아내는 타입(반감 이하)
 * groupOf(slug): 변화기 역할 묶음 (ui/setdesc.js moveGroup)
 */
export function memberGuide(ctx, row, table, board, groupOf = () => null) {
  const { engine } = ctx;
  const { types, tIdx, chart } = engine;
  const W = ctx.metaW;
  const share = new Map();
  ctx.meta.forEach((m, q) => { if (table.move[q] >= 0) share.set(table.move[q], (share.get(table.move[q]) || 0) + m.w); });
  const jobs = table.moves.map((slug, k) => {
    const group = groupOf(slug);
    return { slug, k, share: (share.get(k) || 0) / W, group: group ? GROUP_KO[group] : null };
  });
  // 공격기의 효과 굉장 타입 (단일 타입 기준)
  const seOf = type => types.filter(d => chart[tIdx[type]][tIdx[d]] >= 2);
  const def = engine.defenseProfile(row.mon, { ability: row.set.ab });
  const weak = types.filter((_, a) => def[a] >= 2).sort((x, y) => def[tIdx[y]] - def[tIdx[x]]);
  const resist = types.filter((_, a) => def[a] <= 0.5);
  const best = board.filter(x => x.list[0]?.i === row.i && !x.hole).map(x => x.type);
  let fast = 0;
  ctx.meta.forEach((m, q) => { fast += m.w * table.faster[q]; });
  return { jobs, seOf, weak, immune: types.filter((_, a) => def[a] === 0), resist, best, speed: fast / W, def };
}
