// 추천 이유 표시 (파티 추천 · 포획 추천 공용): 이유 칩 + 사람이 읽는 코멘트
import { store, whereToFind } from '../state.js';
import { esc, josa } from './dom.js';
import { typeBadge } from './components.js';
import { partyTwinNote, twinTag, twinNoteLine } from './sets.js';

/** 추천 후보 → 파티에 넣을 모습: 진화 전으로만 잡히면 그 모습 + 진화 목표, 메가진화 후보면 메가 폼 */
export function addPlan(c) {
  const catchMon = !c.direct && c.from?.length ? c.from[0] : c.base;
  return { id: catchMon.id, evo: catchMon.id !== c.base.id ? c.base.id : null, mega: c.mega ? c.mon.id : null };
}

/** 게임 모드: 후보를 어디서 잡는지 (진화 전으로만 잡히면 그 모습 + "잡아서 진화") */
export function catchHint(c) {
  const catchMon = !c.direct && c.from?.length ? c.from[0] : c.base;
  const where = whereToFind(catchMon);
  return catchMon.id !== c.base.id ? `${catchMon.ko} 잡아서 진화${where ? ` · ${where}` : ''}` : where || '';
}

/** 게임 도구 한글명 (게임 데이터에 없으면 slug) */
export const itemName = slug => store.gameData?.itemNames[slug]?.[0] || slug;

// 지니는 도구를 얻는 곳 (게임 스크립트: 아이템 칸·상점)
const ITEM_SOURCE = {
  battle: '배틀 아이템 · 아이템 칸·상점 일반 상품(무작위)', berry: '나무열매 · 아이템 칸·상점 일반 상품(무작위)',
  signature: '전용도구 · 상점 전용도구 칸', mega: '메가스톤 · 기믹 상점', z: 'Z크리스탈 · 기믹 상점', dynamax: '기믹 상점', tera: '기믹 상점',
};
/** 도구를 얻는 곳·상점 가격 { src, price, text } (게임 지니는 도구가 아니면 null) */
export function itemSource(slug) {
  const info = store.gameData?.itemInfo?.[slug];
  return info ? { src: info[0], price: info[1], text: `${ITEM_SOURCE[info[0]] || '상점'} · ${info[1].toLocaleString()}원` } : null;
}
/** 같은 이름의 파티 아이템이 따로 있는 도구 (돌격조끼·자석·레드카드…) 안내 문장 | null */
export const itemPartyWarning = slug => partyTwinNote(store.gameData?.itemInfo?.[slug]);
/** 도구 이름 + 같은 이름 파티 아이템이 있으면 「배틀 아이템 칸 것만」 표시 (HTML) */
export const itemLabel = slug => `${esc(itemName(slug))}${twinTag(store.gameData?.itemInfo?.[slug])}`;
/** 보여 준 도구들 중 같은 이름 파티 아이템이 있는 것 안내 한 줄 (HTML | '') */
export const itemTwinNote = slugs => twinNoteLine(slugs.filter(Boolean).map(s => store.gameData?.itemInfo?.[s]));

export function reasonChip(engine, r) {
  switch (r.kind) {
    case 'def': return `<span class="reason">${typeBadge(engine, r.type, 'sm')} ${r.mult === 0 ? '무효' : r.mult <= 0.25 ? '¼ 반감' : '반감'}</span>`;
    case 'off': return `<span class="reason off">${r.types.slice(0, 4).map(t => typeBadge(engine, t, 'sm')).join('')} 공략</span>`;
    case 'cov': return `<span class="reason off">공격 범위 +${Math.round(r.value * 100)}%</span>`;
    case 'mate': return `<span class="reason mate">${esc(r.with.ko)} 동료 ${r.pct}%</span>`;
    case 'usage': return `<span class="reason usage">사용률 ${r.u}% · ${r.rank}위</span>`;
    case 'bst': return `<span class="reason usage">높은 종족값 ${r.value}</span>`;
    case 'warn': return `<span class="reason warn">${typeBadge(engine, r.type, 'sm')} 약점 ${r.count}마리째</span>`;
    case 'warn-types': return `<span class="reason warn">${r.types.slice(0, 3).map(t => typeBadge(engine, t, 'sm')).join('')} 약점 겹침 주의</span>`;
    case 'mega': return `<span class="reason usage">메가진화 · ${esc(itemName(r.stone))}</span>`;
    case 'evo': return `<span class="reason">${esc(r.from.map(m => m.ko).join('·'))}에서 진화</span>`;
    default: return '';
  }
}

/** 추천 이유 → 코멘트 한두 문장. c: 후보(base = 메가진화 전 최종 진화) */
export function commentText(engine, reasons, c) {
  const names = ts => ts.map(t => engine.typeKo(t)).join('·');
  const parts = [];
  const def = reasons.filter(r => r.kind === 'def');
  if (def.length) parts.push(`파티가 약한 ${names(def.map(r => r.type))} 공격을 ${def.every(r => r.mult === 0) ? '무효로 막아' : '반감해'} 줘요`);
  const off = reasons.find(r => r.kind === 'off');
  if (off) parts.push(`아직 못 찌르던 ${names(off.types)} 타입을 자속 기술로 찔러요`);
  const cov = reasons.find(r => r.kind === 'cov');
  if (cov && !off) parts.push(`상대 후보에게 효과가 굉장한 공격 범위가 ${Math.round(cov.value * 100)}%p 넓어져요`);
  const bst = reasons.find(r => r.kind === 'bst');
  if (bst) parts.push(`상성 보완은 적지만 기본 능력(종족값 ${bst.value})이 좋아요`);
  const mate = reasons.find(r => r.kind === 'mate');
  if (mate) parts.push(`실전에서 ${josa(mate.with.ko, '와과')} 함께 ${mate.pct}% 쓰여요`);
  const mega = reasons.find(r => r.kind === 'mega');
  if (mega) parts.push(`${josa(itemName(mega.stone), '으로')} 메가진화하면 종족값이 ${mega.value}까지 올라가요 (메가진화는 파티에 1마리만)`);
  const evo = reasons.find(r => r.kind === 'evo');
  if (evo) parts.push(`${josa(evo.from.map(m => m.ko).join('·'), '으로')} 잡아 ${josa(c.base.ko, '으로')} 진화시킨 모습 기준이에요`);
  const warn = reasons.filter(r => r.kind === 'warn');
  if (warn.length) parts.push(`단, ${names(warn.map(r => r.type))} 약점이 ${Math.max(...warn.map(r => r.count))}마리로 겹쳐요`);
  return parts.join('. ') + (parts.length ? '.' : '');
}
