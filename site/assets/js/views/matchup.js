// 상성 탐색: 포켓몬 → 약점/내성, 내 파티 대면, 실전·추천 세팅, 카운터, 자속 공격 상성
import { store, getContext, partyMembers, addRecent, addToParty, usageInfo, isGameMode, gameRule, whereToFind, setsOrder, gameOpts, loadMoves } from '../state.js';
import { substitutesFor } from '../ui/builder.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, copyText, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, statBars, dexNo, barList, moveLabel, itemLabel, natureText, spreadText, ICONS } from '../ui/components.js';
import { ABILITY_EFFECTS } from '../core/engine.js';
import { findCounters, partyVersus } from '../core/party.js';
import { orderedSets, setCard } from '../ui/sets.js';

const view = { slug: null, ability: undefined, tera: null };
let root, resultEl, quickEl;

const go = slug => { location.hash = `#/matchup/${slug}`; };

export function initMatchup(el) {
  root = el;
  root.innerHTML = `
    <div class="search-hero">
      <div>
        <span class="eyebrow">상대 포켓몬 분석</span>
        <h1>약점 타입을 바로 찾아보세요</h1>
        <p>이름(한글·영문·초성) 또는 도감 번호로 검색하면 받는 데미지 배율, 잡기 좋은 포켓몬, 실전 세팅을 보여드려요.</p>
      </div>
      <div id="m-picker"></div>
      <div class="chips" id="m-quick"></div>
    </div>
    <div id="m-result" class="view"></div>`;
  resultEl = root.querySelector('#m-result');
  quickEl = root.querySelector('#m-quick');
  createPicker(root.querySelector('#m-picker'), {
    engine: store.engine, search: store.search, large: true,
    placeholder: '예: 누오, 한카리아스, ㄹㅈㅁ, 445',
    onSelect: p => go(p.slug),
  });

  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); go(el.dataset.go); });
  on(root, 'change', '#m-ability', (e, el) => { view.ability = el.value || null; render(); });
  on(root, 'change', '#m-tera', (e, el) => { view.tera = el.value || null; render(); });
  on(root, 'click', '[data-act="add-party"]', () => {
    const mon = store.engine.bySlug.get(view.slug);
    const err = addToParty(mon);
    toast(err || `${josa(mon.ko, '을를')} 파티에 추가했어요`);
  });
  on(root, 'click', '[data-act="copy-link"]', async () => {
    toast(await copyText(location.href) ? '링크를 복사했어요' : '복사에 실패했어요');
  });
  on(root, 'click', '[data-act="random"]', () => {
    const pool = getContext().pool;
    go(pool[Math.floor(Math.random() * pool.length)].mon.slug);
  });
}

export function showMatchup(slug) {
  if (slug !== view.slug) {
    view.slug = slug;
    view.ability = undefined;
    view.tera = null;
    const mon = store.engine.bySlug.get(slug);
    if (mon) {
      addRecent(mon.id);
      document.title = `${mon.ko} 약점 · 포켓파티 랩`;
    }
    window.scrollTo({ top: 0 });
  }
  render();
}

export function renderMatchup() { if (root) render(); }

function quickChips() {
  const { engine, usage } = store;
  const chip = mon => `<a class="chip" href="#/matchup/${mon.slug}" data-go="${mon.slug}">${sprite(mon)}${esc(mon.ko)}</a>`;
  const recent = store.recent.map(id => engine.byId.get(id)).filter(Boolean).slice(0, 6);
  let html = '';
  if (recent.length) html += `<span class="chips-label">최근</span>${recent.map(chip).join('')}`;
  if (usage) {
    const top = Object.entries(usage.mons).sort((a, b) => a[1].r - b[1].r).slice(0, 8).map(([id]) => engine.byId.get(+id));
    html += `<span class="chips-label" style="margin-left:${recent.length ? 8 : 0}px">실전 인기</span>${top.map(chip).join('')}`;
  }
  html += `<button class="chip" type="button" data-act="random">🎲 랜덤</button>`;
  return html;
}

function render() {
  const { engine, usage } = store;
  quickEl.innerHTML = quickChips();
  const mon = view.slug && engine.bySlug.get(view.slug);
  if (!mon) {
    resultEl.innerHTML = view.slug
      ? `<div class="card empty"><strong>포켓몬을 찾을 수 없어요</strong>검색창에서 다시 찾아보세요.</div>`
      : `<div class="card empty"><strong>검색창에 포켓몬 이름을 입력해 보세요</strong>초성 검색도 됩니다 — 예: <b>ㄴㅇ</b> → 누오</div>`;
    return;
  }
  const ctx = getContext();
  const u = usage?.mons[mon.id];
  const ability = view.ability === undefined ? engine.defaultAbility(mon, u) : view.ability;
  const tera = view.tera;
  const opts = { ability, tera };

  // 약점 → 내 파티 대면 → 세팅 → 카운터 → 자속 공격 상성(맨 아래)
  resultEl.innerHTML = [
    heroCard(ctx, mon, u),
    defenseCard(mon, u, opts),
    versusCard(ctx, mon, opts),
    usageCard(mon, u),
    countersCard(ctx, mon, opts),
    offenseCard(mon, tera),
  ].join('');
}

function heroCard(ctx, mon, u) {
  const { engine } = store;
  const where = isGameMode() ? whereToFind(mon) : '';
  const gameStats = isGameMode() && ctx.stats(mon) !== mon.st;
  const abilityChip = (a, hidden) => {
    const [ko, en, desc] = store.dex.abilities[a] || [a, a, ''];
    const effect = ABILITY_EFFECTS[a] ? ' effect' : '';
    return `<span class="ability${hidden ? ' hidden-ab' : ''}${effect}" title="${esc(en)} — ${esc(desc)}">${esc(ko)}${hidden ? '<small>숨특</small>' : ''}</span>`;
  };
  const flags = [mon.legend && '전설', mon.myth && '환상', mon.mega && '메가진화', mon.battle && '배틀 전용 폼'].filter(Boolean);
  return `
  <article class="card mon-hero">
    <div class="mon-art"><span class="dexno">${dexNo(mon)}</span>${sprite(mon, 'art', 'width="300" height="300"')}</div>
    <div>
      <div class="mon-title"><h2>${esc(mon.ko)}</h2><span class="en">${esc(mon.en)}</span></div>
      <div class="mon-meta">
        ${typeList(engine, mon.t, 'lg')}
        <span class="genus">${esc(mon.genus)}${mon.genus ? ' · ' : ''}${mon.gen}세대</span>
        ${flags.map(f => `<span class="pill-soft">${f}</span>`).join('')}
        ${u ? `<span class="pill-soft accent">${esc(usageInfo().label)} 사용률 ${u.u}% · ${u.r}위</span>` : ''}
        ${isGameMode() ? `<span class="pill-soft accent">${where ? `게임 출현: ${esc(where)}` : '이 맵에서는 야생으로 안 나와요'}</span>` : ''}
      </div>
      <div class="abilities">${mon.ab.map(a => abilityChip(a, false)).join('')}${mon.ha && !mon.ab.includes(mon.ha) ? abilityChip(mon.ha, true) : ''}</div>
      ${statBars(ctx.stats(mon))}
      ${gameStats ? '<p class="note">「포켓몬 파티!」 게임 데이터의 종족값이에요 (원작과 다름).</p>' : ''}
      <div class="hero-actions">
        <button class="btn primary" type="button" data-act="add-party">${ICONS.plus}내 파티에 추가</button>
        <button class="btn" type="button" data-act="copy-link">${ICONS.link}링크 복사</button>
      </div>
    </div>
  </article>`;
}

function defenseCard(mon, u, { ability, tera }) {
  const { engine, dex } = store;
  const profile = engine.defenseProfile(mon, { ability, tera });
  const groups = engine.groupProfile(profile);
  const abilities = engine.abilitiesOf(mon);
  const teraUsage = Object.fromEntries(u?.te || []);
  const abilitySelect = `
    <label class="field">특성
      <select class="select" id="m-ability">
        ${abilities.map(a => `<option value="${a}" ${a === ability ? 'selected' : ''}>${esc(engine.abilityKo(a))}${a === mon.ha ? ' (숨특)' : ''}${ABILITY_EFFECTS[a] ? ' ★' : ''}</option>`).join('')}
        <option value="" ${!ability ? 'selected' : ''}>특성 효과 무시</option>
      </select></label>`;
  // 게임 모드에서는 테라스탈을 쓰는 룰일 때만
  const teraSelect = isGameMode() && !gameRule()?.uses.includes('tera') ? '' : `
    <label class="field">테라스탈
      <select class="select" id="m-tera">
        <option value="">없음</option>
        ${[...dex.types, 'stellar'].map(t => `<option value="${t}" ${t === tera ? 'selected' : ''}>${esc(engine.typeKo(t))}${teraUsage[t] ? ` (실전 ${teraUsage[t]}%)` : ''}</option>`).join('')}
      </select></label>`;

  const weak = groups.filter(g => g.mult >= 2);
  const callout = weak.length
    ? `<div class="callout">이 포켓몬에게는 ${weak.map(g => g.types.map(t => typeBadge(engine, t)).join(' ') + ` <strong>×${g.mult}</strong>`).join(' · ')}</div>`
    : `<div class="callout calm">효과가 굉장한 타입이 없어요. 특성·도구·기술로 공략해야 합니다.</div>`;

  const rows = groups.map(g => g.mult === 1
    ? `<div class="mult-row neutral">${mult(1, true)}<span class="types">${g.types.map(t => typeBadge(engine, t, 'sm')).join('')}</span></div>`
    : `<div class="mult-row">${mult(g.mult, true)}<span class="types">${g.types.map(t => typeBadge(engine, t)).join('')}</span></div>`).join('');

  const effectNote = ability && ABILITY_EFFECTS[ability] ? `<p class="note">★ ${esc(engine.abilityKo(ability))} 특성 효과가 반영된 배율입니다.</p>` : '';
  const others = abilities.filter(a => a !== ability && ABILITY_EFFECTS[a]);
  const otherNote = others.length
    ? `<p class="note">⚠ 특성 변수: ${others.map(a => `<b>${esc(engine.abilityKo(a))}</b>이면 ${esc(describeEffect(a))}`).join(' · ')} — 위 특성 선택에서 바꿔볼 수 있어요.</p>`
    : '';
  const teraNote = tera ? `<p class="note">테라스탈 시 방어 타입은 ${tera === 'stellar' ? '원래 타입 그대로' : `${esc(engine.typeKo(tera))} 단일 타입`}이 됩니다.</p>` : '';
  return `
  <section class="card">
    <div class="card-head"><h3>받는 데미지</h3><span class="sub">공격 타입별 배율 (방어 상성)</span></div>
    <div class="controls">${abilitySelect}${teraSelect}</div>
    ${callout}
    <div class="mult-groups">${rows}</div>
    ${effectNote}${otherNote}${teraNote}
  </section>`;
}

function describeEffect(ability) {
  const eff = ABILITY_EFFECTS[ability];
  if (eff === 'wonder') return '효과 굉장 외 모든 공격 무효';
  if (eff === 'filter') return '효과 굉장 데미지 ×0.75';
  const word = f => (f === 0 ? '무효' : f === 0.5 ? '반감' : `×${f}`);
  return Object.entries(eff).map(([t, f]) => `${store.engine.typeKo(t)} ${word(f)}`).join(', ');
}

function offenseCard(mon, tera) {
  const { engine, dex } = store;
  const blocks = engine.stabTypes(mon, tera).map(s => {
    const line = (label, pred) => {
      const ts = dex.types.filter(d => pred(engine.effectiveness(s, [d])));
      return ts.length ? `<div class="stab-line"><span>${label}</span><span class="types">${ts.map(t => typeBadge(engine, t, 'sm')).join('')}</span></div>` : '';
    };
    return `<div class="stab-block">
      <div>${typeBadge(engine, s)} <span class="note">타입 기술로 공격하면</span></div>
      ${line('효과 굉장 ×2', x => x === 2)}${line('효과 별로 ×½', x => x === 0.5)}${line('효과 없음 ×0', x => x === 0)}
    </div>`;
  }).join('');
  return `
  <section class="card">
    <div class="card-head"><h3>자속 공격 상성</h3><span class="sub">이 포켓몬 타입 기술의 상대별 배율</span></div>
    ${blocks}
  </section>`;
}

function versusCard(ctx, mon, opts) {
  const { engine } = store;
  if (!store.party.length) return '';
  const rows = partyVersus(ctx, partyMembers(ctx), mon, opts)
    .sort((a, b) => (b.atk - b.recv) - (a.atk - a.recv));
  const label = { good: '유리', 'good-ish': '약간 유리', even: '호각', 'bad-ish': '약간 불리', bad: '불리' };
  const cls = v => (v.startsWith('good') ? 'good' : v.startsWith('bad') ? 'bad' : 'even');
  return `
  <section class="card">
    <div class="card-head"><h3>내 파티 대면</h3><span class="sub">자속 기술 기준 · <a href="#/party">파티 편집</a></span></div>
    <table class="versus"><tbody>
      ${rows.map(r => `<tr>
        <td><span class="who">${sprite(r.m.mon)}${esc(r.m.mon.ko)}${r.m.tera ? ` <span class="pill-soft">테라 ${esc(engine.typeKo(r.m.tera))}</span>` : ''}</span></td>
        <td><span class="vs-cell"><span class="vs-label">주는</span>${mult(r.atk, true)}<span class="hide-sm">${r.atkType ? typeBadge(engine, r.atkType, 'sm') : ''}</span></span></td>
        <td><span class="vs-cell"><span class="vs-label">받는</span>${mult(r.recv, true)}<span class="hide-sm">${r.recvType ? typeBadge(engine, r.recvType, 'sm') : ''}</span></span></td>
        <td><span class="verdict ${cls(r.verdict)}">${label[r.verdict]}</span></td>
      </tr>`).join('')}
    </tbody></table>
  </section>`;
}

function countersCard(ctx, mon, opts) {
  const { engine } = store;
  const list = findCounters(ctx, mon, opts, 12);
  const scope = isGameMode() ? '이 맵에서 잡을 수 있는 포켓몬 중'
    : store.usage ? `${usageInfo().label} 실전 포켓몬 중` : '최종진화 포켓몬 중 (파티 추천 옵션 기준)';
  return `
  <section class="card">
    <div class="card-head"><h3>상성으로 잡기 좋은 포켓몬</h3><span class="sub">${esc(scope)} · 자속 효과 굉장 + 상대 자속 반감</span></div>
    ${list.length ? `<div class="mon-grid">${list.map(r => `
      <a class="mon-card" href="#/matchup/${r.c.mon.slug}" data-go="${r.c.mon.slug}">
        ${sprite(r.c.mon)}
        <span class="mc-name">${esc(r.c.mon.ko)}</span>
        ${typeList(engine, r.c.mon.t, 'sm')}
        <span class="mc-sub">주는 ${mult(r.off, true)} 받는 ${mult(r.def, true)}</span>
        ${isGameMode() ? `<span class="mc-where">${esc(whereToFind(r.c.mon))}</span>` : ''}
      </a>`).join('')}</div>` : '<p class="empty">자속으로 효과가 굉장한 후보가 없어요.</p>'}
  </section>`;
}

/** 실전 통계가 없을 때: Smogon 추천 → 랜덤배틀 → 자체 생성 세팅을 모두 보여준다 */
function recommendedSection(mon) {
  const { engine, sets } = store;
  const info = usageInfo();
  const sub = isGameMode()
    ? `${gameRule().name} 기준 · 게임에서 못 구하는 도구·기술은 취소선, 옆에 대신 쓸 기술·도구`
    : info ? `${info.label} 실전 통계 상위 ${info.count}위 안에 없어 추천 세팅을 보여드려요`
    : 'Smogon 분석가 세팅 · 랜덤배틀 역할 세팅 · 자체 생성';
  const head = `<div class="card-head"><h3>추천 세팅</h3><span class="sub">${esc(sub)}</span></div>`;
  if (!sets) return `<section class="card">${head}<p class="note">추천 세팅 불러오는 중…</p></section>`;
  const list = orderedSets(sets, mon.id, setsOrder());
  if (!list.length) return `<section class="card">${head}<p class="note">세팅 정보가 없어요.</p></section>`;
  // 게임 모드: 못 배우는 기술·못 구하는 도구 대신 쓸 것 (기술 데이터를 받으면 다시 그림)
  if (isGameMode() && !store.moves) loadMoves();
  const opts = { mode: store.mode, game: gameOpts(), header: false };
  return `<section class="card">${head}
    <div class="sets">${list.map(s => setCard(engine, sets, mon, s, { ...opts, subs: isGameMode() ? substitutesFor(mon, s) : null })).join('')}</div></section>`;
}

function usageCard(mon, u) {
  const { engine, usage, dex } = store;
  if (!usage || !u) return recommendedSection(mon);
  const info = usageInfo();
  const monLink = id => {
    const m = engine.byId.get(id);
    return { html: `${sprite(m)}${esc(m.ko)}`, attrs: `data-go="${m.slug}"` };
  };
  const cols = [
    ['특성', barList(u.ab.map(([a, p]) => ({ html: esc(engine.abilityKo(a)), pct: p })))],
    ['도구', barList(u.it.map(([i, p]) => ({ html: itemLabel(usage, i), pct: p })))],
    ['기술', barList(u.mv.map(([m, p]) => ({ html: moveLabel(engine, usage, m), pct: p })))],
    [`성격 · ${usage.points}`, barList(u.sp.map(([n, evs, p]) => ({ html: `${natureText(usage, n)} <em class="faint">${spreadText(evs)}</em>`, pct: p })))],
    ...(u.te ? [['테라스탈', barList(u.te.map(([t, p]) => ({ html: dex.typeNames[t] ? typeBadge(engine, t, 'sm') : esc(t), pct: p })))]] : []),
    ['함께 쓰는 포켓몬', barList(u.tm.slice(0, 6).map(([id, p]) => ({ ...monLink(id), pct: p })), 'var(--good-soft)')],
    ...(u.cc.length ? [['실전 카운터 (대면 시 쓰러뜨리거나 교체시킨 비율)', barList(u.cc.slice(0, 6).map(([id, p]) => ({ ...monLink(id), pct: p })), 'var(--danger-soft)')]] : []),
  ];
  return `
  <section class="card">
    <div class="card-head"><h3>실전 세팅 · ${esc(info.label)}</h3>
      <span class="sub">${esc(info.desc)} · ${esc(info.month)} · 레이팅 ${info.cutoff}+ · ${info.battles.toLocaleString()}판</span></div>
    <div class="usage-grid">${cols.map(([h, body]) => `<div class="usage-col"><h4>${esc(h)}</h4>${body}</div>`).join('')}</div>
  </section>`;
}
