// 칸별 전략: 멤버마다 지금 세팅 → 목표 세팅의 할 일(build.js plan)을 칸 종류별로 모아 이득이 큰 순서로 (브라우저/Node 공용)
//   기술 칸: 한 번에 한 마리 · 기술 하나 (Board_Skill_Tile) / 트레이닝 칸: 한 번에 성격 · 특성 · 개체값 하나 중 하나 (Board_Training_Tile)
//   아이템 칸·상점: 지닐 도구 / 육성 파티 아이템(학습장치 · 이상한사탕 · 종합민트 · 특성패치 · 금색병뚜껑)

/**
 * rows: [{ i, mon, known(세팅 입력함), cur, target, steps }] (steps = b.plan(mon, cur, target))
 * 기술은 지금 기술을 알아야 잴 수 있어서 세팅을 입력한 멤버만, 성격·특성·개체값·도구는 입력 전이면 기본값(무보정·개체값 20·도구 없음) 기준
 * @returns { skill: [{ i, learn, forget, gain }], training: [{ i, kind: 'na'|'ab'|'iv', to | stat, gain, assumed }],
 *            items: [{ i, to, from, gain, assumed }] } (각각 gain 큰 순)
 */
export function tileActions(rows) {
  const skill = [], training = [], items = [];
  for (const r of rows) {
    const assumed = !r.known;
    for (const s of r.steps) {
      if (s.kind === 'move') { if (r.known) skill.push({ i: r.i, learn: s.learn, forget: s.forget, gain: s.gain }); }
      else if (s.kind === 'na' || s.kind === 'ab') training.push({ i: r.i, kind: s.kind, to: s.to, gain: s.gain, assumed });
      else if (s.kind === 'iv') s.stats.forEach((stat, k) => training.push({ i: r.i, kind: 'iv', stat, gain: s.gains?.[k] ?? s.gain / s.stats.length, assumed }));
      else if (s.kind === 'it' && s.to) items.push({ i: r.i, to: s.to, from: s.from, gain: s.gain, assumed });
    }
  }
  const byGain = (a, b) => b.gain - a.gain;
  return { skill: skill.sort(byGain), training: training.sort(byGain), items: items.sort(byGain) };
}

/**
 * 육성 파티 아이템마다 가장 이득이 큰 멤버 (일반 상점의 파티 아이템 칸 · 마지막 상점).
 * 학습장치 = 기술 하나 바꾸기(기술 칸 1번과 같음), 종합민트 = 성격, 특성패치 = 특성, 금색병뚜껑 = 개체값 전부 31, 이상한사탕 = 레벨 +1
 * @returns { [key]: { i, gain, step } | null }
 */
export function growthPicks(b, rows) {
  const best = pick => {
    let out = null;
    for (const r of rows) for (const s of r.steps) {
      const x = pick(r, s);
      if (x && (!out || x.gain > out.gain)) out = { i: r.i, gain: x.gain, step: s, assumed: !r.known };
    }
    return out;
  };
  // 이상한사탕: 마지막 토너먼트 레벨에서 1 높을 때 오르는 점수 (앞으로도 계속 1 높게 유지)
  let candy = null;
  for (const r of rows) {
    const set = { ...r.target, lv: b.level };
    const gain = b.evaluate(r.mon, { ...set, lv: b.level + 1 }).score - b.evaluate(r.mon, set).score;
    if (gain > 0.05 && (!candy || gain > candy.gain)) candy = { i: r.i, gain, step: null, assumed: false };
  }
  return {
    exp_share: best((r, s) => (r.known && s.kind === 'move' ? s : null)),
    mint: best((r, s) => (s.kind === 'na' ? s : null)),
    ability_patch: best((r, s) => (s.kind === 'ab' ? s : null)),
    gold_bottle_cap: best((r, s) => (s.kind === 'iv' ? s : null)),
    rare_candy: candy,
  };
}

/**
 * 도구 하나가 나왔을 때 누가 지니면 좋은지: 목표 세팅에서 지금 도구 대신 그 도구를 지닌 점수 − 지금 도구 그대로
 * @returns [{ i, gain, from }] (gain 큰 순, 이미 그 도구를 지닌 멤버는 뺌)
 */
export function holderRank(b, rows, item) {
  // 메가진화 멤버는 메가스톤을 지녀야 해서 뺌
  return rows.filter(r => !r.stone && r.cur.it !== item).map(r => {
    const base = { ...r.target, it: r.cur.it || null };
    return { i: r.i, from: r.cur.it || null, gain: b.evaluate(r.mon, { ...base, it: item }).score - b.evaluate(r.mon, base).score };
  }).sort((a, b2) => b2.gain - a.gain);
}
