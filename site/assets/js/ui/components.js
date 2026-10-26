// 재사용 UI 조각 (HTML 문자열 반환)
import { esc } from './dom.js';
import { STAT_LABELS, STAT_SHORT, formatMult, multClass } from '../core/engine.js';

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='%23e8eaf0' stroke='%23b8bfcc' stroke-width='2'/%3E%3Cpath d='M3 16h26' stroke='%23b8bfcc' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%23fff' stroke='%23b8bfcc' stroke-width='2'/%3E%3C/svg%3E";

/** kind: 'icon'(작은 도트) | 'art'(공식 일러스트) — 빌드 때 확인한 존재하는 이미지만 사용 */
export function spriteUrl(mon, kind = 'icon') {
  const has = mon.img || 'fah';
  const front = `${SPRITES}${mon.id}.png`;
  const art = `${SPRITES}other/official-artwork/${mon.id}.png`;
  const home = `${SPRITES}other/home/${mon.id}.png`;
  const order = kind === 'art' ? [['a', art], ['h', home], ['f', front]] : [['f', front], ['h', home], ['a', art]];
  return order.find(([k]) => has.includes(k))?.[1] || FALLBACK;
}

export const sprite = (mon, kind = 'icon', attrs = '') =>
  `<img class="sprite" src="${spriteUrl(mon, kind)}" alt="${esc(mon.ko)}" loading="lazy" decoding="async" ${attrs} onerror="this.onerror=null;this.src='${FALLBACK}'">`;

export const typeBadge = (engine, t, size = '') => `<span class="type t-${t} ${size}">${esc(engine.typeKo(t))}</span>`;
export const typeList = (engine, types, size = '') => `<span class="types">${types.map(t => typeBadge(engine, t, size)).join('')}</span>`;

export const mult = (m, prefix = false) => `<span class="mult ${multClass(m)}">${prefix ? '×' : ''}${formatMult(m)}</span>`;

const statColor = v => `hsl(${Math.max(0, Math.min(150, (v - 30) * 1.15))} 62% 46%)`;
export function statBars(st) {
  const total = st.reduce((a, b) => a + b, 0);
  return `<div class="stats">${st.map((v, i) => `
    <div class="stat"><span class="stat-label">${STAT_LABELS[i]}</span><span class="stat-val">${v}</span>
      <span class="stat-bar"><span style="width:${Math.min(100, v / 1.8)}%;--sb:${statColor(v)}"></span></span></div>`).join('')}
    <div class="stat total"><span class="stat-label">합계</span><span class="stat-val">${total}</span><span></span></div></div>`;
}

export const pokeName = mon => `${esc(mon.ko)}`;
export const dexNo = mon => `No.${String(mon.sp).padStart(4, '0')}`;

/** "32/32/0/0/2/0" → "H32 A32 D2" */
export function spreadText(evs) {
  return evs.split('/').map((v, i) => (+v ? `${STAT_SHORT[i]}${v}` : '')).filter(Boolean).join(' ');
}

export function natureText(usage, slug) {
  const n = usage.natures[slug];
  if (!n) return esc(slug);
  const [ko, up, down] = n;
  return up === down ? `${esc(ko)} <em>무보정</em>` : `${esc(ko)} <em>+${STAT_LABELS[up]} −${STAT_LABELS[down]}</em>`;
}

const CLS = ['변화', '물리', '특수'];
export const moveLabel = (engine, usage, slug) => {
  const m = usage.moves[slug];
  if (!m) return esc(slug);
  return `<span class="dot t-${m[2]}" title="${esc(engine.typeKo(m[2]))}"></span>${esc(m[0])}<span class="cls">${CLS[m[3]] || ''}</span>`;
};
export const itemLabel = (usage, slug) => esc(usage.items[slug]?.[0] || slug);

/** 퍼센트 막대 목록. rows: [{ html, pct, attrs? }] */
export function barList(rows, color = 'var(--info-soft)') {
  if (!rows.length) return '<p class="note">데이터 없음</p>';
  return `<ul class="bar-list">${rows.map(r => `
    <li class="bar-item ${r.attrs ? 'link' : ''}" style="--w:${Math.min(100, r.pct)}%;--bar:${color}" ${r.attrs || ''}>
      <span class="bi-name">${r.html}</span><span class="bi-pct">${r.pct.toFixed(1)}%</span></li>`).join('')}</ul>`;
}

export const ICONS = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 1 5 5h-2a3 3 0 0 0-6 0v3h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5z"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l-4 4 4 4V9h11V7H7V4zm10 8v3H6v2h11v3l4-4-4-4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7zM19 15l1 2.8 2.8 1-2.8 1L19 23l-1-2.8-2.8-1 2.8-1z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.5-3.5a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8 20a4 4 0 0 1-2.8-6.8l2.5-2.5 1.4 1.4-2.5 2.5a2 2 0 0 0 2.8 2.8l2.5-2.5 1.4 1.4-2.5 2.5A4 4 0 0 1 8 20zm8.3-6.7-1.4-1.4 2.5-2.5a2 2 0 0 0-2.8-2.8l-2.5 2.5-1.4-1.4 2.5-2.5a4 4 0 0 1 5.6 5.6z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l3.3-3.3a1 1 0 0 1 1.4 0l2.3 2.3 4.3-4.3a1 1 0 0 1 1.4 0L19 11.6V6H5zm3.5 1A1.5 1.5 0 1 1 8.5 10a1.5 1.5 0 0 1 0-3z"/></svg>',
};
