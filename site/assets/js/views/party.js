// 파티 추천: 슬롯 편집, 빈 슬롯 자동 추천, 종합 평가·진단·방어 상성표·공격 커버리지·실전 세팅
import { store, update, getContext, partyMembers, addToParty, encodeParty, usageInfo } from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, copyText, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, ICONS, moveLabel, itemLabel, natureText, spreadText } from '../ui/components.js';
import { ABILITY_EFFECTS } from '../core/engine.js';
import { analyze, recommend, alternativesFor, explainSlot } from '../core/party.js';

// 사용자가 처음 보여준 예시 파티 (Gemini 예시 코드의 파티 구성)
const EXAMPLE = ['delphox', 'luxray', 'iron-crown', 'quagsire', 'sableye', 'vivillon'];
const LEVEL_LABEL = { danger: '위험', warn: '주의', good: '좋음', info: '참고' };

let root, slotsEl, analysisEl, optionsEl;
let openAlts = new Set();
let optionsOpen = false;

export function initParty(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">파티 빌더</span>
      <h1>내 포켓몬으로 파티 추천받기</h1>
      <p>가진 포켓몬을 넣고 <b>빈 슬롯 자동 추천</b>을 누르면 약점 겹침 · 공격 범위 · 실전 동료 사용률을 따져 나머지를 채워드려요.
        🔒 잠긴 슬롯은 유지되고, 잠금을 풀면 추천이 바꿀 수 있어요.</p>
    </div>
    <div class="party-tools">
      <div id="p-picker"></div>
      <div class="party-buttons">
        <button class="btn primary" type="button" data-act="recommend">${ICONS.spark}빈 슬롯 자동 추천</button>
        <button class="btn" type="button" data-act="share">${ICONS.link}공유</button>
        <button class="btn ghost" type="button" data-act="example">예시 파티</button>
        <button class="btn ghost" type="button" data-act="clear">비우기</button>
      </div>
    </div>
    <details class="options" id="p-options"></details>
    <div class="slots" id="p-slots"></div>
    <div id="p-analysis" class="view"></div>`;
  slotsEl = root.querySelector('#p-slots');
  analysisEl = root.querySelector('#p-analysis');
  optionsEl = root.querySelector('#p-options');

  createPicker(root.querySelector('#p-picker'), {
    engine: store.engine, search: store.search,
    placeholder: '내 포켓몬 추가 (이름·초성·번호)',
    onSelect: p => { const err = addToParty(p); toast(err || `${josa(p.ko, '을를')} 추가했어요`); },
  });

  on(root, 'click', '[data-act="recommend"]', runRecommend);
  on(root, 'click', '[data-act="share"]', async () => {
    if (!store.party.length) return toast('먼저 포켓몬을 추가해 주세요');
    const url = `${location.origin}${location.pathname}#/party/${encodeParty(store.party)}`;
    toast(await copyText(url) ? '파티 공유 링크를 복사했어요' : '복사에 실패했어요');
  });
  on(root, 'click', '[data-act="example"]', () => {
    openAlts = new Set();
    update(s => {
      s.party = EXAMPLE.map(slug => store.engine.bySlug.get(slug)).filter(Boolean)
        .map(m => ({ id: m.id, ability: null, tera: null, locked: true, picked: false }));
    });
    toast('예시 파티를 불러왔어요');
  });
  on(root, 'click', '[data-act="clear"]', () => { openAlts = new Set(); update(s => { s.party = []; }); });

  on(root, 'click', '[data-slot]', (e, el) => {
    const i = +el.dataset.i;
    const act = el.dataset.slot;
    if (act === 'lock') update(s => { s.party[i].locked = !s.party[i].locked; });
    if (act === 'remove') { openAlts = new Set(); update(s => { s.party.splice(i, 1); }); }
    if (act === 'alts') { openAlts.has(i) ? openAlts.delete(i) : openAlts.add(i); renderParty(); }
  });
  on(root, 'click', '[data-alt]', (e, el) => {
    const i = +el.dataset.i;
    openAlts.delete(i);
    update(s => { s.party[i] = { id: +el.dataset.alt, ability: null, tera: null, locked: false, picked: true }; });
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
  on(root, 'input', 'input[type="range"][data-filter]', (e, el) => { el.nextElementSibling.textContent = el.value; });
  optionsEl.addEventListener('toggle', () => { optionsOpen = optionsEl.open; });
}

function runRecommend() {
  const ctx = getContext();
  const members = partyMembers(ctx);
  if (members.filter(m => m.locked).length >= 6) {
    toast('모든 슬롯이 잠겨 있어요. 바꿀 슬롯의 🔒를 풀어주세요');
    return;
  }
  const t0 = performance.now();
  const r = recommend(ctx, members);
  openAlts = new Set();
  update(s => {
    s.party = r.party.map(m => (m.locked
      ? s.party.find(p => p.id === m.id)
      : { id: m.id, ability: null, tera: null, locked: false, picked: true }));
  });
  toast(r.picks.size ? `${r.picks.size}마리를 추천했어요 (${Math.round(performance.now() - t0)}ms)` : '추천할 후보가 없어요. 옵션을 바꿔 보세요');
}

export function renderParty() {
  if (!root) return;
  const ctx = getContext();
  const members = partyMembers(ctx);
  renderOptions(ctx);
  renderSlots(ctx, members);
  renderAnalysis(ctx, members);
  // 주소창을 현재 파티로 동기화 (새로고침·공유 시 유지)
  const hash = store.party.length ? `#/party/${encodeParty(store.party)}` : '#/party';
  if (location.hash.startsWith('#/party') && location.hash !== hash) history.replaceState(null, '', hash);
}

function renderOptions(ctx) {
  const f = store.filters;
  const info = usageInfo();
  if (info) {
    optionsEl.innerHTML = `
      <summary>추천 옵션 <span class="note">· 실전 데이터: ${esc(info.label)} ${esc(info.month)}</span></summary>
      <div class="options-body">
        <label class="check"><input type="checkbox" data-filter="usageMega" ${f.usageMega ? 'checked' : ''}> 메가진화 포함 (파티당 1마리)</label>
        <p class="note">후보: ${esc(info.desc)} 사용률 상위 ${ctx.pool.length}마리. 타입 상성 + 실전 동료 사용률(함께 쓰인 비율) + 사용률을 함께 반영합니다.
          상단의 데이터 기준을 <b>타입 상성만</b>으로 바꾸면 전체 도감에서 추천해요.</p>
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
        <p class="note">최종진화 포켓몬 중에서 고릅니다. 종족값이 높고 파티의 약점을 메우는 포켓몬을 우선해요.</p>
      </div>`;
  }
  optionsEl.open = optionsOpen;
}

function reasonChip(engine, r) {
  switch (r.kind) {
    case 'def': return `<span class="reason">${typeBadge(engine, r.type, 'sm')} ${r.mult === 0 ? '무효' : r.mult <= 0.25 ? '¼ 반감' : '반감'}</span>`;
    case 'off': return `<span class="reason off">${r.types.map(t => typeBadge(engine, t, 'sm')).join('')} 공략</span>`;
    case 'cov': return `<span class="reason off">공격 범위 +${Math.round(r.value * 100)}%</span>`;
    case 'mate': return `<span class="reason mate">${esc(r.with.ko)} 동료 ${r.pct}%</span>`;
    case 'usage': return `<span class="reason usage">사용률 ${r.u}% · ${r.rank}위</span>`;
    case 'bst': return `<span class="reason usage">높은 종족값 ${r.value}</span>`;
    case 'warn': return `<span class="reason warn">${typeBadge(engine, r.type, 'sm')} 약점 ${r.count}마리째</span>`;
    default: return '';
  }
}

function renderSlots(ctx, members) {
  const { engine, dex } = store;
  const html = [];
  for (let i = 0; i < 6; i++) {
    const m = store.party[i], pm = members[i];
    if (!m) {
      html.push(`<div class="slot empty-slot"><div><b>빈 슬롯 ${i + 1}</b>검색으로 추가하거나<br>자동 추천을 눌러 보세요</div></div>`);
      continue;
    }
    const mon = pm.mon;
    const abilities = engine.abilitiesOf(mon);
    const reasons = m.picked ? explainSlot(ctx, members, i) : [];
    const alts = openAlts.has(i) ? alternativesFor(ctx, members, i, 8) : null;
    html.push(`
      <div class="slot ${m.picked ? 'picked' : ''}">
        <div class="slot-top">
          <a href="#/matchup/${mon.slug}" data-go="${mon.slug}" title="상성 보기">${sprite(mon)}</a>
          <div>
            <div class="slot-name"><a href="#/matchup/${mon.slug}" data-go="${mon.slug}">${esc(mon.ko)}</a>${m.picked ? '<span class="pill-soft accent">추천</span>' : ''}</div>
            <div class="slot-sub">${typeList(engine, mon.t, 'sm')}${pm.u ? `<span class="note">${pm.u.u}%</span>` : ''}</div>
          </div>
          <div class="slot-actions">
            <button type="button" data-slot="lock" data-i="${i}" aria-pressed="${m.locked}" title="${m.locked ? '잠김: 추천해도 유지' : '잠금 해제: 추천이 교체 가능'}" aria-label="잠금">${m.locked ? ICONS.lock : ICONS.unlock}</button>
            <button type="button" data-slot="alts" data-i="${i}" aria-pressed="${openAlts.has(i)}" title="다른 후보 보기" aria-label="다른 후보">${ICONS.swap}</button>
            <button type="button" data-slot="remove" data-i="${i}" title="빼기" aria-label="파티에서 빼기">${ICONS.close}</button>
          </div>
        </div>
        <div class="slot-fields">
          <label>특성<select class="select" data-field="ability" data-i="${i}">
            ${abilities.map(a => `<option value="${a}" ${a === pm.ability ? 'selected' : ''}>${esc(engine.abilityKo(a))}${ABILITY_EFFECTS[a] ? ' ★' : ''}</option>`).join('')}
          </select></label>
          <label>테라스탈<select class="select" data-field="tera" data-i="${i}">
            <option value="">없음</option>
            ${[...dex.types, 'stellar'].map(t => `<option value="${t}" ${t === m.tera ? 'selected' : ''}>${esc(engine.typeKo(t))}</option>`).join('')}
          </select></label>
        </div>
        ${reasons.length ? `<div class="reasons">${reasons.map(r => reasonChip(engine, r)).join('')}</div>` : ''}
        ${alts ? `<div class="alts"><span class="alts-title">이 자리에 넣을 만한 다른 후보</span>
          <div class="chips">${alts.map(a => `<button class="chip" type="button" data-alt="${a.c.id}" data-i="${i}">${sprite(a.c.mon)}${esc(a.c.mon.ko)}</button>`).join('') || '<span class="note">후보 없음</span>'}</div></div>` : ''}
      </div>`);
  }
  slotsEl.innerHTML = html.join('');
}

function renderAnalysis(ctx, members) {
  if (!members.length) {
    analysisEl.innerHTML = `<div class="card empty"><strong>아직 파티가 비어 있어요</strong>포켓몬을 검색해 추가하거나 <b>예시 파티</b>를 불러온 뒤 <b>빈 슬롯 자동 추천</b>을 눌러 보세요.</div>`;
    return;
  }
  const a = analyze(ctx, members);
  analysisEl.innerHTML = [
    scoreCard(a, members),
    `<div class="grid-2">${diagCard(a)}${coverageCard(a, members)}</div>`,
    matrixCard(a, members),
    setsCard(members),
  ].join('');
}

function scoreCard(a, members) {
  const s = a.scores;
  const info = usageInfo();
  const bar = (label, v, sub) => `
    <div class="score-bar"><span>${label}</span><span class="track"><span style="width:${v}%"></span></span><span class="v">${v}</span></div>
    ${sub ? `<p class="note" style="margin:-4px 0 0">${sub}</p>` : ''}`;
  return `
  <section class="card score-card">
    <div class="grade g-${s.grade}" style="--p:${s.total}"><div><b>${s.grade}</b><span>${s.total}점</span></div></div>
    <div class="score-bars">
      <div class="card-head" style="margin:0"><h3>파티 종합 평가</h3>
        <span class="sub">${members.length}/6마리 · ${info ? `${esc(info.label)} 메타 기준` : '타입 상성 기준'}</span></div>
      ${bar('방어 밸런스', s.def, '약점이 겹칠수록, 받아줄 포켓몬이 없을수록 감점')}
      ${bar('공격 커버리지', s.off, `자속 기술로 ${info ? '실전 메타' : '후보'} 포켓몬의 ${Math.round(s.seShare * 100)}%에게 효과 굉장`)}
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
  <section class="card">
    <div class="card-head"><h3>자속 공격 커버리지</h3><span class="sub">타입별로 낼 수 있는 최고 배율</span></div>
    <div class="coverage">${a.offense.map(o => `
      <div class="cov-item ${o.best < 2 ? 'miss' : ''}">
        ${typeBadge(engine, o.type, 'sm')}
        <span class="who">${o.best >= 2 ? o.by.slice(0, 3).map(i => sprite(members[i].mon, 'icon', `title="${esc(members[i].mon.ko)}"`)).join('') : ''}</span>
        ${mult(o.best, true)}
      </div>`).join('')}</div>
  </section>`;
}

function matrixCard(a, members) {
  const { engine } = store;
  return `
  <section class="card">
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
  </section>`;
}

function setsCard(members) {
  const { engine, usage } = store;
  if (!usage) return '';
  const info = usageInfo();
  const line = (label, vals) => (vals ? `<div class="set-line"><span>${label}</span><span class="vals">${vals}</span></div>` : '');
  const cards = members.map(m => {
    const u = m.u;
    if (!u) {
      return `<div class="set-card"><header>${sprite(m.mon)}${esc(m.mon.ko)}</header>
        <p class="note">${esc(info.label)} 사용률 상위권에 없어 실전 통계가 없어요.</p></div>`;
    }
    return `<div class="set-card">
      <header>${sprite(m.mon)}<span>${esc(m.mon.ko)}</span><span class="pill-soft accent">${u.r}위 · ${u.u}%</span></header>
      ${line('특성', u.ab.slice(0, 2).map(([a, p]) => `${esc(engine.abilityKo(a))}<em>${p}%</em>`).join(''))}
      ${line('도구', u.it.slice(0, 3).map(([i, p]) => `${itemLabel(usage, i)}<em>${p}%</em>`).join(''))}
      ${line('기술', u.mv.slice(0, 6).map(([mv, p]) => `<span>${moveLabel(engine, usage, mv)}<em>${Math.round(p)}%</em></span>`).join(''))}
      ${u.sp[0] ? line('성격', `${natureText(usage, u.sp[0][0])} <span class="faint">${spreadText(u.sp[0][1])}</span>`) : ''}
      ${u.te ? line('테라', u.te.map(([t, p]) => `${store.dex.typeNames[t] ? typeBadge(engine, t, 'sm') : esc(t)}<em>${p}%</em>`).join('')) : ''}
    </div>`;
  }).join('');
  return `
  <section class="card">
    <div class="card-head"><h3>멤버별 실전 세팅</h3><span class="sub">${esc(info.label)} · ${esc(info.month)} · ${info.battles.toLocaleString()}판 통계</span></div>
    <div class="sets">${cards}</div>
  </section>`;
}
