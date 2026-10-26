// 타입 상성표 (18×18) + 타입 조합 계산기
import { store } from '../state.js';
import { esc, on } from '../ui/dom.js';
import { sprite, typeBadge, mult } from '../ui/components.js';
import { formatMult, multClass } from '../core/engine.js';

let root, table, comboEl;
let picked = [];

export function initChart(el) {
  root = el;
  const { engine, dex } = store;
  const T = dex.types;
  const legend = [[2, '효과 굉장'], [0.5, '효과 별로'], [0, '효과 없음']]
    .map(([m, label]) => `<span>${mult(m, true)}${label}</span>`).join('');
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">레퍼런스</span>
      <h1>타입 상성표</h1>
      <p>행은 <b>공격하는 기술의 타입</b>, 열은 <b>공격받는 포켓몬의 타입</b>입니다. 칸에 마우스를 올리면 해당 행·열이 강조돼요.</p>
    </div>
    <section class="card">
      <div class="card-head"><div class="legend">${legend}</div><span class="note">데이터: PokeAPI type_efficacy (9세대)</span></div>
      <div class="chart-wrap">
        <table class="type-chart" id="tc">
          <thead><tr><th class="corner">공격 ↓<br>방어 →</th>${T.map(t => `<th scope="col">${typeBadge(engine, t, 'sm')}</th>`).join('')}</tr></thead>
          <tbody>${T.map((a, r) => `<tr><th scope="row">${typeBadge(engine, a, 'sm')}</th>${T.map((d, c) => {
            const m = dex.chart[r][c];
            return `<td class="${multClass(m)}" data-r="${r}" data-c="${c}" title="${esc(engine.typeKo(a))} → ${esc(engine.typeKo(d))}: ×${formatMult(m)}">${m === 1 ? '' : formatMult(m)}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>타입 조합 계산기</h3><span class="sub">방어 타입을 1~2개 골라 보세요</span></div>
      <div class="type-picker">${T.map(t => `<button type="button" class="type t-${t}" data-t="${t}" aria-pressed="false">${esc(engine.typeKo(t))}</button>`).join('')}</div>
      <div id="tc-result" style="margin-top:16px"></div>
    </section>`;
  table = root.querySelector('#tc');
  comboEl = root.querySelector('#tc-result');

  on(table, 'mouseover', 'td', (e, td) => {
    const { r, c } = td.dataset;
    table.classList.add('hovering');
    table.querySelectorAll('td.hl, td.cross').forEach(x => x.classList.remove('hl', 'cross'));
    table.querySelectorAll(`td[data-r="${r}"], td[data-c="${c}"]`).forEach(x => x.classList.add('hl'));
    td.classList.add('cross');
  });
  table.addEventListener('mouseleave', () => {
    table.classList.remove('hovering');
    table.querySelectorAll('td.hl, td.cross').forEach(x => x.classList.remove('hl', 'cross'));
  });
  on(root, 'click', '[data-t]', (e, el) => {
    const t = el.dataset.t;
    picked = picked.includes(t) ? picked.filter(x => x !== t) : [...picked, t].slice(-2);
    root.querySelectorAll('[data-t]').forEach(b => b.setAttribute('aria-pressed', String(picked.includes(b.dataset.t))));
    renderCombo();
  });
  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); location.hash = `#/matchup/${el.dataset.go}`; });
  renderCombo();
}

function renderCombo() {
  const { engine, dex } = store;
  if (!picked.length) {
    comboEl.innerHTML = '<p class="note">예: 물 + 땅을 고르면 풀 ×4 외에는 약점이 없다는 걸 알 수 있어요.</p>';
    return;
  }
  const profile = dex.types.map(atk => engine.effectiveness(atk, picked));
  const rows = engine.groupProfile(profile).map(g => `
    <div class="mult-row ${g.mult === 1 ? 'neutral' : ''}">${mult(g.mult, true)}
      <span class="types">${g.types.map(t => typeBadge(engine, t, g.mult === 1 ? 'sm' : '')).join('')}</span></div>`).join('');
  const same = dex.pokemon
    .filter(p => p.t.length === picked.length && picked.every(t => p.t.includes(t)) && !p.mega)
    .sort((a, b) => engine.bst(b) - engine.bst(a)).slice(0, 14);
  comboEl.innerHTML = `
    <div class="mult-groups">${rows}</div>
    <div style="margin-top:14px" class="chips"><span class="chips-label">이 타입 조합 포켓몬</span>
      ${same.map(p => `<a class="chip" href="#/matchup/${p.slug}" data-go="${p.slug}">${sprite(p)}${esc(p.ko)}</a>`).join('') || '<span class="note">해당 조합의 포켓몬이 없어요</span>'}</div>`;
}
