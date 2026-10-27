// 내 세팅 입력 · 게임 최선 세팅 · 참고 세팅 고르기 · 목표까지 할 일 (파티 추천 화면의 멤버 카드, 「포켓몬 파티!」 모드)
import { store, getBuilder, gameRule, allowedItems, usableItems, itemMode, itemOkFor, setsOrder } from '../state.js';
import { esc, josa } from './dom.js';
import { sprite } from './components.js';
import { NATURES, TYPE_ITEMS, MODELED_ITEMS } from '../core/build.js';
import { STAT_LABELS } from '../core/engine.js';
import { itemName, itemSource, itemPartyWarning } from './reasons.js';
import { orderedSets, relearnMark, relearnToggle, itemModeControl, itemModeWhy } from './sets.js';
import { describeSet, refSource, setNameKo, moveGroup } from './setdesc.js';
import { searchSelect, defineOptions, setSearchValue } from './searchselect.js';

const CLS = ['변화', '물리', '특수'];
const NO_IV = [false, false, false, false, false, false];
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
/** 기술 칩. sub: 대신하는 원래 기술 이름이 있으면 "대체" 표시, re: 기술 떠올리기 전용 기술 Set 이면 「떠올리기」 표시 */
const moveChip = (slug, sub = null, re = null) => {
  const mv = store.moves?.bySlug.get(slug);
  const mark = (sub ? `<span class="sub-mark" title="못 배우는 ${esc(sub)} 대신">대체</span>` : '') + (re?.has(slug) ? relearnMark() : '');
  return mv ? `<span${sub ? ' class="is-sub"' : ''}><span class="dot t-${mv.type}" title="${esc(store.engine.typeKo(mv.type))}"></span>${esc(mv.ko)}<span class="cls">${CLS[mv.cat]}</span>${mark}</span>` : `<span>${esc(slug)}</span>`;
};
const moveKo = slug => store.moves?.bySlug.get(slug)?.ko || store.sets?.moves[slug]?.[0] || slug;
export const natureLabel = slug => {
  const n = NATURES[slug];
  if (!n) return '—';
  return n[1] === n[2] ? `${n[0]} <em>무보정</em>` : `${n[0]} <em>+${STAT_LABELS[n[1]]} −${STAT_LABELS[n[2]]}</em>`;
};
const ivText = iv => {
  const top = STAT_LABELS.filter((_, k) => iv[k]);
  return top.length === 6 ? '전부 31' : top.length ? `${top.join('·')} 31 <em>나머지 20</em>` : '전부 20 <em>기본</em>';
};

/**
 * 세팅 한 덩어리 (기술·도구·특성·성격·개체값).
 * rows: 추천 세팅의 원래 기술 순서 [{ orig, use }] → 못 배우는 기술은 "원래(취소선) → 대체", itemSub: [원래 도구, 대체 도구]
 * re: { only: 기술 떠올리기 전용 기술 Set, on } → 「떠올리기」 표시 + ON/OFF 버튼 · 도구 기준 버튼 (목표 세팅에만)
 * alt: 목표 도구를 못 구했을 때 대신 지닐 도구 [{ it, diff }] (builder.itemAlternatives)
 */
function setLines(set, ab, { rows = null, itemSub = null, re = null, alt = null } = {}) {
  const struck = (text, why) => `<span class="na" title="${why}">${esc(text)}</span>`;
  const only = re?.only || null;
  const why = slug => (only?.has(slug) && !re.on ? '기술 떠올리기로만 배우는 기술 (기술 떠올리기 꺼 둠)' : '이 게임에서 못 배우는 기술');
  const moves = (rows
    ? rows.map(r => (r.use === r.orig ? moveChip(r.use, null, only)
      : `<span class="sub-pair">${struck(moveKo(r.orig), why(r.orig))}<span class="sub-arrow">→</span>${r.use ? moveChip(r.use, moveKo(r.orig), only) : '<span class="faint">대체 없음</span>'}</span>`)).join('')
    : set.mv.length ? set.mv.map(s => moveChip(s, null, only)).join('') : '<span class="faint">입력 안 함</span>')
    + (re ? relearnToggle(re.on) : '');
  // 대체 도구: 이 게임에서 못 구하는 도구 · 도구 기준(구애 빼기 · 도구 없이)으로 뺀 도구 → 대신 지닐 도구 (도구 없이면 없음)
  const itemWhy = slug => ((allowedItems() || new Set()).has(slug) ? itemModeWhy(itemMode()) : '이 게임에서 못 구하는 도구');
  const item = itemSub && itemSub[1] === (set.it || null)
    ? `<span class="sub-pair">${struck(itemName(itemSub[0]), itemWhy(itemSub[0]))}<span class="sub-arrow">→</span>${set.it
      ? `<span class="is-sub">${esc(itemName(set.it))}<span class="sub-mark">대체</span></span>` : '<span class="faint">도구 없이</span>'}</span>`
    : set.it ? esc(itemName(set.it)) : '<span class="faint">없음</span>';
  // 얻는 곳·가격, 같은 이름의 파티 아이템이 있으면 주의
  const src = set.it ? itemSource(set.it) : null;
  const warn = set.it ? itemPartyWarning(set.it) : null;
  const itemExtra = (src ? `<em>${esc(src.text)}</em>` : '') + (warn ? `<span class="item-warn" title="${esc(warn)}">⚠ 같은 이름 파티 아이템 주의</span>` : '');
  return line('기술', moves)
    + line('도구', item + itemExtra + (re ? itemModeControl(itemMode()) : ''))
    + (alt?.length ? `<p class="note item-alt"><b>못 구하면</b> ${alt.map(a => `${a.it ? esc(itemName(a.it)) : '도구 없이'} <span class="faint">${a.diff >= 0 ? '+' : '−'}${Math.abs(a.diff).toFixed(1)}</span>`).join(' · ')}</p>` : '')
    + (warn ? `<p class="note item-warn-note">${esc(warn)}</p>` : '')
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
    case 'iv': return `<span class="todo-where">선택</span>개체값 31로 올릴 수 있으면: <b>${s.stats.map(k => STAT_LABELS[k]).join(' → ')}</b> <em>(트레이닝 칸 1회에 하나 · 금색병뚜껑이면 한 번에)</em>`;
    case 'it': return `<span class="todo-where">아이템·상점</span>${s.to ? `<b>${esc(itemName(s.to))}</b> 지니게 하기` : '도구 빼기'}`;
    default: return '';
  }
}

/** 목표 세팅까지 할 일. t: { title, steps, now, top } */
function todoHtml(t) {
  if (!t.steps.length) return `<p class="build-done">✔ 지금 세팅이 ${esc(t.title)}과 같아요.</p>`;
  const skill = t.steps.filter(s => s.kind === 'move').length;
  const train = t.steps.filter(s => s.kind === 'na' || s.kind === 'ab').length;
  const ivOnly = t.steps.every(s => s.optional);
  const diff = Math.round(t.top.score - t.now.score);
  return `<div class="build-todo">
    <h4>${esc(t.title)}까지 할 일 <span class="note">이득이 큰 순서 · 점수 ${diff >= 0 ? '+' : ''}${diff}</span></h4>
    <ol>${t.steps.map(s => `<li>${stepText(s)}<span class="gain">+${s.gain.toFixed(1)}</span></li>`).join('')}</ol>
    <p class="note">${ivOnly ? '세팅은 목표와 같아요. 개체값은 올릴 수 있을 때만' : `${[skill && `기술 칸 ${skill}번`, train && `트레이닝 칸 ${train}번`].filter(Boolean).join(' · ') || '도구만 바꾸면'} 돼요 (개체값은 기본 20 기준, 올리기는 선택)`}.
      성격·특성·개체값은 마지막 상점의 민트·특성패치·금색병뚜껑으로도 바꿀 수 있어요.</p>
  </div>`;
}

// 도구 묶음 (대체 도구 찾기용): 화력 · 스피드 · 내구 · 그 밖
const POWER_ITEMS = new Set([...Object.keys(TYPE_ITEMS), 'choice-band', 'choice-specs', 'life-orb', 'expert-belt', 'muscle-band',
  'wise-glasses', 'loaded-dice', 'punching-glove', 'booster-energy', 'weakness-policy', 'light-ball', 'thick-club']);
const SPEED_ITEMS = new Set(['choice-scarf', 'quick-claw']);
const BULK_ITEMS = new Set(['leftovers', 'black-sludge', 'sitrus-berry', 'assault-vest', 'rocky-helmet', 'eviolite', 'heavy-duty-boots',
  'focus-sash', 'covert-cloak', 'shell-bell', 'big-root', 'protective-pads']);
const itemClass = it => (POWER_ITEMS.has(it) ? 'power' : SPEED_ITEMS.has(it) ? 'speed' : BULK_ITEMS.has(it) ? 'bulk' : 'other');

/** 기술 정보 (이 게임 기술 표에 없으면 추천 세팅 사전) */
const refMove = slug => {
  const g = store.moves.bySlug.get(slug);
  if (g) return g;
  const s = store.sets?.moves[slug];
  return s ? { slug, ko: s[0], type: s[2], cat: s[3], power: 0 } : { slug, ko: slug, type: null, cat: 0, power: 0 };
};

/**
 * 못 배우는 기술 대신 쓸 기술: 같은 역할의 변화기(랭크업·회복·설치·상태이상·교체…) →
 * 같은 타입·같은 분류 공격기 → 같은 타입 공격기 → 같은 분류 공격기 순으로 찾고, 그중 세팅 점수가 가장 높은 것.
 */
function substituteMove(b, pm, set, orig, learnList) {
  const info = refMove(orig);
  // 잠재파워는 이 게임에선 개체값으로 타입이 정해져서(데이터상 노말) 대체로 쓰지 않음
  const cands = learnList.filter(m => !set.mv.includes(m.slug) && m.slug !== 'hidden-power');
  const group = moveGroup(orig);
  const tiers = [
    group ? cands.filter(m => moveGroup(m.slug) === group) : [],
    info.cat > 0 ? cands.filter(m => m.type === info.type && m.cat === info.cat && m.power > 0) : [],
    info.cat > 0 ? cands.filter(m => m.type === info.type && m.cat > 0 && m.power > 0) : [],
    info.cat > 0 ? cands.filter(m => m.cat === info.cat && m.power > 0) : [],
  ];
  const pool = tiers.find(t => t.length) || [];
  let best = null;
  for (const m of pool) {
    const v = b.evaluate(pm.mon, { ...set, mv: [...set.mv, m.slug] }).score;
    if (!best || v > best.v) best = { v, slug: m.slug };
  }
  return best?.slug || null;
}

/**
 * 못 구하는 도구 대신 쓸 도구: 같은 묶음(화력·스피드·내구) 중 세팅 점수가 가장 높은 것.
 * 메가스톤·Z크리스탈처럼 룰에 따라 못 쓰는 도구는 화력·스피드·내구 도구 전체에서 고른다.
 */
function substituteItem(b, pm, set, orig, allowedAll) {
  const cls = itemClass(orig);
  const allowed = [...allowedAll].filter(i => itemOkFor(pm.mon, i));
  const general = i => MODELED_ITEMS.has(i) && itemClass(i) !== 'other';
  let pool = cls === 'other' ? [...allowed].filter(general) : [...allowed].filter(i => itemClass(i) === cls && MODELED_ITEMS.has(i));
  if (!pool.length) pool = [...allowed].filter(general);
  let best = null;
  for (const it of pool) {
    const v = b.evaluate(pm.mon, { ...set, it }).score;
    if (!best || v > best.v) best = { v, it };
  }
  return best?.it || null;
}

/**
 * 추천 세팅(Smogon·랜덤배틀) → 이 게임에서 쓸 수 있는 세팅. 못 배우는 기술·못 구하는 도구는 대체 기술·도구로 바꾸고,
 * 기술 후보 중에서 고르는 역할 세팅(pool)은 점수가 가장 높은 4개 조합.
 * @returns { set, rows: [{ orig, use }] (원래 순서, use 가 orig 와 다르면 대체 · null 이면 뺌),
 *            subs: [[원래 기술, 대체 기술]], dropped: [대체도 없는 기술], itemSub: [원래 도구, 대체 도구] | null, itemMissing }
 */
// iv: 개체값 (최선 세팅과 같게 지금 개체값 · 기본 20 기준, 31 을 가정하지 않음)
function toGameSet(b, pm, ref, iv = NO_IV) {
  const learnList = b.learnable(pm.mon);
  const learn = new Set(learnList.map(m => m.slug));
  const slots = (ref.mv || []).map(s => (Array.isArray(s) ? s : [s]));
  const dropped = [];
  const rows = [];
  let mv = [];
  if (ref.pool) {
    const cands = [...new Set(slots.flat())].filter(s => learn.has(s));
    // 후보에서 4개를 고르는 세팅: 고를 후보가 4개보다 적을 때만 못 배우는 기술을 대체
    if (cands.length < 4) dropped.push(...[...new Set(slots.flat())].filter(s => !learn.has(s)).slice(0, 4 - cands.length));
    mv = cands.slice(0, 4);
    if (cands.length > 4) {
      let best = -Infinity;
      const pick = (start, chosen) => {
        if (chosen.length === 4) {
          const v = b.evaluate(pm.mon, { lv: store.gameData.finalLevel, mv: chosen, iv, ab: pm.ability, na: 'hardy' }).score;
          if (v > best) { best = v; mv = chosen.slice(); }
          return;
        }
        for (let k = start; k < cands.length; k++) pick(k + 1, [...chosen, cands[k]]);
      };
      pick(0, []);
    }
    rows.push(...mv.map(s => ({ orig: s, use: s })), ...dropped.map(s => ({ orig: s, use: null })));
  } else {
    for (const opts of slots) {
      const ok = opts.find(s => learn.has(s) && !mv.includes(s));
      if (ok) mv.push(ok); else dropped.push(opts[0]);
      rows.push({ orig: ok || opts[0], use: ok || null });
    }
  }
  const usable = usableItems() || new Set();
  const allowed = { has: x => usable.has(x) && itemOkFor(pm.mon, x) };
  const items = (Array.isArray(ref.it) ? ref.it : [ref.it]).filter(Boolean);
  const abilities = store.engine.abilitiesOf(pm.mon);
  const set = {
    lv: store.gameData.finalLevel, mv: mv.slice(0, 4), iv,
    it: pm.stone || items.find(x => allowed.has(x)) || null,
    ab: (ref.ab || []).find(a => abilities.includes(a)) || pm.ability,
    na: (ref.na || []).find(n => NATURES[n]) || 'hardy',
  };
  // 못 구하는 도구 → 대체 도구 (기술보다 먼저: 도구에 따라 좋은 기술이 달라짐)
  const itemMissing = !pm.stone && items.length && !items.some(x => allowed.has(x)) ? items[0] : null;
  let itemSub = null;
  if (itemMissing) {
    // 도구 없이 보기: 대체 없이 빼고 "도구 없이"로 표시
    const sub = itemMode() === 'none' && (allowedItems() || new Set()).has(itemMissing) ? null : substituteItem(b, pm, set, itemMissing, usable);
    if (sub || itemMode() === 'none') { set.it = sub; itemSub = [itemMissing, sub]; }
  }
  // 못 배우는 기술 → 대체 기술 (빈 자리만큼). 기술 순서는 원래 세팅 순서대로
  const subs = [], left = [];
  for (const orig of dropped) {
    const sub = set.mv.length < 4 ? substituteMove(b, pm, set, orig, learnList) : null;
    if (sub) { set.mv = [...set.mv, sub]; subs.push([orig, sub]); } else left.push(orig);
    const row = rows.find(r => r.orig === orig && r.use === null);
    if (row && sub) row.use = sub;
  }
  set.mv = rows.filter(r => r.use).map(r => r.use).slice(0, 4);
  return { set, rows, subs, dropped: left, itemSub, itemMissing: itemSub ? null : itemMissing };
}

/**
 * 추천 세팅 카드(상대 약점 찾기/포켓몬 검색)용: 못 배우는 기술 → 대신 쓸 기술, 못 구하는 도구 → 대신 쓸 도구.
 * @returns { moves: Map(원래 기술 → 대체 기술), item: [원래 도구, 대체 도구] | null } (기술 데이터가 없으면 null)
 */
export function substitutesFor(mon, ref) {
  const b = getBuilder();
  if (!b) return null;
  let map = results.get(b);
  if (!map) results.set(b, (map = new Map()));
  const key = `subs|${mon.id}|${ref.key}`;
  if (!map.has(key)) {
    const pm = { mon, base: mon, ability: store.engine.defaultAbility(mon), stone: null };
    const g = toGameSet(b, pm, ref);
    const info = slug => { const m = store.moves.bySlug.get(slug); return { slug, ko: m.ko, type: m.type, cat: m.cat }; };
    map.set(key, {
      moves: new Map(g.subs.map(([orig, sub]) => [orig, info(sub)])),
      item: g.itemSub ? [g.itemSub[0], { slug: g.itemSub[1], ko: g.itemSub[1] ? itemName(g.itemSub[1]) : '도구 없이' }] : null,
    });
  }
  return map.get(key);
}

/** 고를 수 있는 목표 세팅: 계산한 최선 + 참고 추천 세팅들 (멤버 모습·특성이 같으면 다시 계산하지 않음) */
function targetOptions(b, pm, r) {
  let map = results.get(b);
  if (!map) results.set(b, (map = new Map()));
  const key = `opts|${pm.mon.id}|${pm.stone || ''}|${pm.ability}|${!!store.sets}|${setsOrder()}|${JSON.stringify(r.cur.iv)}`;
  if (!map.has(key)) {
    const refs = [];
    for (const ref of store.sets ? orderedSets(store.sets, pm.mon.id, setsOrder()) : []) {
      const g = toGameSet(b, pm, ref, r.cur.iv);
      // 설명은 이 게임에서 실제로 쓰는 기술·도구(대체 포함)로, 노력치·성격은 원래 세팅 그대로
      const used = { ...ref, mv: g.set.mv, it: [g.set.it].filter(Boolean) };
      const { role } = describeSet(pm.mon, used, { double: store.game.battle === 'double' || ref.key === 'D' });
      refs.push({ key: ref.key, chip: `${refSource(ref)} · ${role}`, title: `${role} 세팅`, src: `${ref.src} · ${setNameKo(ref.n)}`, ref: used, ...g, top: b.evaluate(pm.mon, g.set) });
    }
    map.set(key, refs);
  }
  return [{ key: 'best', chip: '최선 (계산)', title: '이 게임 최선 세팅', src: '배울 수 있는 기술·구할 수 있는 도구 중 계산', set: r.best, top: r.top, dropped: [] }, ...map.get(key)];
}

/** 목표 도구를 못 구했을 때 대신 지닐 도구 (같은 세팅이면 다시 계산하지 않음) */
export function itemAlts(b, pm, set) {
  if (!set.it) return [];
  let map = results.get(b);
  if (!map) results.set(b, (map = new Map()));
  const key = `alt|${pm.mon.id}|${JSON.stringify(set)}`;
  if (!map.has(key)) map.set(key, b.itemAlternatives(pm.mon, set));
  return map.get(key);
}

/** 입력 폼 */
function editorHtml(i, m, pm) {
  const { engine } = store;
  const b = getBuilder();
  const set = currentSet(m, pm);
  const learn = b.learnable(pm.mon, set, { all: true });
  const reOnly = b.relearnOnly(pm.mon);
  const byType = new Map();
  for (const mv of [...learn].sort((x, y) => (y.cat > 0) - (x.cat > 0) || y.power - x.power || x.ko.localeCompare(y.ko, 'ko'))) {
    const key = mv.cat ? mv.type : 'status';
    (byType.get(key) || byType.set(key, []).get(key)).push(mv);
  }
  // 검색 목록: 기술(공격기 위력순 → 변화기) · 도구(이 룰에서 구할 수 있는 것) · 성격
  const moveList = `mv:${pm.mon.id}`;
  defineOptions(moveList, [...byType].sort((a, b2) => (a[0] === 'status') - (b2[0] === 'status')).flatMap(([, list]) => list).map(mv => ({
    value: mv.slug, label: mv.ko,
    sub: `${engine.typeKo(mv.type)} · ${CLS[mv.cat]}${mv.cat ? ` ${mv.power || '—'}` : ''}${mv.acc && mv.acc < 100 ? ` · 명중 ${mv.acc}` : ''}${reOnly.has(mv.slug) ? ' · 떠올리기' : ''}`,
    keys: `${engine.typeKo(mv.type)} ${CLS[mv.cat]} ${mv.slug}${reOnly.has(mv.slug) ? ' 떠올리기' : ''}`,
  })));
  const moveSelect = k => `<label>기술 ${k + 1}${searchSelect({ name: `mv${k}`, list: moveList, value: set.mv[k] || '', placeholder: '기술 이름·초성·타입', label: `기술 ${k + 1}` })}</label>`;
  const allowed = allowedItems() || new Set();
  const it = store.gameData.items, uses = gameRule()?.uses || [];
  const itemGroups = [['배틀 도구', it.battle], ['열매', it.berry], ['전용 도구', it.signature],
    ...(uses.includes('mega') ? [['메가스톤', it.mega]] : []), ...(uses.includes('z') ? [['Z크리스탈', it.z]] : [])];
  const itemList = `it:${gameRule()?.key}`;
  defineOptions(itemList, [{ value: '', label: '없음', sub: '도구 없음' },
    ...itemGroups.flatMap(([group, list]) => list.filter(x => allowed.has(x)).map(x => ({
      value: x, label: itemName(x), keys: `${group} ${x}`,
      sub: `${group} · ${(itemSource(x)?.price || 0).toLocaleString()}원${itemPartyWarning(x) ? ' · ⚠ 같은 이름 파티 아이템 있음' : ''}`,
    })))]);
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
    <p class="note">기술 목록은 이 게임에서 ${esc(josa(pm.mon.ko, '이가'))} 배울 수 있는 기술 전부예요 (「떠올리기」는 레벨업이 아니라 기술 칸·학습장치의 기술 떠올리기로 배우는 교배·가르침·기술머신 기술).</p>
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

/** 참고 세팅마다 대체한 기술·도구 한눈에 (못 배움·못 구함 → 대체). 줄을 누르면 그 세팅으로 */
function subSummary(i, list, re = null) {
  const pair = (from, to, mark = '') => `<span class="sub-pair"><span class="na">${esc(from)}</span><span class="sub-arrow">→</span><b>${esc(to)}</b>${mark}</span>`;
  return `<div class="sub-summary">
    <p class="note"><b>참고 세팅 대체 추천</b> 이 게임에서 못 배우는 기술·못 구하는 도구 대신 쓸 것 (누르면 그 세팅으로)</p>
    ${list.map(o => `<button type="button" class="sub-row" data-pick-set="${i}:${o.key}">
      <span class="sub-src">${esc(o.chip)}</span>
      ${[...o.subs.map(([from, to]) => pair(moveKo(from), moveKo(to), re?.has(to) ? relearnMark() : '')), o.itemSub && pair(itemName(o.itemSub[0]), o.itemSub[1] ? itemName(o.itemSub[1]) : '도구 없이')].filter(Boolean).join('')}
    </button>`).join('')}
  </div>`;
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
  // 대체한 것 · 대체도 못 찾아 뺀 것 (버튼에도 "대체 N" 으로 표시해 참고 세팅에 대체가 있는 걸 바로 알 수 있게)
  const subCount = o => (o.subs?.length || 0) + (o.itemSub ? 1 : 0);
  const swapped = subCount(sel);
  const lost = [...sel.dropped.map(moveKo), sel.itemMissing && itemName(sel.itemMissing)].filter(Boolean);
  const anySubs = opts.some(o => subCount(o));
  // 기술 떠올리기(교배·가르침·기술머신) 전용 기술 (내 세팅에 이미 있는 기술은 배운 것이라 빼고)
  const reOnly = new Set([...b.relearnOnly(pm.mon)].filter(x => !r.cur.mv.includes(x)));
  const reUsed = sel.set.mv.some(x => reOnly.has(x));
  const tabs = opts.length > 1 ? `<div class="set-tabs" role="tablist" aria-label="세팅 고르기">${opts.map(o => `
      <button type="button" role="tab" class="set-tab ${o === sel ? 'on' : ''}" aria-selected="${o === sel}" data-pick-set="${i}:${o.key}">${esc(o.chip)}${subCount(o) ? `<span class="tab-sub">대체 ${subCount(o)}</span>` : ''}</button>`).join('')}</div>
    ${sel.key === 'best' && anySubs ? subSummary(i, opts.filter(o => subCount(o)), reOnly) : ''}` : '';
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
      ${setLines(sel.set, sel.set.ab, { rows: sel.rows, itemSub: sel.itemSub, re: { only: reOnly, on: b.relearn }, alt: pm.stone ? null : itemAlts(b, pm, sel.set) })}${metrics(ev, sel.set)}
      ${reUsed ? '<p class="note re-note"><b>떠올리기</b> 레벨업으로는 못 배우고 기술 칸·학습장치의 「기술 떠올리기」로 배우는 기술(교배·가르침·기술머신)이에요. 기술 떠올리기를 끄면 레벨업 기술만으로 추천해요.</p>' : ''}
      ${swapped ? `<p class="note sub-note"><b>대체 추천</b> 취소선은 이 게임에서 못 배우거나 못 구하는 것${itemMode() !== 'all' ? '(추천 도구 기준으로 뺀 도구 포함)' : ''}, 화살표 뒤가 같은 역할로 대신 쓸 기술·도구예요 (점수도 대체한 세팅 기준).</p>` : ''}
      ${lost.length ? `<p class="note na-note">대신할 것도 없어서 뺀 것: ${esc(lost.join(', '))}</p>` : ''}
    </div>
    ${target}
  </div>`;
}
