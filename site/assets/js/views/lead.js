// 선봉 추천: 상대 파티(최대 6마리) 입력 → 내 파티에서 먼저 내보낼 포켓몬(더블이면 2마리) · 경계할 상대 · 대면표
// 상대 파티는 검색, 이름 붙여넣기, 보드 화면 스크린샷(아이콘 인식)으로 입력할 수 있다.
import { store, update, getContext, partyMembers, battleMode, isGameMode } from '../state.js';
import { createPicker } from '../ui/picker.js';
import { esc, on, toast, josa } from '../ui/dom.js';
import { sprite, typeBadge, typeList, mult, ICONS } from '../ui/components.js';
import { normalize } from '../core/search.js';
import { leadAnalysis } from '../core/party.js';
import { readImage, analyzeShot, drawPreview } from '../ui/shot.js';

let root, oppEl, mineEl, resultEl, shotEl;
// 스크린샷 인식 상태 (저장하지 않음): data 원본 픽셀, result 인식 결과, picks 사용자가 고친 칸, crop 영역 지정 모드
const shot = { data: null, result: null, picks: {}, busy: false, crop: false, k: 1, drag: null };

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
        <div class="shot-tools" id="l-drop">
          <label class="btn sm" for="l-shot-file">${ICONS.image}스크린샷으로 입력</label>
          <input type="file" id="l-shot-file" accept="image/*" hidden>
          <span class="note">보드 화면 스크린샷을 올리거나, 이 화면에서 <b>Ctrl+V</b>로 붙여넣거나, 여기로 끌어다 놓으세요</span>
        </div>
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
    <section class="card shot-card" id="l-shot" hidden></section>
    <div id="l-result" class="view"></div>`;
  oppEl = root.querySelector('#l-opps');
  mineEl = root.querySelector('#l-mine');
  resultEl = root.querySelector('#l-result');
  shotEl = root.querySelector('#l-shot');

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

  // 스크린샷: 파일 선택 · 끌어다 놓기 · 붙여넣기(선봉 화면이 보일 때만)
  root.querySelector('#l-shot-file').addEventListener('change', e => { handleShot(e.target.files[0]); e.target.value = ''; });
  const drop = root.querySelector('#l-drop').closest('.card');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); handleShot(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    if (root.hidden) return;
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); handleShot(item.getAsFile()); }
  });
  on(root, 'click', '[data-shot-use]', (e, el) => useShotRow(+el.dataset.shotUse));
  on(root, 'change', '[data-shot-alt]', (e, el) => {
    const [p, s] = el.dataset.shotAlt.split(',').map(Number);
    (shot.picks[p] ||= {})[s] = el.value ? +el.value : null;
    renderShot();
  });
  on(root, 'click', '[data-act="shot-close"]', () => { Object.assign(shot, { data: null, result: null, picks: {}, crop: false }); renderShot(); });
  on(root, 'click', '[data-act="shot-crop"]', () => { shot.crop = !shot.crop; renderShot(); });
  // 플레이어 패널 영역 직접 지정 (드래그)
  shotEl.addEventListener('pointerdown', e => {
    if (!shot.crop || e.target.id !== 'l-shot-canvas') return;
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);
    shot.drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
  });
  shotEl.addEventListener('pointermove', e => {
    if (!shot.drag || e.target.id !== 'l-shot-canvas') return;
    shot.drag.x1 = e.offsetX; shot.drag.y1 = e.offsetY;
    drawCropBox(e.target);
  });
  shotEl.addEventListener('pointerup', e => {
    if (!shot.drag) return;
    const d = shot.drag;
    shot.drag = null;
    // 화면 표시 크기 → 원본 픽셀 (캔버스가 CSS 로 줄어들었을 수 있음)
    const canvas = root.querySelector('#l-shot-canvas');
    const css = canvas.getBoundingClientRect().width / canvas.width;
    const toImg = v => v / css / shot.k;
    const rect = { x: toImg(Math.min(d.x0, d.x1)), y: toImg(Math.min(d.y0, d.y1)), w: toImg(Math.abs(d.x1 - d.x0)), h: toImg(Math.abs(d.y1 - d.y0)) };
    if (rect.w < 20 || rect.h < 40) return renderShot();
    shot.crop = false;
    runShot(rect);
  });
}

async function handleShot(file) {
  if (!file || !file.type.startsWith('image/')) return toast('이미지 파일을 올려 주세요');
  if (!isGameMode()) toast('스크린샷 인식은 「포켓몬 파티!」 화면 기준이에요');
  try {
    shot.data = await readImage(file);
  } catch (e) {
    return toast(e.message);
  }
  shot.picks = {};
  shot.crop = false;
  runShot(null);
}

async function runShot(rect) {
  shot.busy = true;
  renderShot();
  await new Promise(r => setTimeout(r, 30));   // "읽는 중" 을 먼저 그리고 계산
  try {
    shot.result = await analyzeShot(shot.data, rect);
  } catch (e) {
    toast(`인식에 실패했어요 (${e.message})`);
  }
  shot.busy = false;
  shot.picks = {};
  // 보드 화면을 못 찾았으면 바로 패널 영역을 지정할 수 있게
  shot.crop = !!shot.result && !shot.result.found;
  renderShot();
}

/** 사용자가 고친 값 → 없으면 인식 결과 */
const shotPick = (p, s) => (shot.picks[p] && s in shot.picks[p] ? shot.picks[p][s] : shot.result.players[p][s].id);

function useShotRow(p) {
  const ids = [];
  const species = new Set();
  shot.result.players[p].forEach((cell, s) => {
    const id = cell.empty ? null : shotPick(p, s);
    const mon = id && store.engine.byId.get(id);
    if (mon && !species.has(mon.sp)) { species.add(mon.sp); ids.push(id); }
  });
  if (!ids.length) return toast('이 패널에서 읽은 포켓몬이 없어요');
  update(s => { s.opponents = ids.slice(0, 6); });
  toast(`${p + 1}번 패널의 ${ids.length}마리를 상대 파티로 넣었어요`);
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawCropBox(canvas) {
  drawPreview(canvas, shot.data, null);
  const d = shot.drag, g = canvas.getContext('2d');
  const css = canvas.getBoundingClientRect().width / canvas.width;
  g.strokeStyle = '#ffcb05';
  g.lineWidth = 2;
  g.setLineDash([6, 4]);
  g.strokeRect(Math.min(d.x0, d.x1) / css, Math.min(d.y0, d.y1) / css, Math.abs(d.x1 - d.x0) / css, Math.abs(d.y1 - d.y0) / css);
}

function renderShot() {
  const { engine } = store;
  if (!shot.busy && !shot.result) { shotEl.hidden = true; shotEl.innerHTML = ''; return; }
  shotEl.hidden = false;
  const head = `<div class="card-head"><h3>${ICONS.image} 스크린샷 인식</h3>
    <span class="sub">보드 화면 왼쪽 플레이어 패널 4개 · 주황 테두리는 확인이 필요한 칸</span>
    <button class="btn sm ghost" type="button" data-act="shot-close">닫기</button></div>`;
  if (shot.busy || !shot.result) {
    shotEl.innerHTML = `${head}<p class="note">아이콘을 읽는 중… (처음 한 번은 아이콘 데이터 약 0.5MB를 받아요)</p>`;
    return;
  }
  const mine = new Set(store.party.map(m => engine.byId.get(m.id)?.sp));
  const rows = shot.result.players.map((row, p) => {
    const ids = row.map((c, s) => (c.empty ? null : shotPick(p, s))).filter(Boolean);
    const isMe = ids.length > 0 && ids.filter(id => mine.has(engine.byId.get(id)?.sp)).length >= Math.max(2, Math.ceil(ids.length * 0.6));
    const chips = row.map((cell, s) => {
      if (cell.empty) return '';
      const id = shotPick(p, s), mon = id && engine.byId.get(id);
      const pic = mon ? sprite(mon) : '<span class="shot-none">?</span>';
      // 고르지 않고 인식한 그대로일 때만 이로치·기절 표시
      const tags = id === cell.id ? `${cell.shiny ? '<i class="shot-tag">이로치</i>' : ''}${cell.fainted ? '<i class="shot-tag faint">기절</i>' : ''}` : '';
      if (!cell.unsure) return `<span class="shot-mon">${pic}<b>${esc(mon?.ko || '알 수 없음')}</b>${tags}</span>`;
      return `<label class="shot-mon unsure" title="확인이 필요해요">${pic}<select class="select" data-shot-alt="${p},${s}">
        ${cell.alts.map(a => `<option value="${a.id}" ${a.id === id ? 'selected' : ''}>${esc(engine.byId.get(a.id)?.ko || '')}</option>`).join('')}
        <option value="" ${id ? '' : 'selected'}>(없음)</option></select>${tags}</label>`;
    }).join('');
    return `<div class="shot-row ${isMe ? 'me' : ''}">
      <span class="shot-label">${p + 1}번 패널${isMe ? '<em>내 파티</em>' : ''}</span>
      <div class="shot-mons">${chips || '<span class="note">포켓몬 없음</span>'}</div>
      <button class="btn sm ${isMe ? 'ghost' : 'primary'}" type="button" data-shot-use="${p}" ${ids.length ? '' : 'disabled'}>상대로 설정</button>
    </div>`;
  }).join('');
  const missed = !shot.result.found
    ? '<p class="shot-warn">보드 화면의 플레이어 패널을 자동으로 찾지 못했어요. 미리보기에서 <b>왼쪽 색깔 패널 4개</b>를 드래그로 감싸 주면 다시 읽어요.</p>' : '';
  shotEl.innerHTML = `${head}${missed}
    <div class="shot-body">
      <div class="shot-preview">
        <canvas id="l-shot-canvas" class="${shot.crop ? 'cropping' : ''}"></canvas>
        <p class="note">${shot.crop ? '미리보기에서 <b>플레이어 패널 4개(색깔 상자)</b>를 드래그로 감싸세요.' : '칸 위치가 어긋났다면'}
          <button class="link-btn" type="button" data-act="shot-crop">${shot.crop ? '취소' : '패널 영역 직접 지정'}</button></p>
      </div>
      <div class="shot-rows">${rows}</div>
    </div>`;
  shot.k = drawPreview(shotEl.querySelector('#l-shot-canvas'), shot.data, shot.crop ? null : shot.result);
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
