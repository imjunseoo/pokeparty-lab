// 칸별 전략: 지금 파티 기준으로 보드 칸마다 할 일 (상대 차례에 미리 짜 두기). 「포켓몬 파티!」 게임 룰 모드 전용
// 멤버 카드에서 고른 목표 세팅(기본 = 계산한 최선 세팅)까지의 할 일을 칸 종류별로 모아 이득이 큰 순서로 보여 주고,
// 게임에서 한 뒤 「했어요」를 누르면 내 세팅에 기록해 다음 할 일로 바뀐다.
import {
  store, update, getContext, partyMembers, isGameMode, gameRule, getBuilder, loadMoves, evoOptions, allowedItems, setMode,
  GAME_MODE, toggleRelearn, relearnToast, setItemMode, itemMode,
} from '../state.js';
import { analyzeMember, selectedTarget, natureLabel, itemAlts } from '../ui/builder.js';
import { tileActions, growthPicks, holderRank } from '../core/strategy.js';
import { ITEM_MODES } from '../core/build.js';
import { recommendTypes, memberValues } from '../core/party.js';
import { STAT_LABELS } from '../core/engine.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeBadge } from '../ui/components.js';
import { itemName, itemSource, itemPartyWarning, catchHint } from '../ui/reasons.js';
import { relearnToggle, itemModeControl } from '../ui/sets.js';
import { searchSelect, defineOptions, bindSearchSelects } from '../ui/searchselect.js';
import { openSetEditor } from './party.js';

const NO_IV = [false, false, false, false, false, false];
const TOP = 5;              // 칸마다 보여 줄 할 일 수 (나머지는 접어 둠)
let root, bodyEl;
let lookup = '';            // 아이템 칸에서 나온 도구 (누가 지니면 좋은지)
const planCache = new WeakMap();   // 평가기 → Map(멤버·지금 세팅·목표 세팅 → 할 일)

export function initStrategy(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">칸별 전략</span>
      <h1>이 칸에 멈추면</h1>
      <p>상대 차례에 미리 짜 두세요. 지금 파티 기준으로 <b>보드 칸마다 할 일</b>을 이득이 큰 순서로 정리했어요.
        게임에서 한 뒤 <b>했어요</b>를 누르면 내 세팅에 기록되고 다음 할 일로 바뀌어요.</p>
    </div>
    <div id="st-body" class="view"></div>`;
  bodyEl = root.querySelector('#st-body');
  bindSearchSelects(root);

  on(root, 'click', '[data-act="game-mode"]', async () => { await setMode(GAME_MODE); toast('「포켓몬 파티!」 게임 룰로 분석해요'); });
  on(root, 'click', '[data-act="relearn-toggle"]', () => toast(relearnToast(toggleRelearn())));
  on(root, 'click', '[data-act="item-mode"]', (e, el) => toast(setItemMode(el.dataset.mode)));
  on(root, 'click', '[data-edit]', (e, el) => { openSetEditor(+el.dataset.edit); location.hash = '#/party'; });
  on(root, 'click', '[data-done]', (e, el) => applyDone(el.dataset.done));
  root.addEventListener('ss-change', e => { if (e.target.closest('[data-ss="st-item"]')) { lookup = e.detail || ''; renderStrategy(); } });
}

/** 「했어요」: 게임에서 한 일을 내 세팅에 기록 (i|종류|값|잊은 기술) */
function applyDone(code) {
  const [si, kind, a, forget] = code.split('|');
  const i = +si;
  const m = store.party[i];
  if (!m?.set) return;
  const mon = store.engine.byId.get(m.id);
  update(s => {
    const p = s.party[i], set = p.set;
    if (kind === 'move') {
      const k = forget ? set.mv.indexOf(forget) : -1;
      if (k >= 0) set.mv[k] = a;
      else if (set.mv.length < 4 && !set.mv.includes(a)) set.mv.push(a);
    } else if (kind === 'na') set.na = a;
    else if (kind === 'ab') p.ability = a;
    else if (kind === 'iv') { set.iv = [...(set.iv || NO_IV)]; set.iv[+a] = true; }
    else if (kind === 'ivall') set.iv = [true, true, true, true, true, true];
    else if (kind === 'it') set.it = a;
  });
  toast(`${mon?.ko || '멤버'} 세팅에 기록했어요 · 파티 추천에서 고칠 수 있어요`);
}

/** 멤버마다 지금 세팅 · 목표 세팅 · 할 일 */
function rowsOf(b, members) {
  let map = planCache.get(b);
  if (!map) planCache.set(b, (map = new Map()));
  return store.party.map((m, i) => {
    const pm = members[i];
    const r = analyzeMember(m, pm);
    const sel = selectedTarget(i, m, pm);
    const target = sel?.set || r.best;
    const key = `${pm.mon.id}|${pm.stone || ''}|${JSON.stringify(r.cur)}|${JSON.stringify(target)}`;
    if (!map.has(key)) map.set(key, m.set && sel?.key === 'best' ? r.steps : b.plan(pm.mon, r.cur, target));
    return { i, m, pm, mon: pm.mon, known: !!m.set, cur: r.cur, target, steps: map.get(key), stone: pm.stone, sel };
  });
}

export function renderStrategy() {
  if (!root) return;
  if (!isGameMode()) {
    bodyEl.innerHTML = `<div class="card empty"><strong>「포켓몬 파티!」 게임 룰 전용 화면이에요</strong>
      기술 칸·트레이닝 칸·상점 같은 보드 칸 규칙으로 계산해요.
      <div class="empty-actions"><button class="btn primary" type="button" data-act="game-mode">게임 룰로 바꾸기</button></div></div>`;
    return;
  }
  if (!store.party.length) {
    bodyEl.innerHTML = `<div class="card empty"><strong>아직 파티가 비어 있어요</strong>
      파티 추천 화면에서 가진 포켓몬을 넣으면 칸마다 할 일을 정리해 드려요.
      <div class="empty-actions"><a class="btn primary" href="#/party">파티 넣으러 가기</a></div></div>`;
    return;
  }
  const b = getBuilder();
  if (!b) {
    loadMoves();
    bodyEl.innerHTML = '<div class="card empty"><strong>기술 데이터 불러오는 중…</strong>배울 수 있는 기술 표를 받고 있어요.</div>';
    return;
  }
  const ctx = getContext();
  const members = partyMembers(ctx);
  const rows = rowsOf(b, members);
  const acts = tileActions(rows);
  const growth = growthPicks(b, rows);
  bodyEl.innerHTML = [
    summaryCard(rows, acts),
    `<div class="st-grid">${[
      skillCard(rows, acts.skill, b),
      trainingCard(rows, acts.training),
      itemCard(b, rows, acts.items),
      shopCard(rows, acts.items, growth),
      wildCard(ctx, members),
      tradeCard(ctx, members),
    ].join('')}</div>`,
    tourneyCard(rows, growth),
  ].join('');
}

// ───────── 조각 ─────────

const who = r => `<span class="st-who">${sprite(r.mon)}<b>${esc(r.mon.ko)}</b></span>`;
const gainText = g => `<span class="st-gain" title="멤버 점수가 오르는 정도">+${g.toFixed(1)}</span>`;
const moveKo = slug => store.moves?.bySlug.get(slug)?.ko || slug;
const doneBtn = (r, code) => (r.known
  ? `<button type="button" class="btn sm ghost st-done" data-done="${esc(code)}" title="게임에서 했으면 내 세팅에 기록">했어요</button>`
  : `<button type="button" class="btn sm ghost st-done" data-edit="${r.i}" title="파티 추천에서 지금 세팅 입력">세팅 입력</button>`);
const assumedTag = x => (x.assumed ? '<span class="st-tag" title="지금 세팅을 입력하지 않아 기본값(무보정·개체값 20·도구 없음)으로 계산">세팅 모름</span>' : '');
// 칸 아이콘 글자
const TILE_IC = { 'ic-skill': '기술', 'ic-train': '훈련', 'ic-item': '도구', 'ic-shop': '상점', 'ic-wild': '야생', 'ic-trade': '교환', 'ic-final': '최종' };
const tileIc = cls => `<span class="tile-ic ${cls}">${TILE_IC[cls]}</span>`;
const tileHead = (cls, name, sub) => `<div class="card-head"><h3>${tileIc(cls)}${esc(name)}</h3><span class="sub">${esc(sub)}</span></div>`;

/** 할 일 목록: 처음 TOP 개만 보이고 나머지는 펼침 */
function actList(items, html) {
  if (!items.length) return '';
  const li = items.map(html);
  return `<ol class="st-acts">${li.slice(0, TOP).join('')}</ol>`
    + (li.length > TOP ? `<details class="st-more"><summary>할 일 ${li.length - TOP}개 더</summary><ol class="st-acts" style="counter-reset: st ${TOP}">${li.slice(TOP).join('')}</ol></details>` : '');
}

/** 맨 위: 파티 · 세팅 입력 여부 · 지금 가장 이득이 큰 칸 */
function summaryCard(rows, acts) {
  const g = store.game, data = store.gameData;
  const known = rows.filter(r => r.known).length;
  const empty = 6 - rows.length;
  const tiles = [
    acts.skill[0] && { name: '기술 칸', gain: acts.skill[0].gain, cls: 'ic-skill' },
    acts.training[0] && { name: '트레이닝 칸', gain: acts.training[0].gain, cls: 'ic-train' },
    acts.items[0] && { name: '아이템 칸·상점', gain: acts.items[0].gain, cls: 'ic-item' },
  ].filter(Boolean).sort((a, b) => b.gain - a.gain);
  const rank = [
    empty ? `${tileIc('ic-wild')}<b>야생 칸</b><span class="note">빈 자리 ${empty}마리</span>` : '',
    ...tiles.map(t => `${tileIc(t.cls)}<b>${t.name}</b>${gainText(t.gain)}`),
  ].filter(Boolean).map((x, k) => `<span class="st-rank ${k ? '' : 'top'}">${x}</span>`);
  return `<section class="card st-summary">
    <div class="st-party">${rows.map(r => `<span class="st-mem ${r.known ? 'known' : ''}" title="${esc(r.mon.ko)} · ${r.known ? '세팅 입력함' : '세팅 입력 안 함'}${r.sel ? ` · 목표: ${esc(r.sel.chip)}` : ''}">${sprite(r.mon)}</span>`).join('')}
      <span class="note">세팅 입력 ${known}/${rows.length} · ${esc(data.maps.find(m => m.key === g.map)?.name || '')} · ${esc(gameRule().name)} · ${g.battle === 'double' ? '더블' : '싱글'}${itemMode() !== 'all' ? ` · ${esc(ITEM_MODES.find(m => m.key === itemMode()).name)}` : ''} · <a href="#/party">파티·설정 바꾸기</a></span></div>
    <div class="st-ranks"><span class="st-ranks-label">지금 멈추면 좋은 칸</span>${rank.join('<span class="st-sep">›</span>') || '<span class="note">할 일이 없어요. 파티가 목표 세팅과 같아요.</span>'}</div>
    <p class="note">목표는 파티 추천의 멤버 카드에서 고른 세팅(기본 = 계산한 최선 세팅)이에요. 숫자는 멤버 점수가 오르는 정도라 칸끼리 비교할 수 있어요 · 갈림길이나 이동 아이템으로 칸을 고를 수 있을 때 참고하세요.</p>
  </section>`;
}

function skillCard(rows, skill, b) {
  const unknown = rows.filter(r => !r.known);
  const list = actList(skill, a => {
    const r = rows[a.i];
    return `<li>${who(r)}<span class="st-what"><b>${esc(moveKo(a.learn))}</b> 배우기${a.forget ? ` <em>← ${esc(moveKo(a.forget))} 잊기</em>` : ''}</span>${gainText(a.gain)}${doneBtn(r, `${a.i}|move|${a.learn}|${a.forget || ''}`)}</li>`;
  });
  const missing = unknown.length ? `<div class="st-unknown"><p class="note">지금 기술을 몰라서 순위에서 뺀 멤버 (목표 기술)</p>
    ${unknown.map(r => `<div class="st-unk-row">${who(r)}<span class="st-what">${r.target.mv.map(s => esc(moveKo(s))).join(' · ')}</span>${doneBtn(r, '')}</div>`).join('')}</div>` : '';
  return `<section class="card st-card">
    ${tileHead('ic-skill', '기술 칸', '한 번에 한 마리 · 기술 하나')}
    <p class="note st-rule">레벨업·교배·가르침·기술머신 기술을 「기술 떠올리기」 화면에서 가르쳐요. 학습장치(파티 아이템)도 같은 일을 해요.</p>
    ${list || (unknown.length < rows.length ? '<p class="build-done">✔ 세팅을 입력한 멤버는 배울 기술이 없어요.</p>' : '')}
    ${missing}
    <div class="st-foot">${relearnToggle(b.relearn)}</div>
  </section>`;
}

function trainingCard(rows, training) {
  const text = a => (a.kind === 'na' ? `성격 → <b>${natureLabel(a.to)}</b>`
    : a.kind === 'ab' ? `특성 → <b>${esc(store.engine.abilityKo(a.to))}</b>`
      : `개체값 <b>${STAT_LABELS[a.stat]}</b> 31로`);
  const list = actList(training, a => {
    const r = rows[a.i];
    return `<li>${who(r)}<span class="st-what">${text(a)}${assumedTag(a)}</span>${gainText(a.gain)}${doneBtn(r, `${a.i}|${a.kind}|${a.kind === 'iv' ? a.stat : a.to}`)}</li>`;
  });
  return `<section class="card st-card">
    ${tileHead('ic-train', '트레이닝 칸', '성격 · 특성 · 개체값 하나 중 하나')}
    <p class="note st-rule">한 마리를 골라 성격 바꾸기 · 특성 바꾸기 · 개체값 하나를 31로 중 하나만 해요 (개체값은 20 아니면 31).</p>
    ${list || '<p class="build-done">✔ 성격·특성·개체값이 모두 목표와 같아요.</p>'}
  </section>`;
}

/** 아이템 칸: 지닐 도구 할 일 + 나온 도구를 누가 지니면 좋은지 */
function itemCard(b, rows, items) {
  const allowed = allowedItems() || new Set();
  const it = store.gameData.items;
  defineOptions('st-item', [...it.battle, ...it.berry].filter(x => allowed.has(x)).map(x => ({
    value: x, label: itemName(x), keys: `${it.battle.includes(x) ? '배틀 아이템' : '나무열매'} ${x}`,
    sub: `${it.battle.includes(x) ? '배틀 아이템' : '나무열매'} · ${(itemSource(x)?.price || 0).toLocaleString()}원${itemPartyWarning(x) ? ' · ⚠ 같은 이름 파티 아이템 있음' : ''}`,
  })));
  const list = actList(items, a => {
    const r = rows[a.i];
    const src = itemSource(a.to);
    // 못 구하면: 대신 지닐 도구 1순위 · 도구 없이 (메가스톤은 정해진 도구라 없음)
    const alt = r.stone ? [] : itemAlts(b, r.pm, r.target);
    const altText = alt.length ? [alt[0], alt[alt.length - 1]].filter((x, k, l) => l.indexOf(x) === k)
      .map(x => `${x.it ? esc(itemName(x.it)) : '도구 없이'} ${x.diff >= 0 ? '+' : '−'}${Math.abs(x.diff).toFixed(1)}`).join(' · ') : '';
    return `<li>${who(r)}<span class="st-what"><b>${esc(itemName(a.to))}</b> 지니게 하기${a.from ? ` <em>← ${esc(itemName(a.from))}</em>` : ''}${assumedTag(a)}${src ? `<span class="st-src">${esc(src.text)}</span>` : ''}${altText ? `<span class="st-src">못 구하면 ${altText}</span>` : ''}</span>${gainText(a.gain)}${doneBtn(r, `${a.i}|it|${a.to}`)}</li>`;
  });
  let found = '';
  if (lookup) {
    const rank = holderRank(b, rows, lookup).filter(x => x.gain > 0.05).slice(0, 3);
    const warn = itemPartyWarning(lookup);
    found = `<div class="st-lookup-out">
      ${rank.length ? `<ol class="st-acts">${rank.map(x => {
        const r = rows[x.i];
        return `<li>${who(r)}<span class="st-what">지니게 하기${x.from ? ` <em>← ${esc(itemName(x.from))} 대신</em>` : ''}</span>${gainText(x.gain)}${doneBtn(r, `${x.i}|it|${lookup}`)}</li>`;
      }).join('')}</ol>` : `<p class="note">지금 도구보다 ${esc(josa(itemName(lookup), '이가'))} 나은 멤버가 없어요. 다른 칸을 고르세요.</p>`}
      ${warn ? `<p class="note item-warn-note">${esc(warn)}</p>` : ''}
    </div>`;
  }
  return `<section class="card st-card">
    ${tileHead('ic-item', '아이템 칸', '3개 중 슬롯으로 하나 당첨')}
    <p class="note st-rule">배틀 아이템·기술머신·파티 아이템·용돈·나무열매 중 3종류가 나오고 하나가 당첨돼요. 도구는 받자마자 지니게 할 수 있어요.</p>
    <div class="st-lookup"><label class="note" for="st-item-q">도구가 나오면 누구에게?</label>
      ${searchSelect({ name: 'st-item', list: 'st-item', value: lookup, placeholder: '나온 도구 이름·초성', label: '나온 도구' })}</div>
    ${found}
    <h4 class="st-sub">목표 도구</h4>
    ${list || (itemMode() === 'none' ? '<p class="note">도구 없이 보는 중이라 목표 도구가 없어요. 나온 도구는 위에서 검색하세요.</p>' : '<p class="build-done">✔ 모두 목표 도구를 지녔어요.</p>')}
    <div class="st-foot"><span class="note">추천 도구</span>${itemModeControl(itemMode())}</div>
  </section>`;
}

/** 상점: 진화도구 · 기믹 · 지닐 도구 · 육성 파티 아이템 (지나가기만 해도 들름) */
function shopCard(rows, items, growth) {
  const data = store.gameData;
  const lines = [];
  let total = 0;
  for (const r of rows) {
    const finals = evoOptions(r.pm.base);
    const f = finals.find(x => x.mon.id === r.m.evo) || finals[0];
    if (f?.item) {
      total += data.evoItemPrice;
      lines.push(`<li>${who(r)}<span class="st-what"><b>${esc(itemName(f.item))}</b> → ${esc(f.mon.ko)} 진화<span class="st-src">진화도구 칸 · ${data.evoItemPrice.toLocaleString()}원</span></span></li>`);
    }
  }
  const held = items.filter(a => itemSource(a.to)?.src !== 'battle' && itemSource(a.to)?.src !== 'berry');
  for (const a of held) {
    const r = rows[a.i], src = itemSource(a.to);
    total += src?.price || 0;
    lines.push(`<li>${who(r)}<span class="st-what"><b>${esc(itemName(a.to))}</b> 사서 지니기${src ? `<span class="st-src">${esc(src.text)}</span>` : ''}</span>${gainText(a.gain)}</li>`);
  }
  const random = items.filter(a => !held.includes(a));
  const randomLine = random.length ? `<li class="st-plain"><span class="st-what">일반 상품에 나오면: ${random.slice(0, 4).map(a => `<b>${esc(itemName(a.to))}</b> <span class="faint">(${esc(rows[a.i].mon.ko)} · ${(itemSource(a.to)?.price || 0).toLocaleString()}원)</span>`).join(', ')}</span></li>` : '';
  const party = data.tourneyShop.filter(t => t.shop && growth[t.key]).sort((a, b) => growth[b.key].gain - growth[a.key].gain)
    .map(t => `<b>${esc(t.name)}</b> <span class="faint">(${esc(rows[growth[t.key].i].mon.ko)} · ${t.shop.toLocaleString()}원)</span>`);
  return `<section class="card st-card">
    ${tileHead('ic-shop', '상점', '지나가기만 해도 들름')}
    <p class="note st-rule">일반 상품(파티 아이템 + 배틀 아이템·기술머신·나무열매 중 2종, 5턴마다 바뀜) · 진화도구(균일가) · 전용도구 · 기믹(룰에 따라) 칸이 있어요.</p>
    ${lines.length || randomLine ? `<ol class="st-acts plain">${lines.join('')}${randomLine}</ol>` : '<p class="build-done">✔ 꼭 살 것은 없어요.</p>'}
    ${party.length ? `<p class="note st-party-items"><b>파티 아이템 칸에 나오면</b> ${party.join(', ')}</p>` : ''}
    ${total ? `<p class="st-total">꼭 살 것 합계 <b>${total.toLocaleString()}원</b></p>` : ''}
  </section>`;
}

/** 야생 칸: 노릴 속성 (빈 자리가 있을 때) / 꽉 찼으면 바꿀 멤버 */
function wildCard(ctx, members) {
  const { engine } = store;
  let body;
  if (members.length < 6) {
    const recs = recommendTypes(ctx, members, { limit: 3 });
    body = recs.length ? `<ol class="st-acts plain">${recs.map(r => {
      const seen = new Set();
      const ex = r.list.filter(({ c }) => !seen.has(c.sp) && seen.add(c.sp)).slice(0, 2);
      return `<li class="st-plain">${typeBadge(engine, r.type)}<span class="st-what">${ex.map(({ c }) => `<b>${esc(c.mon.ko)}</b>${catchHint(c) ? ` <span class="faint">${esc(catchHint(c))}</span>` : ''}`).join(' · ')}</span></li>`;
    }).join('')}</ol>` : '<p class="note">추천할 후보가 없어요.</p>';
  } else {
    const worst = lowestMembers(ctx, members, 2);
    body = `<p class="note">파티가 꽉 찼어요. 잡으면 바꿀 후보 (파티 기여가 낮은 순)</p>
      <ol class="st-acts plain">${worst.map(x => `<li class="st-plain"><span class="st-who">${sprite(x.mon)}<b>${esc(x.mon.ko)}</b></span><span class="st-what faint">${esc(x.why)}</span></li>`).join('')}</ol>`;
  }
  return `<section class="card st-card">
    ${tileHead('ic-wild', '야생 칸', '후보 3마리 중 하나 · 볼 3개')}
    ${body}
    <p class="note">후보가 나오면 <a href="#/catch">포획 추천</a>에서 3마리를 비교하세요.</p>
  </section>`;
}

/** 파티 기여(빼면 잃는 점수)가 낮은 멤버 */
function lowestMembers(ctx, members, n) {
  const vals = memberValues(ctx, members);
  return vals.map((v, i) => ({ i, mon: members[i].mon, total: v.synergy + v.indiv, v }))
    .sort((a, b) => a.total - b.total).slice(0, n)
    .map(x => ({ ...x, why: x.v.exposed.length ? `빼면 ${x.v.exposed.slice(0, 3).map(t => store.engine.typeKo(t)).join('·')} 약점이 몰려요` : '빼도 약점이 크게 늘지 않아요' }));
}

/** 미라클교환 칸: 반드시 교환 → 내보낼 멤버 */
function tradeCard(ctx, members) {
  const worst = members.length >= 2 ? lowestMembers(ctx, members, 2) : [];
  return `<section class="card st-card">
    ${tileHead('ic-trade', '미라클교환 칸', '반드시 한 마리 교환')}
    <p class="note st-rule">한 마리를 내보내고 전 종족(전설 포함) 중 무작위 포켓몬을 받아요. 받는 포켓몬 레벨은 내보낸 포켓몬과 같고, PC에 포켓몬이 있으면 PC에서도 고를 수 있어요.</p>
    ${worst.length ? `<p class="note">내보내도 되는 멤버 (PC에 남는 포켓몬이 있으면 그쪽 먼저)</p>
      <ol class="st-acts plain">${worst.map(x => `<li class="st-plain"><span class="st-who">${sprite(x.mon)}<b>${esc(x.mon.ko)}</b></span><span class="st-what faint">${esc(x.why)}</span></li>`).join('')}</ol>`
    : '<p class="note">파티가 한 마리뿐이라 PC 포켓몬을 내보내거나 그대로 교환해야 해요.</p>'}
  </section>`;
}

/** 마지막 상점 (토너먼트 직전): 5종 중 3종 진열 · 종류마다 한 번 */
function tourneyCard(rows, growth) {
  const data = store.gameData;
  const what = (t, g) => {
    const s = g.step;
    switch (t.key) {
      case 'exp_share': return { text: `<b>${esc(moveKo(s.learn))}</b> 배우기${s.forget ? ` <em>← ${esc(moveKo(s.forget))}</em>` : ''}`, done: `${g.i}|move|${s.learn}|${s.forget || ''}` };
      case 'mint': return { text: `성격 → <b>${natureLabel(s.to)}</b>`, done: `${g.i}|na|${s.to}` };
      case 'ability_patch': return { text: `특성 → <b>${esc(store.engine.abilityKo(s.to))}</b>`, done: `${g.i}|ab|${s.to}` };
      case 'gold_bottle_cap': return { text: `개체값 <b>${s.stats.map(k => STAT_LABELS[k]).join('·')}</b> 31로`, done: `${g.i}|ivall|` };
      case 'rare_candy': return { text: `레벨 +1 <em>(토너먼트 Lv.${data.finalLevel + 1})</em>`, done: null };
      default: return { text: '', done: null };
    }
  };
  const list = data.tourneyShop.map(t => ({ t, g: growth[t.key] })).sort((a, b) => (b.g?.gain || 0) - (a.g?.gain || 0));
  return `<section class="card st-card st-wide">
    ${tileHead('ic-final', '마지막 상점', `토너먼트 직전 · ${data.tourneyShop.length}종 중 ${data.tourneyShopCount}종 진열`)}
    <p class="note st-rule">준비 메뉴의 마지막 상점은 모두 같은 ${data.tourneyShopCount}종이 진열되고, 종류마다 한 번씩 사서 바로 써요. 진열된 것 중 위에 있는 것부터 사세요.</p>
    <ol class="st-acts">${list.map(({ t, g }) => {
      if (!g) return `<li class="st-plain"><span class="st-item-name">${esc(t.name)}</span><span class="st-what faint">쓸 곳 없음 (이미 목표와 같음)</span><span class="st-price">${t.price.toLocaleString()}원</span></li>`;
      const r = rows[g.i], w = what(t, g);
      return `<li><span class="st-item-name" title="${esc(t.desc)}">${esc(t.name)}</span>${who(r)}<span class="st-what">${w.text}${assumedTag(g)}</span>${gainText(g.gain)}<span class="st-price">${t.price.toLocaleString()}원</span>${w.done ? doneBtn(r, w.done) : ''}</li>`;
    }).join('')}</ol>
  </section>`;
}
