// 칸 추천: 보드 맵에서 지금 칸 + 주사위 → 어느 길로 가서 어디에 멈출지 (지금 파티·세팅 기준)
// 칸 가치(점수): 야생 = 그 지역 후보 3마리 중 최선의 기대 보강(잡힐 확률 포함) · 기술/트레이닝 = 내 세팅 할 일의 이득
//   트레이너 = 예상 승률 × 상금 − 패배 손실 · 아이템 = 평균 약 2000원어치 · 시작 칸 = 용돈 1000원 · 로켓단 = 손해
//   센터 = 회복이 필요할 때 · 상점 = 지나가며 이용 · 자전거 = 앞/뒤 이동의 기대값 · 엘리베이터·보트 = 짝 칸 자리 이득
import { store, update, getContext, partyMembers, isGameMode, catchForms, loadMoves } from '../state.js';
import { esc, on } from '../ui/dom.js';
import { sprite, typeBadge } from '../ui/components.js';
import { catchValue, prepareCatch } from '../core/party.js';
import { graphOf, rankMoves, turnValue, bikeValue, partners, landType, DICE } from '../core/board.js';
import { analyzeMember } from '../ui/builder.js';

// 칸 종류: 이름 · 지도 글자 · 색
const TILE = {
  start: ['시작', 'S', '#475569'], wild: ['야생', '야', '#16a34a'], trainer: ['트레이너', '트', '#dc2626'],
  item: ['아이템', '아', '#d97706'], skill: ['기술', '기', '#7c3aed'], training: ['트레이닝', '훈', '#c026d3'],
  center: ['센터', '센', '#e11d48'], shop: ['상점', '상', '#0284c7'], rocket: ['로켓단', '로', '#1f2937'],
  miracle_trade: ['미라클교환', '미', '#0d9488'], event: ['이벤트', '이', '#ca8a04'], bike: ['자전거', '자', '#65a30d'],
  elevator: ['엘리베이터', '엘', '#4f46e5'], boat: ['보트', '보', '#0369a1'],
};
const MONEY = 2 / 1000;               // 1000원 = 2점
const WILD_SCALE = 8;                 // 야생 기대 보강 1 = 8점 (상한 10)
const TIERS = [65, 50, 35];           // 포획 등급별 한 번 던질 때 확률
const BALL_BONUS = { poke: 0, great: 8, ultra: 15 };
const GAMMA = 0.4;                    // 다음 턴 기대 점수 반영 비율

let root, ctrlEl, mapEl, resultEl;

export function initBoard(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">보드 이동</span>
      <h1>다음에 갈 칸 추천</h1>
      <p>지도에서 <b>지금 서 있는 칸</b>을 누르고 <b>주사위 눈</b>을 고르면, 갈림길에서 어느 쪽으로 가서 어디에 멈추는 게 좋은지
        지금 파티·내 세팅 기준으로 알려드려요. 주사위를 고르지 않으면 눈마다 최선의 칸을 보여줘요.</p>
    </div>
    <section class="card board-ctrl" id="b-ctrl"></section>
    <section class="card board-map-card"><div id="b-map"></div></section>
    <div id="b-result" class="view"></div>`;
  ctrlEl = root.querySelector('#b-ctrl');
  mapEl = root.querySelector('#b-map');
  resultEl = root.querySelector('#b-result');

  on(root, 'click', '[data-node]', (e, el) => {
    const id = +el.dataset.node;
    update(s => { s.board.pos = { ...s.board.pos, [s.game.map]: id }; });
  });
  on(root, 'click', '[data-dice]', (e, el) => {
    const d = +el.dataset.dice;
    update(s => { s.board.dice = d || null; });
  });
  on(root, 'change', '[data-board]', (e, el) => {
    const key = el.dataset.board;
    update(s => {
      if (key === 'map') s.game.map = el.value;
      else if (key === 'gate') s.board.gate = el.value;
      else if (key === 'heal') s.board.heal = el.checked;
      else if (key === 'ball') s.ball = el.value;
    });
  });
}

/** 지금 맵 · 칸 그래프 · 지금 칸 */
function current() {
  const data = store.gameData;
  const map = data.board.maps[store.game.map] || data.board.maps.tour;
  const g = graphOf(map, store.board.gate);
  const start = map.nodes.find(n => n.type === 'start')?.id || map.nodes[0].id;
  const saved = store.board.pos[store.game.map];
  return { data, map, g, pos: g.has(saved) ? saved : start };
}

/** 칸 가치 계산기 (지금 파티·세팅·옵션 기준). valueOf(node, { passing }) → { value, note, extra } */
function createValuer(g) {
  const { engine, gameData: data } = store;
  const ctx = getContext();
  const members = partyMembers(ctx);
  const prepared = prepareCatch(ctx, members);
  const ball = BALL_BONUS[store.ball] || 0;
  const pool = data.pool;

  // 야생 지역의 후보 (투어: 출현표 가중치 · 타입/세대/색깔/전체: 최종 진화 고르게)
  const candidatesOf = area => {
    const tour = data.areas.find(a => a.key === area);
    if (tour) return tour.mons.filter(([id]) => !pool[id]?.l).map(([id, w]) => ({ mon: engine.byId.get(id), w })).filter(x => x.mon);
    const color = area.startsWith('color_') ? data.board.colors[area] : undefined;
    return Object.entries(pool).filter(([id, v]) => {
      if (v.l) return false;
      if (area.startsWith('t_')) return engine.byId.get(+id)?.t.includes(area.slice(2));
      if (area.startsWith('gen')) return v.g === +area.slice(3);
      if (color !== undefined) return !color || v.c === color;
      return true;
    }).map(([id]) => ({ mon: engine.byId.get(+id), w: 1 })).filter(x => x.mon);
  };
  const wildCache = new Map();
  function wild(area) {
    if (wildCache.has(area)) return wildCache.get(area);
    const list = candidatesOf(area).map(({ mon, w }) => {
      let best = null;
      for (const form of catchForms(ctx, mon)) {
        const v = catchValue(ctx, members, form, { prepared, reasons: false });
        if (!best || v.gain > best.gain) best = { form, gain: v.gain };
      }
      const p = Math.min(95, TIERS[data.catchTier?.[mon.id] ?? 1] + ball) / 100;
      return { mon, w, form: best.form, gain: best.gain, ev: Math.max(0, best.gain) * (1 - (1 - p) ** 3) };
    });
    // 후보 3마리가 나왔을 때 그중 최선의 기대값: P(최선 ≤ x) = F(x)^3
    const W = list.reduce((a, x) => a + x.w, 0) || 1;
    let F = 0, prev = 0, E = 0;
    for (const x of [...list].sort((a, b) => a.ev - b.ev)) {
      F += x.w / W;
      E += x.ev * (F ** 3 - prev);
      prev = F ** 3;
    }
    const r = { E, top: [...list].sort((a, b) => b.ev - a.ev).slice(0, 3), n: list.length };
    wildCache.set(area, r);
    return r;
  }

  // 트레이너: 그 트레이너 타입들과의 상성으로 예상 승률
  const { tIdx, chart } = engine;
  function trainer(id) {
    const t = data.board.trainers[id];
    if (!t || !members.length) return { p: 0.1, t };
    let adv = 0;
    for (const ty of t.types) {
      const d = tIdx[ty];
      const off = Math.max(0, ...members.map(m => Math.max(...m.atk.map(a => chart[tIdx[a]][d]))));
      const weak = members.filter(m => m.def[d] > 1).length / members.length;
      adv += (off >= 2 ? 0.6 : off >= 1 ? 0.15 : -0.35) - 0.6 * weak;
    }
    const p = Math.min(0.92, Math.max(0.15, 0.55 + 0.5 * adv / t.types.length + 0.06 * (members.length - 3) - 0.03 * (t.level + 2)));
    return { p, t };
  }

  // 기술·트레이닝: 내 세팅을 넣은 멤버의 할 일 중 가장 이득이 큰 것
  const plans = store.party.map((m, i) => (m.set ? { m, pm: members[i], r: analyzeMember(m, members[i]) } : null)).filter(x => x?.r);
  const bestStep = kinds => {
    let best = null;
    for (const p of plans) for (const s of p.r.steps) if (kinds.includes(s.kind) && (!best || s.gain > best.s.gain)) best = { ...p, s };
    return best;
  };
  const skill = bestStep(['move']), train = bestStep(['na', 'ab', 'iv']);
  const moveKo = slug => store.moves?.bySlug.get(slug)?.ko || slug;

  const heal = store.board.heal;
  const cache = new Map();
  const base = (node, passing) => {
    const type = landType(node);
    switch (type) {
      case 'start': return { value: 1000 * MONEY, note: '용돈 1000원' };
      case 'center': return { value: heal ? 4 : passing ? 0.3 : 0.5, note: heal ? '파티 회복' : '파티 회복 (지금은 필요 없음)' };
      case 'shop': return { value: 2, note: '상점 이용' };
      case 'item': return { value: 2000 * MONEY, note: '아이템 (평균 약 2000원어치)' };
      case 'event': return { value: 1.5, note: '룰렛 이벤트 (좋은 일도 나쁜 일도)' };
      case 'rocket': return { value: -3, note: '돈·도구를 뺏길 수 있어요' };
      case 'miracle_trade': return { value: 0.5, note: '포켓몬 무작위 교환' };
      case 'wild': {
        const w = wild(node.area);
        return {
          value: Math.min(10, w.E * WILD_SCALE), note: `${data.board.areas[node.area] || node.area} 야생 (후보 ${w.n}종)`,
          extra: { kind: 'wild', top: w.top },
        };
      }
      case 'trainer': {
        const { p, t } = trainer(node.trainer);
        const prize = data.board.prize.base || 1000, loss = (data.board.prize.loss || 500) * 0.4;
        return {
          value: p * prize * MONEY - (1 - p) * (loss * MONEY + 1),
          note: `${t ? t.name + (t.partner ? `·${t.partner}` : '') : '트레이너'} · 예상 승률 ${Math.round(p * 100)}%`,
          extra: { kind: 'trainer', types: t?.types || [] },
        };
      }
      case 'skill': return skill
        ? { value: Math.min(10, skill.s.gain / 3), note: `${skill.pm.mon.ko}에게 「${moveKo(skill.s.learn)}」${skill.s.forget ? ` (← ${moveKo(skill.s.forget)})` : ''} · 세팅 +${skill.s.gain.toFixed(1)}` }
        : { value: 3, note: plans.length ? '내 세팅에서 더 배울 기술이 없어요' : '기술 배우기 (내 세팅을 입력하면 정확해져요)' };
      case 'training': return train
        ? { value: Math.min(10, train.s.gain / 2), note: `${train.pm.mon.ko} ${train.s.kind === 'na' ? '성격 바꾸기' : train.s.kind === 'ab' ? '특성 바꾸기' : '개체값 올리기'} · 세팅 +${train.s.gain.toFixed(1)}` }
        : { value: 2.5, note: plans.length ? '내 세팅에서 다듬을 것이 없어요' : '성격·특성·개체값 다듬기 (내 세팅을 입력하면 정확해져요)' };
      case 'bike': return { value: 1, note: '자전거' };
      case 'elevator': return { value: 0, note: '엘리베이터' };
      case 'boat': return { value: 0, note: '보트' };
      default: return { value: 0, note: TILE[type]?.[0] || type };
    }
  };
  const basic = (node, { passing = false } = {}) => {
    const key = `${node.id}|${passing}`;
    if (!cache.has(key)) cache.set(key, base(node, passing));
    return cache.get(key);
  };
  // 자전거·엘리베이터·보트는 이어지는 이동까지
  const posCache = new Map();
  const pos = id => (posCache.has(id) ? posCache.get(id) : posCache.set(id, turnValue(g, id, basic)).get(id));
  const full = (node, opts = {}) => {
    const t = landType(node);
    if (opts.passing || !['bike', 'elevator', 'boat'].includes(t)) return basic(node, opts);
    if (t === 'bike') return { value: bikeValue(g, node.id, basic), note: '자전거: 50% 앞으로 1~5칸 / 50% 뒤로 1~3칸' };
    const others = partners(g, node);
    const gain = Math.max(0, ...others.map(o => pos(o) - pos(node.id)));
    return { value: GAMMA * gain, note: `${TILE[t][0]}: ${others.map(o => `${o}번`).join('·')} 칸으로 갈 수 있어요${gain > 0.5 ? ' (가는 게 유리)' : ''}` };
  };
  return { valueOf: full, nextTurn: id => turnValue(g, id, full), members, plans };
}

export function renderBoard() {
  if (!root) return;
  if (!isGameMode() || !store.gameData?.board) {
    ctrlEl.innerHTML = '<p class="empty">칸 추천은 「포켓몬 파티!」 게임 룰 모드에서 쓸 수 있어요. 위의 데이터 기준에서 「포켓몬 파티! (게임 룰)」을 골라 주세요.</p>';
    mapEl.innerHTML = '';
    resultEl.innerHTML = '';
    return;
  }
  if (!store.moves && store.party.some(m => m.set)) loadMoves();
  const { data, map, g, pos } = current();
  const b = store.board;
  ctrlEl.innerHTML = `
    <div class="board-opts">
      <label class="field">맵 <select class="select" data-board="map">${Object.entries(data.board.maps).map(([k, m]) => `<option value="${k}" ${k === store.game.map ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      ${map.gate ? `<label class="field">길 스위치 <select class="select" data-board="gate"><option value="off" ${b.gate === 'off' ? 'selected' : ''}>꺼짐</option><option value="on" ${b.gate === 'on' ? 'selected' : ''}>켜짐</option></select></label>` : ''}
      <label class="field">볼 <select class="select" data-board="ball">${[['poke', '몬스터볼'], ['great', '슈퍼볼'], ['ultra', '하이퍼볼']].map(([k, n]) => `<option value="${k}" ${store.ball === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-board="heal" ${b.heal ? 'checked' : ''}> 파티 회복 필요 (기절·부상)</label>
    </div>
    <div class="dice-row"><span class="chips-label">주사위</span>
      <button type="button" class="dice ${!b.dice ? 'on' : ''}" data-dice="0">모름</button>
      ${DICE.map(d => `<button type="button" class="dice ${b.dice === d ? 'on' : ''}" data-dice="${d}">${d}</button>`).join('')}
    </div>
    ${map.gate ? '<p class="note">메이즈는 누군가 시작 칸을 지날 때마다 스위치가 바뀌어 열리는 길이 달라져요.</p>' : ''}`;

  const valuer = createValuer(g);
  const ranked = b.dice ? rankMoves(g, pos, b.dice, valuer.valueOf, { gamma: GAMMA, nextTurn: valuer.nextTurn }) : [];
  mapEl.innerHTML = mapSvg(map, g, pos, ranked);
  resultEl.innerHTML = b.dice ? optionsHtml(g, pos, b.dice, ranked, valuer) : diceTable(g, pos, valuer);
}

const tileName = node => TILE[landType(node)]?.[0] || node.type;

/** 지도 (칸 좌표 그대로): 지금 칸 강조 · 추천 순위 표시 · 1순위 길 */
function mapSvg(map, g, pos, ranked) {
  const xs = map.nodes.map(n => n.x), ys = map.nodes.map(n => n.y);
  const minX = Math.min(...xs) - 3, minY = Math.min(...ys) - 3;
  const w = Math.max(...xs) - minX + 5, h = Math.max(...ys) - minY + 5;
  const c = n => [n.x + 1, n.y + 1];
  const edges = [...g.values()].flatMap(n => n.outs.map(([to]) => {
    const [x1, y1] = c(n), [x2, y2] = c(g.get(to));
    const far = Math.hypot(x2 - x1, y2 - y1) > 9;
    return `<line class="bn-edge ${far ? 'far' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  })).join('');
  const rank = new Map();
  ranked.slice(0, 5).forEach((r, i) => { if (!rank.has(r.land)) rank.set(r.land, i + 1); });
  const top = ranked[0];
  const route = top ? `<polyline class="bn-route" points="${[pos, ...top.passed, top.land].map(id => c(g.get(id)).join(',')).join(' ')}"/>` : '';
  const nodes = map.nodes.map(n => {
    const t = TILE[landType(n)] || ['?', '?', '#888'];
    const [x, y] = c(n);
    const r = rank.get(n.id);
    return `<g class="bn ${n.id === pos ? 'here' : ''} ${r ? 'pick' : ''}" data-node="${n.id}" transform="translate(${x} ${y})" role="button" tabindex="0" aria-label="${n.id}번 ${esc(t[0])} 칸">
      <title>${n.id}번 · ${esc(t[0])}${n.area ? ` · ${esc(store.gameData.board.areas[n.area] || n.area)}` : ''}${n.trigger === 'branch' ? ' · 갈림길' : ''}</title>
      ${n.id === pos ? '<circle class="bn-here" r="3.1"/>' : ''}
      <rect x="-1.8" y="-1.8" width="3.6" height="3.6" rx="0.9" fill="${t[2]}" ${n.trigger === 'branch' ? 'class="branch"' : ''}/>
      <text y="0.7">${t[1]}</text>
      ${r ? `<g class="bn-rank" transform="translate(1.9 -1.9)"><circle r="1.25"/><text y="0.45">${r}</text></g>` : ''}
    </g>`;
  }).join('');
  const legend = Object.entries(TILE).filter(([k]) => map.nodes.some(n => landType(n) === k))
    .map(([, [name, s, color]]) => `<span><i style="background:${color}">${s}</i>${name}</span>`).join('');
  return `<svg class="board-svg" viewBox="${minX} ${minY} ${w} ${h}" role="img" aria-label="${esc(map.name)} 맵">${edges}${route}${nodes}</svg>
    <div class="board-legend">${legend}<span><i class="here-i"></i>지금 칸</span><span class="note">칸을 눌러 지금 위치를 바꿔요 · 테두리 굵은 칸은 갈림길</span></div>`;
}

/** 길 설명: 갈림길 선택 · 지나가는 칸 */
function routeText(g, r) {
  const parts = r.choices.map(ch => `${ch.at}번 갈림길에서 <b>${esc(ch.label || `${ch.to}번 쪽`)}</b>`);
  return parts.length ? parts.join(' → ') : '갈림길 없이 직진';
}

function detailHtml(v) {
  const { engine } = store;
  if (v.extra?.kind === 'wild' && v.extra.top.length) {
    return `<div class="bo-wild">${v.extra.top.filter(x => x.gain > 0).map(x => `<span class="opp">${sprite(x.mon)}<span><b>${esc(x.mon.ko)}</b>${x.form.mon.id !== x.mon.id ? `<span class="note">→ ${esc(x.form.mon.ko)}</span>` : ''}</span></span>`).join('') || '<span class="note">지금 파티에 큰 도움이 되는 후보가 적어요</span>'}</div>`;
  }
  if (v.extra?.kind === 'trainer') return `<div class="types">${v.extra.types.map(t => typeBadge(engine, t, 'sm')).join('')}</div>`;
  return '';
}

/** 주사위를 골랐을 때: 갈 수 있는 칸 순위 */
function optionsHtml(g, pos, dice, ranked, valuer) {
  if (!ranked.length) return '';
  const max = Math.max(1, ...ranked.map(r => r.total));
  const cards = ranked.slice(0, 6).map((r, i) => {
    const land = g.get(r.land);
    const v = r.landing;
    return `<article class="card bo-card ${i === 0 ? 'best' : ''}">
      <div class="bo-head">
        <span class="catch-rank">${i === 0 ? '추천' : `${i + 1}순위`}</span>
        <span class="bo-tile" style="background:${TILE[landType(land)]?.[2] || '#888'}">${TILE[landType(land)]?.[1] || '?'}</span>
        <div class="bo-name"><b>${land.id}번 ${esc(tileName(land))} 칸</b><span class="note">${esc(v.note)}</span></div>
        <div class="catch-gain"><b>${r.total.toFixed(1)}점</b><span class="track"><span style="width:${Math.max(4, Math.round(100 * Math.max(0, r.total) / max))}%"></span></span></div>
      </div>
      <p class="bo-route">${routeText(g, r)}</p>
      ${detailHtml(v)}
      <p class="note">멈춘 칸 ${v.value >= 0 ? '+' : ''}${v.value.toFixed(1)}${r.passes.map(p => ` · 지나가며 ${esc(tileName(g.get(p.id)))} +${p.value.toFixed(1)}`).join('')} · 다음 턴 기대 +${(GAMMA * r.ahead).toFixed(1)}</p>
    </article>`;
  }).join('');
  return `<section class="card catch-summary"><div class="card-head"><h3>주사위 ${dice}: 이렇게 가세요</h3>
      <span class="sub">${valuer.members.length ? `파티 ${valuer.members.length}마리` : '파티 없음'}${valuer.plans.length ? ` · 내 세팅 ${valuer.plans.length}마리 반영` : ' · 내 세팅을 입력하면 기술·트레이닝 칸 점수가 정확해져요'}</span></div>
      <p class="catch-verdict">${routeText(g, ranked[0])} → <b>${ranked[0].land}번 ${esc(tileName(g.get(ranked[0].land)))} 칸</b>에 멈추는 게 가장 좋아요. ${esc(ranked[0].landing.note)}.</p>
    </section>
    <div class="catch-list">${cards}</div>`;
}

/** 주사위를 모를 때: 눈마다 최선 */
function diceTable(g, pos, valuer) {
  const rows = DICE.map(d => {
    const r = rankMoves(g, pos, d, valuer.valueOf, { gamma: GAMMA, nextTurn: valuer.nextTurn })[0];
    return { d, r };
  });
  const avg = rows.reduce((a, x) => a + x.r.total, 0) / rows.length;
  return `<section class="card">
    <div class="card-head"><h3>주사위 눈마다 가장 좋은 칸</h3><span class="sub">평균 ${avg.toFixed(1)}점 · 눈을 고르면 갈림길 선택까지 자세히 보여줘요</span></div>
    <div class="table-wrap"><table class="dice-table">
      <thead><tr><th>눈</th><th>멈출 칸</th><th>길</th><th>점수</th></tr></thead>
      <tbody>${rows.map(({ d, r }) => {
        const land = g.get(r.land);
        return `<tr data-dice="${d}" class="${r.total < 0 ? 'bad' : ''}"><td><b>${d}</b></td>
          <td><span class="bo-tile sm" style="background:${TILE[landType(land)]?.[2] || '#888'}">${TILE[landType(land)]?.[1] || '?'}</span> ${land.id}번 ${esc(tileName(land))}<div class="note">${esc(r.landing.note)}</div></td>
          <td>${routeText(g, r)}</td><td><b>${r.total.toFixed(1)}</b></td></tr>`;
      }).join('')}</tbody>
    </table></div>
  </section>`;
}
