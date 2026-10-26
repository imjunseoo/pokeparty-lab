// 「포켓몬 파티!」 보드 맵 칸 표 (Ruby 설정 스크립트의 *_NODES 해시) → JSON (정규식 파싱, 실행 없음)
//
// 칸 한 줄:  6 => { x: 48, y: 62, type: :center, trigger: :branch, next: [[7, "왼쪽 (...)"], [35, "오른쪽 (...)", :on]], land_type: :center },
//   trigger :land 멈췄을 때만 / :pass_through 지나가기만 해도 (센터·상점) / :branch 지나가며 길을 고름 (멈추면 land_type 이벤트)
//   메이즈의 갈림길 항목 세 번째 값 :on / :off 는 스위치 302 가 그 상태일 때만 열리는 길

const TRIGGER = { land: 'land', pass_through: 'pass', branch: 'branch' };

/** 해시 상수 하나의 본문 (중괄호 짝 맞추기) */
function hashBody(src, name) {
  const start = src.search(new RegExp(`\\b${name}\\s*=\\s*\\{`));
  if (start < 0) return null;
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(src.indexOf('{', start) + 1, j);
  }
  return null;
}

/** 칸 표 → [{ id, x, y, type, trigger, next, area?, trainer?, land? }] (next: 숫자 또는 [[칸, 문구, 'on'|'off'|null]]) */
export function parseNodes(body) {
  const nodes = [];
  for (const [, id, inner] of body.replace(/#.*$/gm, '').matchAll(/(\d+)\s*=>\s*\{([^{}]*)\}/g)) {
    const get = key => inner.match(new RegExp(`\\b${key}:\\s*:?(\\w+)`))?.[1];
    const branch = inner.match(/\bnext:\s*\[\s*(\[[\s\S]*\])\s*\]/);
    const next = branch
      ? [...branch[1].matchAll(/\[\s*(\d+)\s*,\s*"([^"]*)"\s*(?:,\s*:(\w+))?\s*\]/g)].map(([, to, label, cond]) => [+to, label, cond || null])
      : +get('next');
    const node = { id: +id, x: +get('x'), y: +get('y'), type: get('type'), trigger: TRIGGER[get('trigger')] || 'land', next };
    for (const [key, out] of [['area', 'area'], ['trainer_id', 'trainer'], ['land_type', 'land']]) {
      const v = get(key);
      if (v) node[out] = v;
    }
    nodes.push(node);
  }
  return nodes;
}

/**
 * scripts: { Board_Config, Board_Maps, Board_Trainers, Color_Wild, Board_Encounters } 스크립트 원문
 * @returns { maps: { key: { name, nodes } }, trainers: { id: { name, types, partner?, level } }, areas: { key: 이름 } }
 */
export function parseBoard(script) {
  const mapsSrc = script('Board_Maps');
  const constSrc = { BOARD_NODES: script('001_Board_Config') };
  const list = hashBody(mapsSrc, 'BOARD_MAPS');
  const maps = {};
  for (const [, key, name, nodesConst] of list.matchAll(/(\w+):\s*\{\s*name:\s*"([^"]+)"[^}]*?nodes:\s*(\w+)/g)) {
    const body = hashBody(constSrc[nodesConst] || mapsSrc, nodesConst);
    if (!body) throw new Error(`맵 ${key} 의 칸 표 ${nodesConst} 를 찾지 못함`);
    const nodes = parseNodes(body);
    const ids = new Set(nodes.map(n => n.id));
    for (const n of nodes) for (const to of Array.isArray(n.next) ? n.next.map(e => e[0]) : [n.next]) {
      if (!ids.has(to)) throw new Error(`맵 ${key} ${n.id}번 칸의 다음 칸 ${to} 이 없음`);
    }
    const gate = list.match(new RegExp(`${key}:\\s*\\{[^}]*?gate_switch:\\s*(\\d+)`))?.[1];
    maps[key] = { name, nodes, ...(gate ? { gate: +gate } : {}) };
  }

  // 트레이너: 이름·타입 4개·레벨 보정 (2인조는 파트너 타입도)
  const trainers = {};
  const tSrc = script('Board_Trainers');
  const addTrainer = (id, inner) => {
    const types = s => [...(s.match(/types:\s*\[([^\]]*)\]/)?.[1] || '').matchAll(/:([A-Z]+)/g)].map(m => m[1].toLowerCase());
    const [main, partner] = inner.split(/partner:\s*\{/);
    trainers[id] = {
      name: main.match(/name:\s*"([^"]+)"/)?.[1] || id,
      types: [...new Set([...types(main), ...(partner ? types(partner) : [])])],
      level: +(main.match(/level_offset:\s*(-?\d+)/)?.[1] || 0),
      ...(partner ? { partner: partner.match(/name:\s*"([^"]+)"/)?.[1] } : {}),
    };
  };
  const tBody = hashBody(tSrc, 'TRAINER_DATA') || '';
  for (const [, id, inner] of tBody.matchAll(/(\w+):\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) addTrainer(id, inner);
  for (const [, id, inner] of mapsSrc.matchAll(/TRAINER_DATA\[:(\w+)\]\s*=\s*\{([^{}]*)\}/g)) addTrainer(id, inner);
  const num = name => +(tSrc.match(new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)`))?.[1] || 0);
  const prize = { base: num('TRAINER_PRIZE_BASE'), loss: num('TRAINER_LOSS_BASE') };

  // 야생 지역 이름: 투어 지역 · 타입 칸 · 세대 · 색깔 (colors: 색깔 지역 → 도감 색 영문, 무지개는 'rainbow')
  const areas = {}, colors = {};
  for (const [, key, name] of (hashBody(script('Board_Encounters'), 'AREA_SETTINGS') || '').matchAll(/(\w+):\s*\{\s*name:\s*"([^"]+)"/g)) areas[key] = name;
  for (const [, key, name] of mapsSrc.matchAll(/(t_\w+):\s*\["([^"]+)"/g)) areas[key] = `${name} 타입`;
  for (let g = 1; g <= 9; g++) areas[`gen${g}`] = `${g}세대`;
  for (const [, key, color, name] of (hashBody(script('Color_Wild'), 'COLOR_AREAS') || '').matchAll(/(\w+):\s*\[:(\w+),\s*"([^"]+)"\]/g)) {
    areas[key] = name;
    colors[key] = color;
  }
  return { maps, trainers, prize, areas, colors };
}
