// 포획 추천: 야생 칸에서 나온 후보 3마리 중 무엇을 잡을지 (지금 파티 기준)
// 후보마다 최종 진화(메가진화 룰이면 메가진화까지) 모습으로 파티에 넣었을 때의 점수 상승폭 × 볼 3개로 잡힐 확률로 순위를 매긴다.
// 파티가 꽉 찼으면 멤버마다 바꾼 경우를 재서 누구와 바꿀지 · 바꾸지 말지(잡으면 박스로) 판단한다
//   (게임: 꽉 찬 파티에서 잡으면 「파티에 넣기(한 마리를 박스로)」·「박스로 보내기」 중에서 고름. 박스 포켓몬은 PC에서 다시 꺼내거나 미라클교환에 내보낼 수 있음)
import { store, update, getContext, partyMembers, isGameMode, catchForms } from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeList } from '../ui/components.js';
import { catchValue, swapDecision, TRAINED_COST } from '../core/party.js';
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
// 꽉 찬 파티에서의 판단
const DECISION = { swap: ['바꾸기', 'good'], maybe: ['바꾸면 조금 나음', 'warn'], keep: ['바꾸지 말기', 'bad'] };
const signed = g => `${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1)}`;

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
      <p class="note">${members.length >= 6 ? '파티가 꽉 차서, 후보마다 <b>누구와 바꿀지</b> · <b>바꾸지 않는 게 나은지</b>를 판단해요. 내 세팅을 입력해 키워 둔 멤버는 다시 맞추는 수고만큼 더 이득일 때만 바꾸라고 해요.' : `빈 자리 ${6 - members.length}칸에 넣는 기준으로 비교해요.`}</p>`
    : '<p class="note">파티가 비어 있으면 기본 능력·상성 범위가 좋은 후보를 골라요. <a href="#/party">파티 추천</a>에서 가진 포켓몬을 넣으면 더 정확해요.</p>';

  if (!store.wild.length) {
    resultEl.innerHTML = '';
    return;
  }
  const full = members.length >= 6;
  const trained = new Set(store.party.map((m, i) => (m.set ? i : -1)).filter(i => i >= 0));
  const rows = store.wild.map(id => {
    const mon = engine.byId.get(id);
    // 모습(최종 진화·메가진화)마다 가치를 재서 가장 좋은 모습으로
    let best = null;
    for (const form of catchForms(ctx, mon)) {
      const v = catchValue(ctx, members, form);
      if (!best || v.gain > best.v.gain) best = { form, v };
    }
    const chance = catchChance(mon);
    // 꽉 찬 파티: 키운 멤버를 바꾸는 수고까지 뺀 이득(net)으로 판단
    const decision = full && !best.v.blocked ? swapDecision(best.v.swaps, trained) : null;
    const gain = best.v.blocked ? -Infinity : decision ? decision.list[0]?.net ?? -Infinity : best.v.gain;
    return { mon, ...best, chance, gain, decision, expected: gain > 0 ? gain * chance.total : gain };
  }).sort((a, b) => b.expected - a.expected);

  const top = rows.find(r => r.gain > -Infinity);
  const maxGain = Math.max(0.01, ...rows.map(r => (Number.isFinite(r.gain) ? r.gain : 0)));
  const go = full ? rows.find(r => r.decision && r.decision.kind !== 'keep') : null;
  const out = go ? members[go.decision.pick.i].base.ko : '';
  const summary = full && top ? (go
    ? `<b>${esc(go.mon.ko)}</b>${josa(go.mon.ko, '을를').slice(go.mon.ko.length)} 잡아서 <b>${esc(out)}</b> 대신 파티에 넣으세요${go.decision.kind === 'maybe' ? ' (바꾸면 조금 나아요)' : ''}${go.form.mon.id !== go.mon.id ? ` · ${esc(go.form.mon.ko)} 기준` : ''}.
        잡은 뒤 「파티에 넣기」에서 ${esc(josa(out, '을를'))} 박스로 보내면 돼요 (나중에 PC에서 다시 꺼낼 수 있어요). 볼 ${BALL_COUNT}개로 잡힐 확률은 약 ${Math.round(go.chance.total * 100)}%예요.`
    : `<b>이번엔 바꾸지 마세요.</b> 세 후보 모두 지금 파티의 누구와 바꿔도 나아지지 않아요.
        잡는다면 「박스로 보내기」를 고르세요. 박스에 둔 포켓몬은 미라클교환 칸에서 파티 대신 내보낼 수 있어요.`)
    : !top
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
    <div class="catch-list">${rows.map((r, i) => catchCard(r, i, members, maxGain, go)).join('')}</div>`;
}

function catchCard(r, i, members, maxGain, go = null) {
  const { engine } = store;
  const { mon, form, v, chance, decision } = r;
  const blocked = v.blocked;
  const width = blocked || r.gain <= 0 ? 0 : Math.max(4, Math.round(100 * r.gain / maxGain));
  const route = form.mon.id === mon.id ? ''
    : form.stone ? `→ <b>${esc(form.mon.ko)}</b> 기준 (${form.base.id !== mon.id ? `${esc(josa(form.base.ko, '으로'))} 진화 후 ` : ''}${esc(josa(itemName(form.stone), '으로'))} 메가진화)`
      : `→ <b>${esc(form.mon.ko)}</b> 기준 (최종 진화)`;
  const replace = decision ? (decision.pick ? members[decision.pick.i] : null)
    : v.replace !== null && v.replace !== undefined ? members[v.replace] : null;
  // 꽉 찬 파티: 추천은 바꿀 후보가 있을 때만 (모두 바꾸지 말기면 순위만)
  const isBest = i === 0 && !blocked && (!decision || r === go);
  const swapList = decision?.list.length ? `<div class="swap-opts"><span class="note">바꾸면</span>${decision.list.slice(0, 3).map(x => `
      <span class="swap-opt ${x.net >= 0.1 ? 'up' : 'down'}" title="${esc(members[x.i].base.ko)} 대신 넣으면 파티 점수 ${signed(x.gain)}${x.trained ? ` · 세팅을 키워 둔 멤버라 ${TRAINED_COST} 빼고 비교` : ''}">${sprite(members[x.i].base)}<span>${esc(members[x.i].base.ko)} 대신</span><b>${signed(x.net)}</b>${x.trained ? '<em>키운 멤버</em>' : ''}</span>`).join('')}</div>` : '';
  return `
    <article class="card catch-card ${isBest ? 'best' : ''}">
      <div class="catch-head">
        <span class="catch-rank">${isBest ? '추천' : `${i + 1}순위`}</span>
        <a href="#/matchup/${mon.slug}" data-go="${mon.slug}">${sprite(mon)}</a>
        <div class="catch-name"><b>${esc(mon.ko)}</b>${typeList(engine, form.mon.t, 'sm')}
          ${route ? `<span class="catch-route">${route}</span>` : ''}</div>
        <div class="catch-gain">${decision ? `<b class="decision ${DECISION[decision.kind][1]}">${DECISION[decision.kind][0]}</b>` : `<b>${blocked ? '—' : gainLabel(r.gain)}</b>`}<span class="track"><span style="width:${width}%"></span></span></div>
      </div>
      <div class="catch-meta">
        <span class="pill-soft">포획 ${chance.tier.name}</span>
        <span>한 번에 ${Math.round(chance.per * 100)}% · 볼 ${BALL_COUNT}개로 약 ${Math.round(chance.total * 100)}%</span>
        ${replace ? `<span>· ${esc(replace.base.ko)} 대신 넣는 기준</span>` : decision ? '<span>· 잡으면 박스로 보내기</span>' : ''}
      </div>
      ${swapList}
      ${blocked ? `<p class="note">같은 종(또는 메가진화 포켓몬)이 이미 파티에 있어요.</p>` : `
      ${v.reasons.length ? `<div class="reasons">${v.reasons.filter(x => x.kind !== 'usage').map(x => reasonChip(engine, x)).join('')}</div>` : ''}
      <p class="slot-why">${esc(commentText(engine, v.reasons, form))}</p>
      ${decision?.kind === 'keep' ? '<p class="note">하지만 누구와 바꿔도 빠지는 멤버의 몫이 더 커서 파티 점수가 내려가요. 잡는다면 박스로 보내세요.</p>' : ''}`}
    </article>`;
}
