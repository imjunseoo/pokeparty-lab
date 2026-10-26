// 세팅 한 줄 설명: 어떤 세팅인지(역할) + 왜 좋은지 (기술·도구·성격·노력치로 판단)
import { store } from '../state.js';
import { josa } from './dom.js';
import { SETUP_PHYS, SETUP_SPEC, SETUP_BOTH, RECOVERY, NATURES } from '../core/build.js';

const HAZARDS = new Set(['stealth-rock', 'spikes', 'toxic-spikes', 'sticky-web']);
const PIVOTS = new Set(['u-turn', 'volt-switch', 'flip-turn', 'parting-shot', 'teleport', 'chilly-reception', 'shed-tail']);
const STATUS = new Set(['will-o-wisp', 'thunder-wave', 'toxic', 'spore', 'sleep-powder', 'yawn', 'glare', 'hypnosis', 'stun-spore', 'nuzzle']);
const SCREENS = new Set(['reflect', 'light-screen', 'aurora-veil']);
const DOUBLES = new Set(['fake-out', 'follow-me', 'rage-powder', 'helping-hand', 'tailwind', 'trick-room', 'wide-guard', 'icy-wind', 'electroweb', 'snarl']);
const PROTECT = new Set(['protect', 'detect', 'kings-shield', 'spiky-shield', 'baneful-bunker', 'silk-trap', 'burning-bulwark']);
// 랭크업 기술이 올리는 능력
const SETUP_STAT = {
  'swords-dance': '공격', 'dragon-dance': '공격·스피드', 'bulk-up': '공격·방어', coil: '공격·방어', curse: '공격·방어',
  'hone-claws': '공격', 'belly-drum': '공격', 'victory-dance': '공격·방어·스피드', 'tidy-up': '공격·스피드', 'shift-gear': '공격·스피드',
  howl: '공격', 'no-retreat': '모든 능력', 'nasty-plot': '특공', 'calm-mind': '특공·특방', 'quiver-dance': '특공·특방·스피드',
  'tail-glow': '특공', geomancy: '특공·특방·스피드', 'shell-smash': '공격·특공·스피드', 'work-up': '공격·특공', growth: '공격·특공',
  'clangorous-soul': '모든 능력', 'fillet-away': '공격·특공·스피드',
};
// Smogon 세팅 이름 → 한국어 (랜덤배틀 세팅은 이미 한국어)
const NAME_KO = {
  'Choice Scarf': '구애스카프', 'Choice Band': '구애머리띠', 'Choice Specs': '구애안경', 'Choice Item': '구애 도구', Choice: '구애 도구',
  Defensive: '방어형', Offensive: '공격형', 'Swords Dance': '칼춤', 'Nasty Plot': '나쁜음모', 'Calm Mind': '명상', 'Dragon Dance': '용의춤',
  'Shell Smash': '껍질깨기', 'Bulk Up': '벌크업', 'Quiver Dance': '나비춤', 'Bulky Attacker': '내구형 공격', 'Offensive Pivot': '공격형 교체',
  'Defensive Pivot': '방어형 교체', Pivot: '교체형', Wallbreaker: '벽 부수기', 'Assault Vest': '돌격조끼', 'Stealth Rock': '스텔스록',
  'Specially Defensive': '특수 방어형', 'Physically Defensive': '물리 방어형', 'Glass Cannon': '유리대포', 'All-out Attacker': '올인 공격',
  'All-Out Attacker': '올인 공격', Utility: '유틸', 'Bulky Support': '내구형 서포트', Sweeper: '스위퍼', Lead: '선발', 'Hazard Setter': '설치형',
  'Trick Room': '트릭룸', Tailwind: '순풍', Support: '서포트', Setup: '랭크업', 'Mixed Attacker': '양면 공격', 'Life Orb': '생명의구슬',
  Tank: '탱커', 'Belly Drum': '배북', Substitute: '대타출동', 'Hyper Offense': '하이퍼 공격', Spinner: '고속스핀', Defogger: '안개제거',
};
export const setNameKo = n => NAME_KO[n] || n;

/** 추천 세팅의 출처 이름 (예: "Smogon OU", "배틀스타디움", "VGC") */
export function refSource(s) {
  const gen = +(String(s.src).match(/(\d)세대/)?.[1] || 9);
  const fmt = String(s.src).trim().split(' ').pop();
  const old = gen !== 9 ? `(${gen}세대)` : '';
  const src = s.key === 'B' ? '배틀스타디움' : s.key === 'S' ? `Smogon ${fmt}${old}`
    : s.key === 'D' ? (String(s.src).includes('VGC') ? 'VGC' : '랜덤배틀 더블') : s.key === 'R' ? `랜덤배틀${old}` : '자체 생성';
  return src;
}

/** 기술 정보: 게임 기술 표 → 추천 세팅 사전 → 실전 사전 순 */
function moveInfo(slug) {
  const g = store.moves?.bySlug.get(slug);
  if (g) return { slug, ko: g.ko, type: g.type, cat: g.cat, power: g.power };
  const s = store.sets?.moves[slug] || store.usage?.moves[slug];
  return s ? { slug, ko: s[0], type: s[2], cat: s[3], power: 0 } : { slug, ko: slug, type: null, cat: 0, power: 0 };
}
const itemKo = slug => store.gameData?.itemNames[slug]?.[0] || store.sets?.items[slug]?.[0] || store.usage?.items[slug]?.[0] || slug;
const names = list => list.join('·');
const ro = w => josa(w, '으로');   // ~으로/로
const eul = w => josa(w, '을를');  // ~을/를

/**
 * 세팅 → { role: 어떤 세팅인지, line: 왜 좋은지/어떻게 쓰는지 }
 * set: 추천 세팅 형식 { mv: [slug | [후보...]], it, na, ev } 또는 계산 세팅 { mv: [slug], it, na }
 */
export function describeSet(mon, set, { double = false } = {}) {
  const { engine } = store;
  const first = x => (Array.isArray(x) ? x[0] : x);
  const moves = (set.mv || []).map(first).filter(Boolean).map(moveInfo);
  const item = first(set.it) || null;
  const nat = NATURES[first(set.na)];
  // 공격기: 자속 먼저, 위력 높은 순 (추천 세팅은 위력을 모르면 원래 순서)
  const atk = moves.filter(m => m.cat > 0).sort((a, b) => b.power - a.power);
  const stab = atk.filter(m => mon.t.includes(m.type));
  const main = [...stab, ...atk.filter(m => !stab.includes(m))].slice(0, 2).map(m => m.ko);
  const find = group => moves.find(m => group.has(m.slug));
  const setup = moves.find(m => SETUP_PHYS.has(m.slug) || SETUP_SPEC.has(m.slug) || SETUP_BOTH.has(m.slug));
  const heal = find(RECOVERY), hazard = find(HAZARDS), pivot = find(PIVOTS), status = find(STATUS), screen = find(SCREENS), protect = find(PROTECT);
  const dbl = moves.filter(m => DOUBLES.has(m.slug));
  const ev = String(set.ev || '').split('/').map(Number);
  const fast = ev[5] >= 200 || (nat && nat[1] === 5 && nat[1] !== nat[2]);
  const bulky = (ev[0] || 0) + Math.max(ev[2] || 0, ev[4] || 0) >= 400 || (nat && (nat[1] === 2 || nat[1] === 4) && nat[1] !== nat[2]);
  const mainText = names(main) || '공격기';
  let role, line;
  if (double && protect && dbl.length) {
    role = '더블 서포트'; line = `${ro(names(dbl.slice(0, 2).map(m => m.ko)))} 상대를 견제하고 ${ro(protect.ko)} 버티며 짝을 도와요`;
  } else if (item === 'choice-scarf') {
    role = '구애스카프 선공형'; line = `스피드 1.5배로 먼저 ${eul(mainText)} 꽂아요 (한 기술만 계속 써야 해요)`;
  } else if (item === 'choice-band' || item === 'choice-specs') {
    role = `${itemKo(item)} 한 방형`; line = `${mainText}의 화력이 1.5배라 받아내기 어려워요 (한 기술만 계속)`;
  } else if (setup) {
    role = `${fast ? '빠른 ' : bulky ? '내구형 ' : ''}${setup.ko} 랭크업`;
    line = `${ro(setup.ko)} ${eul(SETUP_STAT[setup.slug] || '능력')} 올린 뒤 ${ro(mainText)} 몰아쳐요${heal ? ` · ${ro(heal.ko)} 회복` : ''}`;
  } else if (moves.some(m => m.slug === 'trick-room')) {
    role = '트릭룸'; line = `트릭룸으로 느린 쪽이 먼저 움직이게 한 뒤 ${ro(mainText)} 때려요`;
  } else if (heal && (status || hazard || atk.length <= 2)) {
    role = '막이형'; line = `${ro(heal.ko)} 회복하며 ${ro(names([status, hazard].filter(Boolean).map(m => m.ko)) || mainText)} 상대를 갉아먹어요`;
  } else if (hazard) {
    role = '설치형'; line = `${eul(hazard.ko)} 깔아 상대가 교체할 때마다 피해를 주고 ${pivot ? `${ro(pivot.ko)} 빠져요` : `${ro(mainText)} 싸워요`}`;
  } else if (screen) {
    role = '벽 서포트'; line = `${ro(screen.ko)} 받는 피해를 줄여 동료가 싸우기 쉽게 해요`;
  } else if (pivot) {
    role = '교체형'; line = `${ro(pivot.ko)} 유리하게 교체하며 ${ro(names(main.filter(x => x !== pivot.ko)) || mainText)} 압박해요`;
  } else if (item === 'assault-vest') {
    role = '돌격조끼 공격형'; line = `특수 공격을 1.5배 버티며 ${ro(mainText)} 맞서요`;
  } else if (item === 'focus-sash') {
    role = '기합의띠 선발'; line = `한 번은 반드시 버티고 ${eul(mainText)} 남겨요`;
  } else if (item === 'life-orb') {
    role = `${fast ? '빠른 ' : ''}생명의구슬 공격형`; line = `화력 1.3배로 ${eul(mainText)} 바꿔 가며 써요`;
  } else {
    role = fast ? '빠른 공격형' : bulky ? '내구형 공격' : '공격형'; line = `${mainText} 위주로 싸워요`;
  }
  // 왜 좋은지: 자속으로 못 찌르는 타입을 보조 기술로 찌름
  const stabTypes = [...new Set(mon.t)];
  // 레벨만큼 고정 데미지(지구던지기 등)는 상성과 상관없으니 빼고
  const cover = atk.find(m => m.type && !stabTypes.includes(m.type) && !['lvl', 'half'].includes(store.moves?.bySlug.get(m.slug)?.fx));
  if (cover) {
    const { chart, tIdx, types } = engine;
    const gains = types.filter(t => chart[tIdx[cover.type]][tIdx[t]] >= 2 && Math.max(...stabTypes.map(s => chart[tIdx[s]][tIdx[t]])) < 2);
    if (gains.length) line += ` · ${ro(cover.ko)} ${names(gains.slice(0, 2).map(t => engine.typeKo(t)))}까지 찔러요`;
  }
  return { role, line };
}
