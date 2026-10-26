#!/usr/bin/env node
/**
 * 모든 포켓몬의 "추천 세팅" site/data/sets.json 을 생성한다. (build-pokedex.mjs 이후 실행)
 *
 *  1) Smogon 분석가 세팅 — data.pkmn.cc/sets/gen9 → 8 → 7 → 6 (표준 룰 포맷만)
 *  2) Showdown 랜덤배틀 역할 세팅 — data.pkmn.cc/random (성격·노력치는 역할에 맞게 보완)
 *  3) 위에 없으면 자체 생성 — Showdown 습득 기술표 + 종족값 + 타입 상성으로 기술 4개·도구·성격·노력치 계산
 *
 * 포켓몬마다 B(배틀스타디움 싱글) · S(싱글) · D(더블) · R(랜덤배틀 싱글) · A(자체 생성) 슬롯 중 있는 것만 저장하고,
 * 화면에서 데이터 기준(싱글/더블)에 맞는 슬롯을 고른다.
 *
 *   node scripts/build-sets.mjs [--cache .cache/csv]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, fetchRetry, loadTables, toId, writeJson } from './lib/pokeapi.mjs';
import { NAME_TABLES, SHOWDOWN, createMonMapper, createTranslator, showdownNames } from './lib/names.mjs';

const PKMN = 'https://data.pkmn.cc/';
const GENS = [9, 8, 7, 6];
// 표준 룰 포맷만 사용 (갓리기프트·STABmons·AAA 같은 변종 룰과 CAP 제외). 배열 앞쪽이 우선
const SINGLES = ['ou', 'ubers', 'uu', 'ru', 'nu', 'pu', 'zu', 'ubersuu', 'nationaldex', 'nationaldexubers', 'nationaldexuu',
  'nationaldexru', 'monotype', 'nationaldexmonotype', 'lc', 'nfe', '1v1', 'anythinggoes'];
const BSS = ['battlestadiumsingles'];
const DOUBLES = ['doublesou', 'nationaldexdoubles'];  // + vgcYYYY (최신 연도 우선)
const FORMAT_KO = {
  ou: 'OU', ubers: '우버', uu: 'UU', ru: 'RU', nu: 'NU', pu: 'PU', zu: 'ZU', ubersuu: '우버 UU', nationaldex: '내셔널덱',
  nationaldexubers: '내셔널덱 우버', nationaldexuu: '내셔널덱 UU', nationaldexru: '내셔널덱 RU', monotype: '모노타입',
  nationaldexmonotype: '내셔널덱 모노타입', lc: 'LC', nfe: 'NFE', '1v1': '1대1', anythinggoes: 'AG',
  battlestadiumsingles: '배틀스타디움 싱글', doublesou: '더블 OU', nationaldexdoubles: '내셔널덱 더블',
};
const fmtLabel = f => FORMAT_KO[f] || f.replace(/^vgc(\d{4})$/, 'VGC $1');
const ROLE_KO = {
  'Fast Attacker': '빠른 어태커', 'Setup Sweeper': '랭크업 스위퍼', Wallbreaker: '벽 부수기', 'Bulky Attacker': '내구형 어태커',
  'Bulky Support': '내구형 서포터', 'Bulky Setup': '내구형 랭크업', 'Fast Support': '빠른 서포터', 'Fast Bulky Setup': '빠른 내구 랭크업',
  'AV Pivot': '돌격조끼 피벗', 'Tera Blast user': '테라버스트', 'Bulky Protect': '내구형 방어', 'Offensive Protect': '공격형 방어',
  'Choice Item user': '구애 도구', Staller: '내구 운영', Generalist: '범용', 'Z-Move user': 'Z기술',
  'Doubles Bulky Attacker': '더블 내구형 어태커', 'Doubles Fast Attacker': '더블 빠른 어태커', 'Doubles Setup Sweeper': '더블 랭크업',
  'Doubles Support': '더블 서포터', 'Doubles Wallbreaker': '더블 벽 부수기', 'Doubles Bulky Setup': '더블 내구 랭크업',
};

// ── 자체 생성용 기술 분류 (Showdown move id) ──
const BAD_ATTACKS = new Set(['struggle', 'lastresort', 'dreameater', 'belch', 'steelbeam', 'mindblown', 'chloroblast', 'focuspunch',
  'synchronoise', 'spitup', 'naturalgift', 'fling', 'beatup', 'echoedvoice', 'furycutter', 'rollout', 'iceball', 'round', 'trumpcard',
  'wringout', 'crushgrip', 'snore', 'uproar', 'burnup', 'doubleshock', 'shelltrap', 'firstimpression', 'fakeout', 'present', 'magnitude',
  'thief', 'covet', 'pluck', 'bugbite', 'incinerate', 'retaliate', 'rage', 'skydrop', 'hiddenpower', 'mistyexplosion', 'upperhand',
  'hyperspacefury', 'steelroller', 'clangoroussoul']);
const SETUP = { Physical: ['swordsdance', 'dragondance', 'bulkup', 'victorydance', 'shiftgear', 'tidyup', 'coil', 'shellsmash'],
  Special: ['nastyplot', 'quiverdance', 'calmmind', 'tailglow', 'takeheart', 'shellsmash'] };
const RECOVERY = ['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'synthesis', 'morningsun', 'shoreup', 'strengthsap',
  'milkdrink', 'wish', 'junglehealing', 'lunarblessing'];
const PIVOT = ['uturn', 'voltswitch', 'flipturn', 'partingshot', 'chillyreception', 'teleport'];
const SUPPORT = ['willowisp', 'toxic', 'thunderwave', 'spore', 'stealthrock', 'spikes', 'knockoff', 'rapidspin', 'mortalspin',
  'toxicspikes', 'stickyweb', 'yawn', 'haze', 'encore', 'taunt', 'protect'];
const GOOD_ABILITIES = ['hugepower', 'purepower', 'speedboost', 'protean', 'libero', 'adaptability', 'magicguard', 'regenerator',
  'intimidate', 'levitate', 'multiscale', 'shadowshield', 'prankster', 'unaware', 'drought', 'drizzle', 'sandstream', 'snowwarning',
  'beastboost', 'moxie', 'toughclaws', 'sheerforce', 'swiftswim', 'chlorophyll', 'poisonheal', 'magicbounce', 'thickfat', 'flashfire',
  'waterabsorb', 'voltabsorb', 'sapsipper', 'stormdrain', 'guts', 'strongjaw', 'ironfist', 'sharpness', 'gorillatactics',
  'quarkdrive', 'protosynthesis', 'goodasgold', 'supremeoverlord', 'eartheater', 'purifyingsalt', 'fluffy', 'icescales', 'filter',
  'solidrock', 'furcoat', 'noguard', 'tintedlens', 'compoundeyes', 'psychicsurge', 'electricsurge', 'grassysurge', 'mistysurge',
  'naturalcure', 'sturdy', 'technician'];
const DEF_TERA = ['fairy', 'steel', 'water', 'ghost', 'poison', 'dragon', 'dark', 'flying', 'normal'];
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

const arr = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const evText = evs => {
  if (!evs) return null;
  const vals = STAT_KEYS.map(k => evs[k] || 0);
  return vals.some(Boolean) ? vals.join('/') : null;
};

async function fetchJson(url, optional = false) {
  try {
    return await (await fetchRetry(url)).json();
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

/** Showdown learnsets.js (JS 객체 리터럴) → JSON. 코드를 실행하지 않고 키에 따옴표만 붙여 파싱한다 */
async function loadLearnsets() {
  const js = await (await fetchRetry(SHOWDOWN + 'learnsets.js')).text();
  const body = js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1).replace(/([{,])([A-Za-z0-9_$]+):/g, '$1"$2":');
  return JSON.parse(body);
}

async function main() {
  const dex = JSON.parse(await readFile(join(DATA_DIR, 'pokedex.json'), 'utf8'));
  console.log('세팅 데이터 다운로드 중 (Smogon·Showdown)...');
  const sources = {};
  const [T, sd, sdDex, learnsets] = await Promise.all([
    loadTables(NAME_TABLES), showdownNames(), fetchJson(SHOWDOWN + 'pokedex.json'), loadLearnsets(),
    ...GENS.flatMap(g => [
      fetchJson(`${PKMN}sets/gen${g}.json`, true).then(d => { sources[`sets${g}`] = d; }),
      fetchJson(`${PKMN}random/gen${g}randombattle.json`, true).then(d => { sources[`rand${g}`] = d; }),
      fetchJson(`${PKMN}random/gen${g}randomdoublesbattle.json`, true).then(d => { sources[`randd${g}`] = d; }),
    ]),
  ]);
  if (!sources.sets9 || !sources.rand9) throw new Error('9세대 Smogon/랜덤배틀 세팅을 받지 못했습니다');

  const { mapMon } = createMonMapper(dex, T.pokemon_species);
  const dict = createTranslator(T, dex, sd).dictionary();
  const byId = new Map(dex.pokemon.map(p => [p.id, p]));
  const tIdx = Object.fromEntries(dex.types.map((t, i) => [t, i]));
  const eff = (atk, def) => def.reduce((m, d) => m * dex.chart[tIdx[atk]][tIdx[d]], 1);

  // 메가스톤: PokeAPI에 없는 신규 메가스톤은 "<종 이름>나이트(X/Y/Z)" 로 표기 (예: Clefablite → 픽시나이트)
  const megaStoneKo = {};
  for (const e of Object.values(sdDex)) {
    if (!e.requiredItem || !/-Mega/.test(e.name)) continue;
    const base = byId.get(mapMon(e.baseSpecies, { strict: true }));
    if (base) megaStoneKo[toId(e.requiredItem)] = `${base.ko}나이트${e.name.match(/-Mega-([XYZ])$/)?.[1] || ''}`;
  }
  const item = name => dict.item(name, megaStoneKo[toId(name)]);

  /** 이름이 정확히 맞는 항목을 먼저, 폼 접두어로만 맞는 항목은 나중에 (기본 종 세팅을 코스튬 폼이 덮지 않게) */
  function mapped(data) {
    const strict = [], loose = [];
    for (const [name, v] of Object.entries(data || {})) {
      const id = mapMon(name, { strict: true });
      if (id) strict.push([id, v]);
      else { const lid = mapMon(name); if (lid) loose.push([lid, v]); }
    }
    return [...strict, ...loose];
  }

  // 역할에 맞는 성격·노력치 (랜덤배틀·자체 생성 세팅용)
  function spreadFor(mon, { attacker, fast, physical }) {
    const [, atk, def, spa, spd] = mon.st;
    if (attacker) {
      if (physical) return fast ? ['jolly', '4/252/0/0/0/252'] : ['adamant', '252/252/0/0/4/0'];
      return fast ? ['timid', '4/0/0/252/0/252'] : ['modest', '252/0/0/252/4/0'];
    }
    if (def <= spd) return [atk >= spa ? 'impish' : 'bold', '252/0/252/0/4/0'];
    return [atk >= spa ? 'careful' : 'calm', '252/0/4/0/252/0'];
  }
  const roleOf = mon => {
    const [, atk, def, spa, spd, spe] = mon.st;
    const offense = Math.max(atk, spa);
    return { attacker: offense >= 90 && offense >= Math.min(def, spd) * 0.95, fast: spe >= 85, physical: atk >= spa };
  };

  function smogonSet(gen, fmt, named, mon) {
    const [name, s] = Object.entries(named)[0];
    const ab = arr(s.ability).map(a => dict.ability(a)).filter(Boolean);
    return {
      src: `Smogon ${gen}세대 ${fmtLabel(fmt)}`, n: name,
      mv: arr(s.moves).map(m => (Array.isArray(m) ? m.map(x => dict.move(x)) : dict.move(m))),
      ab: ab.length ? ab : mon.ab.slice(0, 1),
      it: arr(s.item).map(item),
      na: arr(s.nature).map(n => dict.nature(n)).filter(Boolean),
      ev: evText(arr(s.evs)[0]),
      te: arr(s.teratypes).map(t => t.toLowerCase()).filter(t => dex.typeNames[t]),
    };
  }

  function randomSet(gen, entry, doubles, mon) {
    const [roleName, role] = entry.roles ? Object.entries(entry.roles)[0] : [null, entry];
    const mv = arr(role.moves).map(m => dict.move(m));
    const cls = mv.map(s => dict.moves[s][3]);
    const bulky = /Bulky|Support|Staller|Protect/.test(roleName || '');
    const [na, ev] = spreadFor(mon, {
      attacker: roleName ? !bulky : roleOf(mon).attacker,
      fast: roleName ? /Fast/.test(roleName) || mon.st[5] >= 85 : mon.st[5] >= 85,
      physical: cls.filter(c => c === 1).length >= cls.filter(c => c === 2).length,
    });
    return {
      src: `랜덤배틀 ${gen}세대${doubles ? ' 더블' : ''}`, n: ROLE_KO[roleName] || roleName || '추천 기술 후보',
      mv, pool: 1,
      ab: arr(role.abilities || entry.abilities).map(a => dict.ability(a)).filter(Boolean).slice(0, 2),
      it: arr(role.items || entry.items).map(item).slice(0, 2),
      na: [dict.nature(na)], ev,
      te: arr(role.teraTypes).map(t => t.toLowerCase()).filter(t => dex.typeNames[t]),
    };
  }

  const sets = {};
  const slotOf = id => (sets[id] ||= {});
  // 세대 우선: 어떤 세대에서 싱글(또는 더블) 세팅을 찾으면 그보다 옛 세대 데이터는 쓰지 않는다
  const done = new Map();
  const doneOf = id => (done.has(id) ? done.get(id) : done.set(id, { s: false, d: false }).get(id));

  for (const gen of GENS) {
    // 1) Smogon 분석가 세팅
    for (const [id, formats] of mapped(sources[`sets${gen}`])) {
      const mon = byId.get(id), slot = slotOf(id), st = doneOf(id);
      const doubles = [...Object.keys(formats).filter(f => /^vgc\d{4}$/.test(f)).sort().reverse(), ...DOUBLES];
      const pick = list => list.find(f => formats[f]);
      if (!st.s && !slot.B && pick(BSS)) slot.B = smogonSet(gen, pick(BSS), formats[pick(BSS)], mon);
      if (!st.s && !slot.S && pick(SINGLES)) slot.S = smogonSet(gen, pick(SINGLES), formats[pick(SINGLES)], mon);
      if (!st.d && !slot.D && pick(doubles)) slot.D = smogonSet(gen, pick(doubles), formats[pick(doubles)], mon);
    }
    // 2) 랜덤배틀 역할 세팅: 같은 세대에 Smogon 세팅이 없을 때만
    for (const [id, entry] of mapped(sources[`rand${gen}`])) {
      const slot = slotOf(id);
      if (!doneOf(id).s && !slot.S && !slot.B && !slot.R) slot.R = randomSet(gen, entry, false, byId.get(id));
    }
    for (const [id, entry] of mapped(sources[`randd${gen}`])) {
      const slot = slotOf(id);
      if (!doneOf(id).d && !slot.D) slot.D = randomSet(gen, entry, true, byId.get(id));
    }
    for (const [id, slot] of Object.entries(sets)) {
      const st = doneOf(+id);
      if (slot.S || slot.B || slot.R) st.s = true;
      if (slot.D) st.d = true;
    }
  }

  // 3) 배틀 전용 폼(킬가르도 블레이드폼 등)은 기본 폼 세팅을 그대로 사용
  const speciesDefault = new Map(dex.pokemon.filter(p => p.def).map(p => [p.sp, p.id]));
  for (const p of dex.pokemon) {
    const base = sets[speciesDefault.get(p.sp)];
    if (!p.battle || !base || (sets[p.id] && Object.keys(sets[p.id]).length)) continue;
    sets[p.id] = Object.fromEntries(Object.entries(base).map(([k, s]) => [k, { ...s, src: `${s.src} · 기본 폼` }]));
  }

  // 4) 자체 생성: 싱글용 세팅이 하나도 없는 포켓몬
  const sdOf = new Map();
  for (const e of Object.values(sdDex)) {
    if (e.num <= 0 || e.isNonstandard === 'CAP' || e.isNonstandard === 'Custom') continue;
    const id = mapMon(e.name, { strict: true });
    if (id && !sdOf.has(id)) sdOf.set(id, e);
  }
  for (const e of Object.values(sdDex)) {
    if (e.num <= 0 || e.isNonstandard === 'CAP') continue;
    const id = mapMon(e.name);
    if (id && !sdOf.has(id)) sdOf.set(id, e);
  }

  function learnable(e) {
    const gens = new Map();
    for (let cur = e, guard = 0; cur && guard < 4; cur = cur.prevo ? sdDex[toId(cur.prevo)] : null, guard++) {
      // 폼(메가 등)은 자기 습득표가 없으면 원래 폼 → 기본 종 순서로
      const key = [cur.name, cur.changesFrom, cur.baseSpecies].filter(Boolean).map(toId).find(k => learnsets[k]?.learnset);
      for (const [mv, codes] of Object.entries(learnsets[key]?.learnset || {})) {
        const g = Math.max(...codes.map(c => parseInt(c, 10)));
        gens.set(mv, Math.max(gens.get(mv) || 0, g));
      }
    }
    const latest = Math.max(0, ...gens.values());
    return { latest, moves: [...gens].filter(([, g]) => g === latest).map(([mv]) => mv) };
  }

  function autoSet(mon) {
    const e = sdOf.get(mon.id);
    if (!e) return null;
    const { latest, moves } = learnable(e);
    const role = roleOf(mon);
    const md = id => sd.moves[id];
    const usable = id => {
      const m = md(id);
      return m && !m.isZ && !m.isMax && (latest < 9 || !m.isNonstandard); // 9세대 포켓몬은 9세대에 있는 기술만
    };
    const attacks = moves.filter(id => {
      const m = md(id);
      return usable(id) && m.category !== 'Status' && m.basePower >= 50 && !BAD_ATTACKS.has(id) && !m.selfdestruct
        && !m.flags?.recharge && !m.flags?.charge && !m.flags?.futuremove;
    });
    const power = id => {
      const m = md(id);
      const hits = Array.isArray(m.multihit) ? (m.multihit[1] === 5 ? 3 : (m.multihit[0] + m.multihit[1]) / 2) : m.multihit || 1;
      return m.basePower * hits * (m.accuracy === true ? 100 : m.accuracy) / 100;
    };
    const typeOf = id => md(id).type.toLowerCase();
    // 물리/특수: 공격·특공 차이가 작으면 더 센 자속기 쪽
    let cat = mon.st[1] >= mon.st[3] + 10 ? 'Physical' : mon.st[3] >= mon.st[1] + 10 ? 'Special' : null;
    const score = (id, c = cat) => power(id) * (mon.t.includes(typeOf(id)) ? 1.5 : 1) * (!c || md(id).category === c ? 1 : 0.55)
      + (md(id).priority > 0 ? 8 : 0);
    if (!cat) {
      const best = c => Math.max(0, ...attacks.filter(id => md(id).category === c && mon.t.includes(typeOf(id))).map(id => score(id, c)));
      cat = best('Physical') >= best('Special') ? 'Physical' : 'Special';
    }
    role.physical = cat === 'Physical';

    const chosen = [];
    const add = id => { if (id && !chosen.includes(id) && chosen.length < 4) chosen.push(id); };
    const bestOf = list => list.sort((a, b) => score(b) - score(a))[0];
    // 자속기: 타입별 최강 기술
    for (const t of mon.t) add(bestOf(attacks.filter(id => typeOf(id) === t && (md(id).category === cat || power(id) >= 70))));
    // 견제기: 아직 효과 굉장을 못 주는 타입을 가장 많이 메우는 기술
    const covered = () => new Set(dex.types.filter(d => chosen.some(id => md(id).category !== 'Status' && eff(typeOf(id), [d]) >= 2)));
    const attackSlots = role.attacker ? 3 : 2;
    while (chosen.length < attackSlots) {
      const cov = covered();
      const pick = attacks.filter(id => !chosen.includes(id) && md(id).category === cat && power(id) >= 60)
        .map(id => ({ id, gain: dex.types.filter(d => !cov.has(d) && eff(typeOf(id), [d]) >= 2).length }))
        .filter(x => x.gain > 0).sort((a, b) => b.gain - a.gain || score(b.id) - score(a.id))[0];
      if (!pick) break;
      add(pick.id);
    }
    // 보조기: 공격형은 랭크업 → 교체기, 내구형은 회복 → 상태이상/설치기
    const has = list => list.find(id => moves.includes(id) && usable(id));
    if (role.attacker) add(has(SETUP[cat]) || (role.fast ? has(PIVOT) : has(RECOVERY)));
    else { add(has(RECOVERY)); add(has(SUPPORT)); add(has(PIVOT)); }
    // 남은 칸은 공격기로
    for (const id of attacks.filter(id => md(id).category === cat).sort((a, b) => score(b) - score(a))) add(id);
    for (const id of attacks.sort((a, b) => score(b) - score(a))) add(id);
    // 쓸 만한 공격기가 없는 포켓몬(뿔충이 등)은 배울 수 있는 기술 중 위력 순 → 변화기
    if (chosen.length < 4) {
      const rest = moves.filter(id => usable(id) && !chosen.includes(id));
      for (const id of rest.filter(id => md(id).category !== 'Status').sort((a, b) => power(b) - power(a))) add(id);
      for (const id of rest.filter(id => md(id).category === 'Status')) add(id);
    }
    if (!chosen.length) return null;

    const status = chosen.some(id => md(id).category === 'Status');
    const setup = chosen.some(id => SETUP[cat].includes(id));
    let it = 'leftovers';
    if (mon.mega) it = toId(e.requiredItem || '');
    else if (!mon.final) it = 'eviolite';
    else if (role.attacker) {
      if (setup || status) it = 'lifeorb';
      else if (role.fast) it = mon.st[5] <= 105 ? 'choicescarf' : role.physical ? 'choiceband' : 'choicespecs';
      else it = 'assaultvest';
    }
    const abilities = [...mon.ab, mon.ha].filter(Boolean);
    const ab = abilities.find(a => GOOD_ABILITIES.includes(toId(a))) || abilities.find(a => !['truant', 'slow-start', 'defeatist'].includes(a)) || abilities[0];
    const [na, ev] = spreadFor(mon, role);
    // 테라: 공격형은 주력 자속, 내구형은 약점이 가장 적어지는 방어 타입
    const defTera = DEF_TERA.map(t => ({ t, s: dex.types.reduce((acc, a) => acc + (eff(a, [t]) > 1 ? 2 : eff(a, [t]) < 1 ? -1 : 0), 0) }))
      .sort((a, b) => a.s - b.s)[0].t;
    const label = role.attacker ? (role.fast ? '빠른 어태커' : '내구형 어태커') : '내구형 서포터';
    return {
      src: `자체 생성 · ${latest}세대 습득 기술 기준`, n: label,
      mv: chosen.map(id => dict.move(id)),
      ab: ab ? [ab] : [],
      it: it ? [item(it)] : [],
      na: [dict.nature(na)], ev,
      te: [role.attacker ? typeOf(chosen[0]) : defTera].filter(t => dex.typeNames[t]),
    };
  }

  let autoCount = 0;
  const noSet = [];
  for (const p of dex.pokemon) {
    const slot = slotOf(p.id);
    if (slot.S || slot.B || slot.R) continue;
    const a = autoSet(p);
    if (a) { slot.A = a; autoCount++; } else noSet.push(p.slug);
  }
  for (const [id, slot] of Object.entries(sets)) if (!Object.keys(slot).length) delete sets[id];

  const out = {
    meta: { generated: new Date().toISOString(), sources: ['Smogon analyses (data.pkmn.cc/sets)', 'Pokémon Showdown random battle sets', 'Pokémon Showdown learnsets'] },
    moves: dict.moves, items: dict.items, natures: dict.natures, sets,
  };
  const size = await writeJson(join(DATA_DIR, 'sets.json'), out);
  const count = k => Object.values(sets).filter(s => s[k]).length;
  console.log(`✔ sets.json · ${Object.keys(sets).length}/${dex.pokemon.length}개 포켓몬 · 기술 ${Object.keys(dict.moves).length}개 · ${size}`);
  console.log(`  배틀스타디움 싱글 ${count('B')} · Smogon 싱글 ${count('S')} · 더블 ${count('D')} · 랜덤배틀 ${count('R')} · 자체 생성 ${autoCount}`);
  if (noSet.length) console.log('  ⚠ 세팅을 만들지 못함:', noSet.join(', '));
}

main().catch(e => { console.error('✖ 세팅 데이터 생성 실패:', e.message); process.exit(1); });
