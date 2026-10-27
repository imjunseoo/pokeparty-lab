// 내 세팅 평가 · 최선 세팅 계산 (브라우저·Node 공용, DOM 의존 없음)
//
// 「포켓몬 파티!」 육성 규칙 (게임 스크립트 기준)
//   노력치 없음 · 개체값 20(기본) / 31(트레이닝 칸 1회에 능력 하나, 금색병뚜껑은 전부)
//   성격·특성(숨겨진 특성 포함)은 트레이닝 칸에서 원하는 것으로, 기술은 기술 칸에서 배울 수 있는 기술 하나를 골라 배운다
//
// 세팅 점수 = 화력 − 0.5 × 받는 피해 + 20 × 선공 비율 + 변화기·도구·특성 가치   (상대 = 이 맵에서 만날 포켓몬, 출현 가중 평균)
//   화력      : 기술 하나로 줄 수 있는 최대 데미지 (상대 HP 대비 %, 100% 상한)
//   받는 피해 : 상대의 자속 공격(위력 90, 더 높은 공격 능력치)에 받는 데미지 % (100% 상한)
//   선공 비율 : 스피드가 상대보다 빠른 비율
//   변화기    : 추천 세팅(Smogon·랜덤배틀)에 자주 들어가는 변화기일수록, 일반적으로 쓸모 있는 변화기일수록 가치가 높다

export const BASE_IV = 20, PERFECT_IV = 31;
const ROLL = 0.925;        // 데미지 난수 평균
const TAKEN_W = 0.5, SPEED_W = 20, PRIOR_W = 8;

// 성격: slug → [한글, 올리는 능력, 내리는 능력] (1 공격 · 2 방어 · 3 특공 · 4 특방 · 5 스피드, 같으면 무보정)
export const NATURES = {
  hardy: ['노력', 1, 1], lonely: ['외로움', 1, 2], brave: ['용감', 1, 5], adamant: ['고집', 1, 3], naughty: ['개구쟁이', 1, 4],
  bold: ['대담', 2, 1], docile: ['온순', 2, 2], relaxed: ['무사태평', 2, 5], impish: ['장난꾸러기', 2, 3], lax: ['촐랑', 2, 4],
  timid: ['겁쟁이', 5, 1], hasty: ['성급', 5, 2], serious: ['성실', 5, 5], jolly: ['명랑', 5, 3], naive: ['천진난만', 5, 4],
  modest: ['조심', 3, 1], mild: ['의젓', 3, 2], quiet: ['냉정', 3, 5], bashful: ['수줍음', 3, 3], rash: ['덜렁', 3, 4],
  calm: ['차분', 4, 1], gentle: ['얌전', 4, 2], sassy: ['건방', 4, 5], careful: ['신중', 4, 3], quirky: ['변덕', 4, 4],
};

// 공격 타입을 올리는 도구 (×1.2)
export const TYPE_ITEMS = {
  charcoal: 'fire', 'mystic-water': 'water', magnet: 'electric', 'miracle-seed': 'grass', 'never-melt-ice': 'ice',
  'black-belt': 'fighting', 'poison-barb': 'poison', 'soft-sand': 'ground', 'sharp-beak': 'flying', 'twisted-spoon': 'psychic',
  'silver-powder': 'bug', 'hard-stone': 'rock', 'spell-tag': 'ghost', 'dragon-fang': 'dragon', 'black-glasses': 'dark',
  'metal-coat': 'steel', 'silk-scarf': 'normal', 'fairy-feather': 'fairy',
  'flame-plate': 'fire', 'splash-plate': 'water', 'zap-plate': 'electric', 'meadow-plate': 'grass', 'icicle-plate': 'ice',
  'fist-plate': 'fighting', 'toxic-plate': 'poison', 'earth-plate': 'ground', 'sky-plate': 'flying', 'mind-plate': 'psychic',
  'insect-plate': 'bug', 'stone-plate': 'rock', 'spooky-plate': 'ghost', 'draco-plate': 'dragon', 'dread-plate': 'dark',
  'iron-plate': 'steel', 'pixie-plate': 'fairy',
};
// 계산에 반영하는 도구 (이 밖의 도구는 추천 세팅에 자주 나오면 가치를 준다)
export const MODELED_ITEMS = new Set([...Object.keys(TYPE_ITEMS), 'choice-band', 'choice-specs', 'choice-scarf', 'life-orb', 'expert-belt',
  'muscle-band', 'wise-glasses', 'punching-glove', 'loaded-dice', 'power-herb', 'assault-vest', 'leftovers', 'sitrus-berry',
  'focus-sash', 'eviolite', 'light-ball', 'thick-club', 'black-sludge']);
// 구애 도구 (상점·아이템 칸에서 무작위라 구하기 힘들어 빼고 볼 수 있음)
export const CHOICE = new Set(['choice-band', 'choice-specs', 'choice-scarf']);
// 추천 세팅에 쓸 도구 기준: 전부 · 구애 도구 빼기 · 도구 없이 (못 구했을 때)
export const ITEM_MODES = [
  { key: 'all', label: '전부', name: '모든 도구', desc: '이 룰에서 구할 수 있는 도구 전부' },
  { key: 'nochoice', label: '구애 빼기', name: '구애 도구 빼기', desc: '구애머리띠·구애안경·구애스카프를 빼고' },
  { key: 'none', label: '없이', name: '도구 없이', desc: '도구를 못 구했을 때 기준으로' },
];
// -ate 특성: 노말 기술 → 그 타입 ×1.2
const ATE = { aerilate: 'flying', pixilate: 'fairy', refrigerate: 'ice', galvanize: 'electric' };
const ABILITY_TYPE = { transistor: ['electric', 1.3], 'dragons-maw': ['dragon', 1.5], steelworker: ['steel', 1.5], 'rocky-payload': ['rock', 1.5], 'water-bubble': ['water', 2] };
const BAD_ABILITY = { truant: 25, 'slow-start': 25, defeatist: 8, klutz: 4, stall: 4 };

// 일반적으로 쓸모 있는 변화기의 기본 가치 (점수)
const STATUS_VALUE = {
  'swords-dance': 5, 'dragon-dance': 6, 'nasty-plot': 5, 'calm-mind': 5, 'bulk-up': 4, 'quiver-dance': 6, 'shell-smash': 6,
  'shift-gear': 5, coil: 4, agility: 3, 'rock-polish': 3, 'iron-defense': 2, curse: 3, 'belly-drum': 4, 'tail-glow': 4,
  'victory-dance': 5, 'tidy-up': 5, growth: 3, 'hone-claws': 3, 'cosmic-power': 2, amnesia: 2, 'no-retreat': 4, 'clangorous-soul': 5,
  'fillet-away': 4, geomancy: 5, 'work-up': 2,
  recover: 4, roost: 4, 'slack-off': 4, 'soft-boiled': 4, 'milk-drink': 4, moonlight: 3, 'morning-sun': 3, synthesis: 3,
  'shore-up': 4, wish: 3, 'heal-order': 4, 'strength-sap': 4, rest: 2,
  'will-o-wisp': 3, 'thunder-wave': 3, toxic: 3, spore: 5, 'sleep-powder': 3, hypnosis: 2, yawn: 2, 'stun-spore': 2, glare: 3,
  taunt: 2, encore: 2, 'leech-seed': 2, substitute: 2, protect: 2, detect: 2, 'kings-shield': 3, 'spiky-shield': 3, 'baneful-bunker': 3,
  'silk-trap': 3, 'stealth-rock': 3, spikes: 2, 'toxic-spikes': 1, 'sticky-web': 2, defog: 1, 'light-screen': 2, reflect: 2,
  'aurora-veil': 2, tailwind: 2, 'trick-room': 1, 'parting-shot': 2, 'heal-bell': 1, 'destiny-bond': 1,
};
const DOUBLES_STATUS = { protect: 4, detect: 3, 'follow-me': 4, 'rage-powder': 4, 'helping-hand': 2, tailwind: 3, 'trick-room': 3, 'wide-guard': 2 };
// 능력 올리기 기술: 물리 공격용 · 특수 공격용 (공격 기술과 맞지 않으면 가치 없음, 하나만 인정)
export const SETUP_PHYS = new Set(['swords-dance', 'dragon-dance', 'bulk-up', 'coil', 'hone-claws', 'curse', 'belly-drum', 'victory-dance', 'tidy-up', 'shift-gear', 'howl', 'no-retreat']);
export const SETUP_SPEC = new Set(['nasty-plot', 'calm-mind', 'quiver-dance', 'tail-glow', 'geomancy']);
export const SETUP_BOTH = new Set(['shell-smash', 'work-up', 'growth', 'clangorous-soul', 'fillet-away']);
export const RECOVERY = new Set(['recover', 'roost', 'slack-off', 'soft-boiled', 'milk-drink', 'moonlight', 'morning-sun', 'synthesis', 'shore-up', 'wish', 'heal-order', 'strength-sap', 'rest']);
// 쓰고 나서의 손해 (턴·능력치·실패 확률) → 기대 화력 배율
const FX_MULT = { recharge: 0.6, selfko: 0.35, cond: 0.3, first: 0.25, drop: 0.8, lock: 0.9, recoil: 0.92, knock: 1.5 };
// 데미지 밖의 쓸모가 있는 공격기
const ATTACK_BONUS = { 'u-turn': 1.5, 'volt-switch': 1.5, 'flip-turn': 1.5, 'knock-off': 1.5, 'rapid-spin': 1, 'fake-out': 1 };

/**
 * moves.json → { list, bySlug, learn(id), relearn(id) }
 * relearn(id): 레벨업으로는 못 배우고 기술 칸·학습장치의 「기술 떠올리기」로만 배우는 기술 slug (습득표에 -(번호 + 1)로 표시)
 */
export function createMoveBook(json) {
  const list = json.list.map(([slug, ko, type, cat, power, acc, prio, flags, hits, fx], i) => ({ i, slug, ko, type, cat, power, acc, prio, flags, hits, fx }));
  const bySlug = new Map(list.map(m => [m.slug, m]));
  const rows = id => json.learn[id] || [];
  const reCache = new Map();
  const relearn = id => {
    if (!reCache.has(id)) reCache.set(id, new Set(rows(id).filter(i => i < 0).map(i => list[-i - 1].slug)));
    return reCache.get(id);
  };
  return { list, bySlug, learn: id => rows(id).map(i => list[i < 0 ? -i - 1 : i]), relearn };
}

/** Lv·개체값(31이면 true)·성격으로 실제 능력치 [H, A, B, C, D, S] (노력치 0) */
export function statsAt(base, level, iv = [], nature = null) {
  const nat = NATURES[nature];
  return base.map((b, i) => {
    const v = iv[i] ? PERFECT_IV : BASE_IV;
    if (i === 0) return b === 1 ? 1 : Math.floor((2 * b + v) * level / 100) + level + 10;
    const s = Math.floor((2 * b + v) * level / 100) + 5;
    if (!nat || nat[1] === nat[2]) return s;
    return nat[1] === i ? Math.floor(s * 1.1) : nat[2] === i ? Math.floor(s * 0.9) : s;
  });
}

/**
 * 세팅 평가기.
 * ctx: 파티 분석 컨텍스트 (상대 후보 ctx.meta · 타입 배율 ctx.eff), book: createMoveBook
 * opts.level: 기본 레벨 (게임 마지막 Lv.75), opts.battle: 'single' | 'double', opts.sets: sets.json (추천 세팅 = 사전 지식)
 * opts.items: 이 룰에서 구할 수 있는 도구 Set (없으면 도구는 계산에서 고르지 않음)
 */
// relearn: 기술 떠올리기(교배·가르침·기술머신) 기술까지 쓸지. false 면 레벨업 기술만으로 최선 세팅·대체 기술을 고른다
// itemOk(mon, it): 그 포켓몬이 구할 수 있는 도구인지 (전용도구 칸은 쓸 수 있는 포켓몬을 가졌을 때만 팜: 플레이트 → 아르세우스 등)
export function createBuilder(ctx, book, { level = 75, battle = 'single', sets = null, items = null, relearn = true, itemOk = () => true } = {}) {
  const { engine } = ctx;
  const { tIdx } = engine;
  const double = battle === 'double';
  const W = ctx.metaW;
  const targetCache = new Map();
  // 상대 후보의 능력치 (같은 레벨 · 개체값 20 · 무보정)
  const targetsAt = lv => {
    if (!targetCache.has(lv)) {
      targetCache.set(lv, ctx.meta.map((m, q) => {
        const st = statsAt(ctx.stats(m.mon), lv);
        return { q, w: m.w, hp: st[0], atk: st[1], def: st[2], spa: st[3], spd: st[4], spe: st[5], stabs: engine.stabTypes(m.mon).map(s => tIdx[s]) };
      }));
    }
    return targetCache.get(lv);
  };

  // 추천 세팅에 들어간 비율 (기술·도구·특성·성격)
  const priorCache = new Map();
  function prior(mon) {
    if (priorCache.has(mon.id)) return priorCache.get(mon.id);
    const slot = sets?.sets[mon.id] || {};
    const list = Object.values(slot);
    const share = key => {
      const out = new Map();
      for (const s of list) for (const v of new Set((s[key] || []).flat())) out.set(v, (out.get(v) || 0) + 1 / list.length);
      return out;
    };
    const p = { mv: share('mv'), it: share('it'), ab: share('ab'), na: share('na') };
    priorCache.set(mon.id, p);
    return p;
  }

  /** 세팅 → 계산용 모습 (능력치·특성·도구). takenW: 내구형일수록 받는 피해를 더 무겁게 (막이 역할) */
  function profile(mon, set) {
    const lv = set.lv || level;
    const st = statsAt(ctx.stats(mon), lv, set.iv, set.na);
    const b = ctx.stats(mon);
    const bulk = (b[0] + b[2] + b[4]) / (Math.max(b[1], b[3]) + b[5]);
    return {
      mon, lv, st, ab: set.ab, it: set.it, stab: new Set(mon.t), def: engine.defenseProfile(mon, { ability: set.ab }),
      canEvolve: !!set.canEvolve, targets: targetsAt(lv), takenW: TAKEN_W * Math.min(2, Math.max(0.7, bulk / 1.5)),
    };
  }

  /**
   * 기술 하나의 데미지 계산 준비 (특성·도구·자속·연속기·명중 보정). 공격 기술이 아니면 null.
   * single: 1:1 대면 (더블에서도 범위기는 한 마리당 0.75)
   */
  function moveCalc(p, mv, { single = false } = {}) {
    if (!mv || mv.cat === 0 || (!mv.power && !mv.fx)) return null;
    const { ab, it, st, lv } = p;
    let type = mv.type, pm = 1;
    if (type === 'normal' && ATE[ab]) { type = ATE[ab]; pm *= 1.2; }
    if (ABILITY_TYPE[ab]?.[0] === type) pm *= ABILITY_TYPE[ab][1];
    if (ab === 'technician' && mv.power <= 60) pm *= 1.5;
    if (ab === 'tough-claws' && mv.flags & 1) pm *= 1.3;
    if (ab === 'iron-fist' && mv.flags & 2) pm *= 1.2;
    if (ab === 'strong-jaw' && mv.flags & 4) pm *= 1.5;
    if (ab === 'mega-launcher' && mv.flags & 8) pm *= 1.5;
    if (ab === 'sharpness' && mv.flags & 16) pm *= 1.5;
    if (ab === 'punk-rock' && mv.flags & 32) pm *= 1.3;
    if (ab === 'sheer-force' && mv.flags & 128) pm *= 1.3;
    if (TYPE_ITEMS[it] === type) pm *= 1.2;
    if (it === 'punching-glove' && mv.flags & 2) pm *= 1.1;
    if (it === 'muscle-band' && mv.cat === 1) pm *= 1.1;
    if (it === 'wise-glasses' && mv.cat === 2) pm *= 1.1;
    let a = mv.fx === 'def' ? st[2] : mv.cat === 1 ? st[1] : st[3];
    if (mv.cat === 1 && (ab === 'huge-power' || ab === 'pure-power')) a *= 2;
    if (mv.cat === 1 && (ab === 'hustle' || ab === 'gorilla-tactics')) a *= 1.5;
    if ((it === 'choice-band' && mv.cat === 1) || (it === 'choice-specs' && mv.cat === 2)) a *= 1.5;
    if (it === 'light-ball' && p.mon.slug.startsWith('pikachu')) a *= 2;
    if (it === 'thick-club' && mv.cat === 1 && /^(cubone|marowak)/.test(p.mon.slug)) a *= 2;
    let mod = ROLL;
    if (p.stab.has(type) || ab === 'protean' || ab === 'libero') mod *= ab === 'adaptability' ? 2 : 1.5;
    if (it === 'life-orb') mod *= 1.3;
    if (mv.fx === 'crit' || (mv.flags & 64 && ab === 'super-luck')) mod *= ab === 'sniper' ? 2.25 : 1.5;
    let hits = mv.hits;
    if (hits === 3.1) hits = ab === 'skill-link' ? 5 : it === 'loaded-dice' ? 4.5 : hits;
    let acc = mv.acc ? Math.min(1, mv.acc / 100 * (ab === 'compound-eyes' ? 1.3 : 1) * (ab === 'hustle' && mv.cat === 1 ? 0.8 : 1)) : 1;
    if (ab === 'no-guard') acc = 1;
    const turn = mv.fx === 'charge' ? (it === 'power-herb' ? 1 : 0.5)
      : mv.fx === 'recoil' && (ab === 'rock-head' || ab === 'magic-guard') ? 1 : FX_MULT[mv.fx] || 1;
    // 더블: 범위기는 둘을 함께 때림 (0.75 × 2), 1:1 대면이면 한 마리에 0.75
    const spread = double && mv.flags & 256 ? (single ? 0.75 : 1.5) : 1;
    return { mv, type, pm, a, mod, hits, acc, turn, spread, ab, it, lv, lvTerm: Math.floor(2 * lv / 5 + 2) };
  }

  /** 준비한 기술이 상대 t({ hp, atk, def, spd })에게 주는 데미지 % (상한 없음). e: 타입 상성 배율 */
  function pctOn(c, t, e) {
    if (e === 0) return 0;
    if (c.ab === 'tinted-lens' && e < 1) e *= 2;
    if (c.it === 'expert-belt' && e > 1) e *= 1.2;
    if (c.mv.fx === 'lvl') return 100 * c.lv / t.hp * c.spread;
    if (c.mv.fx === 'half') return 50 * c.acc;
    const atk = c.mv.fx === 'foul' ? t.atk : c.a;
    const d = c.mv.cat === 1 || c.mv.fx === 'psy' ? t.def : t.spd;
    const base = Math.floor(Math.floor(c.lvTerm * c.mv.power * c.pm * atk / d) / 50) + 2;
    return 100 * base * c.mod * e * c.hits * c.acc * c.turn * c.spread / t.hp;
  }

  /** 기술 하나가 상대 후보 각각에게 주는 데미지 % (상한 없음) */
  function movePcts(p, mv) {
    const out = new Float32Array(p.targets.length);
    const c = moveCalc(p, mv);
    if (!c) return out;
    const row = ctx.eff[tIdx[c.type]];
    for (const t of p.targets) out[t.q] = pctOn(c, t, row[t.q]);
    return out;
  }

  /** 상대 t 의 자속 공격(위력 90)에 받는 데미지 % */
  function takenPct(p, t) {
    let m = 0;
    for (const s of t.stabs) if (p.def[s] > m) m = p.def[s];
    if (!m) return 0;
    const phys = t.atk >= t.spa;
    let d = phys ? p.st[2] : p.st[4];
    if (p.it === 'assault-vest' && !phys) d *= 1.5;
    if (p.it === 'eviolite' && p.canEvolve) d *= 1.5;
    if (p.ab === 'fur-coat' && phys) d *= 2;
    const base = Math.floor(Math.floor(Math.floor(2 * p.lv / 5 + 2) * 90 * (phys ? t.atk : t.spa) / d) / 50) + 2;
    let pct = 100 * base * 1.5 * m * ROLL / p.st[0];
    if (p.ab === 'multiscale' || p.ab === 'shadow-shield') pct *= 0.75;
    if (p.ab === 'ice-scales' && !phys) pct *= 0.5;
    if (p.ab === 'intimidate' && phys) pct *= 0.75;
    // 여러 턴 버티는 동안의 회복 · 반동 (먹다남은음식은 턴마다 1/16)
    if (p.it === 'leftovers' || (p.it === 'black-sludge' && p.mon.t.includes('poison'))) pct *= 0.85;
    if (p.it === 'sitrus-berry') pct *= 0.9;
    if (p.it === 'life-orb' && p.ab !== 'magic-guard') pct *= 1.15;
    if (p.it === 'focus-sash' && pct >= 100) pct = 70;
    return Math.min(pct, 100);
  }

  const speedOf = p => p.st[5] * (p.it === 'choice-scarf' ? 1.5 : 1);

  /**
   * 변화기·공격기 부가 가치. 구애 도구면 변화기는 못 쓰고, 능력 올리기는 공격 기술 분류(물리·특수)와 맞는 것 하나만,
   * 회복기도 하나만 인정한다.
   */
  function extraValue(mon, moves, it) {
    const pr = prior(mon).mv;
    const phys = moves.filter(mv => mv.cat === 1).length, spec = moves.filter(mv => mv.cat === 2).length;
    const vals = [];
    let bonus = 0, setup = 0, heal = 0;
    for (const mv of moves) {
      if (mv.cat > 0) {
        bonus += (ATTACK_BONUS[mv.slug] || 0) + (mv.slug === 'fake-out' && double ? 2 : 0) + 2 * (pr.get(mv.slug) || 0);
        continue;
      }
      if (CHOICE.has(it)) continue;
      let v = (STATUS_VALUE[mv.slug] || 0) + (double ? DOUBLES_STATUS[mv.slug] || 0 : 0) + PRIOR_W * (pr.get(mv.slug) || 0);
      if (SETUP_PHYS.has(mv.slug) || SETUP_SPEC.has(mv.slug) || SETUP_BOTH.has(mv.slug)) {
        const fits = SETUP_BOTH.has(mv.slug) ? phys + spec > 0 : SETUP_PHYS.has(mv.slug) ? phys > 0 && phys >= spec : spec > 0 && spec >= phys;
        if (!fits) v = 0;
        setup = Math.max(setup, v);
        continue;
      }
      if (RECOVERY.has(mv.slug)) { heal = Math.max(heal, v); continue; }
      vals.push(v);
    }
    if (setup) vals.push(setup);
    if (heal) vals.push(heal);
    vals.sort((a, b) => b - a);
    return bonus + vals.reduce((a, v, k) => a + v * [1, 1, 0.5, 0.25][k], 0);
  }

  /** 추천 세팅에 자주 나오는 도구·특성 가치 − 나쁜 특성 */
  function itemAbilityValue(mon, set) {
    const pr = prior(mon);
    return 4 * (pr.it.get(set.it) || 0) + 4 * (pr.ab.get(set.ab) || 0) - (BAD_ABILITY[set.ab] || 0);
  }

  /** 기술과 상관없는 부분: 받는 피해 · 선공 비율 · 상대별 선공 여부 */
  function fixedPart(mon, set, p) {
    const spe = speedOf(p);
    let taken = 0, fast = 0;
    const slower = new Uint8Array(p.targets.length);
    for (const t of p.targets) {
      taken += t.w * takenPct(p, t);
      const f = spe > t.spe ? 1 : spe === t.spe ? 0.5 : 0;
      fast += t.w * f;
      if (f < 1) slower[t.q] = 1;
    }
    return { taken: taken / W, speed: fast / W, slower, value: itemAbilityValue(mon, set) };
  }

  /** 기술 부분: 화력 (상대별 최대 데미지, 100% 상한) + 느린 상대에게 선제기 + 변화기 가치 */
  function movePart(mon, set, p, fixed, pcts, moves) {
    let off = 0, prioGain = 0;
    const prio = moves.map(mv => mv.prio > 0 && mv.cat > 0);
    for (const t of p.targets) {
      let best = 0, bestPrio = 0;
      for (let k = 0; k < pcts.length; k++) {
        const v = pcts[k][t.q];
        if (v > best) best = v;
        if (prio[k] && v > bestPrio) bestPrio = v;
      }
      off += t.w * Math.min(best, 100);
      if (fixed.slower[t.q] && bestPrio) prioGain += t.w * Math.min(bestPrio, 100) * 0.25;
    }
    return { offense: off / W, extra: extraValue(mon, moves, set.it) + prioGain / W };
  }

  /** 세팅 평가: { score, offense(%), taken(%), speed(0~1), extra, stats } */
  function evaluate(mon, set) {
    const p = profile(mon, set);
    const moves = (set.mv || []).map(s => book.bySlug.get(s)).filter(Boolean);
    const fixed = fixedPart(mon, set, p);
    const mp = movePart(mon, set, p, fixed, moves.map(mv => movePcts(p, mv)), moves);
    const extra = mp.extra + fixed.value;
    return { score: mp.offense - p.takenW * fixed.taken + SPEED_W * fixed.speed + extra, offense: mp.offense, taken: fixed.taken, speed: fixed.speed, extra, stats: p.st };
  }

  /** 습득표가 있는 폼 id (메가진화 폼은 기본 폼) */
  function learnId(mon) {
    if (book.learn(mon.id).length || !mon.mega) return mon.id;
    return engine.dex.pokemon.find(p => p.sp === mon.sp && !p.mega && book.learn(p.id).length)?.id ?? mon.id;
  }
  /** 기술 떠올리기로만 배우는 기술 slug Set */
  const relearnOnly = mon => book.relearn?.(learnId(mon)) || new Set();

  /**
   * 배울 수 있는 기술 (습득표가 없으면 추천 세팅·지금 기술).
   * 기술 떠올리기를 끄면 레벨업 기술만 (all: true 면 끈 것과 상관없이 전부 — 내 세팅 입력용)
   */
  function learnable(mon, set = {}, { all = false } = {}) {
    const list = book.learn(learnId(mon));
    if (list.length) {
      if (relearn || all) return list;
      const re = relearnOnly(mon);
      return list.filter(m => !re.has(m.slug));
    }
    const extra = [...prior(mon).mv.keys(), ...(set.mv || [])].map(s => book.bySlug.get(s)).filter(Boolean);
    return [...new Set(extra)];
  }

  /** 능력치·도구·특성을 고정하고 기술 4개 고르기 (빈 칸 채우기 → 한 칸씩 바꿔 보기) */
  function bestMoves(mon, set, { keep = [] } = {}) {
    const p = profile(mon, set);
    const all = learnable(mon, set);
    const pcts = new Map(all.map(mv => [mv.slug, movePcts(p, mv)]));
    // 후보: 단일 화력 상위 + 가치 있는 변화기
    const solo = all.filter(mv => mv.cat > 0).map(mv => {
      const row = pcts.get(mv.slug);
      let s = 0;
      for (const t of p.targets) s += t.w * Math.min(row[t.q], 100);
      return { mv, s };
    }).sort((a, b) => b.s - a.s).slice(0, 40).map(x => x.mv);
    const status = all.filter(mv => mv.cat === 0 && extraValue(mon, [mv], set.it) > 0.5);
    const cands = [...new Set([...solo, ...status])];
    const fixed = fixedPart(mon, set, p);
    const score = slugs => {
      const moves = slugs.map(s => book.bySlug.get(s));
      const mp = movePart(mon, set, p, fixed, slugs.map(s => pcts.get(s)), moves);
      return mp.offense + mp.extra;
    };
    let cur = [...new Set((set.mv || []).filter(s => book.bySlug.has(s)))].slice(0, 4);
    for (const s of cur) if (!pcts.has(s)) pcts.set(s, movePcts(p, book.bySlug.get(s)));
    while (cur.length < 4) {
      let best = null;
      for (const c of cands) if (!cur.includes(c.slug)) { const v = score([...cur, c.slug]); if (!best || v > best.v) best = { v, s: c.slug }; }
      if (!best) break;
      cur.push(best.s);
    }
    for (let pass = 0; pass < 6; pass++) {
      let base = score(cur), best = null;
      cur.forEach((old, k) => {
        if (keep.includes(old)) return;
        for (const c of cands) {
          if (cur.includes(c.slug)) continue;
          const next = cur.slice(); next[k] = c.slug;
          const v = score(next);
          if (v > base + 0.05 && (!best || v > best.v)) best = { v, next };
        }
      });
      if (!best) break;
      cur = best.next;
    }
    return cur;
  }

  /**
   * 최선 세팅: 기술 → 성격 → 특성 → 도구 순으로 번갈아 고르기.
   * 개체값은 지금 그대로(입력 안 하면 기본 20): 트레이닝 칸·금색병뚜껑으로 못 올리는 경우가 많아 31 을 가정하지 않는다
   * (올리면 좋은 능력은 plan 의 선택 할 일).
   * opts.abilities: 고를 수 있는 특성, opts.fixedItem: 메가스톤처럼 정해진 도구
   */
  function optimize(mon, cur, opts = {}) {
    // 시작점에 따라 물리/특수 한쪽에 갇힐 수 있어 여러 시작점(지금 세팅 · 빈 세팅 무보정/고집/조심)에서 찾아 가장 좋은 것
    const seeds = [cur, ...['hardy', 'adamant', 'modest'].map(na => ({ ...cur, mv: [], na, it: null }))];
    let best = null;
    for (const seed of seeds) {
      const set = optimizeFrom(mon, seed, opts);
      const v = evaluate(mon, set).score;
      if (!best || v > best.v + 0.01) best = { v, set };
    }
    return best.set;
  }

  function optimizeFrom(mon, cur, { abilities = engine.abilitiesOf(mon), fixedItem = null } = {}) {
    let set = { ...cur, iv: cur.iv || [], ab: abilities.includes(cur.ab) ? cur.ab : abilities[0] || null, it: fixedItem || cur.it || null };
    if (!set.na) set.na = 'hardy';
    const itemList = fixedItem ? [fixedItem] : items
      ? [null, ...[...items].filter(i => (MODELED_ITEMS.has(i) || prior(mon).it.has(i)) && itemOk(mon, i))]
      : [set.it];
    for (let round = 0; round < 3; round++) {
      const before = JSON.stringify(set);
      set.mv = bestMoves(mon, set);
      const pick = (key, list) => {
        let best = { v: evaluate(mon, set).score, x: set[key] };
        for (const x of list) { const v = evaluate(mon, { ...set, [key]: x }).score; if (v > best.v + 0.05) best = { v, x }; }
        set = { ...set, [key]: best.x };
      };
      pick('na', Object.keys(NATURES));
      pick('ab', abilities);
      pick('it', itemList);
      if (JSON.stringify(set) === before) break;
    }
    return set;
  }

  /**
   * 지금 세팅 → 최선 세팅으로 가는 할 일 (이득이 큰 순서, 개체값 올리기는 선택이라 맨 끝).
   * 기술: 하나씩 배울 때마다 가장 덜 아까운 기술을 잊는 순서 / 성격·특성: 트레이닝 칸 / 개체값: 트레이닝 칸 1회에 하나 / 도구
   */
  function plan(mon, cur, best) {
    const steps = [];
    const sc = s => evaluate(mon, s).score;
    // 기술: 성격·특성·도구는 최선 상태라고 보고 지금 기술에서 하나씩 바꿔 가며 이득을 잰다
    let state = { ...best, mv: (cur.mv || []).filter(s => book.bySlug.has(s)) };
    const missing = best.mv.filter(m => !state.mv.includes(m));
    while (missing.length) {
      let pickStep = null;
      for (const add of missing) {
        const options = state.mv.length < 4
          ? [{ mv: [...state.mv, add], forget: null }]
          : state.mv.filter(m => !best.mv.includes(m)).map(old => ({ mv: state.mv.map(m => (m === old ? add : m)), forget: old }));
        for (const o of options) {
          const v = sc({ ...state, mv: o.mv });
          if (!pickStep || v > pickStep.v) pickStep = { v, ...o, add };
        }
      }
      if (!pickStep) break;
      steps.push({ kind: 'move', learn: pickStep.add, forget: pickStep.forget, gain: pickStep.v - sc(state) });
      state = { ...state, mv: pickStep.mv };
      missing.splice(missing.indexOf(pickStep.add), 1);
    }
    // 성격·특성·도구: 최선 세팅에서 그것만 지금 것으로 되돌렸을 때 잃는 점수 = 바꾸는 이득
    const top = sc(best);
    for (const key of ['na', 'ab', 'it']) {
      if ((best[key] || null) === (cur[key] || null)) continue;
      steps.push({ kind: key, from: cur[key] || null, to: best[key] || null, gain: top - sc({ ...best, [key]: cur[key] || null }) });
    }
    const out = steps.filter(s => s.gain > 0.05).sort((a, b) => b.gain - a.gain);
    // 개체값(선택, 맨 끝 한 줄): 최선 세팅은 지금 개체값 기준이라, 하나씩 31로 올렸을 때 오르는 점수를 이득이 큰 순서로
    //   (트레이닝 칸 1회에 하나, 금색병뚜껑이면 한 번에. 못 올리는 경우가 많아 다른 할 일 뒤에)
    const ivs = [];
    for (let i = 0; i < 6; i++) {
      if (cur.iv?.[i] || best.iv?.[i]) continue;
      const iv = Array.from({ length: 6 }, (_, k) => !!best.iv?.[k] || k === i);
      ivs.push({ stat: i, gain: sc({ ...best, iv }) - top });
    }
    ivs.sort((a, b) => b.gain - a.gain);
    const useful = ivs.filter(x => x.gain > 0.05);
    if (useful.length) out.push({ kind: 'iv', optional: true, stats: useful.map(x => x.stat), gains: useful.map(x => x.gain), gain: useful.reduce((a, x) => a + x.gain, 0) });
    return out;
  }

  /**
   * 이 맵 상대 후보 하나하나와의 대면표 (상대 타입별 대응용):
   * best[q] 내 기술 중 가장 큰 데미지 %(상한 없음), move[q] 그 기술 번호, taken[q] 상대 자속 공격에 받는 %, faster[q] 내가 빠름
   */
  function targetTable(mon, set) {
    const p = profile(mon, set);
    const moves = (set.mv || []).map(s => book.bySlug.get(s)).filter(Boolean);
    const pcts = moves.map(mv => movePcts(p, mv));
    const n = p.targets.length, spe = speedOf(p);
    const best = new Float32Array(n), move = new Int8Array(n).fill(-1), taken = new Float32Array(n), faster = new Uint8Array(n);
    for (const t of p.targets) {
      for (let k = 0; k < pcts.length; k++) if (pcts[k][t.q] > best[t.q]) { best[t.q] = pcts[k][t.q]; move[t.q] = k; }

      taken[t.q] = takenPct(p, t);
      faster[t.q] = spe > t.spe ? 1 : 0;
    }
    return { moves: moves.map(mv => mv.slug), best, move, taken, faster };
  }

  /** 방어 쪽 실능치 (돌격조끼·진화의휘석·퍼코트 · 멀티스케일 등은 받는 데미지 배율 mult) */
  const defender = p => ({
    hp: p.st[0], atk: p.st[1], def: p.st[2] * (p.ab === 'fur-coat' ? 2 : 1) * (p.it === 'eviolite' && p.canEvolve ? 1.5 : 1),
    spd: p.st[4] * (p.it === 'assault-vest' ? 1.5 : 1) * (p.it === 'eviolite' && p.canEvolve ? 1.5 : 1),
    mult: (p.ab === 'multiscale' || p.ab === 'shadow-shield' ? 0.75 : 1), ice: p.ab === 'ice-scales',
  });
  /** 기술마다 상대에게 주는 데미지 % (맞았을 때, 명중 acc 는 따로) · 기댓값(pct × acc) 큰 순 */
  function hitsOn(p, foe, foeDef) {
    const out = [];
    for (const slug of p.set.mv || []) {
      const mv = book.bySlug.get(slug);
      const c = moveCalc(p, mv, { single: true });
      if (!c) continue;
      let pct = pctOn(c, foeDef, foe.def[tIdx[c.type]]) * foeDef.mult;
      if (foeDef.ice && mv.cat === 2) pct *= 0.5;
      const acc = c.acc || 1;
      out.push({ slug, pct: pct / acc, acc, prio: mv.prio > 0 });
    }
    return out.sort((a, b) => b.pct * b.acc - a.pct * a.acc);
  }

  /**
   * 1:1 대면: 내 세팅 vs 상대(foe, foeSet = 상대 세팅). 상대 공격 기술이 없으면 자속 위력 90 으로.
   * @returns { mine: [{ slug, pct(맞았을 때), acc, prio }], theirs: [...], taken(상대 기술이 맞았을 때 최고 %), mySpeed, foeSpeed }
   */
  function duel(mon, set, foe, foeSet) {
    const p = { ...profile(mon, set), set };
    const fp = { ...profile(foe, foeSet), set: foeSet };
    // 위협(intimidate): 나온 상대의 공격 −1 → 물리 기술 2/3
    const intim = (list, ab) => (ab === 'intimidate' ? list.map(x => (book.bySlug.get(x.slug)?.cat === 1 ? { ...x, pct: x.pct * 2 / 3 } : x)).sort((x, y) => y.pct - x.pct) : list);
    const mine = intim(hitsOn(p, fp, defender(fp)), foeSet.ab);
    const theirs = intim(hitsOn(fp, p, defender(p)), set.ab);
    // 받는 피해는 맞았을 때 기준 (가장 아픈 기술)
    const taken = theirs.length ? Math.max(...theirs.map(x => x.pct))
      : takenPct(p, { atk: fp.st[1], spa: fp.st[3], stabs: engine.stabTypes(foe).map(s => tIdx[s]) });
    return { mine, theirs, taken, mySpeed: speedOf(p), foeSpeed: speedOf(fp) };
  }

  /**
   * 목표 도구를 못 구했을 때 대신 지닐 도구 (상점·아이템 칸 도구는 무작위라 노린 도구가 안 나오기 쉬움).
   * 고를 수 있는 도구 중 점수가 높은 순 + 도구 없이. @returns [{ it | null, diff(목표 대비 점수 차) }]
   */
  function itemAlternatives(mon, set, { limit = 3 } = {}) {
    if (!set.it || !items) return [];
    const base = evaluate(mon, set).score;
    const list = [...items].filter(i => i !== set.it && (MODELED_ITEMS.has(i) || prior(mon).it.has(i)) && itemOk(mon, i))
      .map(it => ({ it, diff: evaluate(mon, { ...set, it }).score - base }))
      .sort((a, b) => b.diff - a.diff).slice(0, limit);
    return [...list, { it: null, diff: evaluate(mon, { ...set, it: null }).score - base }];
  }

  return { evaluate, optimize, plan, learnable, relearnOnly, relearn, itemAlternatives, targetTable, duel, profile, statsAt: (mon, set) => profile(mon, set).st, level };
}
