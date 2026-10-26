// 포켓몬 검색 자동완성 (combobox 패턴, 키보드 ↑↓ Enter Esc 지원)
import { esc } from './dom.js';
import { ICONS, sprite, typeList } from './components.js';

let uid = 0;

export function createPicker(container, { engine, search, placeholder, onSelect, large = false }) {
  const id = `picker-${++uid}`;
  container.innerHTML = `
    <div class="picker ${large ? 'lg' : ''}">
      <div class="picker-box">${ICONS.search}
        <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}"
          placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
      </div>
      <ul class="picker-list" id="${id}" role="listbox" hidden></ul>
    </div>`;
  const input = container.querySelector('input');
  const list = container.querySelector('ul');
  let results = [];
  let active = -1;

  function open(show) {
    list.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
  }

  function render() {
    if (!input.value.trim()) { open(false); return; }
    if (!results.length) {
      list.innerHTML = '<li class="pl-none" role="option" aria-disabled="true">일치하는 포켓몬이 없어요</li>';
      open(true);
      return;
    }
    list.innerHTML = results.map((p, i) => `
      <li id="${id}-${i}" role="option" data-i="${i}" aria-selected="${i === active}">
        ${sprite(p)}
        <span class="pl-main"><span class="pl-name">${esc(p.ko)}</span>
          <span class="pl-sub">${esc(p.en)} · No.${String(p.sp).padStart(4, '0')}</span></span>
        ${typeList(engine, p.t, 'sm')}
      </li>`).join('');
    input.setAttribute('aria-activedescendant', active >= 0 ? `${id}-${active}` : '');
    open(true);
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const p = results[i];
    if (!p) return;
    input.value = '';
    results = [];
    open(false);
    onSelect(p);
  }

  input.addEventListener('input', () => {
    results = search(input.value, 10);
    active = results.length ? 0 : -1;
    render();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      if (e.isComposing) return; // 한글 조합 중 Enter 는 무시
      e.preventDefault();
      if (active >= 0) choose(active);
    } else if (e.key === 'Escape') {
      open(false);
    }
  });
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(() => open(false), 120));
  // mousedown 으로 처리해야 blur 보다 먼저 선택됨
  list.addEventListener('mousedown', e => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(+li.dataset.i);
  });

  return { focus: () => input.focus(), input };
}
