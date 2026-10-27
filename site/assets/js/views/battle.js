// 전투 전략: 지금 파티의 기술 세팅으로 실제 데미지를 계산해 상대마다 누구를 내보내고 어떤 기술을 쓸지 (「포켓몬 파티!」 게임 룰 모드 전용)
//   상대 포켓몬 대면(마지막 토너먼트·레이드·트레이너) · 상대 타입별 대응(체육관 관장) · 멤버별 운용법
import { store, getContext, partyMembers, isGameMode, getBuilder, loadMoves, setMode, GAME_MODE } from '../state.js';
import { analyzeMember, selectedTarget } from '../ui/builder.js';
import { duelRank, typeBoard, memberGuide } from '../core/battle.js';
import { NATURES } from '../core/build.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult } from '../ui/components.js';
import { itemName } from '../ui/reasons.js';
import { describeSet, moveGroup } from '../ui/setdesc.js';

const CLS = ['변화', '물리', '특수'];
const VERDICT = { good: ['유리', 'good'], close: ['아슬아슬', 'warn'], bad: ['불리', 'bad'], stuck: ['못 때림', 'bad'] };
const JOB_KO = {
  'setup-phys': '랭크업', 'setup-spec': '랭크업', 'setup-both': '랭크업', heal: '회복', hazard: '설치', pivot: '교체',
  status: '상태이상', screen: '벽', protect: '방어', doubles: '더블 보조',
};
let root, bodyEl;
let foeId = null;           // 대면할 상대
let foeLv = 'party';        // 상대 레벨 ('party' = 내 파티 레벨)
const recentFoes = [];      // 최근에 본 상대 (저장 안 함)
const foeCache = new WeakMap();   // 평가기 → Map(상대·레벨 → 상대 최선 세팅)

export function initBattle(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">전투 전략</span>
      <h1>내 파티로 싸우는 법</h1>
      <p>지금 파티의 <b>기술 세팅으로 실제 데미지를 계산</b>해서, 상대마다 누구를 내보내고 어떤 기술을 쓸지 정리했어요.
        마지막 토너먼트·전설 레이드는 상대 포켓몬을 골라 대면을, 체육관 관장은 타입별 대응을 보세요.</p>
    </div>
    <div id="bt-body" class="view"></div>`;
  bodyEl = root.querySelector('#bt-body');
  on(root, 'click', '[data-act="game-mode"]', async () => { await setMode(GAME_MODE); toast('「포켓몬 파티!」 게임 룰로 분석해요'); });
  on(root, 'click', '[data-foe]', (e, el) => pickFoe(+el.dataset.foe));
  on(root, 'click', '[data-act="foe-clear"]', () => { foeId = null; renderBattle(); syncHash(); });
  root.addEventListener('change', e => {
    if (e.target.matches('[data-act="foe-lv"]')) { foeLv = e.target.value; renderBattle(); }
  });
}

/** #/battle/<slug> 로 들어오면 그 상대로 */
export function showBattle(slug) {
  const mon = slug && store.engine.bySlug.get(slug);
  if (mon) pickFoe(mon.id, { quiet: true });
  else renderBattle();
}

// 주소창을 지금 상대로 (새로고침·공유 시 유지, 다시 그리지 않게 replaceState)
const syncHash = () => {
  const hash = foeId ? `#/battle/${store.engine.byId.get(foeId)?.slug || ''}` : '#/battle';
  if (location.hash.startsWith('#/battle') && location.hash !== hash) history.replaceState(null, '', hash);
};

function pickFoe(id, { quiet = false } = {}) {
  foeId = id;
  const i = recentFoes.indexOf(id);
  if (i >= 0) recentFoes.splice(i, 1);
  recentFoes.unshift(id);
  recentFoes.length = Math.min(recentFoes.length, 8);
  renderBattle();
  syncHash();
  if (!quiet) document.getElementById('bt-duel')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/** 멤버마다 싸울 세팅: 내 세팅(기술을 입력했으면) → 아니면 멤버 카드에서 고른 목표 세팅 */
function rowsOf(members) {
  return store.party.map((m, i) => {
    const pm = members[i];
    const r = analyzeMember(m, pm);
    const known = !!m.set && r.cur.mv.length > 0;
    const set = known ? r.cur : (selectedTarget(i, m, pm)?.set || r.best);
    return { i, m, pm, mon: pm.mon, set, known };
  });
}

/** 상대의 세팅: 같은 게임 규칙에서 최선으로 키웠다고 가정 (레벨마다 한 번 계산) */
function foeSetOf(b, foe, lv) {
  let map = foeCache.get(b);
  if (!map) foeCache.set(b, (map = new Map()));
  const key = `${foe.id}|${lv}`;
  if (!map.has(key)) {
    const ab = store.engine.defaultAbility(foe);
    map.set(key, b.optimize(foe, { lv, mv: [], ab, na: 'hardy', it: null, iv: [] }));
  }
  return map.get(key);
}

export function renderBattle() {
  if (!root) return;
  if (!isGameMode()) {
    bodyEl.innerHTML = `<div class="card empty"><strong>「포켓몬 파티!」 게임 룰 전용 화면이에요</strong>
      게임의 기술 습득·도구·레벨 규칙으로 데미지를 계산해요.
      <div class="empty-actions"><button class="btn primary" type="button" data-act="game-mode">게임 룰로 바꾸기</button></div></div>`;
    return;
  }
  if (!store.party.length) {
    bodyEl.innerHTML = `<div class="card empty"><strong>아직 파티가 비어 있어요</strong>
      파티 추천 화면에서 가진 포켓몬과 기술을 넣으면 전투 전략을 짜 드려요.
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
  const rows = rowsOf(members);
  const tables = rows.map(r => ({ i: r.i, t: b.targetTable(r.mon, r.set) }));
  const board = typeBoard(ctx, tables);
  bodyEl.innerHTML = [
    summaryCard(rows),
    `<section class="card bt-duel" id="bt-duel"></section>`,
    boardCard(rows, board),
    `<div class="bt-members">${rows.map((r, k) => memberCard(ctx, r, tables[k].t, board)).join('')}</div>`,
  ].join('');
  renderDuel(b, rows);
}

// ───────── 조각 ─────────

const moveInfo = slug => store.moves?.bySlug.get(slug);
const moveKo = slug => moveInfo(slug)?.ko || slug;
// 기술 이름 (상대 기술은 명중을 섞지 않은 데미지라 그대로)
const moveChip = slug => {
  const mv = moveInfo(slug);
  return mv ? `<span class="bt-move"><span class="dot t-${mv.type}"></span>${esc(mv.ko)}</span>` : esc(slug);
};
const who = r => `<span class="st-who">${sprite(r.mon)}<b>${esc(r.mon.ko)}</b></span>`;
const hitsText = n => (n === Infinity ? '—' : n >= 9 ? '9타+' : `${n}타`);
const pct = v => `${Math.round(v)}%`;

function summaryCard(rows) {
  const known = rows.filter(r => r.known).length;
  return `<section class="card st-summary">
    <div class="st-party">${rows.map(r => `<span class="st-mem ${r.known ? 'known' : ''}" title="${esc(r.mon.ko)} · ${r.known ? '내 세팅 기술' : '추천 세팅 기술 (내 세팅 입력 안 함)'}">${sprite(r.mon)}</span>`).join('')}
      <span class="note">내 세팅 기술 ${known}/${rows.length} · 나머지는 추천 세팅 기술로 계산 · ${store.game.battle === 'double' ? '더블 (범위기는 한 마리당 0.75배)' : '싱글'} · <a href="#/party">세팅 입력·바꾸기</a></span></div>
    <p class="note">데미지는 실제 공식(레벨·실능치·자속·상성·특성·도구·명중)의 평균값이에요. 「1타」는 평균 데미지로 쓰러뜨리는 횟수라, 난수·급소·명중에 따라 달라질 수 있어요.</p>
  </section>`;
}

/** 상대 포켓몬 대면: 고르기 + 멤버별 판정 */
function renderDuel(b, rows) {
  const el = bodyEl.querySelector('#bt-duel');
  const { engine } = store;
  const partyLv = Math.max(...rows.map(r => r.set.lv || store.gameData.finalLevel));
  const lv = foeLv === 'party' ? partyLv : +foeLv;
  const levels = [...new Set(store.gameData.levelTable)];
  const quick = [...new Set([...store.opponents, ...recentFoes])].filter(id => engine.byId.has(id) && id !== foeId).slice(0, 10);
  const head = `<div class="card-head"><h3><span class="tile-ic ic-duel">대면</span>상대 포켓몬 대면</h3><span class="sub">마지막 토너먼트 · 전설 레이드 · 트레이너</span></div>
    <div class="bt-pick">
      <div id="bt-picker"></div>
      <label class="field">상대 레벨 <select class="select" data-act="foe-lv">
        <option value="party" ${foeLv === 'party' ? 'selected' : ''}>내 파티와 같게 (Lv.${partyLv})</option>
        ${levels.map(v => `<option value="${v}" ${foeLv === String(v) ? 'selected' : ''}>Lv.${v}</option>`).join('')}
      </select></label>
    </div>
    ${quick.length ? `<div class="bt-quick"><span class="note">${store.opponents.length ? '선봉 추천의 상대·최근' : '최근'}</span>${quick.map(id => {
      const mon = engine.byId.get(id);
      return `<button type="button" class="bt-chip" data-foe="${id}">${sprite(mon)}${esc(mon.ko)}</button>`;
    }).join('')}</div>` : ''}`;
  if (!foeId || !engine.byId.has(foeId)) {
    el.innerHTML = `${head}<p class="note">상대 포켓몬을 검색하면 멤버마다 쓸 기술·몇 타에 쓰러뜨리는지·받는 피해·누가 먼저 움직이는지를 계산해요.</p>`;
    mountPicker(el);
    return;
  }
  const foe = engine.byId.get(foeId);
  const foeSet = foeSetOf(b, foe, lv);
  const res = duelRank(b, rows, foe, foeSet);
  const top = res.find(x => x.win);
  const nat = NATURES[foeSet.na];
  const legend = store.gameData.pool[foe.id]?.l;
  const line = x => {
    const r = rows[x.i];
    const [label, cls] = VERDICT[x.verdict];
    return `<li class="bt-row v-${cls}">
      <span class="bt-who">${who(r)}${r.known ? '' : '<span class="st-tag" title="내 세팅 기술을 입력하지 않아 추천 세팅 기술로 계산">추천 세팅</span>'}</span>
      <span class="bt-cell"><span class="bt-k">쓸 기술</span>${x.best ? `${moveChip(x.best.slug)} <b>${pct(x.best.pct)}</b> · ${hitsText(x.myHits)}${x.best.acc < 1 ? ` <em>명중 ${pct(x.best.acc * 100)}</em>` : ''}${x.best.prio ? ' <em>선제기</em>' : ''}` : '<span class="faint">때릴 기술 없음</span>'}</span>
      <span class="bt-cell"><span class="bt-k">받는 피해</span>${x.foeMove ? `${moveChip(x.foeMove.slug)} ` : ''}<b>${pct(x.taken)}</b> · ${hitsText(x.foeHits)}</span>
      <span class="bt-cell"><span class="bt-k">순서</span>${x.faster === 1 ? '<b class="good">먼저</b>' : x.faster === 0.5 ? '동속' : '<b class="bad">나중</b>'}</span>
      <span class="bt-verdict ${cls}" title="${x.win ? `이기면 남는 HP 약 ${Math.round(x.hpLeft)}%${x.sure < 1 ? ` · 필요한 만큼 다 맞을 확률 ${pct(x.sure * 100)}` : ''}` : '상대가 먼저 쓰러뜨려요'}">${label}${x.win ? `<small>${x.sure < 0.85 ? `명중 ${pct(x.sure * 100)}` : `HP ${Math.round(x.hpLeft)}%`}</small>` : ''}</span>
    </li>`;
  };
  const advice = top
    ? `<p class="bt-advice"><b>추천</b> ${esc(josa(rows[top.i].mon.ko, '으로'))} ${esc(josa(moveKo(top.best.slug), '을를'))} 쓰면 ${top.faster === 1 ? '먼저 움직여 ' : ''}${hitsText(top.myHits)}에 쓰러뜨려요${top.hpLeft < 100 ? ` (남는 HP 약 ${Math.round(top.hpLeft)}%)` : ''}.</p>`
    : `<p class="bt-advice bad"><b>주의</b> 1:1로 이기는 멤버가 없어요. 가장 덜 맞는 ${esc(josa(rows[[...res].sort((a, c) => a.taken - c.taken)[0].i].mon.ko, '으로'))} 받아내거나, 랭크업·상태이상으로 풀어 가세요.</p>`;
  el.innerHTML = `${head}
    <div class="bt-foe">${sprite(foe)}<div>
      <div class="bt-foe-name"><b>${esc(foe.ko)}</b>${typeList(engine, foe.t, 'sm')}<span class="note">Lv.${lv}</span><button type="button" class="link-btn" data-act="foe-clear">다른 상대</button></div>
      <p class="note">상대가 최선 세팅이라면: ${foeSet.mv.map(moveChip).join(' ')} · ${foeSet.it ? esc(itemName(foeSet.it)) : '도구 없음'} · ${esc(engine.abilityKo(foeSet.ab))} · ${nat ? esc(nat[0]) : '무보정'} · 스피드 ${b.statsAt(foe, foeSet)[5]}</p>
    </div></div>
    ${advice}
    <ol class="bt-rows">${res.map(line).join('')}</ol>
    ${legend ? '<p class="note">전설 레이드라면 보스 체력이 2.5배라 타수가 더 걸리고, 위 순서대로 <b>2마리</b>가 함께 싸워요 (방어막 동안 피해 감소).</p>' : ''}`;
  mountPicker(el);
}

function mountPicker(el) {
  createPicker(el.querySelector('#bt-picker'), {
    engine: store.engine, search: store.search,
    placeholder: '상대 포켓몬 검색 (이름·초성·번호)',
    onSelect: p => pickFoe(p.id),
  });
}

/** 상대 타입별 대응 (체육관 관장은 한 타입) */
function boardCard(rows, board) {
  const { engine } = store;
  const cell = x => {
    if (!x.n) return `<div class="bt-type">${typeBadge(engine, x.type)}<span class="note">이 맵에 이 타입 상대가 없어요</span></div>`;
    const a = x.list[0], c = x.list[1];
    const atk = l => `<span class="bt-pick-row">${sprite(rows[l.i].mon)}<b>${esc(rows[l.i].mon.ko)}</b>${l.move ? moveChip(l.move) : ''}<span class="faint">1타 ${pct(l.ko * 100)}</span></span>`;
    return `<div class="bt-type ${x.hole ? 'hole' : ''} ${x.danger ? 'danger' : ''}">
      <div class="bt-type-head">${typeBadge(engine, x.type)}${x.hole ? '<span class="bt-flag bad" title="누구도 평균 40% 이상 못 줘요">공격 구멍</span>' : ''}${x.danger ? '<span class="bt-flag warn" title="절반 넘는 멤버가 평균 60% 이상 받아요">위험</span>' : ''}<span class="note">상대 ${x.n}종</span></div>
      <div class="bt-type-body"><span class="bt-k">공격</span>${atk(a)}${c ? `<span class="bt-k sub">다음</span>${atk(c)}` : ''}
        ${x.tank ? `<span class="bt-k">받기</span><span class="bt-pick-row">${sprite(rows[x.tank.i].mon)}<b>${esc(rows[x.tank.i].mon.ko)}</b><span class="faint">받는 피해 ${pct(x.tank.taken)}</span></span>` : ''}</div>
    </div>`;
  };
  return `<section class="card">
    <div class="card-head"><h3><span class="tile-ic ic-gym">관장</span>상대 타입별 대응</h3><span class="sub">체육관 관장 · 트레이너</span></div>
    <p class="note bt-rule">체육관 관장은 한 타입 포켓몬 3마리(30·40턴 판 4마리)를 그 라운드 레벨·개체값 20으로 내보내요. 관장 타입이 나오면 그 칸의 <b>공격</b> 멤버를 먼저, 위험할 땐 <b>받기</b> 멤버로 교체하세요.
      (이 맵 상대 후보 중 그 타입을 가진 포켓몬 평균, 「1타」는 한 번에 쓰러뜨리는 비율)</p>
    <div class="bt-types">${board.map(cell).join('')}</div>
  </section>`;
}

/** 멤버별 운용법 */
function memberCard(ctx, r, table, board) {
  const { engine } = store;
  const g = memberGuide(ctx, r, table, board, moveGroup);
  const desc = describeSet(r.mon, r.set, { double: store.game.battle === 'double' });
  const jobs = g.jobs.map(j => {
    const mv = moveInfo(j.slug);
    if (!mv) return '';
    if (mv.cat === 0) return `<li>${moveChip(j.slug)}<span class="bt-job">${j.group ? esc(j.group) : '변화'}</span></li>`;
    const se = g.seOf(mv.type);
    const stab = r.mon.t.includes(mv.type);
    return `<li>${moveChip(j.slug)}<span class="bt-job">${stab ? '자속 ' : ''}${CLS[mv.cat]} ${mv.power || '—'}${j.share >= 0.05 ? ` · 주력 ${pct(j.share * 100)}` : ''}</span>
      ${se.length ? `<span class="bt-se">${se.slice(0, 6).map(t => typeBadge(engine, t, 'sm')).join('')}</span>` : ''}</li>`;
  }).join('');
  const weak = g.weak.map(t => `${typeBadge(engine, t, 'sm')}${g.def[engine.tIdx[t]] >= 4 ? mult(4, true) : ''}`).join('');
  return `<section class="card bt-member">
    <header>${sprite(r.mon)}<b>${esc(r.mon.ko)}</b><span class="note">${r.known ? '내 세팅' : '추천 세팅'} · Lv.${r.set.lv || store.gameData.finalLevel}${r.set.it ? ` · ${esc(itemName(r.set.it))}` : ''}</span></header>
    <p class="set-why"><b>${esc(desc.role)}</b> ${esc(desc.line)}</p>
    <ul class="bt-jobs">${jobs}</ul>
    <p class="note bt-jobs-note">주력 % = 이 맵 상대 중 그 기술이 가장 센 비율 · 타입은 효과 굉장</p>
    <div class="bt-lines">
      <div><span class="bt-k">선공</span>이 맵 상대의 ${pct(g.speed * 100)}보다 빠름 <span class="faint">(스피드 ${getBuilder().statsAt(r.mon, r.set)[5]})</span></div>
      ${g.best.length ? `<div><span class="bt-k">내보낼 때</span>${g.best.slice(0, 8).map(t => typeBadge(engine, t, 'sm')).join('')}</div>` : ''}
      ${weak ? `<div><span class="bt-k">조심</span>${weak}</div>` : ''}
      ${g.resist.length ? `<div><span class="bt-k">받아냄</span>${g.resist.map(t => typeBadge(engine, t, 'sm')).join('')}${g.immune.length ? ' <em>(무효 포함)</em>' : ''}</div>` : ''}
    </div>
  </section>`;
}
