// 추천 세팅 표시 (실전 통계에 없는 포켓몬용): Smogon 분석가 세팅 → 랜덤배틀 역할 세팅 → 자체 생성
// 「포켓몬 파티!」 모드에서는 게임에서 못 구하는 도구 · 못 배우는 기술을 표시하고 기믹 룰에 맞춰 보여준다.
import { esc, josa } from './dom.js';
import { sprite, typeBadge, moveLabel, itemLabel, natureText, spreadText } from './components.js';
import { ITEM_MODES } from '../core/build.js';

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

// 기술 얻는 방법 표시: 레벨업(놓쳐도 「내 포켓몬 확인 → 기술 떠올리기」로 다시 배움) · Lv.N(아직) · 기술 칸(기술머신·가르침·교배)
export function learnMark(k) {
  if (!k) return '';
  if (k.kind === 'level') return `<span class="lm lm-level" title="레벨업 기술 (Lv.${k.lv}) · 놓치거나 잊어도 「내 포켓몬 확인 → 기술 떠올리기」로 다시 배워요">레벨업</span>`;
  if (k.kind === 'later') return `<span class="lm lm-later" title="Lv.${k.lv}에 레벨업으로 배워요 (그 전엔 기술 칸·학습장치로)">Lv.${k.lv}</span>`;
  return `<span class="lm lm-tech" title="레벨업으로는 못 배워요 · 기술 칸·학습장치·기술머신·가르침으로 배워요">기술 칸</span>`;
}
/** 떠올리기 대체: 기술 칸 기술을 못 구했을 때 기술 떠올리기로 대신 배울 레벨업 기술 */
export const relearnSubChip = mv => `<span class="re-sub" title="이 기술을 못 구하면 「내 포켓몬 확인 → 기술 떠올리기」로 대신 배울 레벨업 기술"><span class="sub-arrow">↳</span>떠올리기 <b>${esc(mv.ko)}</b></span>`;
/** 떠올리기 대체 ON/OFF 버튼 (추천 세팅 기술 줄 옆, 모든 카드 공통 설정) */
export const relearnToggle = on => `<button type="button" class="re-toggle ${on ? 'on' : ''}" data-act="relearn-toggle" aria-pressed="${on}"
  title="${on ? '켜짐: 기술 칸·기술머신 기술 옆에, 못 구했을 때 「내 포켓몬 확인 → 기술 떠올리기」로 대신 배울 레벨업 기술을 보여 줘요' : '꺼짐: 떠올리기 대체를 숨겨요'}">떠올리기 대체 <b>${on ? 'ON' : 'OFF'}</b></button>`;

/** 도구 기준 버튼 (전부 · 구애 빼기 · 없이, 추천 세팅 도구 줄 옆, 모든 카드 공통 설정) */
export const itemModeControl = mode => `<span class="it-mode" role="group" aria-label="추천에 쓸 도구">${ITEM_MODES.map(m => `<button type="button"
  class="${m.key === mode ? 'on' : ''}" data-act="item-mode" data-mode="${m.key}" aria-pressed="${m.key === mode}" title="${m.name}: ${m.desc} 추천·대체">${m.label}</button>`).join('')}</span>`;
/** 「구애 도구 빼기」로 · 「도구 없이」로 */
const modeName = mode => { const n = ITEM_MODES.find(m => m.key === mode).name; return `「${n}」${josa(n, '으로').slice(n.length)}`; };
/** 도구 기준 때문에 뺀 도구의 이유 */
export const itemModeWhy = mode => (mode === 'none' ? '도구 없이 보는 중 (도구 기준)' : '구애 도구 빼 둠 (도구 기준) · 상점·아이템 칸에서 무작위라 구하기 힘든 도구');

/**
 * 같은 이름의 파티 아이템이 따로 있는 도구 (돌격조끼·자석·레드카드…) 안내 문장. info: gameData.itemInfo[slug]
 * 파티 아이템 쪽은 보드 효과만 있고 지닐 수 없다.
 */
export function partyTwinNote(info) {
  if (!info?.[2]) return null;
  const kind = info[0] === 'battle' ? '배틀 아이템' : '전용도구';
  const effect = info[3].split('.')[0].trim();
  return `아이템 칸·상점에서 「${kind}」${josa(kind, '으로').slice(kind.length)} 나온 ${info[2]}만 지닐 수 있어요. 「파티 아이템」으로 나온 ${josa(info[2], '은는')} 보드 효과(${effect})만 있고 지닐 수 없어요.`;
}
/** 도구 이름 옆 짧은 표시: 「배틀 아이템 칸 것만」 (같은 이름 파티 아이템이 없으면 '') */
export function twinTag(info) {
  const note = partyTwinNote(info);
  return note ? `<span class="item-warn" title="${esc(note)}">${info[0] === 'battle' ? '배틀 아이템' : '전용도구'} 칸 것만</span>` : '';
}
/** 표시한 도구 중 같은 이름 파티 아이템이 있는 것이 있으면 한 줄 안내 */
export function twinNoteLine(infos) {
  const names = [...new Set(infos.filter(i => i?.[2]).map(i => i[2]))];
  return names.length ? `<p class="note item-warn-note"><b>배틀 아이템 칸 것만</b>: ${esc(names.join('·'))}${josa(names[names.length - 1], '은는').slice(names[names.length - 1].length)} 같은 이름의 <b>파티 아이템</b>(보드 전용, 지닐 수 없음)이 따로 있어요. 아이템 칸·상점에서 「배틀 아이템」 칸으로 나온 것만 지닐 수 있어요.</p>` : '';
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
  // obtainable: 이 룰에서 구할 수 있는 도구, allowed: 그중 도구 기준(구애 빼기 · 도구 없이)에 맞는 것
  const obtainable = game ? gameItemSet(game.data, game.rule) : null;
  const allowed = game?.items?.usable || obtainable;
  const itemMode = game?.items?.mode || 'all';
  const itemName = slug => (game?.data.itemNames[slug] ? esc(game.data.itemNames[slug][0]) : itemLabel(setsData, slug));
  const na = (html, title) => `<span class="na" title="${esc(title)}">${html}</span>`;
  const CLS = ['변화', '물리', '특수'];
  // 기술 얻는 방법: 레벨업 · Lv.N · 기술 칸, 떠올리기 대체 ON 이면 기술 칸 기술 옆에 기술 떠올리기로 대신 배울 레벨업 기술 (마지막 토너먼트 레벨 기준)
  const learn = game?.learn || null;
  const lvNow = game?.data?.finalLevel || 75;
  const blocked = x => illegal.has(x);
  const kindOf = x => (learn && !blocked(x) ? learn.kind(mon, x, lvNow) : null);
  const slots = set.mv.map(m => (Array.isArray(m) ? m : [m]));
  const base = learn ? { lv: lvNow, mv: slots.map(o => o.find(x => !blocked(x))).filter(Boolean), iv: [], ab: mon.ab[0], na: 'hardy', it: null } : null;
  const used = [];   // 이미 다른 기술의 대체로 쓴 기술 (겹치지 않게)
  const reSub = x => {
    const r = learn?.on && kindOf(x)?.kind === 'tech' ? learn.sub(mon, { ...base, mv: base.mv.filter(y => y !== x) }, x, lvNow, used) : null;
    if (r) used.push(r.slug);
    return r;
  };
  const subMove = s => `<span class="sub-arrow">→</span><span class="is-sub"><span class="dot t-${s.type}" title="${esc(engine.typeKo(s.type))}"></span>${esc(s.ko)}<span class="cls">${CLS[s.cat]}</span><span class="sub-mark">대체</span>${learnMark(kindOf(s.slug))}</span>`;

  const moves = slots.map(opts => `<span>${opts.map((x, k) => {
    const label = moveLabel(engine, setsData, x);
    if (!blocked(x)) { const r = reSub(x); return label + learnMark(kindOf(x)) + (r ? relearnSubChip(r) : ''); }
    const s = subs?.moves.get(x);
    // 대체를 못 찾은 칸: 칸의 첫 기술에만 "대체 없음" (같은 칸에 쓸 수 있는 기술이 있으면 생략)
    const none = !s && subs && !set.pool && k === 0 && opts.every(blocked);
    return na(label, '이 게임에서는 배울 수 없는 기술')
      + (s ? subMove(s) : none ? '<span class="sub-arrow">→</span><span class="faint">대체 없음</span>' : '');
  }).join(' <em>/</em> ')}</span>`).join('') + (learn && slots.flat().some(x => kindOf(x)?.kind === 'tech') ? relearnToggle(learn.on) : '');
  const abilities = (set.ab.length ? set.ab : mon.ab.slice(0, 1)).map(a => esc(engine.abilityKo(a))).join(' <em>/</em> ');
  // 같은 이름의 파티 아이템이 따로 있는 도구(돌격조끼 등): 배틀 아이템으로 나온 것만 지닐 수 있음
  const partyTwin = i => {
    return twinTag(game?.data.itemInfo?.[i]);
  };
  const items = set.it.map(i => {
    if (!allowed || allowed.has(i)) return itemName(i) + partyTwin(i);
    const s = subs?.item?.[0] === i ? subs.item[1] : null;
    return na(itemName(i), obtainable.has(i) ? itemModeWhy(itemMode) : '게임 상점·아이템 칸에서 구할 수 없는 도구')
      + (s ? `<span class="sub-arrow">→</span>${s.slug ? `<span class="is-sub">${esc(s.ko)}<span class="sub-mark">대체</span></span>` : '<span class="faint">도구 없이</span>'}` : '');
  }).join(' <em>/</em> ') + (game && set.it.length ? itemModeControl(itemMode) : '');
  const natures = set.na.filter(Boolean).map(n => natureText(setsData, n)).join(' <em>/</em> ');
  const evs = set.ev ? ` <span class="faint">${spreadText(set.ev)}</span>` : '';
  const uses = game?.rule?.uses || [];
  // 테라: 챔피언스에는 없음, 게임에서는 테라스탈을 쓰는 룰일 때만
  const showTera = !isChampions(mode) && (!game || uses.includes('tera'));
  const tera = showTera && set.te?.length ? set.te.map(t => typeBadge(engine, t, 'sm')).join('') : '';
  // 메가진화: 게임 룰이 메가를 쓰고 이 포켓몬의 메가스톤이 기믹 상점에 있을 때
  const megas = game && uses.includes('mega') ? game.data.megas[mon.id] || [] : [];
  const megaLine = megas.map(([mid, stone]) => `<span>${esc(engine.byId.get(mid)?.ko || '')} <em>${itemName(stone)}</em></span>`).join('');
  const hasNa = set.mv.flat().some(blocked) || (allowed && set.it.some(i => !allowed.has(i)));

  return `<div class="set-card">
    ${header ? `<header>${sprite(mon)}<span>${esc(mon.ko)}</span><span class="pill-soft">추천 세팅</span></header>` : ''}
    ${tabs}
    <div class="set-src"><b>${esc(set.n)}</b><span>${esc(set.src)}</span></div>
    ${desc ? `<p class="set-why"><b>${esc(desc.role)}</b> ${esc(desc.line)}</p>` : ''}
    ${line('특성', abilities)}
    ${line('도구', items)}
    ${game ? twinNoteLine(set.it.filter(i => !allowed || allowed.has(i)).map(i => game.data.itemInfo?.[i])) : ''}
    ${line(set.pool ? '기술 후보' : '기술', moves)}
    ${line('성격', natures + evs)}
    ${line('테라', tera)}
    ${line('메가진화', megaLine)}
    ${set.pool ? '<p class="note">기술 후보 중 4개를 골라 쓰는 역할별 세팅이에요.</p>' : ''}
    ${hasNa ? `<p class="note na-note">취소선 항목은 「포켓몬 파티!」에서 구할 수 없거나 배울 수 없어요${itemMode !== 'all' && set.it.some(i => obtainable.has(i) && !allowed.has(i)) ? ` (도구 기준 ${modeName(itemMode)} 뺀 도구 포함)` : ''}. ${subs ? '옆의 <b>대체</b>는 같은 역할로 이 게임에서 쓸 수 있는 기술·도구예요.' : '비슷한 도구·기술로 바꿔 쓰세요.'}</p>` : ''}
    ${isChampions(mode) && set.ev ? '<p class="note">노력치는 SV 기준이에요 (챔피언스는 능력 포인트 체계).</p>' : ''}
    ${extra}
  </div>`;
}
