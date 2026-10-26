// 추천 세팅 표시 (실전 통계에 없는 포켓몬용): Smogon 분석가 세팅 → 랜덤배틀 역할 세팅 → 자체 생성
// 「포켓몬 파티!」 모드에서는 게임에서 못 구하는 도구 · 못 배우는 기술을 표시하고 기믹 룰에 맞춰 보여준다.
import { esc } from './dom.js';
import { sprite, typeBadge, moveLabel, itemLabel, natureText, spreadText } from './components.js';

// 세팅 우선순위 (B 배틀스타디움 싱글 · S Smogon 싱글 · D 더블 · R 랜덤배틀 · A 자체 생성)
const ORDER = {
  'champions-singles': ['B', 'S', 'R', 'A', 'D'],
  'champions-doubles': ['D', 'B', 'S', 'R', 'A'],
  'game-single': ['S', 'B', 'R', 'A', 'D'],
  'game-double': ['D', 'S', 'B', 'R', 'A'],
};
const DEFAULT_ORDER = ['S', 'B', 'R', 'A', 'D'];

/** 해당 포켓몬의 추천 세팅 목록. order: 데이터 기준 키 (예: 'champions-singles', 'game-double') */
export function orderedSets(setsData, id, order) {
  const slot = setsData?.sets[id];
  if (!slot) return [];
  return (ORDER[order] || DEFAULT_ORDER).filter(k => slot[k]).map(k => ({ key: k, ...slot[k] }));
}

const isChampions = mode => String(mode).startsWith('champions');

/** 게임 룰에서 손에 넣을 수 있는 지닌 도구 */
export function gameItemSet(data, rule) {
  const uses = rule?.uses || [];
  const it = data.items;
  return new Set([...it.battle, ...it.berry, ...it.signature,
    ...(uses.includes('mega') ? it.mega : []), ...(uses.includes('z') ? it.z : []),
    ...(uses.includes('tera') ? it.tera : []), ...(uses.includes('dynamax') ? it.dynamax : [])]);
}

/**
 * 세팅 한 개 카드.
 * opts.mode   : 데이터 기준 (챔피언스면 테라 숨김·노력치 안내)
 * opts.game   : { data, rule } 「포켓몬 파티!」 모드일 때
 * opts.header : 포켓몬 이름 머리줄 포함 여부, opts.extra: 카드 끝에 덧붙일 HTML
 * opts.tabs   : 다른 세팅으로 바꾸는 버튼 줄 HTML, opts.desc: { role, line } 한 줄 설명 (ui/setdesc.js)
 * opts.subs   : 게임에서 못 쓰는 기술·도구 대신 쓸 것 { moves: Map(원래 → {slug, ko, type, cat}), item: [원래, {slug, ko}] }
 */
export function setCard(engine, setsData, mon, set, { mode, game = null, header = true, extra = '', tabs = '', desc = null, subs = null } = {}) {
  const line = (label, vals) => (vals ? `<div class="set-line"><span>${label}</span><span class="vals">${vals}</span></div>` : '');
  const illegal = new Set(game?.data.illegal[mon.id] || []);
  const allowed = game ? gameItemSet(game.data, game.rule) : null;
  const itemName = slug => (game?.data.itemNames[slug] ? esc(game.data.itemNames[slug][0]) : itemLabel(setsData, slug));
  const na = (html, title) => `<span class="na" title="${esc(title)}">${html}</span>`;
  const CLS = ['변화', '물리', '특수'];
  const subMove = s => `<span class="sub-arrow">→</span><span class="is-sub"><span class="dot t-${s.type}" title="${esc(engine.typeKo(s.type))}"></span>${esc(s.ko)}<span class="cls">${CLS[s.cat]}</span><span class="sub-mark">대체</span></span>`;

  const moves = set.mv.map(m => `<span>${(Array.isArray(m) ? m : [m]).map(x => {
    const label = moveLabel(engine, setsData, x);
    if (!illegal.has(x)) return label;
    const s = subs?.moves.get(x);
    return na(label, '이 게임에서는 배울 수 없는 기술') + (s ? subMove(s) : '');
  }).join(' <em>/</em> ')}</span>`).join('');
  const abilities = (set.ab.length ? set.ab : mon.ab.slice(0, 1)).map(a => esc(engine.abilityKo(a))).join(' <em>/</em> ');
  const items = set.it.map(i => {
    if (!allowed || allowed.has(i)) return itemName(i);
    const s = subs?.item?.[0] === i ? subs.item[1] : null;
    return na(itemName(i), '게임 상점·아이템 칸에서 구할 수 없는 도구') + (s ? `<span class="sub-arrow">→</span><span class="is-sub">${esc(s.ko)}<span class="sub-mark">대체</span></span>` : '');
  }).join(' <em>/</em> ');
  const natures = set.na.filter(Boolean).map(n => natureText(setsData, n)).join(' <em>/</em> ');
  const evs = set.ev ? ` <span class="faint">${spreadText(set.ev)}</span>` : '';
  const uses = game?.rule?.uses || [];
  // 테라: 챔피언스에는 없음, 게임에서는 테라스탈을 쓰는 룰일 때만
  const showTera = !isChampions(mode) && (!game || uses.includes('tera'));
  const tera = showTera && set.te?.length ? set.te.map(t => typeBadge(engine, t, 'sm')).join('') : '';
  // 메가진화: 게임 룰이 메가를 쓰고 이 포켓몬의 메가스톤이 기믹 상점에 있을 때
  const megas = game && uses.includes('mega') ? game.data.megas[mon.id] || [] : [];
  const megaLine = megas.map(([mid, stone]) => `<span>${esc(engine.byId.get(mid)?.ko || '')} <em>${itemName(stone)}</em></span>`).join('');
  const hasNa = illegal.size && set.mv.flat().some(x => illegal.has(x)) || (allowed && set.it.some(i => !allowed.has(i)));

  return `<div class="set-card">
    ${header ? `<header>${sprite(mon)}<span>${esc(mon.ko)}</span><span class="pill-soft">추천 세팅</span></header>` : ''}
    ${tabs}
    <div class="set-src"><b>${esc(set.n)}</b><span>${esc(set.src)}</span></div>
    ${desc ? `<p class="set-why"><b>${esc(desc.role)}</b> ${esc(desc.line)}</p>` : ''}
    ${line('특성', abilities)}
    ${line('도구', items)}
    ${line(set.pool ? '기술 후보' : '기술', moves)}
    ${line('성격', natures + evs)}
    ${line('테라', tera)}
    ${line('메가진화', megaLine)}
    ${set.pool ? '<p class="note">기술 후보 중 4개를 골라 쓰는 역할별 세팅이에요.</p>' : ''}
    ${hasNa ? `<p class="note na-note">취소선 항목은 「포켓몬 파티!」에서 구할 수 없거나 배울 수 없어요. ${subs ? '옆의 <b>대체</b>는 같은 역할로 이 게임에서 쓸 수 있는 기술·도구예요.' : '비슷한 도구·기술로 바꿔 쓰세요.'}</p>` : ''}
    ${isChampions(mode) && set.ev ? '<p class="note">노력치는 SV 기준이에요 (챔피언스는 능력 포인트 체계).</p>' : ''}
    ${extra}
  </div>`;
}
