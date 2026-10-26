// 파티 추천: 내 파티 → 다음에 노릴 속성(예시 포켓몬 3마리) → 멤버별 추천 세팅 → 평가·진단 → 상세 상성 분석
// 「포켓몬 파티!」는 원하는 포켓몬을 고를 수 없으므로 "어떤 속성을 노릴지 + 그 속성의 예시"를 추천하고,
// 예시를 고르면 바로 다음 추천을 다시 계산한다.
import {
  store, update, getContext, partyMembers, addToParty, encodeParty, usageInfo,
  isGameMode, gameRule, battleMode, whereToFind, setsOrder, gameOpts, evoOptions, megaOptions, loadMoves, sanitizeSet,
} from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, copyText, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, ICONS, moveLabel, itemLabel, natureText, spreadText } from '../ui/components.js';
import { ABILITY_EFFECTS } from '../core/engine.js';
import { analyze, recommend, recommendTypes, explainSlot, explainCandidate, memberValues, alternativesFor, bestSwaps } from '../core/party.js';
import { orderedSets, setCard } from '../ui/sets.js';
import { reasonChip, commentText, itemName, addPlan, catchHint } from '../ui/reasons.js';
import { buildCard, readEditor, fillEditor, analyzeMember, pickSet, pickedSet, selectedTarget } from '../ui/builder.js';
import { bindSearchSelects } from '../ui/searchselect.js';
import { describeSet, refSource } from '../ui/setdesc.js';

// 사용자가 처음 보여준 예시 파티 (Gemini 예시 코드의 파티 구성)
const EXAMPLE = ['delphox', 'luxray', 'iron-crown', 'quagsire', 'sableye', 'vivillon'];
const LEVEL_LABEL = { danger: '위험', warn: '주의', good: '좋음', info: '참고' };

let root, slotsEl, recEl, analysisEl, optionsEl;
let optionsOpen = null;   // null = 모드 기본값 (게임 모드는 펼침)
let deepOpen = false;
let editing = null;       // 내 세팅 입력 폼을 연 멤버 번호
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
    editing = null;
    update(s => {
      s.party = EXAMPLE.map(slug => store.engine.bySlug.get(slug)).filter(Boolean)
        .map(m => ({ id: m.id, ability: null, tera: null, picked: false }));
    });
    toast('예시 파티를 불러왔어요');
  });
  on(root, 'click', '[data-act="clear"]', () => { editing = null; update(s => { s.party = []; }); });
  on(root, 'click', '[data-act="autofill"]', autofill);
  on(root, 'click', '[data-remove]', (e, el) => { editing = null; update(s => { s.party.splice(+el.dataset.remove, 1); }); });
  on(root, 'click', '[data-add]', (e, el) => {
    const mon = store.engine.byId.get(+el.dataset.add);
    const plan = { picked: true, evo: +el.dataset.evo || null, mega: +el.dataset.mega || null };
    // 멤버 점수의 "대신 노릴 후보": 그 자리를 바꿔 본다
    if (el.dataset.replace !== undefined) {
      const i = +el.dataset.replace, old = store.engine.byId.get(store.party[i].id);
      if (store.party.some((m, j) => j !== i && store.engine.byId.get(m.id).sp === mon.sp)) return toast(`${josa(mon.ko, '와과')} 같은 종이 이미 파티에 있어요`);
      editing = null;
      update(s => { s.party[i] = { id: mon.id, ability: null, tera: null, set: null, ...plan }; });
      return toast(`${josa(old.ko, '을를')} ${josa(mon.ko, '으로')} 바꿔 봤어요 · 마음에 안 들면 ✕로 빼고 다시 넣으세요`);
    }
    const err = addToParty(mon, plan);
    toast(err || `${josa(mon.ko, '을를')} 넣었어요 · 다음 추천을 다시 계산했어요`);
  });
  on(root, 'click', '[data-more]', (e, el) => {
    recOffset.set(el.dataset.more, (recOffset.get(el.dataset.more) || 0) + 3);
    renderParty();
  });
  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); location.hash = `#/matchup/${el.dataset.go}`; });
  on(root, 'change', '[data-field]', (e, el) => {
    const i = +el.dataset.i, field = el.dataset.field;
    const numeric = field === 'evo' || field === 'mega';
    update(s => { s.party[i][field] = el.value ? (numeric ? +el.value : el.value) : null; });
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
  // 내 세팅 입력
  on(root, 'click', '[data-act="set-edit"]', (e, el) => { editing = +el.dataset.i; loadMoves(); renderParty(); });
  on(root, 'click', '[data-act="set-cancel"]', () => { editing = null; renderParty(); });
  on(root, 'click', '[data-act="set-clear"]', (e, el) => {
    editing = null;
    update(s => { s.party[+el.dataset.i].set = null; });
    toast('입력한 세팅을 지웠어요');
  });
  on(root, 'click', '[data-act="set-fill"]', (e, el) => {
    const i = +el.dataset.i;
    const t = selectedTarget(i, store.party[i], partyMembers(getContext())[i]);
    if (t) fillEditor(el.closest('form'), t.set);
    toast(`${t?.title || '세팅'}을 채웠어요 · 실제와 다르면 고친 뒤 저장하세요`);
  });
  // 멤버 카드의 세팅 버튼 (최선 ↔ 참고 추천 세팅)
  on(root, 'click', '[data-pick-set]', (e, el) => {
    const [i, key] = el.dataset.pickSet.split(':');
    pickSet(+i, key);
    renderParty();
  });
  bindSearchSelects(root);
  root.addEventListener('submit', e => {
    const form = e.target.closest('.set-editor');
    if (!form) return;
    e.preventDefault();
    const i = +form.dataset.editor;
    const { set, ability } = readEditor(form);
    editing = null;
    update(s => {
      s.party[i].set = sanitizeSet(set);
      if (ability) s.party[i].ability = ability;
    });
    toast('내 세팅을 저장했어요 · 할 일을 확인하세요');
  });
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
    for (const c of r.party.slice(s.party.length)) s.party.push({ ...addPlan(c), ability: null, tera: null, picked: true, set: null });
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
    // caught: 가진 모습 / mon: 분석에 쓰는 모습(최종 진화 → 메가진화) / evolved: 메가진화 전 최종 진화
    const caught = pm.base, mon = pm.mon;
    const finals = evoOptions(caught);
    const evolved = (finals.find(f => f.mon.id === m.evo) || finals[0])?.mon || caught;
    const megas = megaOptions(evolved);
    const abilities = engine.abilitiesOf(mon);
    const reasons = m.picked ? explainSlot(ctx, members, i).filter(r => r.kind !== 'usage') : [];
    const where = isGameMode() ? whereToFind(caught) : '';
    const evoNote = mon.id !== caught.id
      ? `<div class="slot-evo">→ <b>${esc(mon.ko)}</b> 기준으로 분석${pm.stone ? ` · ${esc(itemName(pm.stone))}` : ''}</div>` : '';
    html.push(`
      <div class="slot ${m.picked ? 'picked' : ''}">
        <div class="slot-top">
          <a href="#/matchup/${caught.slug}" data-go="${caught.slug}" title="상성 보기">${sprite(caught)}</a>
          <div>
            <div class="slot-name"><a href="#/matchup/${caught.slug}" data-go="${caught.slug}">${esc(caught.ko)}</a>${m.picked ? '<span class="pill-soft accent">추천</span>' : ''}</div>
            <div class="slot-sub">${typeList(engine, mon.t, 'sm')}${pm.u ? `<span class="note">${pm.u.u}%</span>` : ''}${where ? `<span class="note">${esc(where)}</span>` : ''}</div>
            ${evoNote}
          </div>
          <div class="slot-actions">
            <button type="button" data-remove="${i}" title="빼기" aria-label="파티에서 빼기">${ICONS.close}</button>
          </div>
        </div>
        <div class="slot-fields ${showTera || finals.length > 1 || megas.length ? '' : 'one'}">
          ${finals.length > 1 ? `<label>진화 목표<select class="select" data-field="evo" data-i="${i}">
            ${finals.map(f => `<option value="${f.mon.id}" ${f.mon.id === evolved.id ? 'selected' : ''}>${esc(f.mon.ko)}${f.item ? ` (${esc(itemName(f.item))})` : ''}</option>`).join('')}
          </select></label>` : ''}
          ${megas.length ? `<label>메가진화<select class="select" data-field="mega" data-i="${i}">
            <option value="">안 함</option>
            ${megas.map(([id, stone]) => `<option value="${id}" ${id === m.mega ? 'selected' : ''}>${esc(engine.byId.get(id)?.ko || '')} · ${esc(itemName(stone))}</option>`).join('')}
          </select></label>` : ''}
          <label>특성<select class="select" data-field="ability" data-i="${i}" ${abilities.length < 2 ? 'disabled' : ''}>
            ${abilities.map(a => `<option value="${a}" ${a === pm.ability ? 'selected' : ''}>${esc(engine.abilityKo(a))}${ABILITY_EFFECTS[a] ? ' ★' : ''}</option>`).join('')}
          </select></label>
          ${showTera ? `<label>테라스탈<select class="select" data-field="tera" data-i="${i}">
            <option value="">없음</option>
            ${[...dex.types, 'stellar'].map(t => `<option value="${t}" ${t === m.tera ? 'selected' : ''}>${esc(engine.typeKo(t))}</option>`).join('')}
          </select></label>` : ''}
        </div>
        ${reasons.length ? `<div class="reasons">${reasons.map(r => reasonChip(engine, r)).join('')}</div>
          <p class="slot-why">${esc(commentText(engine, reasons, pm))}</p>` : ''}
      </div>`);
  }
  slotsEl.innerHTML = html.join('');
}

/** 예시 포켓몬 아래에 붙는 한 줄: 게임 모드는 잡는 곳(진화 전으로 잡으면 그 모습), 실전 모드는 사용률, 타입 모드는 종족값 */
function exampleHint(ctx, c) {
  if (isGameMode()) return catchHint(c);
  if (c.u) return `사용률 ${c.u.u}%`;
  return `종족값 ${ctx.stats(c.mon).reduce((a, b) => a + b, 0)}`;
}

/**
 * 6마리 완성: 파티 평가(등급·강점·약점) + 교체 추천(멤버 하나를 바꾸면 파티 점수가 가장 많이 오르는 조합)
 */
function fullPartyCard(ctx, members, scope) {
  const { engine } = store;
  const a = analyze(ctx, members);
  const s = a.scores;
  const order = { danger: 0, warn: 1, info: 2, good: 3 };
  const notes = [...a.diag].filter(d => d.level !== 'info' || d.types).sort((x, y) => order[x.level] - order[y.level]).slice(0, 4);
  const verdict = s.total >= 85 ? '아주 균형 잡힌 파티예요. 세팅을 다듬는 데 집중하세요.'
    : s.total >= 70 ? '좋은 파티예요. 아래 교체 한 번이면 더 단단해져요.'
      : s.total >= 55 ? '약점이 조금 몰려 있어요. 아래 교체 추천을 노려 보세요.'
        : '약점이 크게 겹쳐요. 교체 추천부터 노리는 걸 권해요.';
  // 보여 주는 파티 점수(0~100) 순서와 맞게 정렬
  const swaps = bestSwaps(ctx, members).filter(x => x.gain > 0.15)
    .map(x => ({ ...x, after: analyze(ctx, members.map((m, j) => (j === x.i ? x.c : m))).scores }))
    .sort((a, b) => b.after.total - a.after.total || b.gain - a.gain);
  const swapHtml = swaps.map(x => {
    const out = members[x.i];
    const { after } = x;
    const plan = addPlan(x.c);
    return `<div class="swap">
      <div class="swap-from">${sprite(out.base)}<span><b>${esc(out.base.ko)}</b><span class="note">빼고</span></span></div>
      <span class="swap-arrow" aria-hidden="true">→</span>
      <button class="rec-mon" type="button" data-replace="${x.i}" data-add="${plan.id}"${plan.evo ? ` data-evo="${plan.evo}"` : ''}${plan.mega ? ` data-mega="${plan.mega}"` : ''} title="이렇게 바꿔 보기">
        ${sprite(x.c.mon)}
        <span class="rm-main"><b>${esc(x.c.mon.ko)}</b>${typeList(engine, x.c.mon.t, 'sm')}
          <span class="rm-why">${esc(commentText(engine, x.reasons, x.c))}</span>
          <span class="rm-hint">${esc(exampleHint(ctx, x.c))}</span></span>
        <span class="swap-gain"><b>${s.total} → ${after.total}</b><span>${s.grade} → ${after.grade}</span></span>
      </button>
    </div>`;
  }).join('');
  return `<div class="card-head"><h3>${ICONS.spark} 6마리 완성 · 파티 평가</h3><span class="sub">${esc(scope)} 교체 후보를 찾았어요</span></div>
    <div class="full-eval">
      <div class="grade g-${s.grade}" style="--p:${s.total}"><div><b>${s.grade}</b><span>${s.total}점</span></div></div>
      <div class="full-eval-main">
        <p class="catch-verdict">${esc(verdict)}</p>
        <p class="note">방어 밸런스 ${s.def} · 공격 커버리지 ${s.off} (자속 기술로 상대 후보의 ${Math.round(s.seShare * 100)}%에게 효과 굉장)</p>
        ${notes.length ? `<ul class="diag">${notes.map(d => `<li class="${d.level}"><span class="lv">${LEVEL_LABEL[d.level]}</span>
          ${d.type ? typeBadge(engine, d.type, 'sm') : ''}${d.types ? `<span class="types">${d.types.map(t => typeBadge(engine, t, 'sm')).join('')}</span>` : ''}
          <span>${esc(d.text)}</span></li>`).join('')}</ul>` : ''}
      </div>
    </div>
    <h4 class="swap-title">교체 추천 <span class="note">한 마리만 바꿨을 때 파티 점수가 가장 많이 오르는 조합 · 누르면 바꿔 봐요</span></h4>
    ${swapHtml ? `<div class="swap-list">${swapHtml}</div>` : '<p class="note">이 맵에서 잡을 수 있는 포켓몬 중에는 바꿔서 더 좋아지는 조합이 없어요. 아래 멤버별 세팅을 다듬어 보세요.</p>'}`;
}

function renderRec(ctx, members) {
  const { engine } = store;
  const scope = isGameMode()
    ? `${store.gameData.maps.find(m => m.key === store.game.map)?.name} 맵에서 잡을 수 있는 포켓몬 중`
    : usageInfo() ? `${usageInfo().label} 실전 포켓몬 중` : '최종진화 포켓몬 중';
  const head = (sub, buttons = '') => `<div class="card-head"><h3>${ICONS.spark} 다음에 노릴 속성</h3>
    <span class="sub">${esc(sub)}</span>${buttons}</div>`;
  if (store.party.length >= 6) {
    recEl.innerHTML = fullPartyCard(ctx, members, scope);
    return;
  }
  const recs = recommendTypes(ctx, members, { limit: 6 });
  if (!recs.length) {
    recEl.innerHTML = `${head(scope)}<p class="empty">추천할 후보가 없어요. 옵션을 바꿔 보세요.</p>`;
    return;
  }
  const cards = recs.map((r, rank) => {
    // 같은 종의 일반·메가진화 후보는 점수가 높은 쪽만
    const seen = new Set();
    const list = r.list.filter(({ c }) => !seen.has(c.sp) && seen.add(c.sp));
    const total = list.length;
    let off = recOffset.get(r.type) || 0;
    if (off >= total) { off = 0; recOffset.set(r.type, 0); }
    const examples = list.slice(off, off + 3);
    return `<div class="rec-type">
      <div class="rec-head">${typeBadge(engine, r.type, 'lg')}<span class="rec-rank">${rank + 1}순위</span>
        <span class="note">후보 ${total}마리</span></div>
      <div class="reasons">${r.reasons.map(x => reasonChip(engine, x)).join('') || '<span class="note">공격·방어 균형을 고르게 올려줘요</span>'}</div>
      <div class="rec-examples">${examples.map(({ c }) => {
        const plan = addPlan(c);
        const why = commentText(engine, explainCandidate(ctx, members, c), c);
        return `
        <button class="rec-mon" type="button" data-add="${plan.id}"${plan.evo ? ` data-evo="${plan.evo}"` : ''}${plan.mega ? ` data-mega="${plan.mega}"` : ''} title="파티에 넣기">
          ${sprite(c.mon)}
          <span class="rm-main"><b>${esc(c.mon.ko)}</b>${typeList(engine, c.mon.t, 'sm')}
            <span class="rm-why">${esc(why)}</span>
            <span class="rm-hint">${esc(exampleHint(ctx, c))}</span></span>
          <span class="rm-add">${ICONS.plus}</span>
        </button>`;
      }).join('')}</div>
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
    rankCard(ctx, members),
    setsCard(members),
    members.length < 6 ? scoreCard(a, members) : '',   // 6마리면 위의 "6마리 완성 · 파티 평가"에 등급이 있음
    diagCard(a),
    `<details class="deep card" id="p-deep" ${deepOpen ? 'open' : ''}>
      <summary><h3>상세 상성 분석</h3><span class="sub">자속 공격 커버리지 · 방어 상성표</span></summary>
      <div class="deep-body">${coverageCard(a, members)}${matrixCard(a, members)}</div>
    </details>`,
  ].join('');
}

// 멤버 점수 (0~100) = 전투력 45% + 파티 기여 35% + 기본 능력 20%
//   전투력: 세팅 점수(내 세팅을 넣었으면 지금 세팅, 아니면 이 게임 최선 세팅) — 이 맵 상대 후보와 1:1로 싸울 때의 힘
//   파티 기여: 이 멤버를 빼면 파티 점수가 얼마나 떨어지는지 (약점 보완·공격 범위, 약점이 겹치면 마이너스)
//   기본 능력: 종족값 (최종 진화·메가진화 기준)
const RANKS = [[75, '에이스', 'ace'], [60, '주전', 'good'], [45, '보통', 'ok'], [0, '교체 후보', 'weak']];
const pct = (v, lo, hi) => Math.round(100 * Math.min(1, Math.max(0, (v - lo) / (hi - lo))));

function rankCard(ctx, members) {
  const { engine } = store;
  if (members.length < 2) return '';
  const values = memberValues(ctx, members);
  const rows = members.map((m, i) => {
    const r = isGameMode() && store.moves ? analyzeMember(store.party[i], m) : null;
    const ev = r ? r.now || r.top : null;
    const raw = pct(engine.effectiveBst(m.mon), 300, 600);
    const battle = ev ? pct(ev.score, 30, 115) : raw;
    const synergy = Math.round(100 / (1 + Math.exp(-values[i].synergy / 3)));
    const total = Math.round(0.45 * battle + 0.35 * synergy + 0.2 * raw);
    return { i, m, r, ev, raw, battle, synergy, total, v: values[i], rank: RANKS.find(([min]) => total >= min) };
  }).sort((a, b) => b.total - a.total);
  const bar = (label, v, title) => `<span class="mr-bar" title="${esc(title)}"><span>${label}</span><span class="track"><span style="width:${v}%"></span></span><b>${v}</b></span>`;
  const names = ts => ts.map(t => engine.typeKo(t)).join('·');
  const items = rows.map((row, k) => {
    const { m, v, ev, r } = row;
    const good = [], bad = [];
    const def = v.reasons.filter(x => x.kind === 'def');
    const off = v.reasons.find(x => x.kind === 'off');
    if (def.length) good.push(`${names(def.map(x => x.type))} 공격을 받아줘요`);
    if (off) good.push(`${names(off.types)} 타입을 혼자 찔러요`);
    if (v.exposed.length) good.push(`빼면 ${names(v.exposed)} 약점이 몰려요`);
    const warn = v.reasons.filter(x => x.kind === 'warn');
    if (warn.length) bad.push(`${names(warn.map(x => x.type))} 약점이 겹쳐요`);
    if (ev) {
      if (ev.offense >= 85) good.push(`화력이 강해요(${Math.round(ev.offense)}%)`);
      else if (ev.offense < 60) bad.push(`화력이 약해요(${Math.round(ev.offense)}%)`);
      if (ev.speed >= 0.8) good.push('대부분보다 빨라요');
      if (ev.taken >= 60) bad.push('잘 버티지 못해요');
    }
    const potential = r?.now && r.top.score - r.now.score >= 5 ? `<p class="note">최선 세팅이면 전투력 ${pct(r.top.score, 30, 115)} (지금 ${row.battle}) — 아래 멤버별 세팅의 할 일 참고</p>` : '';
    // 교체 후보: 이 자리에 대신 넣으면 좋은 후보 (게임에서 잡을 수 있는 포켓몬 중)
    const swap = row.rank[2] === 'weak' || (k === rows.length - 1 && row.total < 55);   // 꼴찌가 낮으면 교체 후보도 보여 줌
    const alts = swap ? alternativesFor(ctx, members, row.i, 6)
      .filter(({ c }, j, arr) => arr.findIndex(x => x.c.sp === c.sp) === j).slice(0, 3) : [];
    const altHtml = alts.length ? `<div class="mr-alts"><span class="note">대신 노릴 후보</span>${alts.map(({ c }) => {
      const plan = addPlan(c);
      return `<button class="opp" type="button" data-replace="${row.i}" data-add="${plan.id}"${plan.evo ? ` data-evo="${plan.evo}"` : ''}${plan.mega ? ` data-mega="${plan.mega}"` : ''} title="이 자리를 ${esc(josa(c.mon.ko, '으로'))} 바꾸기">${sprite(c.mon)}<span><b>${esc(c.mon.ko)}</b><span class="note">${esc(exampleHint(ctx, c))}</span></span></button>`;
    }).join('')}</div>` : '';
    return `<li class="mr-row mr-${row.rank[2]}">
      <span class="mr-rank">${k + 1}</span>
      ${sprite(m.base)}
      <div class="mr-main">
        <div class="mr-name"><b>${esc(m.base.ko)}</b>${m.mon.id !== m.base.id ? `<span class="note">→ ${esc(m.mon.ko)}</span>` : ''}<span class="pill-soft mr-pill">${row.rank[1]}</span></div>
        <div class="mr-bars">
          ${bar('전투력', row.battle, ev ? `${r.now ? '지금 세팅' : '최선 세팅'} 기준 · 화력 ${Math.round(ev.offense)}% · 받는 피해 ${Math.round(ev.taken)}% · 선공 ${Math.round(ev.speed * 100)}%` : '종족값 기준 (게임 룰 모드에서 세팅으로 계산)')}
          ${bar('파티 기여', row.synergy, '빼면 파티 점수가 얼마나 떨어지는지 (약점이 겹치면 낮음)')}
          ${bar('기본 능력', row.raw, `종족값 ${engine.effectiveBst(m.mon)}`)}
        </div>
        <p class="mr-why">${good.length ? `<span class="good"><b>강점</b> ${esc(good.join(' · '))}</span>` : ''}${bad.length ? `<span class="bad"><b>아쉬운 점</b> ${esc(bad.join(' · '))}</span>` : ''}</p>
        ${potential}${altHtml}
      </div>
      <span class="mr-total"><b>${row.total}</b><span>점</span></span>
    </li>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><h3>멤버 점수 · 누가 좋은 포켓몬?</h3>
      <span class="sub">전투력 45% + 파티 기여 35% + 기본 능력 20% · ${isGameMode() ? `${esc(store.gameData.maps.find(x => x.key === store.game.map)?.name || '')} 맵 상대 후보 기준` : '지금 데이터 기준'}</span></div>
    <ol class="member-rank">${items}</ol>
    ${isGameMode() && !store.party.some(x => x.set) ? '<p class="note">「내 세팅 입력」을 하면 전투력이 지금 세팅 기준으로 바뀌어요 (입력 전에는 최선 세팅 기준).</p>' : ''}
  </section>`;
}

/** 실전 통계에 없는 멤버: 추천 세팅(Smogon → 랜덤배틀 → 자체 생성)을 버튼으로 바꿔 보기 + 한 줄 설명 */
function recommendedCard(m, i) {
  const { engine, sets } = store;
  const head = `<header>${sprite(m.mon)}<span>${esc(m.mon.ko)}</span></header>`;
  if (!sets) return `<div class="set-card">${head}<p class="note">추천 세팅 불러오는 중…</p></div>`;
  const list = orderedSets(sets, m.id, setsOrder());
  if (!list.length) return `<div class="set-card">${head}<p class="note">세팅 정보가 없어요.</p></div>`;
  const sel = list.find(s => s.key === pickedSet(i)) || list[0];
  const tabs = list.length > 1 ? `<div class="set-tabs" role="tablist" aria-label="세팅 고르기">${list.map(s => `
    <button type="button" role="tab" class="set-tab ${s === sel ? 'on' : ''}" aria-selected="${s === sel}" data-pick-set="${i}:${s.key}">${esc(`${refSource(s)} · ${describeSet(m.mon, s, { double: battleMode() === 'double' || s.key === 'D' }).role}`)}</button>`).join('')}</div>` : '';
  return setCard(engine, sets, m.mon, sel, {
    mode: store.mode, game: gameOpts(), tabs, desc: describeSet(m.mon, sel, { double: battleMode() === 'double' || sel.key === 'D' }),
  });
}

function setsCard(members) {
  const { engine, usage } = store;
  const info = usageInfo();
  const line = (label, vals) => (vals ? `<div class="set-line"><span>${label}</span><span class="vals">${vals}</span></div>` : '');
  if (isGameMode()) {
    // 「포켓몬 파티!」: 배울 수 있는 기술·구할 수 있는 도구로 계산한 최선 세팅 + 내 세팅 입력 → 할 일
    if (!store.moves) loadMoves();
    const cards = members.map((m, i) => buildCard(i, store.party[i], m, { editing: editing === i, recommended: recommendedCard(m, i) })).join('');
    return `
    <section class="card">
      <div class="card-head"><h3>멤버별 세팅</h3><span class="sub">${esc(`${gameRule().name} · ${battleMode() === 'double' ? '더블' : '싱글'} · Lv.${store.gameData.finalLevel} 기준 · 「내 세팅 입력」으로 지금 세팅을 넣으면 최선까지 할 일을 알려줘요`)}</span></div>
      <div class="sets">${cards}</div>
    </section>`;
  }
  const cards = members.map((m, i) => {
    const u = m.u;
    if (!u) return recommendedCard(m, i);
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
