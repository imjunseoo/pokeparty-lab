// 「포켓몬 파티!」 기술 표 + 포켓몬별로 배울 수 있는 기술 (내 세팅 입력 · 최선 세팅 계산용) → site/data/game/moves.json
//
// list[i] = [slug, 한글명, 타입, 분류(0 변화 · 1 물리 · 2 특수), 위력, 명중(0 = 반드시 맞음), 우선도, 플래그, 타수, 효과]
//   위력: 게임 데이터 그대로. 상황마다 달라지는 기술(데이터상 1)은 대표값, 일격필살·반사 같은 기술은 0
//   플래그(비트): 1 접촉 · 2 펀치 · 4 물기 · 8 파동 · 16 베기 · 32 소리 · 64 급소율 높음 · 128 추가 효과(우격다짐) · 256 상대 여럿 공격(더블)
//   타수: 연속기 평균 (2~5회 = 3.1, 트리플킥·트리플악셀 = 위력이 오르는 3타라 6)
//   효과: crit 급소 확정 · charge 모으는 2턴(미래예지 포함) · recharge 다음 턴 쉼 · selfko 자폭 · lvl 레벨만큼 고정 · half 상대 HP 절반
//         def 방어로 공격(바디프레스) · foul 상대 공격으로(속임수) · psy 특수기지만 상대 방어로(사이코쇼크)
//         cond 조건부 성공(힘껏펀치 등) · first 첫 턴만(속이기) · drop 쓰면 능력 하락(오버히트) · lock 난동 · recoil 반동 · knock 탁쳐서떨구기
// learn[dex id] = 기술 번호 배열 (진화 전 단계에서 물려받는 기술 포함). 레벨업으로는 못 배우고 기술 칸·학습장치의
//   「기술 떠올리기」로만 배우는 기술(교배·가르침·기술머신)은 -(번호 + 1)

const FLAG_BITS = { Contact: 1, Punching: 2, Biting: 4, Pulse: 8, Slicing: 16, Sound: 32, HighCriticalHitRate: 64 };
const SPREAD = new Set(['AllNearFoes', 'AllNearOthers']);
// 위력이 상황마다 다른 기술의 대표 위력
const VAR_POWER = {
  PowerHigherWithTargetWeight: 80, PowerHigherWithUserHeavierThanTarget: 80, PowerHigherWithTargetFasterThanUser: 80,
  PowerHigherWithUserFasterThanTarget: 80, PowerHigherWithUserHappiness: 102, PowerLowerWithUserHappiness: 102,
  PowerLowerWithUserHP: 60, PowerHigherWithTargetHP: 100, PowerHigherWithTargetHP100PowerRange: 80,
  PowerHigherWithTargetPositiveStatStages: 60, PowerHigherWithUserPositiveStatStages: 40,
  RandomPowerDoublePowerIfTargetUnderground: 70, PowerHigherWithLessPP: 50,
};
const FIXED = { FixedDamageUserLevel: 'lvl', FixedDamageHalfTargetHP: 'half' };

function hitsOf(code) {
  if (/^HitThreeTimesPowersUpWithEachHit/.test(code)) return 6;
  if (/^HitTwoToFiveTimes/.test(code)) return 3.1;
  if (/^HitTenTimes/.test(code)) return 7;
  if (/^HitThreeTimes/.test(code)) return 3;
  if (/^HitTwoTimes/.test(code)) return 2;
  return 1;
}

// 조건이 맞아야만 성공하는 기술 (대부분 실패)
const COND = new Set(['FailsIfUserDamagedThisTurn', 'FailsIfUserNotConsumedBerry', 'FailsIfUserHasUnusedMove', 'FailsUnlessTargetSharesTypeWithUser',
  'HealUserByHalfOfDamageDoneIfTargetAsleep', 'FlinchTargetFailsIfUserNotAsleep', 'RemoveTerrain', 'MultiTurnAttackPowersUpEachTurn']);

function fxOf(code) {
  if (FIXED[code]) return FIXED[code];
  if (COND.has(code)) return 'cond';
  if (/FailsIfNotUserFirstTurn$/.test(code)) return 'first';                 // 속이기·만나서반가워: 첫 턴만
  if (/AlwaysCriticalHit/.test(code)) return 'crit';
  if (/^TwoTurnAttack/.test(code) || code === 'AttackTwoTurnsLater') return 'charge';
  if (code === 'AttackAndSkipNextTurn') return 'recharge';
  if (/^UserFaintsExplosive/.test(code)) return 'selfko';
  if (/LowerUserSpAtk2$|^LowerUserAtkDef1$|^UserLosesFireType$/.test(code)) return 'drop';   // 쓰고 나면 화력이 떨어짐
  if (code === 'MultiTurnAttackConfuseUserAtEnd') return 'lock';
  if (/^Recoil/.test(code)) return 'recoil';
  if (code === 'UseUserDefenseInsteadOfUserAttack') return 'def';
  if (code === 'UseTargetAttackInsteadOfUserAttack') return 'foul';
  if (code === 'UseTargetDefenseInsteadOfTargetSpDef') return 'psy';       // 사이코쇼크: 특수기인데 상대 방어로
  if (code === 'RemoveTargetItem') return 'knock';                          // 탁쳐서떨구기: 도구가 있으면 1.5배
  return '';
}

/**
 * moves: moves.dat (Map 게임 기술 ID → GameData::Move), slugOf: 게임 기술 ID → 사이트 slug, nameOf: (slug, 영문명) → 한글명
 * learnOf: dex id → Set(게임 기술 ID 의 toId), ids: 습득표를 만들 dex id 목록, toId
 */
export function buildMoves({ moves, slugOf, nameOf, learnOf, relearnOf = () => [], ids, toId }) {
  const list = [], index = new Map();
  for (const [key, m] of moves) {
    const flags = (m.flags || []).map(String);
    if (flags.some(f => /^(ZMove|DynamaxMove|GmaxMove)/.test(f))) continue;   // Z기술·다이맥스 기술은 배우는 기술이 아님
    const code = String(m.function_code || '');
    const cat = m.category === 2 ? 0 : m.category + 1;
    let power = m.power || 0;
    const fx = fxOf(code);
    if (power === 1) power = VAR_POWER[code] || 0;
    const id = toId(String(key)), slug = slugOf(String(key));
    index.set(id, list.length);
    list.push([
      slug, nameOf(slug, String(m.real_name)), String(m.type).toLowerCase(), cat,
      power, m.accuracy || 0, m.priority || 0,
      flags.reduce((a, f) => a | (FLAG_BITS[f] || 0), 0) | (m.effect_chance > 0 ? 128 : 0) | (SPREAD.has(String(m.target)) ? 256 : 0),
      hitsOf(code), fx,
    ]);
  }
  const learn = {};
  for (const dexId of ids) {
    const re = relearnOf(dexId);
    const idx = [...learnOf(dexId)].filter(mv => index.has(mv)).sort((a, b) => index.get(a) - index.get(b));
    if (idx.length) learn[dexId] = idx.map(mv => (re.has(mv) ? -(index.get(mv) + 1) : index.get(mv)));
  }
  return { list, learn };
}
