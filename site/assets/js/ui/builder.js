// 내 세팅 입력 · 게임 최선 세팅 · 참고 세팅 고르기 · 목표까지 할 일 (파티 추천 화면의 멤버 카드, 「포켓몬 파티!」 모드)
import { store, getBuilder, gameRule, allowedItems, setsOrder } from '../state.js';
import { esc, josa } from './dom.js';
import { sprite } from './components.js';
import { NATURES } from '../core/build.js';
import { STAT_LABELS } from '../core/engine.js';
import { itemName } from './reasons.js';
import { orderedSets } from './sets.js';
import { describeSet, refSource, setNameKo } from './setdesc.js';
import { searchSelect, defineOptions, setSearchValue } from './searchselect.js';

const CLS = ['변화', '물리', '특수'];
const NO_IV = [false, false, false, false, false, false];
const ALL_IV = [true, true, true, true, true, true];
const results = new WeakMap();   // 평가기 → Map(멤버 세팅 키 → 계산 결과)

// 멤버 카드마다 고른 세팅 (멤버 번호 → 'best' | 추천 세팅 키 B·S·D·R·A). 저장하지 않음
const picked = new Map();
export const pickSet = (i, key) => picked.set(i, key);
export const pickedSet = i => picked.get(i);

/** 멤버의 지금 세팅 (입력이 없으면 빈 세팅: 기술 없음·무보정·개체값 20) */
export function currentSet(m, pm) {
  return {
    lv: m.set?.lv || store.gameData.finalLevel, mv: m.set?.mv || [], it: m.set?.it ?? null,
    na: m.set?.na ?? null, iv: m.set?.iv || NO_IV, ab: pm.ability,
  };
}

/** 최선 세팅 · 평가 · 할 일 (같은 입력이면 다시 계산하지 않음) */
export function analyzeMember(m, pm) {
  const b = getBuilder();
  if (!b) return null;
  const cur = currentSet(m, pm);
  const key = `${pm.mon.id}|${pm.stone || ''}|${JSON.stringify(cur)}`;
  let map = results.get(b);
  if (!map) results.set(b, (map = new Map()));
  if (!map.has(key)) {
    const abilities = store.engine.abilitiesOf(pm.mon);
    const best = b.optimize(pm.mon, cur, { abilities, fixedItem: pm.stone || null });
    map.set(key, {
      cur, best, now: m.set ? b.evaluate(pm.mon, cur) : null, top: b.evaluate(pm.mon, best),
      steps: m.set ? b.plan(pm.mon, cur, best) : [],
    });
  }
  return map.get(key);
}

const line = (label, vals) => (vals ? `<div class="set-line"><span>${label}</span><span class="vals">${vals}</span></div>` : '');
const moveChip = slug => {
  const mv = store.moves?.bySlug.get(slug);
  return mv ? `<span><span class="dot t-${mv.type}" title="${esc(store.engine.typeKo(mv.type))}"></span>${esc(mv.ko)}<span class="cls">${CLS[mv.cat]}</span></span>` : `<span>${esc(slug)}</span>`;
};
export const natureLabel = slug => {
  const n = NATURES[slug];
  if (!n) return '—';
  return n[1] === n[2] ? `${n[0]} <em>무보정</em>` : `${n[0]} <em>+${STAT_LABELS[n[1]]} −${STAT_LABELS[n[2]]}</em>`;
};
const ivText = iv => {
  const top = STAT_LABELS.filter((_, k) => iv[k]);
  return top.length === 6 ? '전부 31' : top.length ? `${top.join('·')} 31 <em>나머지 20</em>` : '전부 20 <em>기본</em>';
};

/** 세팅 한 덩어리 (기술·도구·특성·성격·개체값) */
function setLines(set, ab) {
  return line('기술', set.mv.length ? set.mv.map(moveChip).join('') : '<span class="faint">입력 안 함</span>')
    + line('도구', set.it ? esc(itemName(set.it)) : '<span class="faint">없음</span>')
    + line('특성', ab ? esc(store.engine.abilityKo(ab)) : '')
    + line('성격', natureLabel(set.na))
    + line('개체값', ivText(set.iv || NO_IV));
}

/** 화력 · 받는 피해 · 선공 + 실제 능력치 */
function metrics(ev, set) {
  const st = ev.stats.map((v, k) => `${STAT_LABELS[k]} ${v}${set.iv?.[k] ? '★' : ''}`).join(' · ');
  return `<div class="build-metrics">
      <span title="이 맵 상대 후보에게 기술 하나로 주는 최대 데미지 평균 (100% 상한)">화력 <b>${Math.round(ev.offense)}%</b></span>
      <span title="상대의 자속 공격(위력 90)에 받는 데미지 평균">받는 피해 <b>${Math.round(ev.taken)}%</b></span>
      <span title="상대보다 빠른 비율">선공 <b>${Math.round(ev.speed * 100)}%</b></span>
      <span class="score">점수 <b>${Math.round(ev.score)}</b></span>
    </div>
    <p class="note stats-line">Lv.${set.lv} 실능치 ${st}</p>`;
}

/** 할 일 한 줄 */
function stepText(s) {
  const book = store.moves;
  switch (s.kind) {
    case 'move': return `<span class="todo-where">기술 칸</span><b>${esc(book.bySlug.get(s.learn)?.ko || s.learn)}</b> 배우기${s.forget ? ` <em>← ${esc(book.bySlug.get(s.forget)?.ko || s.forget)} 잊기</em>` : ''}`;
    case 'na': return `<span class="todo-where">트레이닝 칸</span>성격 → <b>${natureLabel(s.to)}</b>`;
    case 'ab': return `<span class="todo-where">트레이닝 칸</span>특성 → <b>${esc(store.engine.abilityKo(s.to))}</b>`;
    case 'iv': return `<span class="todo-where">트레이닝 칸</span>개체값 31로: <b>${s.stats.map(k => STAT_LABELS[k]).join(' → ')}</b> <em>(1회에 하나 · 금색병뚜껑이면 한 번에)</em>`;
    case 'it': return `<span class="todo-where">아이템·상점</span>${s.to ? `<b>${esc(itemName(s.to))}</b> 지니게 하기` : '도구 빼기'}`;
    default: return '';
  }
}

/** 목표 세팅까지 할 일. t: { title, steps, now, top } */
function todoHtml(t) {
  if (!t.steps.length) return `<p class="build-done">✔ 지금 세팅이 ${esc(t.title)}과 같아요.</p>`;
  const skill = t.steps.filter(s => s.kind === 'move').length;
  const train = t.steps.reduce((a, s) => a + (s.kind === 'na' || s.kind === 'ab' ? 1 : s.kind === 'iv' ? s.stats.length : 0), 0);
  const diff = Math.round(t.top.score - t.now.score);
  return `<div class="build-todo">
    <h4>${esc(t.title)}까지 할 일 <span class="note">이득이 큰 순서 · 점수 ${diff >= 0 ? '+' : ''}${diff}</span></h4>
    <ol>${t.steps.map(s => `<li>${stepText(s)}<span class="gain">+${s.gain.toFixed(1)}</span></li>`).join('')}</ol>
    <p class="note">${[skill && `기술 칸 ${skill}번`, train && `트레이닝 칸 ${train}번`].filter(Boolean).join(' · ') || '도구만 바꾸면'} 돼요.
      성격·특성·개체값은 마지막 상점의 민트·특성패치·금색병뚜껑으로도 바꿀 수 있어요.</p>
  </div>`;
}

/**
 * 추천 세팅(Smogon·랜덤배틀) → 이 게임에서 쓸 수 있는 세팅. 못 배우는 기술·못 구하는 도구는 빼고,
 * 기술 후보 중에서 고르는 역할 세팅(pool)은 점수가 가장 높은 4개 조합.
 */
function toGameSet(b, pm, ref) {
  const learn = new Set(b.learnable(pm.mon).map(m => m.slug));
  const slots = (ref.mv || []).map(s => (Array.isArray(s) ? s : [s]));
  const dropped = [];
  let mv = [];
  if (ref.pool) {
    const cands = [...new Set(slots.flat())].filter(s => learn.has(s));
    dropped.push(...[...new Set(slots.flat())].filter(s => !learn.has(s)));
    mv = cands.slice(0, 4);
    if (cands.length > 4) {
      let best = -Infinity;
      const pick = (start, chosen) => {
        if (chosen.length === 4) {
          const v = b.evaluate(pm.mon, { lv: store.gameData.finalLevel, mv: chosen, iv: ALL_IV, ab: pm.ability, na: 'hardy' }).score;
          if (v > best) { best = v; mv = chosen.slice(); }
          return;
        }
        for (let k = start; k < cands.length; k++) pick(k + 1, [...chosen, cands[k]]);
      };
      pick(0, []);
    }
  } else {
    for (const opts of slots) {
      const ok = opts.find(s => learn.has(s) && !mv.includes(s));
      if (ok) mv.push(ok); else dropped.push(opts[0]);
    }
  }
  const allowed = allowedItems() || new Set();
  const items = (Array.isArray(ref.it) ? ref.it : [ref.it]).filter(Boolean);
  const abilities = store.engine.abilitiesOf(pm.mon);
  return {
    set: {
      lv: store.gameData.finalLevel, mv: mv.slice(0, 4), iv: ALL_IV,
      it: pm.stone || items.find(x => allowed.has(x)) || null,
      ab: (ref.ab || []).find(a => abilities.includes(a)) || pm.ability,
      na: (ref.na || []).find(n => NATURES[n]) || 'hardy',
    },
    dropped,
    itemMissing: !pm.stone && items.length && !items.some(x => allowed.has(x)) ? items[0] : null,
  };
}

/** 고를 수 있는 목표 세팅: 계산한 최선 + 참고 추천 세팅들 (멤버 모습·특성이 같으면 다시 계산하지 않음) */
function targetOptions(b, pm, r) {
  let map = results.get(b);
  if (!map) results.set(b, (map = new Map()));
  const key = `opts|${pm.mon.id}|${pm.stone || ''}|${pm.ability}|${!!store.sets}|${setsOrder()}`;
  if (!map.has(key)) {
    const refs = [];
    for (const ref of store.sets ? orderedSets(store.sets, pm.mon.id, setsOrder()) : []) {
      const g = toGameSet(b, pm, ref);
      const { role } = describeSet(pm.mon, ref, { double: store.game.battle === 'double' || ref.key === 'D' });
      refs.push({ key: ref.key, chip: `${refSource(ref)} · ${role}`, title: `${role} 세팅`, src: `${ref.src} · ${setNameKo(ref.n)}`, ref, ...g, top: b.evaluate(pm.mon, g.set) });
    }
    map.set(key, refs);
  }
  return [{ key: 'best', chip: '최선 (계산)', title: '이 게임 최선 세팅', src: '배울 수 있는 기술·구할 수 있는 도구 중 계산', set: r.best, top: r.top, dropped: [] }, ...map.get(key)];
}

/** 입력 폼 */
function editorHtml(i, m, pm) {
  const { engine } = store;
  const b = getBuilder();
  const set = currentSet(m, pm);
  const learn = b.learnable(pm.mon, set);
  const byType = new Map();
  for (const mv of [...learn].sort((x, y) => (y.cat > 0) - (x.cat > 0) || y.power - x.power || x.ko.localeCompare(y.ko, 'ko'))) {
    const key = mv.cat ? mv.type : 'status';
    (byType.get(key) || byType.set(key, []).get(key)).push(mv);
  }
  // 검색 목록: 기술(공격기 위력순 → 변화기) · 도구(이 룰에서 구할 수 있는 것) · 성격
  const moveList = `mv:${pm.mon.id}`;
  defineOptions(moveList, [...byType].sort((a, b2) => (a[0] === 'status') - (b2[0] === 'status')).flatMap(([, list]) => list).map(mv => ({
    value: mv.slug, label: mv.ko,
    sub: `${engine.typeKo(mv.type)} · ${CLS[mv.cat]}${mv.cat ? ` ${mv.power || '—'}` : ''}${mv.acc && mv.acc < 100 ? ` · 명중 ${mv.acc}` : ''}`,
    keys: `${engine.typeKo(mv.type)} ${CLS[mv.cat]} ${mv.slug}`,
  })));
  const moveSelect = k => `<label>기술 ${k + 1}${searchSelect({ name: `mv${k}`, list: moveList, value: set.mv[k] || '', placeholder: '기술 이름·초성·타입', label: `기술 ${k + 1}` })}</label>`;
  const allowed = allowedItems() || new Set();
  const it = store.gameData.items, uses = gameRule()?.uses || [];
  const itemGroups = [['배틀 도구', it.battle], ['열매', it.berry], ['전용 도구', it.signature],
    ...(uses.includes('mega') ? [['메가스톤', it.mega]] : []), ...(uses.includes('z') ? [['Z크리스탈', it.z]] : [])];
  const itemList = `it:${gameRule()?.key}`;
  defineOptions(itemList, [{ value: '', label: '없음', sub: '도구 없음' },
    ...itemGroups.flatMap(([group, list]) => list.filter(x => allowed.has(x)).map(x => ({ value: x, label: itemName(x), sub: group, keys: `${group} ${x}` })))]);
  const itemSelect = pm.stone
    ? `<label>도구<select class="select" name="it" disabled><option value="${pm.stone}">${esc(itemName(pm.stone))} (메가진화)</option></select></label>`
    : `<label>도구${searchSelect({ name: 'it', list: itemList, value: set.it || '', placeholder: '도구 이름·초성', label: '도구' })}</label>`;
  defineOptions('na', [{ value: '', label: '모름 (무보정)', sub: '' }, ...Object.entries(NATURES).map(([k, n]) => ({
    value: k, label: n[0], sub: n[1] === n[2] ? '무보정' : `+${STAT_LABELS[n[1]]} −${STAT_LABELS[n[2]]}`,
    keys: n[1] === n[2] ? `무보정 ${k}` : `${STAT_LABELS[n[1]]} ${STAT_LABELS[n[2]]} ${k}`,
  }))]);
  const abilities = engine.abilitiesOf(pm.mon);
  return `<form class="set-editor" data-editor="${i}">
    <div class="se-grid">
      <label>레벨<input class="select" type="number" name="lv" min="1" max="100" value="${set.lv}"></label>
      ${itemSelect}
      <label>특성<select class="select" name="ab" ${abilities.length < 2 ? 'disabled' : ''}>${abilities.map(a => `<option value="${a}" ${a === pm.ability ? 'selected' : ''}>${esc(engine.abilityKo(a))}</option>`).join('')}</select></label>
      <label>성격${searchSelect({ name: 'na', list: 'na', value: set.na || '', placeholder: '성격 이름·능력(예: 스피드)', label: '성격' })}</label>
    </div>
    <p class="note se-tip">칸을 누르고 이름이나 초성(예: ㅈㅈ → 지진), 타입(예: 땅)으로 찾은 뒤 ↑↓ · Enter 로 고르세요.</p>
    <div class="se-moves">${[0, 1, 2, 3].map(moveSelect).join('')}</div>
    <fieldset class="se-iv"><legend>개체값 31 (트레이닝 칸·금색병뚜껑·우수 개체 ★)</legend>
      ${STAT_LABELS.map((label, k) => `<label class="check"><input type="checkbox" name="iv${k}" ${set.iv[k] ? 'checked' : ''}> ${label}</label>`).join('')}
    </fieldset>
    <p class="note">기술 목록은 이 게임에서 ${esc(josa(pm.mon.ko, '이가'))} 기술 칸에서 배울 수 있는 기술이에요.</p>
    <div class="se-actions">
      <button class="btn" type="submit">저장</button>
      <button class="btn ghost" type="button" data-act="set-fill" data-i="${i}">고른 세팅으로 채우기</button>
      ${m.set ? `<button class="btn ghost" type="button" data-act="set-clear" data-i="${i}">세팅 지우기</button>` : ''}
      <button class="btn ghost" type="button" data-act="set-cancel">닫기</button>
    </div>
  </form>`;
}

/** 입력 폼 → 세팅 값 */
export function readEditor(form) {
  const f = form.elements;
  return {
    set: {
      lv: +f.lv.value, mv: [0, 1, 2, 3].map(k => f[`mv${k}`].value).filter(Boolean),
      it: f.it.disabled ? null : f.it.value || null, na: f.na.value || null,
      iv: [0, 1, 2, 3, 4, 5].map(k => f[`iv${k}`].checked),
    },
    ability: f.ab.disabled ? null : f.ab.value || null,
  };
}

/** 세팅을 입력 폼에 채우기 (저장은 사용자가) */
export function fillEditor(form, best) {
  const f = form.elements;
  const put = (name, value) => {
    const box = form.querySelector(`.ss input[name="${name}"]`)?.closest('.ss');
    if (box) setSearchValue(box, value);
  };
  [0, 1, 2, 3].forEach(k => put(`mv${k}`, best.mv[k] || ''));
  if (!f.it.disabled) put('it', best.it || '');
  if (!f.ab.disabled && best.ab) f.ab.value = best.ab;
  put('na', best.na || '');
  [0, 1, 2, 3, 4, 5].forEach(k => { f[`iv${k}`].checked = !!best.iv[k]; });
}

/** 멤버 카드에서 지금 고른 목표 세팅 (입력 폼 "채우기" 용) */
export function selectedTarget(i, m, pm) {
  const b = getBuilder(), r = analyzeMember(m, pm);
  if (!b || !r) return null;
  const opts = targetOptions(b, pm, r);
  return opts.find(o => o.key === picked.get(i)) || opts[0];
}

/**
 * 멤버 카드 (게임 모드): 계산한 최선 세팅 + (입력했으면) 내 세팅과 할 일 + 참고 추천 세팅
 * recommended: 기존 추천 세팅 카드 HTML (Smogon·랜덤배틀)
 */
export function buildCard(i, m, pm, { editing = false, recommended = '' } = {}) {
  const head = `<header>${sprite(pm.mon)}<span>${esc(pm.mon.ko)}</span>
    ${pm.mon.id !== pm.base.id ? `<span class="note">${esc(pm.base.ko)} →</span>` : ''}
    <button class="btn sm ${m.set ? 'ghost' : ''} build-edit" type="button" data-act="set-edit" data-i="${i}">${m.set ? '내 세팅 수정' : '내 세팅 입력'}</button></header>`;
  if (!store.moves) return `<div class="set-card build-card">${head}<p class="note">기술 데이터 불러오는 중…</p></div>`;
  const r = analyzeMember(m, pm);
  const b = getBuilder();
  if (!r || !b) return `<div class="set-card build-card">${head}${recommended}</div>`;
  const mine = m.set && !editing ? `
    <div class="build-block mine">
      <div class="set-src"><b>내 세팅</b><span>입력한 그대로 · 이 맵 상대 후보 기준</span></div>
      ${setLines(r.cur, r.cur.ab)}${metrics(r.now, r.cur)}
    </div>` : '';
  // 목표 세팅 고르기: 계산한 최선 ↔ 참고 추천 세팅 (버튼으로 바꿈)
  const opts = targetOptions(b, pm, r);
  const sel = opts.find(o => o.key === picked.get(i)) || opts[0];
  const ev = sel.top || b.evaluate(pm.mon, sel.set);
  const desc = describeSet(pm.mon, sel.ref || sel.set, { double: store.game.battle === 'double' || sel.key === 'D' });
  const lost = [...sel.dropped.map(s => store.moves.bySlug.get(s)?.ko || store.sets?.moves[s]?.[0] || s), sel.itemMissing && itemName(sel.itemMissing)].filter(Boolean);
  const tabs = opts.length > 1 ? `<div class="set-tabs" role="tablist" aria-label="세팅 고르기">${opts.map(o => `
      <button type="button" role="tab" class="set-tab ${o === sel ? 'on' : ''}" aria-selected="${o === sel}" data-pick-set="${i}:${o.key}">${esc(o.chip)}</button>`).join('')}</div>` : '';
  const target = m.set && !editing ? todoHtml({
    title: sel.key === 'best' ? '최선 세팅' : sel.title,
    steps: sel.key === 'best' ? r.steps : b.plan(pm.mon, r.cur, sel.set), now: r.now, top: ev,
  }) : '';
  return `<div class="set-card build-card">
    ${head}
    ${editing ? editorHtml(i, m, pm) : ''}
    ${mine}
    ${tabs}
    <div class="build-block best">
      <div class="set-src"><b>${esc(sel.title)}</b><span>${esc(sel.src)}</span></div>
      <p class="set-why"><b>${esc(desc.role)}</b> ${esc(desc.line)}<span class="faint"> · 이 맵 상대에게 화력 ${Math.round(ev.offense)}% · 선공 ${Math.round(ev.speed * 100)}%</span></p>
      ${setLines(sel.set, sel.set.ab)}${metrics(ev, sel.set)}
      ${lost.length ? `<p class="note na-note">이 게임에서 못 배우거나 못 구하는 ${esc(lost.join(', '))}는 빼고 계산했어요.</p>` : ''}
    </div>
    ${target}
  </div>`;
}
