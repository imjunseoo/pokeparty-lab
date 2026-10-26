// 보드 칸 추천 (브라우저·Node 공용, DOM 의존 없음)
//
// 이동 규칙 (게임 스크립트 기준)
//   · 주사위(1~10)만큼 next 를 따라 한 칸씩. 갈림길(next 가 목록)은 지나갈 때 고른다 (출발 칸이 갈림길이어도)
//   · 지나가기만 해도 쓰는 칸: 센터·상점(trigger pass, 또는 갈림길 칸인데 멈추면 센터·상점), 시작 칸(용돈 1000원)
//   · 멈춘 칸의 이벤트: 갈림길 칸은 land 타입, 자전거 = 50% 앞으로 1~5칸 / 50% 뒤로 1~3칸, 엘리베이터·보트 = 짝 칸으로 이동 가능
//   · 메이즈: 스위치(gate)가 켜졌는지 꺼졌는지에 따라 열리는 길이 다르다
//
// 칸 가치는 바깥에서 넘겨받는 valueOf(node) 로 계산 (지금 파티·세팅에 따라 달라짐) → 이 파일은 길 찾기와 합산만 한다.

export const DICE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const SERVICE = new Set(['center', 'shop']);

/** 맵 칸 표 → Map(id → { ...칸, outs: [[다음 칸, 문구]], ins: [이전 칸] }) (메이즈는 스위치 상태로 길을 거름) */
export function graphOf(map, gate = 'off') {
  const g = new Map(map.nodes.map(n => [n.id, { ...n, outs: [], ins: [] }]));
  for (const n of map.nodes) {
    const outs = Array.isArray(n.next)
      ? n.next.filter(([, , cond]) => !cond || cond === gate).map(([to, label]) => [to, label])
      : [[n.next, '']];
    g.get(n.id).outs = outs;
    for (const [to] of outs) g.get(to)?.ins.push(n.id);
  }
  return g;
}

/** 멈추면 일어나는 이벤트 종류 */
export const landType = node => (node.trigger === 'branch' && node.land ? node.land : node.type);
/** 지나가기만 해도 쓰는 칸인가 */
export const passService = node => node.trigger === 'pass' || (node.trigger === 'branch' && SERVICE.has(node.land));

/**
 * from 에서 steps 칸 갔을 때 가능한 모든 길 (갈림길마다 갈라짐).
 * @returns [{ land, passed: [지나간 칸...], choices: [{ at, to, label }] }]
 */
export function paths(g, from, steps) {
  const out = [];
  const walk = (id, left, passed, choices) => {
    const node = g.get(id);
    if (!left || !node.outs.length) { out.push({ land: id, passed: passed.slice(0, -1), choices }); return; }
    for (const [to, label] of node.outs) {
      const ch = node.outs.length > 1 ? [...choices, { at: id, to, label }] : choices;
      walk(to, left - 1, [...passed, to], ch);
    }
  };
  walk(from, steps, [], []);
  return out;
}

/** 뒤로 n 칸 (자전거에서 넘어짐): 들어오는 길이 여럿이면 모두 */
export function backward(g, from, steps) {
  let cur = [from];
  for (let k = 0; k < steps; k++) cur = [...new Set(cur.flatMap(id => (g.get(id).ins.length ? g.get(id).ins : [id])))];
  return cur;
}

/**
 * 한 번의 이동 가치 = 멈춘 칸 가치 + 지나간 센터·상점·시작 칸 가치.
 * valueOf(node, { passing }) → { value, kind, note }
 */
export function moveValue(g, route, valueOf) {
  const land = g.get(route.land);
  const items = [];
  const seen = new Set();
  for (const id of route.passed) {
    const n = g.get(id);
    if (!(passService(n) || n.type === 'start')) continue;
    const key = n.type === 'start' ? 'start' : landType(n);
    if (seen.has(key)) continue;   // 같은 종류 서비스는 한 번만 셈
    seen.add(key);
    items.push({ id, passing: true, ...valueOf(n, { passing: true }) });
  }
  const landing = { id: land.id, passing: false, ...valueOf(land, { passing: false }) };
  return { value: landing.value + items.reduce((a, x) => a + x.value, 0), landing, passes: items };
}

/**
 * 주사위 d 로 갈 수 있는 선택지마다 점수. lookahead: 멈춘 자리에서 다음 턴 기대 점수 × γ
 * special(node) 이 있으면 자전거·엘리베이터·보트처럼 멈춘 뒤 이어지는 이동을 그 값으로 대신한다.
 */
export function rankMoves(g, from, d, valueOf, { gamma = 0.4, nextTurn = null } = {}) {
  return paths(g, from, d).map(route => {
    const mv = moveValue(g, route, valueOf);
    const ahead = nextTurn ? nextTurn(route.land) : 0;
    return { ...route, ...mv, ahead, total: mv.value + gamma * ahead };
  }).sort((a, b) => b.total - a.total);
}

/** 다음 턴 기대 점수: 주사위 1~10 각각에서 가장 좋은 길의 평균 (멈춘 칸 + 지나간 칸만, 더 내다보지 않음) */
export function turnValue(g, from, valueOf) {
  let sum = 0;
  for (const d of DICE) {
    let best = -Infinity;
    for (const route of paths(g, from, d)) best = Math.max(best, moveValue(g, route, valueOf).value);
    sum += best;
  }
  return sum / DICE.length;
}

/** 자전거 칸: 50% 앞으로 1~5 (갈림길은 고름) / 50% 뒤로 1~3 의 기대 가치 */
export function bikeValue(g, at, valueOf) {
  let fwd = 0, back = 0;
  for (let k = 1; k <= 5; k++) {
    let best = -Infinity;
    for (const route of paths(g, at, k)) best = Math.max(best, moveValue(g, route, valueOf).value);
    fwd += best / 5;
  }
  for (let k = 1; k <= 3; k++) {
    const lands = backward(g, at, k);
    back += lands.reduce((a, id) => a + valueOf(g.get(id), { passing: false }).value, 0) / lands.length / 3;
  }
  return 0.5 * fwd + 0.5 * back;
}

/** 엘리베이터·보트의 짝 칸 */
export const partners = (g, node) => [...g.values()].filter(n => n.id !== node.id && n.type === node.type).map(n => n.id);
