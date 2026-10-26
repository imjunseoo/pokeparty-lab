// 진입점: 데이터 로드 → 화면 초기화 → 해시 라우팅 (#/matchup/<slug>, #/party/<파티>, #/strategy, #/lead/<상대>, #/chart)
import {
  store, initStore, subscribe, setMode, loadUsage, loadSets, decodeParty, decodeIds, encodeParty, update, usageInfo,
  isGameMode, TYPE_MODE, GAME_MODE,
} from './state.js';
import { initMatchup, showMatchup, renderMatchup } from './views/matchup.js';
import { initParty, renderParty } from './views/party.js';
import { initLead, renderLead } from './views/lead.js';
import { initCatch, renderCatch } from './views/catch.js';
import { initStarter, renderStarter } from './views/starter.js';
import { initStrategy, renderStrategy } from './views/strategy.js';
import { initChart } from './views/chart.js';
import { $, esc, toast } from './ui/dom.js';

const TABS = ['matchup', 'party', 'strategy', 'catch', 'starter', 'lead', 'chart'];
const TITLES = { party: '파티 추천', strategy: '칸별 전략', catch: '포획 추천', starter: '스타팅 추천', lead: '선봉 추천', chart: '타입 상성표' };
let current = null;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function boot() {
  const bootEl = $('#boot');
  try {
    const [dex, usageIndex, gameData] = await Promise.all([
      fetchJson('data/pokedex.json'),
      fetchJson('data/usage/index.json').catch(() => null),
      fetchJson('data/game/pokemon-party.json').catch(() => null),
    ]);
    initStore(dex, usageIndex, gameData);
    try { await loadUsage(); } catch { store.mode = TYPE_MODE; store.usage = null; }

    initMatchup($('#view-matchup'));
    initParty($('#view-party'));
    initLead($('#view-lead'));
    initCatch($('#view-catch'));
    initStarter($('#view-starter'));
    initStrategy($('#view-strategy'));
    initChart($('#view-chart'));
    setupModeSelect();
    setupTheme();
    renderFooter();
    subscribe(() => {
      if (current === 'matchup') renderMatchup();
      if (current === 'party') renderParty();
      if (current === 'lead') renderLead();
      if (current === 'catch') renderCatch();
      if (current === 'starter') renderStarter();
      if (current === 'strategy') renderStrategy();
      renderFooter();
    });
    window.addEventListener('hashchange', route);
    bootEl.remove();
    route();
    loadSets();
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
  } else if (tab === 'lead') {
    const shared = arg && decodeIds(decodeURIComponent(arg));
    if (shared?.length && arg !== store.opponents.join(',')) update(s => { s.opponents = shared; });
    else renderLead();
  } else if (tab === 'catch') {
    renderCatch();
  } else if (tab === 'starter') {
    renderStarter();
  } else if (tab === 'strategy') {
    renderStrategy();
  }
  if (changed && tab !== 'matchup') window.scrollTo({ top: 0 });
}

function setupModeSelect() {
  const sel = $('#mode-select');
  sel.innerHTML = (store.gameData ? `<option value="${GAME_MODE}">포켓몬 파티! (게임 룰)</option>` : '')
    + store.usageIndex.map(f => `<option value="${f.key}">실전: ${esc(f.label)} (${esc(f.month)})</option>`).join('')
    + `<option value="${TYPE_MODE}">타입 상성만 (전체 도감)</option>`;
  sel.value = store.mode;
  sel.addEventListener('change', async () => {
    sel.disabled = true;
    await setMode(sel.value);
    sel.value = store.mode;
    sel.disabled = false;
    const info = usageInfo();
    toast(isGameMode() ? '「포켓몬 파티!」 게임 룰로 분석해요 (파티 화면에서 맵·룰 설정)'
      : info ? `${info.label} 실전 데이터로 전환했어요` : '타입 상성만으로 분석해요');
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
  const { dex, gameData } = store;
  const info = usageInfo();
  const date = dex.meta.generated.slice(0, 10);
  $('#data-info').innerHTML = `도감 데이터 ${esc(date)} 갱신 · ${dex.meta.species}종 ${dex.meta.count}개 폼`
    + (isGameMode() ? ` · 「포켓몬 파티!」 v${esc(gameData.meta.version)} 게임 데이터 (${esc(gameData.meta.extracted)} 추출)` : '')
    + (info ? ` · 실전 통계 ${esc(info.label)} ${esc(info.month)} (${info.battles.toLocaleString()}판, 레이팅 ${info.cutoff}+)` : '');
}

boot();
