// 진입점: 데이터 로드 → 화면 초기화 → 해시 라우팅 (#/matchup/<slug>, #/party/<파티>, #/chart)
import { store, initStore, subscribe, setMode, loadUsage, decodeParty, encodeParty, update, usageInfo, TYPE_MODE } from './state.js';
import { initMatchup, showMatchup, renderMatchup } from './views/matchup.js';
import { initParty, renderParty } from './views/party.js';
import { initChart } from './views/chart.js';
import { $, esc, toast } from './ui/dom.js';

const TABS = ['matchup', 'party', 'chart'];
const TITLES = { party: '파티 추천', chart: '타입 상성표' };
let current = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function boot() {
  const bootEl = $('#boot');
  try {
    const [dex, usageIndex] = await Promise.all([
      fetchJson('data/pokedex.json'),
      fetchJson('data/usage/index.json').catch(() => null),
    ]);
    initStore(dex, usageIndex);
    try { await loadUsage(); } catch { store.mode = TYPE_MODE; store.usage = null; }

    initMatchup($('#view-matchup'));
    initParty($('#view-party'));
    initChart($('#view-chart'));
    setupModeSelect();
    setupTheme();
    renderFooter();
    subscribe(() => {
      if (current === 'matchup') renderMatchup();
      if (current === 'party') renderParty();
      renderFooter();
    });
    window.addEventListener('hashchange', route);
    bootEl.remove();
    route();
  } catch (err) {
    console.error(err);
    bootEl.classList.add('error');
    bootEl.querySelector('p').textContent = '데이터를 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
  }
}

function route() {
  const [, name, arg = ''] = location.hash.match(/^#\/(\w+)(?:\/(.*))?$/) || [];
  const tab = TABS.includes(name) ? name : 'matchup';
  const changed = tab !== current;
  current = tab;
  for (const t of TABS) $(`#view-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (tab !== 'matchup') document.title = `${TITLES[tab]} · 포켓파티 랩`;
  if (tab === 'matchup') {
    if (!arg) document.title = '포켓파티 랩 · 포켓몬 상성 & 파티 추천';
    showMatchup(decodeURIComponent(arg) || null);
  } else if (tab === 'party') {
    const shared = arg && decodeParty(decodeURIComponent(arg));
    if (shared?.length && arg !== encodeParty(store.party)) update(s => { s.party = shared; });
    else renderParty();
  }
  if (changed && tab !== 'matchup') window.scrollTo({ top: 0 });
}

function setupModeSelect() {
  const sel = $('#mode-select');
  sel.innerHTML = store.usageIndex.map(f => `<option value="${f.key}">실전: ${esc(f.label)} (${esc(f.month)})</option>`).join('')
    + `<option value="${TYPE_MODE}">타입 상성만 (전체 도감)</option>`;
  sel.value = store.mode;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    await setMode(sel.value);
    sel.value = store.mode;
    sel.disabled = false;
    const info = usageInfo();
    toast(info ? `${info.label} 실전 데이터로 전환했어요` : '타입 상성만으로 분석해요');
  });
}

function setupTheme() {
  const btn = $('#theme-toggle');
  const media = matchMedia('(prefers-color-scheme: dark)');
  const effective = () => document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');
  btn.addEventListener('click', () => {
    const next = effective() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('ppl.theme', next); } catch { /* 저장 불가 환경 */ }
  });
}

function renderFooter() {
  const { dex } = store;
  const info = usageInfo();
  const date = dex.meta.generated.slice(0, 10);
  $('#data-info').innerHTML = `도감 데이터 ${esc(date)} 갱신 · ${dex.meta.species}종 ${dex.meta.count}개 폼`
    + (info ? ` · 실전 통계 ${esc(info.label)} ${esc(info.month)} (${info.battles.toLocaleString()}판, 레이팅 ${info.cutoff}+)` : '');
}

boot();
