// 폼 추천: 지금 파티 멤버마다 고를 수 있는 진화 갈래(지방 폼 진화 포함)와 폼 변경 도구 폼을 평균 승률 · 파티 상성으로 비교 (「포켓몬 파티!」 게임 룰 전용)
//   지방 폼 진화: 진화도구 칸의 알로라의가면·가라르의차·히스이의골동품 (Board_Evolution)
//   폼 변경 도구: 전용도구 칸 (쓸 수 있는 포켓몬을 가졌을 때만 팜) — 지니면 바뀜(구슬·백금옥·가면·플레이트·메모리·카세트…) / 쓰면 바뀜(로토무카탈로그·비추는거울…)
import {
  store, update, getContext, partyMembers, isGameMode, getBuilder, loadMoves, setMode, GAME_MODE,
  evoOptions, formOptions, formKey, formMon, attackTypes,
} from '../state.js';
import { analyzeMember } from '../ui/builder.js';
import { winRate } from '../core/battle.js';
import { DRIVE_TYPE } from '../core/build.js';
import { formSwapGain } from '../core/party.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeList } from '../ui/components.js';
import { itemName } from '../ui/reasons.js';

const RATE_LIMIT = 7;     // 평균 승률은 파티 상성 상위 몇 개 + 지금 것만 계산 (아르세우스·실버디는 17폼)
let root, bodyEl;
const cache = new WeakMap();   // 평가기(없으면 분석 컨텍스트) → Map(멤버 키 → 비교 결과)

export function initForms(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">폼 추천</span>
      <h1>어떤 폼이 좋을까?</h1>
      <p>지금 파티 멤버마다 고를 수 있는 <b>진화 갈래(알로라·가라르·히스이 지방 폼 포함)</b>와 <b>폼 변경 도구 폼</b>(기라티나·로토무·영물·아르세우스 플레이트·게노세크트 카세트 등)을
        평균 승률과 파티 상성으로 비교해 추천해요. <b>이걸로</b>를 누르면 파티 분석·세팅이 그 폼 기준으로 바뀌어요.</p>
    </div>
    <div id="fm-body" class="view"></div>`;
  bodyEl = root.querySelector('#fm-body');
  on(root, 'click', '[data-act="game-mode"]', async () => { await setMode(GAME_MODE); toast('「포켓몬 파티!」 게임 룰로 분석해요'); });
  on(root, 'click', '[data-form-apply]', (e, el) => {
    const [si, kind, value] = el.dataset.formApply.split('|');
    const i = +si;
    update(s => {
      if (kind === 'evo') { s.party[i].evo = +value; s.party[i].form = null; } else s.party[i].form = value || null;
    });
    toast(`${el.dataset.name} 기준으로 파티와 세팅을 다시 계산했어요`);
  });
}

/** 멤버 i 의 선택지: 진화 갈래 · (지금 진화 목표의) 기본 폼 + 폼 변경 도구 폼 */
function choicesOf(m) {
  const caught = store.engine.byId.get(m.id);
  const finals = evoOptions(caught);
  const evolved = (finals.find(f => f.mon.id === m.evo) || finals[0])?.mon || caught;
  const out = [];
  if (finals.length > 1) {
    for (const f of finals) {
      out.push({ kind: 'evo', value: f.mon.id, mon: f.mon, stone: null, item: f.item, cur: f.mon.id === evolved.id && !m.form });
    }
  }
  const forms = formOptions(evolved);
  if (forms.length) {
    if (!out.some(o => o.mon.id === evolved.id && o.kind === 'evo')) out.push({ kind: 'form', value: '', mon: evolved, stone: null, item: null, cur: !m.form });
    for (const o of forms) {
      // 이름: 「오리진폼」 → 「기라티나 오리진폼」 (히트로토무처럼 이미 이름이 들어 있으면 그대로)
      const name = o.name.includes(evolved.ko.slice(-3)) ? o.name : `${evolved.ko} ${o.name}`;
      out.push({ kind: 'form', value: formKey(o), mon: formMon(evolved, o), stone: o.hold ? o.item : null, item: o.item, hold: o.hold, name, cur: m.form === formKey(o) });
    }
  }
  return { caught, evolved, list: out };
}

/** 선택지마다 파티 상성(지금 것 대비) · 평균 승률 */
function compare(ctx, b, members, i) {
  const m = store.party[i];
  const holder = b || ctx;
  let map = cache.get(holder);
  if (!map) cache.set(holder, (map = new Map()));
  const key = `${i}|${JSON.stringify(store.party)}`;
  if (map.has(key)) return map.get(key);
  const { caught, list } = choicesOf(m);
  if (list.length < 2) { map.set(key, null); return null; }
  const { engine } = store;
  for (const o of list) {
    const ability = engine.abilitiesOf(o.mon).includes(m.ability) ? m.ability : undefined;
    // 게노세크트 카세트: 타입은 같고 테크노버스터 타입이 바뀜 → 공격 범위에 그 타입을 더함
    const drive = DRIVE_TYPE[o.stone];
    const atk = drive ? [...new Set([...(attackTypes(m.set) || o.mon.t), drive])] : attackTypes(m.set);
    o.pm = ctx.prep(o.mon, { ability, tera: m.tera || null, base: caught, stone: o.stone, atk });
    o.fitAbs = formSwapGain(ctx, members, i, o.pm);
  }
  const cur = list.find(o => o.cur) || list[0];
  for (const o of list) o.fit = o.fitAbs - cur.fitAbs;
  // 평균 승률: 지금 것 + 파티 상성 상위 몇 개 (내 세팅을 입력했으면 그 기술, 아니면 그 모습의 최선 세팅)
  if (b) {
    const rated = new Set([cur, ...[...list].sort((x, y) => y.fit - x.fit).slice(0, RATE_LIMIT)]);
    for (const o of rated) {
      const r = analyzeMember(m, o.pm);
      const set = m.set ? { ...r.cur, ...(o.stone ? { it: o.stone } : {}) } : r.best;
      o.rate = winRate(ctx, b.targetTable(o.mon, set));
    }
  }
  for (const o of list) o.score = (o.rate !== undefined && cur.rate !== undefined ? (o.rate - cur.rate) * 100 : 0) + o.fit;
  list.sort((x, y) => y.score - x.score);
  const res = { caught, list, cur, best: list[0] !== cur && list[0].score > 0.5 ? list[0] : null };
  map.set(key, res);
  return res;
}

export function renderForms() {
  if (!root) return;
  if (!isGameMode()) {
    bodyEl.innerHTML = `<div class="card empty"><strong>「포켓몬 파티!」 게임 룰 전용 화면이에요</strong>
      게임 상점의 진화도구·전용도구로 바꿀 수 있는 폼을 비교해요.
      <div class="empty-actions"><button class="btn primary" type="button" data-act="game-mode">게임 룰로 바꾸기</button></div></div>`;
    return;
  }
  const ctx = getContext();
  const b = getBuilder();
  if (!b) loadMoves();
  const members = partyMembers(ctx);
  const cards = store.party.map((m, i) => compare(ctx, b, members, i) && memberCard(i, compare(ctx, b, members, i), !!b)).filter(Boolean);
  bodyEl.innerHTML = [
    cards.length ? cards.join('') : `<div class="card empty"><strong>${store.party.length ? '지금 파티에는 폼을 고를 포켓몬이 없어요' : '아직 파티가 비어 있어요'}</strong>
      아래 포켓몬을 잡으면 진화 갈래나 폼을 고를 수 있어요. <a href="#/party">파티 추천</a>에서 가진 포켓몬을 넣어 주세요.</div>`,
    referenceCard(),
  ].join('');
}

// ───────── 조각 ─────────

const pct = v => `${Math.round(v * 100)}%`;
const signed = (v, unit = '') => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(unit ? 0 : 1)}${unit}`;
const priceOf = slug => store.gameData.itemInfo?.[slug]?.[1] ?? store.gameData.signaturePrice;

function howText(o) {
  if (o.kind === 'evo') return o.item ? `진화도구 칸 ${itemName(o.item)} · ${store.gameData.evoItemPrice.toLocaleString()}원` : '레벨업 · 기본 진화';
  if (!o.item) return '기본 폼 (도구 없음)';
  return `전용도구 칸 ${itemName(o.item)} · ${priceOf(o.item).toLocaleString()}원 · ${o.hold ? '지니면 바뀜 (도구 칸 차지)' : '쓰면 바뀜'}`;
}

function memberCard(i, res, rated) {
  const { engine } = store;
  const { caught, list, cur, best } = res;
  const label = o => (o.kind === 'evo' ? o.mon.ko : o.name ? `${o.name}` : `${o.mon.ko} (기본)`);
  const verdict = best
    ? `<b>${esc(label(best))}</b>${josa(label(best), '을를').slice(label(best).length)} 추천해요 — ${best.rate !== undefined && cur.rate !== undefined ? `평균 승률 ${signed((best.rate - cur.rate) * 100, '%p')} · ` : ''}파티 상성 ${signed(best.fit)}`
    : `지금 <b>${esc(label(cur))}</b> 그대로가 좋아요`;
  const rows = list.map((o, k) => `<li class="mega-row ${o.cur ? 'on' : ''}">
      <span class="mega-rank">${k + 1}</span>
      <span class="mega-mon">${sprite(o.mon)}<span><b>${esc(label(o))}</b>${typeList(engine, o.mon.t, 'sm')}<span class="note">${esc(howText(o))}</span></span></span>
      ${o.rate !== undefined ? `<span class="mega-stat" title="이 맵 상대 후보와 1:1로 붙었을 때 먼저 쓰러뜨리는 비율"><span class="bt-k">평균 승률</span><b>${pct(o.rate)}</b>${o.cur || cur.rate === undefined ? '' : ` <em class="${o.rate >= cur.rate ? 'good' : 'bad'}">${signed((o.rate - cur.rate) * 100, '%p')}</em>`}</span>`
        : `<span class="mega-stat"><span class="bt-k">평균 승률</span><span class="faint">${rated ? '—' : '계산 중'}</span></span>`}
      <span class="mega-stat" title="지금 고른 모습 대비 파티 상성 점수 변화 (약점 겹침·공격 범위·종족값)"><span class="bt-k">파티 상성</span>${o.cur ? '<span class="faint">기준</span>' : `<em class="${o.fit >= 0 ? 'good' : 'bad'}">${signed(o.fit)}</em>`}</span>
      ${o.cur ? '<span class="mega-on">지금 기준</span>' : `<button type="button" class="btn sm" data-form-apply="${i}|${o.kind}|${o.value}" data-name="${esc(label(o))}">이걸로</button>`}
    </li>`).join('');
  return `<section class="card mega-card form-card">
    <div class="card-head"><h3>${sprite(caught)}${esc(caught.ko)}</h3><span class="sub">${list.some(o => o.kind === 'evo') ? '진화 갈래' : ''}${list.some(o => o.kind === 'evo') && list.some(o => o.item && o.kind === 'form') ? ' · ' : ''}${list.some(o => o.kind === 'form' && o.item) ? '폼 변경 도구' : ''}</span></div>
    <p class="mega-state">${verdict}</p>
    <ol class="mega-list">${rows}</ol>
  </section>`;
}

/** 참고: 이 게임에서 폼을 고를 수 있는 포켓몬 (잡을 때 참고) */
function referenceCard() {
  const { engine } = store;
  const data = store.gameData;
  const forms = Object.keys(data.formItems || {}).map(id => engine.byId.get(+id)).filter(Boolean);
  const regional = Object.entries(data.evo).filter(([, e]) => e.some(([, it]) => /region$/.test(it || ''))).map(([id, e]) => [engine.byId.get(+id), e.filter(([, it]) => /region$/.test(it || ''))])
    .filter(([mon]) => mon && !Object.values(data.evo).some(list => list.some(([t]) => t === mon.id)));   // 진화 전 첫 단계만
  const chip = mon => `<a class="fm-chip" href="#/matchup/${mon.slug}">${sprite(mon)}${esc(mon.ko)}</a>`;
  return `<details class="card fm-ref">
    <summary><h3>이 게임에서 폼을 고를 수 있는 포켓몬</h3><span class="sub">잡을 때 참고</span></summary>
    <p class="note">폼 변경 도구는 상점 전용도구 칸에서 그 포켓몬을 가졌을 때만 팔아요 (${data.signaturePrice.toLocaleString()}원).</p>
    <div class="fm-chips">${forms.map(chip).join('')}</div>
    <p class="note">지방 폼 진화는 진화도구 칸의 알로라의가면·가라르의차·히스이의골동품 (${data.evoItemPrice.toLocaleString()}원)으로 해요.</p>
    <div class="fm-chips">${regional.map(([mon, e]) => `<span class="fm-chip">${sprite(mon)}${esc(mon.ko)} <em>→ ${e.map(([t]) => esc(engine.byId.get(t)?.ko || '')).join(', ')}</em></span>`).join('')}</div>
  </details>`;
}
