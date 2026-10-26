// 포획 추천: 야생 칸에서 나온 후보 3마리 중 무엇을 잡을지 (지금 파티 기준)
// 후보마다 최종 진화(메가진화 룰이면 메가진화까지) 모습으로 파티에 넣었을 때의 점수 상승폭 × 볼 3개로 잡힐 확률로 순위를 매긴다.
import { store, update, getContext, partyMembers, isGameMode, catchForms } from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeList } from '../ui/components.js';
import { catchValue } from '../core/party.js';
import { reasonChip, commentText, itemName } from '../ui/reasons.js';
import { parseNames } from '../ui/names.js';

// 보드 사파리 (게임 스크립트): 포획 등급별 한 번 던질 때 확률 + 볼 보너스, 볼은 3개
const TIERS = [{ name: '흔함', p: 65 }, { name: '보통', p: 50 }, { name: '희귀', p: 35 }];
const BALLS = [
  { key: 'poke', name: '몬스터볼 (1~3라운드)', bonus: 0 },
  { key: 'great', name: '슈퍼볼 (4~9라운드)', bonus: 8 },
  { key: 'ultra', name: '하이퍼볼 (10라운드~)', bonus: 15 },
];
const BALL_COUNT = 3;

let root, wildEl, mineEl, resultEl, ballEl;

export function initCatch(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">야생 칸</span>
      <h1>3마리 중 무엇을 잡을까?</h1>
      <p>야생 칸에서 나온 후보 3마리를 넣으면 <b>지금 파티에 가장 도움이 되는 포켓몬</b>을 골라 드려요.
        진화 전 포켓몬은 최종 진화, 메가진화 룰이면 메가진화한 모습까지 따지고 잡힐 확률도 함께 봐요.</p>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>야생 후보</h3><span class="sub">최대 3마리</span>
          <button class="btn sm ghost" type="button" data-act="wild-clear">비우기</button></div>
        <div id="c-picker"></div>
        <div class="opp-list" id="c-wild"></div>
        <details class="paste">
          <summary>이름 3개 한 번에 입력</summary>
          <textarea id="c-paste" rows="2" placeholder="예: 꼬부기, 피카츄, 이브이 (쉼표·줄바꿈·띄어쓰기로 구분)"></textarea>
          <button class="btn sm" type="button" data-act="paste">입력</button>
        </details>
        <label class="field ball-field">볼 <select class="select" id="c-ball"></select></label>
      </section>
      <section class="card">
        <div class="card-head"><h3>내 파티</h3><a class="sub" href="#/party">파티 편집 →</a></div>
        <div id="c-mine"></div>
      </section>
    </div>
    <div id="c-result" class="view"></div>`;
  wildEl = root.querySelector('#c-wild');
  mineEl = root.querySelector('#c-mine');
  resultEl = root.querySelector('#c-result');
  ballEl = root.querySelector('#c-ball');
  ballEl.innerHTML = BALLS.map(b => `<option value="${b.key}">${esc(b.name)}</option>`).join('');

  createPicker(root.querySelector('#c-picker'), {
    engine: store.engine, search: store.search,
    placeholder: '야생 후보 추가 (이름·초성·번호)',
    onSelect: p => toast(addWild(p.id) || `${josa(p.ko, '을를')} 후보에 넣었어요`),
  });
  on(root, 'click', '[data-act="wild-clear"]', () => update(s => { s.wild = []; }));
  on(root, 'click', '[data-wild-remove]', (e, el) => update(s => { s.wild.splice(+el.dataset.wildRemove, 1); }));
  on(root, 'click', '[data-act="paste"]', () => {
    const box = root.querySelector('#c-paste');
    const { found, missed } = parseNames(box.value);
    let added = 0;
    for (const p of found) if (!addWild(p.id, false)) added++;
    update(() => {});
    box.value = missed.join(', ');
    toast(missed.length ? `${added}마리 입력 · 못 찾은 이름: ${missed.join(', ')}` : `${added}마리를 입력했어요`);
  });
  ballEl.addEventListener('change', () => update(s => { s.ball = ballEl.value; }));
  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); location.hash = `#/matchup/${el.dataset.go}`; });
}

function addWild(id, emit = true) {
  if (store.wild.length >= 3) return '야생 후보는 3마리까지예요 (비우고 다시 넣어 주세요)';
  if (emit) update(s => { s.wild.push(id); });
  else store.wild.push(id);
  return null;
}

/** 볼 3개로 잡힐 확률 (도망은 무시) */
function catchChance(mon) {
  const tier = store.gameData?.catchTier?.[mon.id] ?? 1;
  const ball = BALLS.find(b => b.key === store.ball) || BALLS[0];
  const p = Math.min(95, TIERS[tier].p + ball.bonus) / 100;
  return { tier: TIERS[tier], per: p, total: 1 - (1 - p) ** BALL_COUNT };
}

const gainLabel = g => (g >= 1.2 ? '큰 보강' : g >= 0.4 ? '보강' : g > 0.05 ? '조금 보강' : '도움 적음');

export function renderCatch() {
  if (!root) return;
  const { engine } = store;
  const ctx = getContext();
  const members = partyMembers(ctx);
  ballEl.value = store.ball;

  wildEl.innerHTML = store.wild.length
    ? store.wild.map((id, i) => {
      const mon = engine.byId.get(id);
      return `<span class="opp">${sprite(mon)}<span><b>${esc(mon.ko)}</b>${typeList(engine, mon.t, 'sm')}</span>
        <button type="button" data-wild-remove="${i}" aria-label="${esc(mon.ko)} 빼기" title="빼기">✕</button></span>`;
    }).join('')
    : '<p class="note">야생 칸에서 나온 후보를 검색해 넣어 주세요.</p>';
  mineEl.innerHTML = members.length
    ? `<div class="mine-list">${members.map(m => `<span class="opp">${sprite(m.base)}<span><b>${esc(m.base.ko)}</b>${m.mon.id !== m.base.id ? `<span class="note">→ ${esc(m.mon.ko)}</span>` : typeList(engine, m.mon.t, 'sm')}</span></span>`).join('')}</div>
      <p class="note">${members.length >= 6 ? '파티가 꽉 차서, 후보마다 가장 덜 아까운 멤버와 바꾸는 기준으로 비교해요.' : `빈 자리 ${6 - members.length}칸에 넣는 기준으로 비교해요.`}</p>`
    : '<p class="note">파티가 비어 있으면 기본 능력·상성 범위가 좋은 후보를 골라요. <a href="#/party">파티 추천</a>에서 가진 포켓몬을 넣으면 더 정확해요.</p>';

  if (!store.wild.length) {
    resultEl.innerHTML = '';
    return;
  }
  const rows = store.wild.map(id => {
    const mon = engine.byId.get(id);
    // 모습(최종 진화·메가진화)마다 가치를 재서 가장 좋은 모습으로
    let best = null;
    for (const form of catchForms(ctx, mon)) {
      const v = catchValue(ctx, members, form);
      if (!best || v.gain > best.v.gain) best = { form, v };
    }
    const chance = catchChance(mon);
    const gain = best.v.blocked ? -Infinity : best.v.gain;
    return { mon, ...best, chance, gain, expected: gain > 0 ? gain * chance.total : gain };
  }).sort((a, b) => b.expected - a.expected);

  const top = rows.find(r => r.gain > -Infinity);
  const maxGain = Math.max(0.01, ...rows.map(r => (Number.isFinite(r.gain) ? r.gain : 0)));
  const summary = !top
    ? '세 후보 모두 같은 종이 이미 파티에 있어요. 교환용으로 잡아 두는 정도예요.'
    : top.gain <= 0.05
      ? `셋 다 지금 파티에 큰 도움은 안 돼요. 그래도 고른다면 <b>${esc(top.mon.ko)}</b> — ${esc(commentText(engine, top.v.reasons, top.form) || '파티 균형을 덜 해쳐요.')}`
      : `<b>${esc(top.mon.ko)}</b>${josa(top.mon.ko, '을를').slice(top.mon.ko.length)} 잡으세요${top.form.mon.id !== top.mon.id ? ` (${esc(top.form.mon.ko)} 기준)` : ''}.
        볼 ${BALL_COUNT}개로 잡힐 확률은 약 ${Math.round(top.chance.total * 100)}%예요. 이유는 아래 카드에 있어요.`;

  resultEl.innerHTML = `
    <section class="card catch-summary"><div class="card-head"><h3>추천</h3>
      <span class="sub">${esc(isGameMode() ? `${store.gameData.maps.find(m => m.key === store.game.map)?.name || ''} 맵 · ${store.gameData.rules.find(r => r.key === store.game.rule)?.name || ''}` : '지금 데이터 기준')}</span></div>
      <p class="catch-verdict">${summary}</p>
    </section>
    <div class="catch-list">${rows.map((r, i) => catchCard(r, i, members, maxGain)).join('')}</div>`;
}

function catchCard(r, i, members, maxGain) {
  const { engine } = store;
  const { mon, form, v, chance } = r;
  const blocked = v.blocked;
  const width = blocked ? 0 : Math.max(4, Math.round(100 * Math.max(0, r.gain) / maxGain));
  const route = form.mon.id === mon.id ? ''
    : form.stone ? `→ <b>${esc(form.mon.ko)}</b> 기준 (${form.base.id !== mon.id ? `${esc(josa(form.base.ko, '으로'))} 진화 후 ` : ''}${esc(josa(itemName(form.stone), '으로'))} 메가진화)`
      : `→ <b>${esc(form.mon.ko)}</b> 기준 (최종 진화)`;
  const replace = v.replace !== null && v.replace !== undefined ? members[v.replace] : null;
  return `
    <article class="card catch-card ${i === 0 && !blocked ? 'best' : ''}">
      <div class="catch-head">
        <span class="catch-rank">${i === 0 && !blocked ? '추천' : `${i + 1}순위`}</span>
        <a href="#/matchup/${mon.slug}" data-go="${mon.slug}">${sprite(mon)}</a>
        <div class="catch-name"><b>${esc(mon.ko)}</b>${typeList(engine, form.mon.t, 'sm')}
          ${route ? `<span class="catch-route">${route}</span>` : ''}</div>
        <div class="catch-gain"><b>${blocked ? '—' : gainLabel(r.gain)}</b><span class="track"><span style="width:${width}%"></span></span></div>
      </div>
      <div class="catch-meta">
        <span class="pill-soft">포획 ${chance.tier.name}</span>
        <span>한 번에 ${Math.round(chance.per * 100)}% · 볼 ${BALL_COUNT}개로 약 ${Math.round(chance.total * 100)}%</span>
        ${replace ? `<span>· ${esc(replace.base.ko)} 대신 넣는 기준</span>` : ''}
      </div>
      ${blocked ? `<p class="note">같은 종(또는 메가진화 포켓몬)이 이미 파티에 있어요.</p>` : `
      ${v.reasons.length ? `<div class="reasons">${v.reasons.filter(x => x.kind !== 'usage').map(x => reasonChip(engine, x)).join('')}</div>` : ''}
      <p class="slot-why">${esc(commentText(engine, v.reasons, form))}</p>`}
    </article>`;
}
