// 선봉 추천: 상대 파티(최대 6마리) 입력 → 내 파티에서 먼저 내보낼 포켓몬(더블이면 2마리) · 경계할 상대 · 대면표
import { store, update, getContext, partyMembers, battleMode, isGameMode } from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, ICONS } from '../ui/components.js';
import { normalize } from '../core/search.js';
import { leadAnalysis } from '../core/party.js';

let root, oppEl, mineEl, resultEl;

export function initLead(el) {
  root = el;
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">대전 준비</span>
      <h1>상대 파티로 선봉 고르기</h1>
      <p>토너먼트에서 만날 상대의 포켓몬을 입력하면, 내 파티에서 <b>먼저 내보내기 좋은 포켓몬</b>과 조심할 상대를 알려드려요.</p>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>상대 파티</h3><span class="sub">최대 6마리</span>
          <button class="btn sm ghost" type="button" data-act="opp-clear">비우기</button></div>
        <div id="l-picker"></div>
        <div class="opp-list" id="l-opps"></div>
        <details class="paste">
          <summary>이름 여러 개 한 번에 입력</summary>
          <textarea id="l-paste" rows="2" placeholder="예: 누오, 한카리아스, 알로라 라이츄 (쉼표·줄바꿈·띄어쓰기로 구분)"></textarea>
          <button class="btn sm" type="button" data-act="paste">입력</button>
        </details>
      </section>
      <section class="card">
        <div class="card-head"><h3>내 파티</h3><a class="sub" href="#/party">파티 편집 →</a></div>
        <div id="l-mine"></div>
      </section>
    </div>
    <div id="l-result" class="view"></div>`;
  oppEl = root.querySelector('#l-opps');
  mineEl = root.querySelector('#l-mine');
  resultEl = root.querySelector('#l-result');

  createPicker(root.querySelector('#l-picker'), {
    engine: store.engine, search: store.search,
    placeholder: '상대 포켓몬 추가 (이름·초성·번호)',
    onSelect: p => toast(addOpponent(p.id) || `${josa(p.ko, '을를')} 상대 파티에 넣었어요`),
  });
  on(root, 'click', '[data-act="opp-clear"]', () => update(s => { s.opponents = []; }));
  on(root, 'click', '[data-opp-remove]', (e, el) => update(s => { s.opponents.splice(+el.dataset.oppRemove, 1); }));
  on(root, 'click', '[data-act="paste"]', () => {
    const box = root.querySelector('#l-paste');
    const { found, missed } = parseNames(box.value);
    let added = 0;
    for (const p of found) if (!addOpponent(p.id, false)) added++;
    update(() => {});
    box.value = missed.join(', ');
    toast(missed.length ? `${added}마리 입력 · 못 찾은 이름: ${missed.join(', ')}` : `${added}마리를 입력했어요`);
  });
  on(root, 'click', '[data-go]', (e, el) => { e.preventDefault(); location.hash = `#/matchup/${el.dataset.go}`; });
}

/** 상대 파티에 추가. 실패 사유 또는 null */
function addOpponent(id, emit = true) {
  if (store.opponents.length >= 6) return '상대 파티는 6마리까지예요';
  if (store.opponents.includes(id)) return '이미 들어 있어요';
  if (emit) update(s => { s.opponents.push(id); });
  else store.opponents.push(id);
  return null;
}

/**
 * "누오, 한카리아스 알로라 라이츄" 같은 글을 포켓몬 목록으로.
 * 띄어쓰기가 이름 안에도 있을 수 있어(알로라 라이츄) 앞에서부터 가장 긴 일치를 고른다.
 */
function parseNames(text) {
  const found = [], missed = [];
  const exact = q => {
    const n = normalize(q);
    return store.search(q, 5).find(p => normalize(p.ko) === n || normalize(p.en) === n) || null;
  };
  for (const chunk of text.split(/[,\n/·|]+/).map(s => s.trim()).filter(Boolean)) {
    const words = chunk.split(/\s+/);
    for (let i = 0; i < words.length;) {
      let hit = null, len = 0;
      for (let j = Math.min(words.length, i + 3); j > i && !hit; j--) {
        hit = exact(words.slice(i, j).join(' '));
        len = j - i;
      }
      if (!hit) { hit = store.search(words[i], 1)[0] || null; len = 1; }
      if (hit) found.push(hit); else missed.push(words[i]);
      i += len;
    }
  }
  return { found, missed };
}

export function renderLead() {
  if (!root) return;
  const { engine } = store;
  const ctx = getContext();
  const mine = partyMembers(ctx);
  const foes = store.opponents.map(id => ctx.prep(engine.byId.get(id)));

  oppEl.innerHTML = foes.length
    ? foes.map((o, i) => `<span class="opp">${sprite(o.mon)}<span><b>${esc(o.mon.ko)}</b>${typeList(engine, o.mon.t, 'sm')}</span>
        <button type="button" data-opp-remove="${i}" aria-label="빼기">${ICONS.close}</button></span>`).join('')
    : '<p class="note">위 검색창으로 상대 포켓몬을 넣어 주세요.</p>';
  mineEl.innerHTML = mine.length
    ? `<div class="mine-list">${mine.map(m => `<a class="opp" href="#/matchup/${m.mon.slug}" data-go="${m.mon.slug}">${sprite(m.mon)}<span><b>${esc(m.mon.ko)}</b>${typeList(engine, m.mon.t, 'sm')}</span></a>`).join('')}</div>`
    : '<p class="note">내 파티가 비어 있어요. <a href="#/party">파티 화면</a>에서 먼저 넣어 주세요.</p>';

  // 주소창 동기화 (#/lead/195,445,...)
  const hash = store.opponents.length ? `#/lead/${store.opponents.join(',')}` : '#/lead';
  if (location.hash.startsWith('#/lead') && location.hash !== hash) history.replaceState(null, '', hash);

  if (!mine.length || !foes.length) {
    resultEl.innerHTML = `<div class="card empty"><strong>${!mine.length ? '내 파티를 먼저 만들어 주세요' : '상대 포켓몬을 입력해 주세요'}</strong>
      양쪽 파티가 있으면 선봉 추천과 대면표를 보여드려요.</div>`;
    return;
  }
  const double = battleMode() === 'double';
  const a = leadAnalysis(ctx, mine, foes, { double });
  resultEl.innerHTML = [leadCard(a, foes.length, double), threatCard(a, mine), gridCard(a, foes)].join('');
}

const pctBar = v => `<span class="track"><span style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></span></span>`;

function leadCard(a, n, double) {
  const { engine } = store;
  const chips = r => `
    <span class="reason off">효과 굉장 ${r.se}/${n}</span>
    <span class="reason ${r.weakTo ? 'warn' : ''}">약점 찔림 ${r.weakTo}/${n}</span>
    <span class="reason usage">스피드 우위 ${r.outspeed}/${n}</span>`;
  const max = Math.max(...a.ranked.map(r => r.score)), min = Math.min(...a.ranked.map(r => r.score));
  const norm = s => (max === min ? 1 : (s - min) / (max - min));
  const pair = double && a.pair ? `
    <div class="lead-pair">
      <span class="lead-rank">선봉 2마리</span>
      ${a.pair.rows.map(r => `<a class="lead-mon" href="#/matchup/${r.m.mon.slug}" data-go="${r.m.mon.slug}">${sprite(r.m.mon)}<b>${esc(r.m.mon.ko)}</b></a>`).join('<span class="plus">+</span>')}
      <span class="reasons"><span class="reason off">둘 중 하나가 효과 굉장 ${a.pair.cover}/${n}</span>
        <span class="reason ${a.pair.both ? 'warn' : ''}">둘 다 약한 상대 ${a.pair.both}</span></span>
    </div>` : '';
  return `
  <section class="card">
    <div class="card-head"><h3>${ICONS.spark} 추천 선봉</h3>
      <span class="sub">${double ? '더블 배틀 · 함께 내보낼 2마리 + 개별 순위' : '싱글 배틀'} · 자속 상성 + 스피드(같은 레벨 가정)</span></div>
    ${pair}
    <ol class="lead-list">${a.ranked.slice(0, Math.min(3, a.ranked.length)).map((r, i) => `
      <li class="${i === 0 && !double ? 'top' : ''}">
        <span class="lead-rank">${i + 1}</span>
        <a class="lead-mon" href="#/matchup/${r.m.mon.slug}" data-go="${r.m.mon.slug}">${sprite(r.m.mon)}<span><b>${esc(r.m.mon.ko)}</b>${typeList(engine, r.m.mon.t, 'sm')}</span></a>
        <span class="lead-score">${pctBar(norm(r.score))}</span>
        <span class="reasons">${chips(r)}</span>
      </li>`).join('')}</ol>
    ${a.ranked.length > 3 ? `<p class="note">나머지: ${a.ranked.slice(3).map(r => esc(r.m.mon.ko)).join(' · ')}</p>` : ''}
  </section>`;
}

function threatCard(a, mine) {
  const { engine } = store;
  const top = a.threats.filter(t => t.hitsMe > 0).slice(0, 3);
  if (!top.length) return '';
  return `
  <section class="card">
    <div class="card-head"><h3>경계할 상대</h3><span class="sub">내 파티 여러 마리의 약점을 찌르는 상대와 맞붙일 포켓몬</span></div>
    <div class="threats">${top.map(t => {
      const idx = store.opponents.indexOf(t.o.id);   // 대면 칸(cells)은 상대 입력 순서와 같다
      const answer = [...a.rows].sort((x, y) => (y.cells[idx].atk - y.cells[idx].recv) - (x.cells[idx].atk - x.cells[idx].recv))[0];
      const c = answer.cells[idx];
      return `<div class="threat">
        <a class="lead-mon" href="#/matchup/${t.o.mon.slug}" data-go="${t.o.mon.slug}">${sprite(t.o.mon)}<span><b>${esc(t.o.mon.ko)}</b>${typeList(engine, t.o.mon.t, 'sm')}</span></a>
        <p>내 파티 <b>${t.hitsMe}마리</b>의 약점을 찔러요${t.iHit ? ` · 내가 효과 굉장을 줄 수 있는 포켓몬 ${t.iHit}마리` : ' · 효과 굉장으로 칠 포켓몬이 없어요'}</p>
        <p class="answer">대응: <b>${esc(answer.m.mon.ko)}</b> <span class="vs-cell"><span class="vs-label">주는</span>${mult(c.atk, true)}<span class="vs-label">받는</span>${mult(c.recv, true)}</span></p>
      </div>`;
    }).join('')}</div>
  </section>`;
}

function gridCard(a, foes) {
  const cls = c => (c.atk >= 2 && c.recv <= 1 ? 'good' : c.recv >= 2 && c.atk <= 1 ? 'bad' : c.atk > c.recv ? 'good-ish' : c.atk < c.recv ? 'bad-ish' : 'even');
  return `
  <section class="card">
    <div class="card-head"><h3>대면표</h3><span class="sub">칸마다 <b>내가 주는 배율 / 받는 배율</b> · ⚡ 내가 더 빠름</span></div>
    <div class="table-wrap">
      <table class="vs-grid">
        <thead><tr><th></th>${foes.map(o => `<th>${sprite(o.mon)}<span class="th-name">${esc(o.mon.ko)}</span></th>`).join('')}</tr></thead>
        <tbody>${a.ranked.map(r => `<tr>
          <th class="rowhead">${sprite(r.m.mon)}<span class="th-name">${esc(r.m.mon.ko)}</span></th>
          ${r.cells.map(c => `<td class="${cls(c)}"><span>${mult(c.atk)}<i>/</i>${mult(c.recv)}</span>${c.faster === 1 ? '<em>⚡</em>' : ''}</td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="note">자속 기술 기준이에요. 실제 기술 배치·도구·특성·${isGameMode() ? '레벨' : '노력치'}에 따라 달라질 수 있어요.</p>
  </section>`;
}
