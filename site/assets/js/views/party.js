// 파티 추천: 내 파티 → 다음에 노릴 속성(예시 포켓몬 3마리) → 멤버별 추천 세팅 → 평가·진단 → 상세 상성 분석
// 「포켓몬 파티!」는 원하는 포켓몬을 고를 수 없으므로 "어떤 속성을 노릴지 + 그 속성의 예시"를 추천하고,
// 예시를 고르면 바로 다음 추천을 다시 계산한다.
import {
  store, update, getContext, partyMembers, addToParty, encodeParty, usageInfo,
  isGameMode, gameRule, battleMode, whereToFind, setsOrder, gameOpts,
} from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, copyText, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, ICONS, moveLabel, itemLabel, natureText, spreadText } from '../ui/components.js';
import { ABILITY_EFFECTS } from '../core/engine.js';
import { analyze, recommend, recommendTypes, explainSlot } from '../core/party.js';
import { orderedSets, setCard } from '../ui/sets.js';

// 사용자가 처음 보여준 예시 파티 (Gemini 예시 코드의 파티 구성)
const EXAMPLE = ['delphox', 'luxray', 'iron-crown', 'quagsire', 'sableye', 'vivillon'];
const LEVEL_LABEL = { danger: '위험', warn: '주의', good: '좋음', info: '참고' };

let root, slotsEl, recEl, analysisEl, optionsEl;
let optionsOpen = null;   // null = 모드 기본값 (게임 모드는 펼침)
let deepOpen = false;
const recOffset = new Map();   // 타입별 "다른 예시 보기" 위치

export function initParty(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">파티 빌더</span>
      <h1>내 파티 완성하기</h1>
      <p>지금 가진 포켓몬을 넣으면 <b>다음에 노리면 좋은 속성</b>과 예시 포켓몬을 알려드려요.
        예시를 누르면 파티에 넣고 바로 다음 추천을 다시 계산합니다.</p>
    </div>
    <div class="party-tools">
      <div id="p-picker"></div>
      <div class="party-buttons">
        <button class="btn" type="button" data-act="share">${ICONS.link}공유</button>
        <button class="btn ghost" type="button" data-act="example">예시 파티</button>
        <button class="btn ghost" type="button" data-act="clear">비우기</button>
      </div>
    </div>
    <details class="options" id="p-options"></details>
    <div class="slots" id="p-slots"></div>
    <section class="card rec-card" id="p-rec"></section>
    <div id="p-analysis" class="view"></div>`;
  slotsEl = root.querySelector('#p-slots');
  recEl = root.querySelector('#p-rec');
  analysisEl = root.querySelector('#p-analysis');
  optionsEl = root.querySelector('#p-options');

  createPicker(root.querySelector('#p-picker'), {
    engine: store.engine, search: store.search,
    placeholder: '가진 포켓몬 추가 (이름·초성·번호)',
    onSelect: p => { const err = addToParty(p); toast(err || `${josa(p.ko, '을를')} 추가했어요`); },
  });

  on(root, 'click', '[data-act="share"]', async () => {
    if (!store.party.length) return toast('먼저 포켓몬을 추가해 주세요');
    const url = `${location.origin}${location.pathname}#/party/${encodeParty(store.party)}`;
    toast(await copyText(url) ? '파티 공유 링크를 복사했어요' : '복사에 실패했어요');
  });
  on(root, 'click', '[data-act="example"]', () => {
    update(s => {
      s.party = EXAMPLE.map(slug => store.engine.bySlug.get(slug)).filter(Boolean)
        .map(m => ({ id: m.id, ability: null, tera: null, picked: false }));
    });
    toast('예시 파티를 불러왔어요');
  });
  on(root, 'click', '[data-act="clear"]', () => update(s => { s.party = []; }));
  on(root, 'click', '[data-act="autofill"]', autofill);
  on(root, 'click', '[data-remove]', (e, el) => update(s => { s.party.splice(+el.dataset.remove, 1); }));
  on(root, 'click', '[data-add]', (e, el) => {
    const mon = store.engine.byId.get(+el.dataset.add);
    const err = addToParty(mon, { picked: true });
    toast(err || `${josa(mon.ko, '을를')} 넣었어요 · 다음 추천을 다시 계산했어요`);
  });
  on(root, 'click', '[data-more]', (e, el) => {
    recOffset.set(el.dataset.more, (recOffset.get(el.dataset.more) || 0) + 3);
    renderParty();
  });
  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); location.hash = `#/matchup/${el.dataset.go}`; });
  on(root, 'change', '[data-field]', (e, el) => {
    const i = +el.dataset.i;
    update(s => { s.party[i][el.dataset.field] = el.value || null; });
  });
  on(root, 'change', '[data-filter]', (e, el) => {
    const key = el.dataset.filter;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    update(s => { s.filters[key] = value; });
  });
  on(root, 'change', '[data-game]', (e, el) => {
    const key = el.dataset.game;
    recOffset.clear();
    update(s => { s.game[key] = el.type === 'checkbox' ? el.checked : el.value; });
  });
  on(root, 'input', 'input[type="range"][data-filter]', (e, el) => { el.nextElementSibling.textContent = el.value; });
  optionsEl.addEventListener('toggle', () => { optionsOpen = optionsEl.open; });
  root.addEventListener('toggle', e => { if (e.target.id === 'p-deep') deepOpen = e.target.open; }, true);
}

/** 남은 칸을 예시로 끝까지 채워 보기 (빔 서치) */
function autofill() {
  const ctx = getContext();
  const members = partyMembers(ctx).map(m => ({ ...m, locked: true }));
  if (members.length >= 6) return toast('파티가 이미 6마리예요');
  const r = recommend(ctx, members);
  update(s => {
    for (const m of r.party.slice(s.party.length)) s.party.push({ id: m.id, ability: null, tera: null, picked: true });
  });
  toast(`${r.picks.size}마리를 예시로 채웠어요`);
}

export function renderParty() {
  if (!root) return;
  const ctx = getContext();
  const members = partyMembers(ctx);
  renderOptions(ctx);
  renderSlots(ctx, members);
  renderRec(ctx, members);
  renderAnalysis(ctx, members);
  // 주소창을 현재 파티로 동기화 (새로고침·공유 시 유지)
  const hash = store.party.length ? `#/party/${encodeParty(store.party)}` : '#/party';
  if (location.hash.startsWith('#/party') && location.hash !== hash) history.replaceState(null, '', hash);
}

function renderOptions(ctx) {
  const f = store.filters;
  const info = usageInfo();
  if (isGameMode()) {
    const g = store.game, data = store.gameData;
    const opt = (list, cur, label) => list.map(x => `<option value="${x.key}" ${x.key === cur ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
    optionsEl.innerHTML = `
      <summary>게임 설정 <span class="note">· 포켓몬 파티! v${esc(data.meta.version)} · ${esc(data.maps.find(m => m.key === g.map)?.name || '')} · ${esc(gameRule().name)} · ${g.battle === 'double' ? '더블' : '싱글'}</span></summary>
      <div class="options-body">
        <label class="field">맵 <select class="select" data-game="map">${opt(data.maps, g.map, m => `${m.name} — ${m.desc}`)}</select></label>
        <label class="field">기믹 룰 <select class="select" data-game="rule">${opt(data.rules, g.rule, r => `${r.name} — ${r.desc}`)}</select></label>
        <label class="field">배틀 <select class="select" data-game="battle">${opt(data.battleModes, g.battle, b => b.name)}</select></label>
        <label class="check"><input type="checkbox" data-game="legends" ${g.legends ? 'checked' : ''}> 미라클교환·레이드 전설도 예시에 포함</label>
        <p class="note">후보: 이 맵에서 잡을 수 있는 포켓몬 ${ctx.pool.length}종 (마지막 토너먼트 Lv.${data.finalLevel}). 방장이 고른 룰과 맵 투표 결과에 맞춰 바꿔 주세요.</p>
      </div>`;
  } else if (info) {
    optionsEl.innerHTML = `
      <summary>추천 옵션 <span class="note">· 실전 데이터: ${esc(info.label)} ${esc(info.month)}</span></summary>
      <div class="options-body">
        <label class="check"><input type="checkbox" data-filter="usageMega" ${f.usageMega ? 'checked' : ''}> 메가진화 포함 (파티당 1마리)</label>
        <p class="note">후보: ${esc(info.desc)} 사용률 상위 ${ctx.pool.length}마리. 타입 상성 + 실전 동료 사용률 + 사용률을 함께 반영합니다.</p>
      </div>`;
  } else {
    const games = Object.entries(store.dex.games).map(([k, g]) => `<option value="${k}" ${f.game === k ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
    optionsEl.innerHTML = `
      <summary>추천 옵션 <span class="note">· 타입 상성만 · 후보 ${ctx.pool.length}마리</span></summary>
      <div class="options-body">
        <label class="field">도감 <select class="select" data-filter="game"><option value="all">전국도감</option>${games}</select></label>
        <label class="check"><input type="checkbox" data-filter="legend" ${f.legend ? 'checked' : ''}> 전설·환상 포함</label>
        <label class="check"><input type="checkbox" data-filter="mega" ${f.mega ? 'checked' : ''}> 메가진화 포함</label>
        <label class="range">최소 종족값 <input type="range" min="300" max="600" step="10" data-filter="minBst" value="${f.minBst}"><b>${f.minBst}</b></label>
      </div>`;
  }
  optionsEl.open = optionsOpen ?? isGameMode();
}

function reasonChip(engine, r) {
  switch (r.kind) {
    case 'def': return `<span class="reason">${typeBadge(engine, r.type, 'sm')} ${r.mult === 0 ? '무효' : r.mult <= 0.25 ? '¼ 반감' : '반감'}</span>`;
    case 'off': return `<span class="reason off">${r.types.slice(0, 4).map(t => typeBadge(engine, t, 'sm')).join('')} 공략</span>`;
    case 'cov': return `<span class="reason off">공격 범위 +${Math.round(r.value * 100)}%</span>`;
    case 'mate': return `<span class="reason mate">${esc(r.with.ko)} 동료 ${r.pct}%</span>`;
    case 'usage': return `<span class="reason usage">사용률 ${r.u}% · ${r.rank}위</span>`;
    case 'bst': return `<span class="reason usage">높은 종족값 ${r.value}</span>`;
    case 'warn': return `<span class="reason warn">${typeBadge(engine, r.type, 'sm')} 약점 ${r.count}마리째</span>`;
    case 'warn-types': return `<span class="reason warn">${r.types.slice(0, 3).map(t => typeBadge(engine, t, 'sm')).join('')} 약점 겹침 주의</span>`;
    default: return '';
  }
}

function renderSlots(ctx, members) {
  const { engine, dex } = store;
  const showTera = !isGameMode() || gameRule()?.uses.includes('tera');
  const html = [];
  for (let i = 0; i < 6; i++) {
    const m = store.party[i], pm = members[i];
    if (!m) {
      html.push(`<div class="slot empty-slot"><div><b>빈 슬롯 ${i + 1}</b>위 검색으로 가진 포켓몬을 넣거나<br>아래 추천 속성의 예시를 골라 보세요</div></div>`);
      continue;
    }
    const mon = pm.mon;
    const abilities = engine.abilitiesOf(mon);
    const reasons = m.picked ? explainSlot(ctx, members, i).filter(r => r.kind !== 'usage') : [];
    const where = isGameMode() ? whereToFind(mon) : '';
    html.push(`
      <div class="slot ${m.picked ? 'picked' : ''}">
        <div class="slot-top">
          <a href="#/matchup/${mon.slug}" data-go="${mon.slug}" title="상성 보기">${sprite(mon)}</a>
          <div>
            <div class="slot-name"><a href="#/matchup/${mon.slug}" data-go="${mon.slug}">${esc(mon.ko)}</a>${m.picked ? '<span class="pill-soft accent">추천</span>' : ''}</div>
            <div class="slot-sub">${typeList(engine, mon.t, 'sm')}${pm.u ? `<span class="note">${pm.u.u}%</span>` : ''}${where ? `<span class="note">${esc(where)}</span>` : ''}</div>
          </div>
          <div class="slot-actions">
            <button type="button" data-remove="${i}" title="빼기" aria-label="파티에서 빼기">${ICONS.close}</button>
          </div>
        </div>
        <div class="slot-fields ${showTera ? '' : 'one'}">
          <label>특성<select class="select" data-field="ability" data-i="${i}">
            ${abilities.map(a => `<option value="${a}" ${a === pm.ability ? 'selected' : ''}>${esc(engine.abilityKo(a))}${ABILITY_EFFECTS[a] ? ' ★' : ''}</option>`).join('')}
          </select></label>
          ${showTera ? `<label>테라스탈<select class="select" data-field="tera" data-i="${i}">
            <option value="">없음</option>
            ${[...dex.types, 'stellar'].map(t => `<option value="${t}" ${t === m.tera ? 'selected' : ''}>${esc(engine.typeKo(t))}</option>`).join('')}
          </select></label>` : ''}
        </div>
        ${reasons.length ? `<div class="reasons">${reasons.map(r => reasonChip(engine, r)).join('')}</div>` : ''}
      </div>`);
  }
  slotsEl.innerHTML = html.join('');
}

/** 예시 포켓몬 아래에 붙는 한 줄: 게임 모드는 출현 장소, 실전 모드는 사용률, 타입 모드는 종족값 */
function exampleHint(ctx, c) {
  if (isGameMode()) return whereToFind(c.mon) || '';
  if (c.u) return `사용률 ${c.u.u}%`;
  return `종족값 ${ctx.stats(c.mon).reduce((a, b) => a + b, 0)}`;
}

function renderRec(ctx, members) {
  const { engine } = store;
  const scope = isGameMode()
    ? `${store.gameData.maps.find(m => m.key === store.game.map)?.name} 맵에서 잡을 수 있는 포켓몬 중`
    : usageInfo() ? `${usageInfo().label} 실전 포켓몬 중` : '최종진화 포켓몬 중';
  const head = (sub, buttons = '') => `<div class="card-head"><h3>${ICONS.spark} 다음에 노릴 속성</h3>
    <span class="sub">${esc(sub)}</span>${buttons}</div>`;
  if (store.party.length >= 6) {
    recEl.innerHTML = `${head('파티 6마리 완성!')}
      <p class="note">아래에서 멤버별 세팅과 약점을 확인하세요. 바꾸고 싶은 포켓몬을 빼면(✕) 그 자리에 맞는 속성을 다시 추천해요.</p>`;
    return;
  }
  const recs = recommendTypes(ctx, members, { limit: 6 });
  if (!recs.length) {
    recEl.innerHTML = `${head(scope)}<p class="empty">추천할 후보가 없어요. 옵션을 바꿔 보세요.</p>`;
    return;
  }
  const cards = recs.map((r, rank) => {
    const total = r.list.length;
    let off = recOffset.get(r.type) || 0;
    if (off >= total) { off = 0; recOffset.set(r.type, 0); }
    const examples = r.list.slice(off, off + 3);
    return `<div class="rec-type">
      <div class="rec-head">${typeBadge(engine, r.type, 'lg')}<span class="rec-rank">${rank + 1}순위</span>
        <span class="note">후보 ${total}마리</span></div>
      <div class="reasons">${r.reasons.map(x => reasonChip(engine, x)).join('') || '<span class="note">공격·방어 균형을 고르게 올려줘요</span>'}</div>
      <div class="rec-examples">${examples.map(({ c }) => `
        <button class="rec-mon" type="button" data-add="${c.id}" title="파티에 넣기">
          ${sprite(c.mon)}
          <span class="rm-main"><b>${esc(c.mon.ko)}</b>${typeList(engine, c.mon.t, 'sm')}<span class="rm-hint">${esc(exampleHint(ctx, c))}</span></span>
          <span class="rm-add">${ICONS.plus}</span>
        </button>`).join('')}</div>
      ${total > 3 ? `<button class="link-btn" type="button" data-more="${r.type}">다른 예시 보기 (${Math.min(off + 3, total)}/${total})</button>` : ''}
    </div>`;
  }).join('');
  recEl.innerHTML = `${head(`${scope} · 고르면 바로 다시 계산해요`,
    `<button class="btn sm ghost" type="button" data-act="autofill" title="남은 칸을 예시로 끝까지 채워 보기">끝까지 자동 채우기</button>`)}
    <div class="rec-grid">${cards}</div>`;
}

function renderAnalysis(ctx, members) {
  if (!members.length) {
    analysisEl.innerHTML = `<div class="card empty"><strong>아직 파티가 비어 있어요</strong>가진 포켓몬을 검색해 넣거나, 위의 추천 속성 예시를 골라 시작해 보세요.</div>`;
    return;
  }
  const a = analyze(ctx, members);
  analysisEl.innerHTML = [
    setsCard(members),
    scoreCard(a, members),
    diagCard(a),
    `<details class="deep card" id="p-deep" ${deepOpen ? 'open' : ''}>
      <summary><h3>상세 상성 분석</h3><span class="sub">자속 공격 커버리지 · 방어 상성표</span></summary>
      <div class="deep-body">${coverageCard(a, members)}${matrixCard(a, members)}</div>
    </details>`,
  ].join('');
}

/** 실전 통계에 없는 멤버: 추천 세팅(Smogon → 랜덤배틀 → 자체 생성) + 다른 세팅 펼치기 */
function recommendedCard(m) {
  const { engine, sets } = store;
  const head = `<header>${sprite(m.mon)}<span>${esc(m.mon.ko)}</span></header>`;
  if (!sets) return `<div class="set-card">${head}<p class="note">추천 세팅 불러오는 중…</p></div>`;
  const [first, ...rest] = orderedSets(sets, m.id, setsOrder());
  if (!first) return `<div class="set-card">${head}<p class="note">세팅 정보가 없어요.</p></div>`;
  const opts = { mode: store.mode, game: gameOpts() };
  const more = rest.length
    ? `<details class="more-sets"><summary>다른 세팅 ${rest.length}개</summary>${rest.map(s => setCard(engine, sets, m.mon, s, { ...opts, header: false })).join('')}</details>`
    : '';
  return setCard(engine, sets, m.mon, first, { ...opts, extra: more });
}

function setsCard(members) {
  const { engine, usage } = store;
  const info = usageInfo();
  const line = (label, vals) => (vals ? `<div class="set-line"><span>${label}</span><span class="vals">${vals}</span></div>` : '');
  const cards = members.map(m => {
    const u = m.u;
    if (!u) return recommendedCard(m);
    return `<div class="set-card">
      <header>${sprite(m.mon)}<span>${esc(m.mon.ko)}</span><span class="pill-soft accent">실전 ${u.r}위 · ${u.u}%</span></header>
      <div class="set-src"><b>실전 통계</b><span>${esc(info.label)} ${esc(info.month)} · 레이팅 ${info.cutoff}+</span></div>
      ${line('특성', u.ab.slice(0, 2).map(([a, p]) => `${esc(engine.abilityKo(a))}<em>${p}%</em>`).join(''))}
      ${line('도구', u.it.slice(0, 3).map(([i, p]) => `${itemLabel(usage, i)}<em>${p}%</em>`).join(''))}
      ${line('기술', u.mv.slice(0, 6).map(([mv, p]) => `<span>${moveLabel(engine, usage, mv)}<em>${Math.round(p)}%</em></span>`).join(''))}
      ${u.sp[0] ? line('성격', `${natureText(usage, u.sp[0][0])} <span class="faint">${spreadText(u.sp[0][1])}</span>`) : ''}
      ${u.te ? line('테라', u.te.map(([t, p]) => `${store.dex.typeNames[t] ? typeBadge(engine, t, 'sm') : esc(t)}<em>${p}%</em>`).join('')) : ''}
    </div>`;
  }).join('');
  const sub = isGameMode()
    ? `${gameRule().name} · ${battleMode() === 'double' ? '더블' : '싱글'} 기준 · Smogon 추천 → 랜덤배틀 → 자체 생성 (게임에서 못 구하는 도구·기술은 취소선)`
    : info ? `${info.label} 실전 통계 우선 · 상위권에 없으면 Smogon 추천 → 랜덤배틀 → 자체 생성 세팅`
    : 'Smogon 분석가 세팅 → 랜덤배틀 역할 세팅 → 자체 생성 순';
  return `
  <section class="card">
    <div class="card-head"><h3>멤버별 추천 세팅</h3><span class="sub">${esc(sub)}</span></div>
    <div class="sets">${cards}</div>
  </section>`;
}

function scoreCard(a, members) {
  const s = a.scores;
  const info = usageInfo();
  const basis = isGameMode() ? '게임 출현 포켓몬 기준' : info ? `${info.label} 메타 기준` : '타입 상성 기준';
  const bar = (label, v, sub) => `
    <div class="score-bar"><span>${label}</span><span class="track"><span style="width:${v}%"></span></span><span class="v">${v}</span></div>
    ${sub ? `<p class="note" style="margin:-4px 0 0">${sub}</p>` : ''}`;
  return `
  <section class="card score-card">
    <div class="grade g-${s.grade}" style="--p:${s.total}"><div><b>${s.grade}</b><span>${s.total}점</span></div></div>
    <div class="score-bars">
      <div class="card-head" style="margin:0"><h3>파티 종합 평가</h3>
        <span class="sub">${members.length}/6마리 · ${esc(basis)}</span></div>
      ${bar('방어 밸런스', s.def, '약점이 겹칠수록, 받아줄 포켓몬이 없을수록 감점')}
      ${bar('공격 커버리지', s.off, `자속 기술로 상대 후보의 ${Math.round(s.seShare * 100)}%에게 효과 굉장`)}
    </div>
  </section>`;
}

function diagCard(a) {
  const { engine } = store;
  const order = { danger: 0, warn: 1, good: 2, info: 3 };
  const items = [...a.diag].sort((x, y) => order[x.level] - order[y.level]);
  return `
  <section class="card">
    <div class="card-head"><h3>약점 & 시너지 진단</h3></div>
    <ul class="diag">${items.map(d => `
      <li class="${d.level}"><span class="lv">${LEVEL_LABEL[d.level]}</span>
        ${d.type ? typeBadge(engine, d.type, 'sm') : ''}${d.types ? `<span class="types">${d.types.map(t => typeBadge(engine, t, 'sm')).join('')}</span>` : ''}
        <span>${esc(d.text)}</span></li>`).join('') || '<li class="good"><span class="lv">좋음</span>특별한 문제가 없어요</li>'}</ul>
  </section>`;
}

function coverageCard(a, members) {
  const { engine } = store;
  return `
  <div class="deep-part">
    <div class="card-head"><h3>자속 공격 커버리지</h3><span class="sub">타입별로 낼 수 있는 최고 배율</span></div>
    <div class="coverage">${a.offense.map(o => `
      <div class="cov-item ${o.best < 2 ? 'miss' : ''}">
        ${typeBadge(engine, o.type, 'sm')}
        <span class="who">${o.best >= 2 ? o.by.slice(0, 3).map(i => sprite(members[i].mon, 'icon', `title="${esc(members[i].mon.ko)}"`)).join('') : ''}</span>
        ${mult(o.best, true)}
      </div>`).join('')}</div>
  </div>`;
}

function matrixCard(a, members) {
  const { engine } = store;
  return `
  <div class="deep-part">
    <div class="card-head"><h3>방어 상성표</h3><span class="sub">공격 타입별로 각 포켓몬이 받는 배율 · 특성/테라 반영</span></div>
    <div class="table-wrap">
      <table class="matrix">
        <thead><tr><th class="rowhead">공격 타입</th>
          ${members.map(m => `<th>${sprite(m.mon)}<span class="th-name">${esc(m.mon.ko)}</span>${m.tera ? `<span class="pill-soft">테라 ${esc(engine.typeKo(m.tera))}</span>` : ''}</th>`).join('')}
          <th>약점 / 반감</th></tr></thead>
        <tbody>${a.rows.map(r => `
          <tr class="${r.level}">
            <th class="rowhead">${typeBadge(engine, r.type, 'sm')}</th>
            ${r.mults.map(x => `<td>${mult(x)}</td>`).join('')}
            <td><span class="sum">${r.weak} / ${r.resist}${r.level === 'danger' ? ' 위험' : ''}</span></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}
