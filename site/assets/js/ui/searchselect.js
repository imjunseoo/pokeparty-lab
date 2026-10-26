// 검색해서 고르는 입력칸 (내 세팅의 기술·도구·성격): 이름·초성·타입·분류로 찾고 ↑↓ Enter 로 고른다
// 화면은 HTML 문자열로 다시 그려지므로 동작은 root 에 한 번만 붙이는 이벤트 위임으로 처리한다.
import { esc } from './dom.js';
import { normalize, chosung } from '../core/search.js';

const lists = new Map();   // 목록 id → [{ value, label, sub, n(정규화 이름), cho(초성), extra(추가 검색어) }]
const LIMIT = 60;

/** 옵션 목록 등록 (같은 id 는 덮어씀). keys: 이름 말고도 검색되게 할 말 (타입·분류 등) */
export function defineOptions(id, options) {
  lists.set(id, options.map(o => {
    const n = normalize(o.label);
    return { ...o, n, cho: chosung(n), extra: normalize(o.keys || '') };
  }));
}

const labelOf = (id, value) => lists.get(id)?.find(o => o.value === value)?.label || '';

/** 입력칸 HTML: 보이는 검색칸 + 실제 값(hidden, name) + 목록 */
export function searchSelect({ name, list, value = '', placeholder = '', label = '' }) {
  return `<div class="ss" data-ss="${esc(list)}">
    <input type="search" class="select ss-input" placeholder="${esc(placeholder)}" value="${esc(labelOf(list, value))}"
      autocomplete="off" autocapitalize="off" spellcheck="false" role="combobox" aria-expanded="false" aria-label="${esc(label)}">
    <input type="hidden" name="${esc(name)}" value="${esc(value)}">
    <ul class="ss-list" role="listbox" hidden></ul>
  </div>`;
}

/**
 * 검색: 이름 그대로 > 이름 시작 > 이름 포함 > 추가 검색어(타입·분류·올리는 능력 등, 앞부분이면 우선).
 * 초성만 치면(ㅈㅈ) 초성이 똑같은 이름 > 초성으로 시작 > 초성 포함. 이름이 맞은 것끼리는 짧은 이름 먼저, 나머지는 원래 순서(위력순 등).
 */
function filter(id, query) {
  const all = lists.get(id) || [];
  const q = normalize(query);
  if (!q) return all.slice(0, LIMIT);
  const choOnly = /^[ㄱ-ㅎ]+$/.test(q);
  const hits = [];
  all.forEach((o, k) => {
    let s = -1;
    if (choOnly) s = o.cho === q ? 98 : o.cho.startsWith(q) ? 90 : o.cho.includes(q) ? 60 : o.extra.includes(q) ? 40 : -1;
    else s = o.n === q ? 100 : o.n.startsWith(q) ? 85 : o.n.includes(q) ? 70 : o.extra.startsWith(q) ? 55 : o.extra.includes(q) ? 50 : -1;
    if (s >= 0) hits.push([s, s >= 60 ? o.n.length : 0, k, o]);
  });
  return hits.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]).slice(0, LIMIT).map(h => h[3]);
}

/** 값 바꾸기 (최선 세팅으로 채우기 등) */
export function setSearchValue(box, value) {
  box.querySelector('input[type="hidden"]').value = value || '';
  box.querySelector('.ss-input').value = labelOf(box.dataset.ss, value || '');
}

/** root 안의 검색 입력칸 동작 (한 번만 호출) */
export function bindSearchSelects(root) {
  const state = new WeakMap();   // box → { items, active }
  const boxOf = el => el.closest('.ss');
  const render = (box, query) => {
    const items = filter(box.dataset.ss, query);
    const ul = box.querySelector('.ss-list');
    const cur = box.querySelector('input[type="hidden"]').value;
    const active = Math.max(0, items.findIndex(o => o.value === cur));
    state.set(box, { items, active });
    ul.innerHTML = items.length
      ? items.map((o, k) => `<li role="option" data-k="${k}" aria-selected="${k === active}" class="${o.value === cur ? 'cur' : ''}">
          <span class="ss-label">${esc(o.label)}</span>${o.sub ? `<span class="ss-sub">${esc(o.sub)}</span>` : ''}</li>`).join('')
      : '<li class="ss-none">일치하는 항목이 없어요</li>';
    ul.hidden = false;
    box.querySelector('.ss-input').setAttribute('aria-expanded', 'true');
    ul.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };
  const close = box => {
    box.querySelector('.ss-list').hidden = true;
    box.querySelector('.ss-input').setAttribute('aria-expanded', 'false');
  };
  // 고르면 상자에서 ss-change 이벤트 (detail = 값): 고르자마자 다시 계산하는 화면용 (칸별 전략의 "나온 도구")
  const choose = (box, o) => {
    setSearchValue(box, o.value);
    close(box);
    box.dispatchEvent(new CustomEvent('ss-change', { bubbles: true, detail: o.value }));
  };
  const move = (box, d) => {
    const st = state.get(box);
    if (!st?.items.length) return;
    st.active = (st.active + d + st.items.length) % st.items.length;
    box.querySelectorAll('.ss-list li').forEach((li, k) => li.setAttribute('aria-selected', String(k === st.active)));
    box.querySelectorAll('.ss-list li')[st.active]?.scrollIntoView({ block: 'nearest' });
  };

  root.addEventListener('focusin', e => {
    const input = e.target.closest('.ss-input');
    if (!input) return;
    input.select();
    render(boxOf(input), '');   // 처음엔 전체 목록 (지금 값 강조)
  });
  root.addEventListener('input', e => {
    const input = e.target.closest('.ss-input');
    if (input) render(boxOf(input), input.value);
  });
  root.addEventListener('keydown', e => {
    const input = e.target.closest('.ss-input');
    if (!input) return;
    const box = boxOf(input);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (box.querySelector('.ss-list').hidden) render(box, input.value);
      else move(box, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      const st = state.get(box);
      if (!box.querySelector('.ss-list').hidden && st?.items[st.active]) { e.preventDefault(); choose(box, st.items[st.active]); }
    } else if (e.key === 'Escape') {
      close(box);
    }
  });
  // 목록은 mousedown 에서 고른다 (blur 보다 먼저)
  root.addEventListener('mousedown', e => {
    const li = e.target.closest('.ss-list li[data-k]');
    if (!li) return;
    e.preventDefault();
    const box = boxOf(li);
    choose(box, state.get(box).items[+li.dataset.k]);
  });
  root.addEventListener('focusout', e => {
    const input = e.target.closest('.ss-input');
    if (!input) return;
    const box = boxOf(input);
    close(box);
    // 비우면 값도 비움(없음), 그 밖엔 고른 값의 이름으로 되돌림
    const had = box.querySelector('input[type="hidden"]').value;
    if (!input.value.trim()) {
      setSearchValue(box, '');
      if (had) box.dispatchEvent(new CustomEvent('ss-change', { bubbles: true, detail: '' }));
    } else setSearchValue(box, had);
  });
}
