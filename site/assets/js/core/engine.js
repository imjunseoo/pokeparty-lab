// 타입 상성 계산 엔진 (브라우저·Node 공용, DOM 의존 없음)

// 방어 상성을 바꾸는 특성. 숫자는 받는 배율에 곱하는 값(0 = 무효)
export const ABILITY_EFFECTS = {
  levitate: { ground: 0 },
  'earth-eater': { ground: 0 },
  'flash-fire': { fire: 0 },
  'well-baked-body': { fire: 0 },
  'water-absorb': { water: 0 },
  'storm-drain': { water: 0 },
  'dry-skin': { water: 0, fire: 1.25 },
  'volt-absorb': { electric: 0 },
  'lightning-rod': { electric: 0 },
  'motor-drive': { electric: 0 },
  'sap-sipper': { grass: 0 },
  'thick-fat': { fire: 0.5, ice: 0.5 },
  heatproof: { fire: 0.5 },
  'water-bubble': { fire: 0.5 },
  'purifying-salt': { ghost: 0.5 },
  fluffy: { fire: 2 },
  'wonder-guard': 'wonder',  // 효과가 굉장한 기술만 맞음
  filter: 'filter',          // 효과가 굉장한 기술 ×0.75
  'solid-rock': 'filter',
  'prism-armor': 'filter',
};

// 종족값에 비해 실전 성능이 크게 떨어지는 특성 (다른 특성을 고를 수 없을 때만 적용)
const ABILITY_BST_PENALTY = { truant: 250, 'slow-start': 250, defeatist: 80 };

export const STAT_LABELS = ['HP', '공격', '방어', '특공', '특방', '스피드'];
export const STAT_SHORT = ['H', 'A', 'B', 'C', 'D', 'S'];

export function createEngine(dex) {
  const types = dex.types;
  const tIdx = Object.fromEntries(types.map((t, i) => [t, i]));
  const chart = dex.chart;
  const byId = new Map(dex.pokemon.map(p => [p.id, p]));
  const bySlug = new Map(dex.pokemon.map(p => [p.slug, p]));

  const typeKo = t => dex.typeNames[t]?.ko || t;
  const bst = mon => mon.st.reduce((a, b) => a + b, 0);
  const abilityKo = a => dex.abilities[a]?.[0] || a;
  const abilitiesOf = mon => [...mon.ab, mon.ha].filter((a, i, arr) => a && arr.indexOf(a) === i);
  const effectiveBst = mon => {
    const pens = abilitiesOf(mon).map(a => ABILITY_BST_PENALTY[a] || 0);
    return bst(mon) - (pens.length ? Math.min(...pens) : 0);
  };

  /** 공격 타입 atk 가 방어 타입 목록에 주는 배율 */
  const effectiveness = (atk, defTypes) => defTypes.reduce((m, d) => m * chart[tIdx[atk]][tIdx[d]], 1);

  function applyAbility(ability, atk, m) {
    const eff = ABILITY_EFFECTS[ability];
    if (!eff) return m;
    if (eff === 'wonder') return m >= 2 ? m : 0;
    if (eff === 'filter') return m >= 2 ? m * 0.75 : m;
    if (eff[atk] === undefined) return m;
    return eff[atk] === 0 ? 0 : m * eff[atk];
  }

  /** 테라스탈 시 방어 타입은 테라 타입 하나로 바뀐다 (스텔라는 원래 타입 유지) */
  const defenseTypes = (mon, tera) => (tera && tera !== 'stellar' ? [tera] : mon.t);
  /** 자속(STAB) 공격 타입: 원래 타입 + 테라 타입 */
  const stabTypes = (mon, tera) => (tera && tera !== 'stellar' && !mon.t.includes(tera) ? [...mon.t, tera] : mon.t);

  /** 18개 공격 타입별로 받는 배율 배열 */
  function defenseProfile(mon, { ability = null, tera = null } = {}) {
    const defTypes = defenseTypes(mon, tera);
    return types.map(atk => applyAbility(ability, atk, effectiveness(atk, defTypes)));
  }

  /** 공격자의 자속 기술 중 가장 잘 들어가는 배율 (방어자 특성·테라 반영) */
  function bestStab(attacker, defender, { atkTera = null, defAbility = null, defTera = null } = {}) {
    const prof = defenseProfile(defender, { ability: defAbility, tera: defTera });
    let best = 0, type = null;
    for (const t of stabTypes(attacker, atkTera)) {
      const m = prof[tIdx[t]];
      if (m > best) { best = m; type = t; }
    }
    return { mult: best, type };
  }

  /** 방어 배율별 그룹: [{ mult, types: [...] }] (큰 배율부터) */
  function groupProfile(profile) {
    const groups = new Map();
    profile.forEach((m, i) => {
      const key = Math.round(m * 1000) / 1000;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(types[i]);
    });
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([mult, ts]) => ({ mult, types: ts }));
  }

  /** 특성 기본값: 사용률 1위 특성 → 없으면 첫 번째 일반 특성 */
  function defaultAbility(mon, usageMon) {
    const top = usageMon?.ab?.[0]?.[0];
    if (top && abilitiesOf(mon).includes(top)) return top;
    return mon.ab[0] || mon.ha || null;
  }

  return {
    dex, types, tIdx, chart, byId, bySlug,
    typeKo, bst, effectiveBst, abilityKo, abilitiesOf, effectiveness, applyAbility,
    defenseTypes, stabTypes, defenseProfile, bestStab, groupProfile, defaultAbility,
  };
}

export function formatMult(m) {
  if (m === 0) return '0';
  if (m === 0.25) return '¼';
  if (m === 0.5) return '½';
  if (m === 0.125) return '⅛';
  return String(Math.round(m * 100) / 100);
}

/** 배율 → 상태 키 (CSS 색상용) */
export function multClass(m) {
  if (m === 0) return 'x0';
  if (m >= 4) return 'x4';
  if (m >= 2) return 'x2';
  if (m > 1) return 'x15';
  if (m === 1) return 'x1';
  if (m >= 0.5) return 'x05';
  return 'x025';
}
