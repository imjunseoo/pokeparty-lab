// 기믹 활용 (브라우저/Node 공용): 테라스탈로 파티 약점 막기 · 다이맥스/거다이맥스 효과
//   테라스탈: 테라피스를 지녀야 하고 한 번 쓰면 사라짐. 테라 타입은 기본적으로 자기 타입 중 하나, 마스터테라주얼로 원하는 타입으로 바꿈
//   다이맥스: 다이버섯을 지녀야 함, 3턴 · HP 2배. 거다이맥스는 다이스프를 먹인 거다이맥스 폼이 있는 포켓몬만

/**
 * 테라스탈로 막을 파티 약점: 파티 여럿이 약점인 공격 타입마다, 누가 어떤 테라 타입이 되면 그 타입을 반감 이하로 받는지
 * members: ctx.prep 된 파티 (def = 타입별 받는 배율)
 * @returns [{ type, weak: [멤버 번호], resist: [멤버 번호], picks: [{ i, tera, mult, natural, fixes: [같이 막는 다른 약점 타입], adds: [새로 생기는 약점 중 파티가 이미 약한 타입] }] }]
 */
export function teraPlan(ctx, members, { limit = 4, perType = 2 } = {}) {
  const { engine } = ctx;
  const { types } = engine;
  const weakCount = types.map((_, k) => members.filter(m => m.def[k] >= 2).length);
  const resistCount = types.map((_, k) => members.filter(m => m.def[k] <= 0.5).length);
  const rows = types.map((type, k) => ({ type, k, weak: members.map((m, i) => (m.def[k] >= 2 ? i : -1)).filter(i => i >= 0), resist: members.map((m, i) => (m.def[k] <= 0.5 ? i : -1)).filter(i => i >= 0) }))
    .filter(r => r.weak.length >= 2 && r.weak.length > r.resist.length)
    .sort((x, y) => (y.weak.length - y.resist.length) - (x.weak.length - x.resist.length) || y.weak.length - x.weak.length)
    .slice(0, limit);
  for (const r of rows) {
    const cands = [];
    members.forEach((m, i) => {
      if (m.def[r.k] <= 0.5) return;   // 이미 반감 이하로 받는 멤버는 테라스탈할 필요 없음
      if (m.stone && !/-mask$/.test(m.stone)) return;   // 메가스톤 등 정해진 도구를 지녀서 테라피스를 못 지님 (오거폰 가면은 테라스탈 가능)
      for (const tera of types) {
        const def = engine.defenseProfile(m.mon, { ability: m.ability, tera });
        if (def[r.k] > 0.5) continue;
        const natural = m.mon.t.includes(tera);
        // 같이 막는 다른 약점(파티가 약한 타입 중 원래 약점 → 반감 이하) · 새로 생기는 약점(파티가 이미 약한 타입)
        const fixes = types.filter((a, k) => k !== r.k && weakCount[k] >= 2 && m.def[k] >= 2 && def[k] <= 0.5);
        const adds = types.filter((a, k) => weakCount[k] >= 2 && m.def[k] < 2 && def[k] >= 2);
        const score = (m.def[r.k] >= 2 ? 2 : 1) + (natural ? 1.5 : 0) + fixes.length - 1.2 * adds.length + (def[r.k] === 0 ? 0.5 : 0)
          - 0.3 * Math.max(0, resistCount[r.k] - 1);
        cands.push({ i, tera, mult: def[r.k], natural, fixes, adds, score });
      }
    });
    // 멤버마다 가장 좋은 테라 타입 하나씩 → 점수 순
    const byMember = new Map();
    for (const c of cands.sort((a, b) => b.score - a.score)) if (!byMember.has(c.i)) byMember.set(c.i, c);
    r.picks = [...byMember.values()].slice(0, perType);
  }
  return rows;
}

// 다이맥스 기술 (타입마다) 이름과 추가 효과
export const MAX_MOVE = {
  normal: ['다이어택', '상대 스피드↓'], fire: ['다이번', '날씨 쾌청'], water: ['다이스트림', '날씨 비'], electric: ['다이썬더', '일렉트릭필드'],
  grass: ['다이그래스', '그래스필드'], ice: ['다이아이스', '날씨 싸라기눈'], fighting: ['다이너클', '아군 공격↑'], poison: ['다이애시드', '아군 특공↑'],
  ground: ['다이어스', '아군 특방↑'], flying: ['다이제트', '아군 스피드↑'], psychic: ['다이사이코', '사이코필드'], bug: ['다이웜', '상대 특공↓'],
  rock: ['다이록', '날씨 모래바람'], ghost: ['다이할로우', '상대 방어↓'], dragon: ['다이드라군', '상대 공격↓'], dark: ['다이아크', '상대 특방↓'],
  steel: ['다이스틸', '아군 방어↑'], fairy: ['다이페어리', '미스트필드'],
};
// 거다이맥스 기술 효과 (게임 기술 표의 효과 코드 → 설명)
const GMAX_FX = {
  StartVineLashOnFoeSide: '4턴 동안 상대에게 매 턴 지속 피해', StartWildfireOnFoeSide: '4턴 동안 상대에게 매 턴 지속 피해',
  StartCannonadeOnFoeSide: '4턴 동안 상대에게 매 턴 지속 피해', StartVolcalithOnFoeSide: '4턴 동안 상대에게 매 턴 지속 피해',
  IgnoreTargetAbility: '위력 160 · 상대 특성 무시', ParalyzeTargetSide: '상대 모두 마비', PoisonTargetSide: '상대 모두 독',
  PoisonOrParalyzeTargetSide: '상대 모두 독 또는 마비', PoisonParalyzeOrSleepTargetSide: '상대 모두 독·마비·잠듦 중 하나',
  ConfuseTargetSide: '상대 모두 혼란', InfatuateTargetSide: '상대 모두 헤롱헤롱', ConfuseTargetSideAddMoney: '상대 모두 혼란',
  DamageTargetAddStealthRocksToFoeSide: '스텔스록 설치', DamageTargetAddSteelsurgeToFoeSide: '강철 압정 설치 (교체할 때마다 피해)',
  BindTargetSideUserCanSwitch: '상대 모두 4~5턴 묶기', LowerTargetSideSpeed2: '상대 모두 스피드 2랭크↓',
  RemoveSideEffectsAndTerrain: '상대 벽·필드 지우기', DamageTargetStartGravity: '중력 5턴', HealUserSideOneSixthOfTotalHP: '아군 HP 1/6 회복',
  CureStatusConditionsUsersSide: '아군 상태이상 회복', LowerTargetSideEva1: '상대 회피율↓', RestoreUserSideConsumedBerries: '먹은 나무열매 되살리기',
  LowerPPOfTargetSideLastMoveBy2: '상대 마지막 기술 PP↓', DamageTargetStartWeakenDamageAgainstUserSide: '오로라베일 5턴 (받는 피해 감소)',
  UserSideCriticalBoost1: '아군 급소율↑', TrapTargetSideInBattle: '상대 교체 못 함', DamageTargetSleepTargetNextTurn: '다음 턴 잠듦 (하품)',
  DisableTargetSideUsingSameMoveConsecutively: '상대 같은 기술 연속 사용 못 함', IgnoreProtections: '다이월·방어 무시',
};
export const gmaxEffect = fn => GMAX_FX[fn] || '';
