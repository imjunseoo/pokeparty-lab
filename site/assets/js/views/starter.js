// 스타팅 추천: 게임 시작 때 드래프트로 고르는 스타팅(1~9세대 27마리)마다 추천 파티 조합 + 슬롯별 대체 후보
// 스타팅은 최종 진화(메가진화 룰이면 메가진화까지) 기준으로 고정하고, 나머지 5마리는 이 맵에서 잡을 수 있는 포켓몬으로 빔 서치.
// 드래프트에 나온 세대를 고르면 그 6마리 중 어떤 스타팅이 좋은지 순위를 보여준다.
import { store, update, getContext, isGameMode, gameRule, evoOptions, megaOptions } from '../state.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeList, typeBadge, ICONS } from '../ui/components.js';
import { recommendTop, analyze, alternativesFor, explainSlot } from '../core/party.js';
import { reasonChip, commentText, addPlan, catchHint } from '../ui/reasons.js';

const COMBOS = 3;           // 스타팅마다 보여 줄 조합 수
const ALTS = 3;             // 슬롯마다 대체 후보 수
let root, optsEl, listEl, detailEl;
let combo = 0;              // 보고 있는 조합 번호
const cache = new WeakMap();   // 분석 컨텍스트 → Map(스타팅 id → 결과)

export function initStarter(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">게임 시작</span>
      <h1>스타팅 별 추천 조합</h1>
      <p>게임을 시작할 때 드래프트로 고르는 스타팅 포켓몬마다, 이 맵에서 잡을 수 있는 포켓몬으로 만든 <b>추천 파티 조합</b>과
        자리마다 <b>대체 후보</b>를 보여드려요. 드래프트에 나온 세대를 고르면 그중 어떤 스타팅이 좋은지 순위도 알려줘요.</p>
    </div>
    <section class="card" id="s-opts"></section>
    <section class="card" id="s-list"></section>
    <div id="s-detail" class="view"></div>`;
  optsEl = root.querySelector('#s-opts');
  listEl = root.querySelector('#s-list');
  detailEl = root.querySelector('#s-detail');

  on(root, 'change', '[data-game]', (e, el) => update(s => { s.game[el.dataset.game] = el.value; }));
  on(root, 'click', '[data-gen]', (e, el) => {
    const g = +el.dataset.gen;
    update(s => {
      const gens = s.starter.gens.includes(g) ? s.starter.gens.filter(x => x !== g) : [...s.starter.gens, g];
      s.starter.gens = gens.sort((a, b) => a - b);
    });
  });
  on(root, 'click', '[data-act="gens-clear"]', () => update(s => { s.starter.gens = []; }));
  on(root, 'click', '[data-starter]', (e, el) => {
    combo = 0;
    update(s => { s.starter.id = +el.dataset.starter; });
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  on(root, 'click', '[data-combo]', (e, el) => { combo = +el.dataset.combo; renderStarter(); });
  on(root, 'click', '[data-act="use-combo"]', () => useCombo());
}

/** 스타팅 → 싸우는 모습 후보: 최종 진화 (+ 메가진화 룰이면 메가진화) */
function startForms(ctx, starter) {
  const finals = evoOptions(starter);
  const out = [];
  for (const { mon } of finals.length ? finals : [{ mon: starter }]) {
    const route = { base: mon, from: mon.id !== starter.id ? [starter] : [], direct: mon.id === starter.id };
    out.push({ ...ctx.prep(mon, route), locked: true });
    for (const [mid, stone] of megaOptions(mon)) {
      const mega = store.engine.byId.get(mid);
      if (mega) out.push({ ...ctx.prep(mega, { ...route, stone }), locked: true });
    }
  }
  return out;
}

/** 스타팅 하나의 추천 조합들 (모습마다 계산해 점수 높은 순, 캐시) */
function combosFor(ctx, starter) {
  let map = cache.get(ctx);
  if (!map) cache.set(ctx, (map = new Map()));
  if (!map.has(starter.id)) {
    const all = [];
    for (const lead of startForms(ctx, starter)) {
      for (const t of recommendTop(ctx, [lead], { top: COMBOS })) all.push({ ...t, lead, grade: analyze(ctx, t.party).scores });
    }
    all.sort((a, b) => b.grade.total - a.grade.total || b.score - a.score);
    map.set(starter.id, all.slice(0, COMBOS));
  }
  return map.get(starter.id);
}

export function renderStarter() {
  if (!root) return;
  if (!isGameMode() || !store.gameData?.starters) {
    optsEl.innerHTML = '<p class="empty">스타팅 추천은 「포켓몬 파티!」 게임 룰 모드에서 쓸 수 있어요. 위의 데이터 기준에서 「포켓몬 파티! (게임 룰)」을 골라 주세요.</p>';
    listEl.innerHTML = '';
    detailEl.innerHTML = '';
    return;
  }
  const { engine, gameData: data } = store;
  const ctx = getContext();
  const gens = store.starter.gens;
  const opt = (list, cur, label) => list.map(x => `<option value="${x.key}" ${x.key === cur ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
  optsEl.innerHTML = `
    <div class="starter-opts">
      <label class="field">맵 <select class="select" data-game="map">${opt(data.maps, store.game.map, m => m.name)}</select></label>
      <label class="field">기믹 룰 <select class="select" data-game="rule">${opt(data.rules, store.game.rule, r => r.name)}</select></label>
    </div>
    <div class="gen-row"><span class="chips-label">드래프트에 나온 세대</span>
      ${Object.keys(data.starters).map(g => `<button type="button" class="gen-chip ${gens.includes(+g) ? 'on' : ''}" data-gen="${g}" aria-pressed="${gens.includes(+g)}">${g}세대</button>`).join('')}
      ${gens.length ? '<button type="button" class="link-btn" data-act="gens-clear">전체 보기</button>' : ''}
    </div>
    <p class="note">드래프트에는 무작위 2개 세대의 스타팅 6마리가 나와요. 두 세대를 고르면 그 6마리만 비교해요.</p>`;

  // 스타팅 순위: 각 스타팅의 가장 좋은 조합 점수
  const starters = Object.entries(data.starters).filter(([g]) => !gens.length || gens.includes(+g))
    .flatMap(([g, ids]) => ids.map(id => ({ g: +g, mon: engine.byId.get(id) }))).filter(x => x.mon);
  // 파티 점수가 같으면 스타팅 자체가 강한 순(최종 진화·메가진화 종족값) → 조합 내부 점수
  const bst = x => engine.effectiveBst(x.best.lead.mon);
  const ranked = starters.map(x => ({ ...x, best: combosFor(ctx, x.mon)[0] })).filter(x => x.best)
    .sort((a, b) => b.best.grade.total - a.best.grade.total || bst(b) - bst(a) || b.best.score - a.best.score);
  const sel = ranked.find(x => x.mon.id === store.starter.id) || null;
  listEl.innerHTML = `
    <div class="card-head"><h3>${ICONS.spark} 스타팅 순위</h3>
      <span class="sub">${esc(`${data.maps.find(m => m.key === store.game.map)?.name || ''} 맵 · ${gameRule().name} · 가장 좋은 조합의 파티 점수 순`)}</span></div>
    <div class="starter-grid">${ranked.map((x, k) => {
      const fin = x.best.lead;
      return `<button type="button" class="starter-btn ${sel === x ? 'on' : ''} ${k === 0 ? 'top' : ''}" data-starter="${x.mon.id}">
        <span class="sb-rank">${k + 1}</span>
        ${sprite(x.mon)}
        <span class="sb-main"><b>${esc(x.mon.ko)}</b><span class="note">${x.g}세대 → ${esc(fin.mon.ko)} · 종족값 ${bst(x)}</span>${typeList(engine, fin.mon.t, 'sm')}</span>
        <span class="sb-grade g-${x.best.grade.grade}"><b>${x.best.grade.grade}</b><span>${x.best.grade.total}</span></span>
      </button>`;
    }).join('')}</div>
    <p class="note">등급·점수는 그 스타팅으로 만들 수 있는 가장 좋은 파티 기준이에요. 점수가 같으면 스타팅 자체 능력(종족값)이 높은 순이에요.${ranked.length && !sel ? ' 스타팅을 누르면 추천 조합과 자리마다 대체 후보를 보여줘요.' : ''}</p>`;

  detailEl.innerHTML = sel ? detailHtml(ctx, sel) : '';
}

/** 고른 스타팅의 조합 상세: 조합 버튼 · 6마리(이유·잡는 곳·대체 후보) · 약점 · 이 조합으로 시작 */
function detailHtml(ctx, sel) {
  const { engine } = store;
  const combos = combosFor(ctx, sel.mon);
  if (combo >= combos.length) combo = 0;
  const cur = combos[combo];
  const party = cur.party;
  const lead = cur.lead;
  const rows = party.map((m, i) => {
    const reasons = explainSlot(ctx, party, i).filter(r => r.kind !== 'usage');
    const alts = i === 0 ? [] : alternativesFor(ctx, party, i, 8)
      .filter(({ c }, j, arr) => arr.findIndex(x => x.c.sp === c.sp) === j).slice(0, ALTS);
    const route = i === 0
      ? `스타팅 ${esc(sel.mon.ko)}${lead.mon.id !== sel.mon.id ? ` → ${esc(lead.stone ? lead.base.ko : lead.mon.ko)}` : ''}${lead.stone ? ` → 메가진화` : ''}`
      : esc(catchHint(m) || '이 맵에서 잡기');
    return `<li class="combo-row ${i === 0 ? 'lead' : ''}">
      <span class="cr-slot">${i === 0 ? '스타팅' : i + 1}</span>
      ${sprite(m.mon)}
      <div class="cr-main">
        <div class="cr-name"><b>${esc(m.mon.ko)}</b>${typeList(engine, m.mon.t, 'sm')}</div>
        <span class="note">${route}</span>
        ${reasons.length ? `<div class="reasons">${reasons.map(r => reasonChip(engine, r)).join('')}</div>` : ''}
        <p class="slot-why">${esc(commentText(engine, reasons, m))}</p>
        ${alts.length ? `<div class="cr-alts"><span class="note">못 잡으면 대신</span>${alts.map(({ c }) => `<span class="opp">${sprite(c.mon)}<span><b>${esc(c.mon.ko)}</b><span class="note">${esc(catchHint(c))}</span></span></span>`).join('')}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  const a = analyze(ctx, party);
  const danger = a.rows.filter(r => r.level === 'danger').map(r => r.type);
  return `<section class="card combo-card">
    <div class="card-head"><h3>${esc(sel.mon.ko)} 스타팅 추천 조합</h3>
      <span class="sub">스타팅은 ${esc(lead.mon.ko)} 기준 · 나머지 5마리는 이 맵에서 잡을 수 있는 포켓몬</span></div>
    <div class="set-tabs" role="tablist" aria-label="조합 고르기">${combos.map((c, k) => `
      <button type="button" role="tab" class="set-tab ${k === combo ? 'on' : ''}" aria-selected="${k === combo}" data-combo="${k}">조합 ${k + 1} · ${c.grade.grade} ${c.grade.total}점</button>`).join('')}</div>
    <p class="note">방어 밸런스 ${cur.grade.def} · 공격 커버리지 ${cur.grade.off}${danger.length ? ` · 약점이 몰린 타입: ${danger.map(t => engine.typeKo(t)).join('·')}` : ' · 3마리 이상 겹치는 약점 없음'}</p>
    <ol class="combo-list">${rows}</ol>
    <div class="combo-actions">
      <button class="btn" type="button" data-act="use-combo">이 조합으로 파티 시작</button>
      <span class="note">스타팅과 추천 5마리를 파티 추천 화면에 넣어요 (지금 파티는 바뀌어요). 게임에서 실제로 잡으면서 바꿔 가세요.</span>
    </div>
  </section>`;
}

/** 지금 보고 있는 조합을 내 파티로 */
function useCombo() {
  const ctx = getContext();
  const starter = store.engine.byId.get(store.starter.id);
  if (!starter) return;
  const cur = combosFor(ctx, starter)[combo];
  if (!cur) return;
  update(s => {
    s.party = cur.party.map((c, i) => {
      const plan = i === 0
        ? { id: starter.id, evo: c.base.id !== starter.id ? c.base.id : null, mega: c.mega ? c.mon.id : null }
        : addPlan(c);
      return { ...plan, ability: null, tera: null, picked: i > 0, set: null };
    });
  });
  toast(`${josa(starter.ko, '와과')} 추천 5마리를 파티에 넣었어요`);
  location.hash = '#/party';
}
