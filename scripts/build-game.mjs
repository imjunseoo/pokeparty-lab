#!/usr/bin/env node
/**
 * 「포켓몬 파티!」(Pokémon Essentials v21.1 기반 보드게임) 데이터 → site/data/game/pokemon-party.json
 *
 * 게임 폴더의 Data/*.dat(Ruby Marshal)와 PluginScripts.rxdata(보드게임 설정 스크립트)를 "읽기만" 해서
 * 출현 포켓몬·지역·아이템·기믹 룰·배틀 모드·레벨·기술 습득 정보를 뽑는다. 게임 코드는 실행하지 않는다.
 * 게임 파일이 있는 PC에서만 실행 (CI에서는 커밋된 결과 JSON을 그대로 배포).
 *
 *   node scripts/build-game.mjs --game "C:/.../Pokemon Party!_20261026"
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { DATA_DIR, loadTables, toId, writeJson } from './lib/pokeapi.mjs';
import { loadMarshal } from './lib/marshal.mjs';
import { decodePng } from './lib/png.mjs';
import { ICON_FRAME, ICON_GRID, iconCells, packCells, cellsDiff, composeHud, hudTemplate } from './lib/icons.mjs';
import { buildMoves } from './lib/game-moves.mjs';

const args = process.argv.slice(2);
const GAME = args.includes('--game') ? args[args.indexOf('--game') + 1]
  : process.env.POKEPARTY_GAME_DIR || 'C:/Users/imjun/Desktop/Pocketmon/Pokemon Party!_20261026/Pokemon Party!_20261026';
const LEGEND_FLAGS = ['Legendary', 'Mythical', 'UltraBeast', 'Paradox'];
const COLOR_KO = { Red: '빨강', Blue: '파랑', Yellow: '노랑', Green: '초록', Black: '검정', Brown: '갈색', Purple: '보라', Gray: '회색', White: '하양', Pink: '분홍' };
const REGION_GEN = { alola: 7, galar: 8, hisui: 8, paldea: 9 };
// 게임 룰 → 배틀에서 쓸 수 있는 기믹
const RULE_USES = { normal: [], mega: ['mega'], zmove: ['z'], dynamax: ['dynamax'], terastal: ['tera'],
  all: ['mega', 'z', 'dynamax', 'tera'], first: ['mega', 'z', 'dynamax', 'tera'], alola: ['mega', 'z'] };
const RULE_DESC = {
  normal: '기믹 없음', mega: '메가링 지급 · 메가스톤 판매', zmove: 'Z링 지급 · Z크리스탈 판매',
  dynamax: '다이맥스밴드 지급', terastal: '테라스탈오브 지급', all: '모든 링 지급 · 모든 기믹',
  first: '링을 상점에서 먼저 산 사람만 (링마다 1개)', alola: '메가진화 + Z기술',
};

// ── Ruby 설정 스크립트에서 상수 꺼내기 (정규식 파싱, 실행 없음) ──
function block(src, name, open = '[') {
  const close = open === '[' ? ']' : '}';
  const start = src.search(new RegExp(`\\b${name}\\s*=\\s*\\${open}`));
  if (start < 0) throw new Error(`스크립트에서 ${name} 를 찾지 못함`);
  let i = src.indexOf(open, start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close && --depth === 0) return src.slice(i + 1, j);
  }
  throw new Error(`${name} 괄호가 닫히지 않음`);
}
const syms = text => [...text.replace(/#.*$/gm, '').matchAll(/:([A-Z][A-Z0-9_]*)/g)].map(m => m[1]);

function main() {
  if (!existsSync(join(GAME, 'Data', 'species.dat'))) throw new Error(`게임 폴더를 찾을 수 없음: ${GAME}`);
  const dat = f => loadMarshal(readFileSync(join(GAME, 'Data', f)));
  const dex = JSON.parse(readFileSync(join(DATA_DIR, 'pokedex.json'), 'utf8'));
  const sets = JSON.parse(readFileSync(join(DATA_DIR, 'sets.json'), 'utf8'));
  return loadTables(['items', 'item_names', 'pokemon_species', 'moves', 'move_names']).then(T => build({ dat, dex, sets, T }));
}

function build({ dat, dex, sets, T }) {
  console.log('게임 데이터 읽는 중:', GAME);
  // 보드게임 플러그인 스크립트
  const plugins = dat('PluginScripts.rxdata');
  const scripts = {};
  for (const [pname, , files] of plugins) {
    if (!String(pname).startsWith('Board Party')) continue;
    for (const [path, code] of files) scripts[String(path)] = inflateSync(code).toString('utf8');
  }
  const script = part => {
    const key = Object.keys(scripts).find(k => k.includes(part));
    if (!key) throw new Error(`보드게임 스크립트 ${part} 없음`);
    return scripts[key];
  };
  const encSrc = script('Board_Encounters'), shopSrc = script('006_Board_Shop'), itemSrc = script('005_Board_Items'),
    mapSrc = script('Board_Maps'), lvSrc = script('Board_Level_Scaling'), ruleSrc = script('Board_Game_Rules');
  // 게임 판 번호: 멀티플레이 패치 번호(MP_PATCH_VERSION)가 실제 배포 판
  const version = Object.values(scripts).map(s => s.match(/MP_PATCH_VERSION\s*=\s*"([\d.]+)"/)?.[1]).find(Boolean)
    || (ruleSrc.match(/\(v(\d+\.\d+)\)/) || [])[1];

  // ── 게임 한글 이름표 (영문 → 한국어) ──
  const msg = dat('messages_kor_core.dat');
  const koItem = msg[7], koForm = msg[4];

  // ── 게임 종족 → pokedex.json 항목 매핑 ──
  const species = dat('species.dat');
  const byDexEn = new Map(dex.pokemon.filter(p => p.def).map(p => [toId(p.en), p]));
  const bySlug = new Map(dex.pokemon.map(p => [toId(p.slug), p]));
  const speciesSlug = Object.fromEntries(T.pokemon_species.map(s => [s.id, s.identifier]));
  const ALIAS = { NIDORANfE: 'nidoranf', NIDORANmA: 'nidoranm' };
  const statsOf = s => ['HP', 'ATTACK', 'DEFENSE', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE', 'SPEED'].map(k => [...s.base_stats].find(([kk]) => String(kk) === k)?.[1]);
  const gameMon = new Map();   // 게임 키(BULBASAUR_1) → { data, dex }
  const unmapped = [];
  const defaultOf = new Map();
  for (const [key, s] of species) {
    const sp = String(s.species);
    if (s.form !== 0) continue;
    // 니드런♀/♂ 은 영문 이름에서 기호를 빼면 같아지므로 별칭을 먼저 본다
    const p = (ALIAS[sp] && bySlug.get(ALIAS[sp])) || byDexEn.get(toId(s.real_name)) || bySlug.get(toId(sp));
    if (p) defaultOf.set(sp, p);
  }
  for (const [key, s] of species) {
    const sp = String(s.species), k = String(key);
    const base = defaultOf.get(sp);
    if (!base) { unmapped.push(k); continue; }
    let p = base;
    if (s.form !== 0) {
      const types = s.types.map(t => String(t).toLowerCase()), st = statsOf(s);
      const same = dex.pokemon.filter(x => x.sp === base.sp);
      const exact = same.find(x => x.t.join() === types.join() && x.st.join() === st.join() && !!x.mega === !!s.mega_stone);
      const typed = same.find(x => x.t.join() === types.join() && !!x.mega === !!s.mega_stone && x.id !== base.id);
      p = exact || (s.mega_stone ? typed : null) || (base.t.join() === types.join() ? base : typed || base);
    }
    gameMon.set(k, { data: s, dex: p });
  }

  const isLegend = s => (s.flags || []).some(f => LEGEND_FLAGS.includes(String(f)));
  const hasForward = s => (s.evolutions || []).some(e => !(e.length >= 4 && e[3]) && String(e[1]) !== 'None');

  // ── 출현 지역 (투어 맵) ──
  const areaNames = Object.fromEntries([...block(encSrc, 'AREA_SETTINGS', '{').matchAll(/(\w+):\s*\{\s*name:\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
  const areas = [];
  const encBlock = block(encSrc, 'AREA_ENCOUNTERS', '{');
  for (const [, key, body] of encBlock.matchAll(/(\w+):\s*\[([\s\S]*?)\n\s*\]/g)) {
    const mons = [];
    for (const [, sym, w] of body.matchAll(/\[:([A-Z0-9_]+),\s*(\d+)\]/g)) {
      const g = gameMon.get(sym);
      if (!g) { unmapped.push(sym); continue; }
      const prev = mons.find(m => m[0] === g.dex.id);
      if (prev) prev[1] += +w; else mons.push([g.dex.id, +w]);
    }
    areas.push({ key, name: areaNames[key] || key, mons });
  }

  // ── 보드·아울렛·아일랜드·메이즈 맵이 쓰는 전체 풀: 최종진화(메가 제외) ──
  const pool = {};   // dex id → { legend, color, gen }
  for (const [k, g] of gameMon) {
    const s = g.data;
    if (s.mega_stone || s.mega_move || hasForward(s)) continue;
    const p = g.dex;
    if (p.mega || pool[p.id]) continue;
    const regionGen = Object.entries(REGION_GEN).find(([r]) => p.slug.includes('-' + r))?.[1];
    pool[p.id] = { l: isLegend(s) ? 1 : 0, c: COLOR_KO[String(s.color)] || '', g: regionGen || p.gen };
  }

  // ── 맵 ──
  const mapBlock = block(mapSrc, 'BOARD_MAPS', '{');
  const MAP_POOL = { tour: 'area', board: 'type', outlet: 'all', island: 'gen', maze: 'color' };
  const maps = [...mapBlock.matchAll(/(\w+):\s*\{\s*name:\s*"([^"]+)"[\s\S]*?desc:\s*\[([^\]]*)\]/g)]
    .map(([, key, name, desc]) => ({ key, name, desc: [...desc.matchAll(/"([^"]+)"/g)].map(m => m[1]).join(' · '), pool: MAP_POOL[key] || 'all' }));
  // ── 스타팅: 세대별 3마리 (게임 시작 때 무작위 2개 세대의 6마리 중 드래프트로 고름) → { 세대: [dex id] } ──
  const starters = {};
  for (const [, gen, list] of block(script('Board_Game_Flow'), 'GENERATION_STARTERS', '{').matchAll(/(\d+)\s*=>\s*\[([^\]]*)\]/g)) {
    starters[gen] = syms(list).map(sp => gameMon.get(sp)?.dex.id).filter(Boolean);
  }

  // ── 기믹 룰 ──
  const ruleNames = Object.fromEntries([...block(shopSrc, 'RULE_NAMES', '{').matchAll(/(\w+):\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
  const rules = Object.entries(ruleNames).map(([key, name]) => ({ key, name, desc: RULE_DESC[key] || '', uses: RULE_USES[key] || [] }));

  // ── 아이템 (PokeAPI identifier 로, 없으면 게임 한글명) ──
  const itemSlug = new Map(T.items.map(i => [toId(i.identifier), i.identifier]));
  const gameItems = dat('items.dat');
  const itemNames = {};
  // 타입 Z크리스탈은 게임에 한글명이 없어 "노말Z" 식으로 (전용 Z크리스탈은 영문 유지)
  const typeKo = Object.fromEntries(Object.entries(dex.typeNames).map(([t, n]) => [t, n.ko]));
  const Z_TYPE = { normalium: 'normal', firium: 'fire', waterium: 'water', electrium: 'electric', grassium: 'grass', icium: 'ice',
    fightinium: 'fighting', poisonium: 'poison', groundium: 'ground', flyinium: 'flying', psychium: 'psychic', buginium: 'bug',
    rockium: 'rock', ghostium: 'ghost', dragonium: 'dragon', darkinium: 'dark', steelium: 'steel', fairium: 'fairy' };
  // 아이템 이름: 게임에 실제로 표시되는 한글명 우선 → PokeAPI 한글명 → 영문
  const gameItemEn = new Map([...gameItems].map(([k, v]) => [String(k), v.real_name]));
  const apiKo = new Map(T.items.map(i => [i.identifier, null]));
  for (const r of T.item_names) if (r.local_language_id === '3') {
    const it = T.items.find(i => i.id === r.item_id);
    if (it) apiKo.set(it.identifier, r.name);
  }
  const item = sym => {
    const slug = itemSlug.get(toId(sym)) || toId(sym);
    if (!itemNames[slug]) {
      const en = gameItemEn.get(sym) || sym;
      const zType = Z_TYPE[toId(sym).replace(/z$/, '')];
      itemNames[slug] = [koItem.get(en) || apiKo.get(slug) || (zType ? `${typeKo[zType]}Z` : en), en];
    }
    return slug;
  };
  // ── 포켓몬에게 지닐 수 있는 도구만 (게임 items.dat 의 can_hold? 규칙 + 보드 스크립트 예외) ──
  //   중요한 물건(주머니 8 · KeyItem: 로토무카탈로그·그라시데아꽃 등)·기술머신(주머니 4)은 못 지님.
  //   Z크리스탈은 "중요한 물건"이지만 게임이 사용하면 쥐여 주는 방식이라 지님,
  //   마스터테라주얼·다이스프는 지니는 게 아니라 포켓몬에게 쓰는 도구 (Bag_Scene USE_ON_POKEMON_ITEMS)
  const useOnly = new Set(syms(block(script('Bag_Scene'), 'USE_ON_POKEMON_ITEMS')));
  const itemBySym = new Map([...gameItems].map(([k, v]) => [String(k), v]));
  const holdable = sym => {
    const it = itemBySym.get(sym);
    if (!it || useOnly.has(sym)) return false;
    const flags = (it.flags || []).map(String);
    if (flags.includes('ZCrystal')) return true;
    return it.pocket !== 8 && it.pocket !== 4 && !flags.includes('KeyItem');
  };
  const held = list => list.filter(holdable);
  const rawItems = {
    battle: syms(block(itemSrc, 'BATTLE_ITEMS')),
    berry: syms(block(itemSrc, 'BERRY_ITEMS')),
    signature: syms(block(shopSrc, 'SIGNATURE_ITEMS')),
    mega: syms(block(shopSrc, 'MEGA_STONES')),
    z: syms(block(shopSrc, 'Z_CRYSTALS')),
    dynamax: syms(block(shopSrc, 'DYNAMAX_ITEMS')),
    tera: syms(block(shopSrc, 'TERA_ITEMS')),
  };
  const items = Object.fromEntries(Object.entries(rawItems).map(([k, list]) => [k, held(list).map(item)]));
  const notHeld = Object.values(rawItems).flat().filter(s => !holdable(s));

  // ── 도구를 얻는 곳·상점 가격 (지닐 수 있는 도구만) + 같은 이름의 파티 아이템 ──
  //   배틀 아이템: 아이템 칸의 "배틀 아이템"·상점 일반 상품 (가격은 실전 강도 4단계), 나무열매: 같은 곳 (3단계),
  //   전용도구: 상점의 전용도구 칸 (균일가), 메가스톤·Z크리스탈·다이버섯·테라피스: 기믹 상점 (그 룰일 때만)
  const priceOf = name => +(shopSrc.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`))?.[1] || 0);
  const tierOf = (sym, tiers, fallback) => tiers.find(([list]) => list.includes(sym))?.[1] ?? fallback;
  const battleTiers = [[syms(block(shopSrc, 'BATTLE_ITEMS_TOP')), priceOf('BATTLE_ITEM_PRICE_TOP')],
    [syms(block(shopSrc, 'BATTLE_ITEMS_HIGH')), priceOf('BATTLE_ITEM_PRICE_HIGH')], [syms(block(shopSrc, 'BATTLE_ITEMS_LOW')), priceOf('BATTLE_ITEM_PRICE_LOW')]];
  const berryTiers = [[syms(block(shopSrc, 'BERRY_ITEMS_HIGH')), priceOf('BERRY_PRICE_HIGH')], [syms(block(shopSrc, 'BERRY_ITEMS_LOW')), priceOf('BERRY_PRICE_LOW')]];
  const partyItems = [...block(itemSrc, 'PARTY_ITEMS').matchAll(/\{\s*key:\s*:(\w+),\s*icon:\s*:(\w+),\s*name:\s*"([^"]+)"[\s\S]*?desc:\s*"([^"]+)"/g)]
    .map(([, key, icon, name, desc]) => ({ key, icon, name, desc }));
  const itemInfo = {};
  for (const [cat, list] of Object.entries(rawItems)) for (const sym of held(list)) {
    const slug = item(sym);
    const price = cat === 'battle' ? tierOf(sym, battleTiers, priceOf('BATTLE_ITEM_PRICE_MID'))
      : cat === 'berry' ? tierOf(sym, berryTiers, priceOf('BERRY_PRICE_MID'))
        : cat === 'signature' ? priceOf('SIGNATURE_ITEM_PRICE') : priceOf('GIMMICK_ITEM_PRICE');
    const party = partyItems.find(p => p.icon === sym);
    itemInfo[slug] = [cat, price, ...(party ? [party.name, party.desc] : [])];
  }
  // 토너먼트 직전 상점(TOURNEY_SHOP_ITEMS 중 판마다 3개 진열, 종류마다 1번): 파티 아이템 키 → 게임 표시 이름 · 설명 ·
  //   마지막 상점 가격(TOURNEY_SHOP_PRICE / _PRICES) · 일반 상점의 파티 아이템 칸에 나올 때 가격(등급 · 직접 지정, 안 팔면 null)
  const partyPrice = { low: priceOf('PARTY_ITEM_PRICE_LOW'), mid: priceOf('PARTY_ITEM_PRICE_MID'), high: priceOf('PARTY_ITEM_PRICE_HIGH') };
  const shopExcluded = new Set([...block(shopSrc, 'SHOP_EXCLUDED_PARTY_ITEMS').matchAll(/:(\w+)/g)].map(m => m[1]));
  const tourneyPrices = Object.fromEntries([...block(shopSrc, 'TOURNEY_SHOP_PRICES', '{').matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], +m[2]]));
  const partyOverride = Object.fromEntries([...block(shopSrc, 'PARTY_ITEM_PRICE_OVERRIDE', '{').matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], +m[2]]));
  const tierSrc = block(shopSrc, 'PARTY_ITEM_TIERS', '{');
  const partyTier = key => tierSrc.match(new RegExp(`\\b${key}:\\s*:(low|mid|high)\\b`))?.[1] || 'mid';
  const tourneyShop = [...block(shopSrc, 'TOURNEY_SHOP_ITEMS').matchAll(/:(\w+)/g)].map(([, key]) => {
    const p = partyItems.find(x => x.key === key);
    return {
      key, name: p?.name || key, desc: p?.desc || '',
      price: tourneyPrices[key] || priceOf('TOURNEY_SHOP_PRICE'),
      shop: shopExcluded.has(key) ? null : partyOverride[key] || partyPrice[partyTier(key)],
    };
  });
  // 전용도구 칸은 쓸 수 있는 포켓몬을 가졌을 때만 팜 (shop_signature_stock): 도구 → 쓸 수 있는 종 번호
  //   SIGNATURE_USERS (플레이트 → 아르세우스, 전기구슬 → 피카츄 …) · 폼체인지 도구는 FORM_CHANGE_SPECIES 먼저. 부스트에너지는 패러독스 전부라 뺌
  const usersOf = src => [...src.matchAll(/(\w+):\s*\[([^\]]*)\]/g)].map(([, key, list]) => [key, syms(list)]);
  const signatureUsers = {};
  for (const [key, list] of [...usersOf(block(script('Board_Evolution'), 'FORM_CHANGE_SPECIES', '{')), ...usersOf(block(shopSrc, 'SIGNATURE_USERS', '{'))]) {
    const slug = item(key);
    if (!items.signature.includes(slug) || signatureUsers[slug]) continue;
    signatureUsers[slug] = [...new Set(list.map(sp => defaultOf.get(sp)?.sp).filter(Boolean))];
  }
  const tourneyShopCount = priceOf('TOURNEY_SHOP_COUNT');
  const evoItemPrice = priceOf('EVOLUTION_ITEM_PRICE');
  const levelTable = (block(lvSrc, 'LEVEL_TABLE').replace(/#.*$/gm, '').match(/\d+/g) || []).map(Number);

  // ── 기술 습득: 추천 세팅의 기술 중 게임에서 배울 수 없는 것 표시 ──
  // 레벨업 기술은 레벨이 오르면 배우고(Board_Turn), 놓치거나 잊어도 「내 포켓몬 확인 → 기술 떠올리기」로 다시 배운다
  //   (Ultimate Move Tutor pbGetRelearnableMoves, MOVETUTOR 변수 기본 0 → 자기 레벨업 기술 + 첫 진화 단계의 레벨업 기술, 지금 레벨 이하).
  // 기술머신·가르침·교배 기술은 기술 칸·학습장치(SKILL_TILE_MOVE_SCOPE = 2 → 전부)·기술머신으로만 배운다.
  // Lv.75 를 넘는 레벨업 기술은 마지막 레벨로 당겨 배운다 (Board_Move_Cap)
  const finalLevel = levelTable[levelTable.length - 1] || 75;
  const learn = new Map();     // dex id → Set(move id) 전부
  const lvAt = new Map();      // dex id → Map(move id → 배우는 레벨) 레벨업 기술만
  for (const [k, g] of gameMon) {
    const s = g.data;
    const set = learn.get(g.dex.id) || new Set();
    const lv = lvAt.get(g.dex.id) || new Map();
    for (const [level, mv] of s.moves || []) {
      // 레벨 -1 = 기술 떠올리기 전용(9세대 규칙: 레벨업으로는 안 배우고 떠올리기로만) → 처음부터 떠올리기로 배울 수 있으니 0
      const id = toId(String(mv)), l = Math.min(Math.max(+level || 0, 0), finalLevel);
      set.add(id);
      if (!lv.has(id) || l < lv.get(id)) lv.set(id, l);
    }
    for (const mv of [...(s.tutor_moves || []), ...(s.egg_moves || [])]) set.add(toId(String(mv)));
    learn.set(g.dex.id, set);
    lvAt.set(g.dex.id, lv);
  }
  // 진화 전 단계의 기술(알 기술 등)도 물려받음
  const prevOf = new Map();
  for (const [, g] of gameMon) for (const e of g.data.evolutions || []) {
    if (e.length >= 4 && e[3]) continue;
    const t = gameMon.get(String(e[0]));
    if (t) (prevOf.get(t.dex.id) || prevOf.set(t.dex.id, new Set()).get(t.dex.id)).add(g.dex.id);
  }
  const withPrevos = table => id => {
    const out = new Set(table.get(id) || []);
    const seen = new Set([id]);
    const stack = [...(prevOf.get(id) || [])];
    while (stack.length) {
      const pid = stack.pop();
      if (seen.has(pid)) continue;
      seen.add(pid);
      for (const m of table.get(pid) || []) out.add(m);
      for (const q of prevOf.get(pid) || []) stack.push(q);
    }
    return out;
  };
  const fullLearn = withPrevos(learn);
  // 첫 진화 단계 (get_baby_species): 진화 전으로 끝까지
  const babyOf = id => {
    const seen = new Set([id]);
    let cur = id;
    for (;;) {
      const prev = [...(prevOf.get(cur) || [])].find(p => !seen.has(p));
      if (!prev) return cur;
      seen.add(prev);
      cur = prev;
    }
  };
  // 기술 떠올리기로 다시 배울 수 있는 레벨업 기술 → 배우는 레벨 (자기 + 첫 진화 단계, 더 낮은 레벨)
  const levelOf = id => {
    const out = new Map(lvAt.get(id) || []);
    const baby = babyOf(id);
    if (baby !== id) for (const [m, l] of lvAt.get(baby) || []) if (!out.has(m) || l < out.get(m)) out.set(m, l);
    return out;
  };
  const illegal = {};
  for (const id of Object.keys(pool).map(Number)) {
    const can = fullLearn(id);
    if (!can.size) continue;
    const bad = new Set();
    for (const s of Object.values(sets.sets[id] || {})) for (const m of s.mv.flat()) if (!can.has(toId(m))) bad.add(m);
    if (bad.size) illegal[id] = [...bad];
  }

  // ── 내 세팅 입력용: 기술 표 + 포켓몬별로 배울 수 있는 기술 (moves.json, 세팅 입력을 열 때만 받음) ──
  // 기술 한글명: 게임 표시 이름 → (게임에 한글이 없는 9세대 기술은) PokeAPI 한글명 → 영문
  const moveSlug = new Map(T.moves.map(m => [toId(m.identifier), m.identifier]));
  const moveKoApi = new Map();
  const moveById = new Map(T.moves.map(m => [m.id, m.identifier]));
  for (const r of T.move_names) if (r.local_language_id === '3' && moveById.has(r.move_id)) moveKoApi.set(moveById.get(r.move_id), r.name);
  const hasHangul = s => /[가-힣]/.test(s);
  const moveData = buildMoves({
    moves: dat('moves.dat'), toId,
    slugOf: key => moveSlug.get(toId(key)) || toId(key),
    nameOf: (slug, en) => [msg[5].get(en), moveKoApi.get(slug)].find(s => s && hasHangul(s)) || en,
    learnOf: fullLearn, levelOf, ids: [...new Set([...gameMon.values()].map(g => g.dex.id))],
  });
  writeJson(join(DATA_DIR, 'game', 'moves.json'), moveData)
    .then(size => console.log(`✔ game/moves.json · 기술 ${moveData.list.length}개 · 습득표 ${Object.keys(moveData.learn).length}종 (레벨업 ${Object.values(moveData.learn).flat().filter(i => i >= 0).length} · 기술 칸·기술머신 ${Object.values(moveData.learn).flat().filter(i => i < 0).length}) · ${size}`));

  // ── 메가진화: 기본 폼 dex id → [[메가 폼 dex id, 메가스톤]] (게임 상점의 메가스톤 기준) ──
  const megas = {};
  for (const [, g] of gameMon) {
    const s = g.data;
    if (!s.mega_stone || !g.dex.mega) continue;
    const base = defaultOf.get(String(s.species));
    if (!base) continue;
    const stone = item(String(s.mega_stone));
    if (!items.mega.includes(stone)) continue;
    (megas[base.id] ||= []).push([g.dex.id, stone]);
  }

  // ── 진화: 진화 전 dex id → [[최종 진화 dex id, 필요한 진화 도구 또는 null]] (리전폼은 같은 폼으로 진화) ──
  // 파티 추천은 진화 전 포켓몬도 최종 진화 기준으로 평가한다 (토너먼트 Lv.75 까지 레벨이 오르므로)
  // 지방 폼 진화 (Board_Evolution REGION_ITEM_KEYWORDS): 기본 폼이 진화하는 대상에 그 지방 폼이 있으면 진화도구 상점의 지방 도구
  //   (알로라의가면·가라르의차·히스이의골동품)로 그 폼으로 진화. 진화 전 포켓몬 자체에 그 지방 폼이 있으면 대상 아님 (가디 → 히스이 가디가 따로 있음)
  const regionKeys = [...block(script('Board_Evolution'), 'REGION_ITEM_KEYWORDS', '{').matchAll(/(\w+):\s*\[([^\]]*)\]/g)]
    .map(([, sym, list]) => [sym, [...list.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase())]);
  //   게임은 폼 이름만 보므로 피카츄는 「Alola Cap」 때문에 지방 폼이 있는 것으로 판정돼 알로라 라이츄로 진화 못 하고,
  //   피츄는 알로라의가면으로 모자 피카츄가 됨 → 판정은 게임 그대로, 진화 결과가 모자·메가·달마모드 폼인 갈래만 추천에서 뺌 (Board_Extra_Forms 의 예외와 같은 기준)
  const regionalOf = new Map();   // `${지방 도구}|${종}` → 지방 폼 게임 키 (먼저 나오는 폼)
  for (const [key, g] of gameMon) {
    if (!g.data.form) continue;
    const name = String(g.data.real_form_name || '').toLowerCase();
    for (const [sym, words] of regionKeys) {
      const k = `${sym}|${String(g.data.species)}`;
      if (!regionalOf.has(k) && words.some(w => name.includes(w))) regionalOf.set(k, key);
    }
  }
  const NOT_REGIONAL = /Cap|Mega|메가|Zen/i;
  const forwardOf = g => (g.data.evolutions || []).filter(e => !(e.length >= 4 && e[3]) && String(e[1]) !== 'None');
  const nextOf = key => {
    const g = gameMon.get(key), form = g.data.form;
    const out = forwardOf(g).map(e => {
      const target = String(e[0]);
      const to = (form && gameMon.has(`${target}_${form}`)) ? `${target}_${form}` : target;
      const how = /^Item/.test(String(e[1])) && e[2] ? item(String(e[2])) : null;
      return gameMon.has(to) ? [to, how] : null;
    }).filter(Boolean);
    if (!form) {
      for (const [sym] of regionKeys) {
        if (regionalOf.has(`${sym}|${String(g.data.species)}`)) continue;
        for (const e of forwardOf(g)) {
          const r = regionalOf.get(`${sym}|${String(e[0]).replace(/_\d+$/, '')}`);
          if (r && !NOT_REGIONAL.test(String(gameMon.get(r).data.real_form_name)) && !out.some(([to]) => to === r)) out.push([r, item(sym)]);
        }
      }
    }
    return out;
  };
  const evo = {};
  for (const [key, g] of gameMon) {
    if (g.dex.mega || !nextOf(key).length) continue;
    const finals = new Map();
    const walk = (k, how, seen) => {
      const nx = nextOf(k).filter(([to]) => !seen.has(to));
      if (!nx.length) { const id = gameMon.get(k).dex.id; if (!finals.has(id)) finals.set(id, how); return; }
      for (const [to, h] of nx) walk(to, how || h, new Set(seen).add(to));
    };
    walk(key, null, new Set([key]));
    finals.delete(g.dex.id);
    if (finals.size) evo[g.dex.id] = [...new Map([...(evo[g.dex.id] || []), ...finals])];
  }

  // ── 폼 변경 도구 (전용도구 칸 · 쓸 수 있는 포켓몬을 가졌을 때만 팜): 기본 폼 dex id → [{ id, item, hold, t, name }]
  //   지니면 바뀜(백금옥·금강옥·백옥·구슬·가면·녹슨 검/방패·플레이트·메모리·카세트) / 쓰면 바뀜(로토무카탈로그·비추는거울·그라시데아꽃·굴레의항아리·운석)
  //   id: 도감에 따로 있는 폼의 dex id, 없으면 null + t(그 폼의 타입: 아르세우스·실버디) — 게노세크트는 타입은 같고 테크노버스터 타입만 바뀜
  const FORM_ITEM_TARGETS = {
    GRISEOUSCORE: ['GIRATINA_1'], ADAMANTCRYSTAL: ['DIALGA_1'], LUSTROUSGLOBE: ['PALKIA_1'], REDORB: ['GROUDON_1'], BLUEORB: ['KYOGRE_1'],
    ROTOMCATALOG: ['ROTOM_1', 'ROTOM_2', 'ROTOM_3', 'ROTOM_4', 'ROTOM_5'], REVEALGLASS: ['TORNADUS_1', 'THUNDURUS_1', 'LANDORUS_1', 'ENAMORUS_1'],
    GRACIDEA: ['SHAYMIN_1'], PRISONBOTTLE: ['HOOPA_1'], METEORITE: ['DEOXYS_1', 'DEOXYS_2', 'DEOXYS_3'],
    WELLSPRINGMASK: ['OGERPON_1'], HEARTHFLAMEMASK: ['OGERPON_2'], CORNERSTONEMASK: ['OGERPON_3'], RUSTEDSWORD: ['ZACIAN_1'], RUSTEDSHIELD: ['ZAMAZENTA_1'],
  };
  const PLATE_TYPE = { FLAMEPLATE: 'fire', SPLASHPLATE: 'water', ZAPPLATE: 'electric', MEADOWPLATE: 'grass', ICICLEPLATE: 'ice', FISTPLATE: 'fighting',
    TOXICPLATE: 'poison', EARTHPLATE: 'ground', SKYPLATE: 'flying', MINDPLATE: 'psychic', INSECTPLATE: 'bug', STONEPLATE: 'rock',
    SPOOKYPLATE: 'ghost', DRACOPLATE: 'dragon', DREADPLATE: 'dark', IRONPLATE: 'steel', PIXIEPLATE: 'fairy' };
  const DRIVE_NAME = { DOUSEDRIVE: 'douse', SHOCKDRIVE: 'shock', BURNDRIVE: 'burn', CHILLDRIVE: 'chill' };
  const formsOf = sp => [...gameMon].filter(([, g]) => String(g.data.species) === sp && g.data.form);
  const typesOf = g => g.data.types.map(t => String(t).toLowerCase());
  for (const sym of syms(block(shopSrc, 'SIGNATURE_ITEMS'))) {
    if (PLATE_TYPE[sym]) FORM_ITEM_TARGETS[sym] = formsOf('ARCEUS').filter(([, g]) => typesOf(g).join() === PLATE_TYPE[sym]).map(([k]) => k).slice(0, 1);
    const mem = sym.match(/^(\w+)MEMORY$/);
    if (mem) FORM_ITEM_TARGETS[sym] = formsOf('SILVALLY').filter(([, g]) => typesOf(g).join() === mem[1].toLowerCase()).map(([k]) => k).slice(0, 1);
    if (DRIVE_NAME[sym]) FORM_ITEM_TARGETS[sym] = formsOf('GENESECT').filter(([, g]) => String(g.data.real_form_name).toLowerCase().startsWith(DRIVE_NAME[sym])).map(([k]) => k);
  }
  const formItems = {};
  for (const [sym, keys] of Object.entries(FORM_ITEM_TARGETS)) {
    if (!itemBySym.has(sym)) continue;
    for (const key of keys) {
      const g = gameMon.get(key);
      const base = g && defaultOf.get(String(g.data.species));
      if (!g || !base) continue;
      const own = g.dex.id !== base.id;   // 도감에 따로 있는 폼
      const en = String(g.data.real_form_name || '');
      (formItems[base.id] ||= []).push({
        id: own ? g.dex.id : null, item: item(sym), hold: holdable(sym),
        ...(own ? {} : { t: typesOf(g) }), name: koForm.get(en) || (own ? g.dex.ko : en),
      });
    }
  }

  // ── 거다이맥스 (다이맥스 룰, 다이스프를 먹이면 거다이맥스 가능): 기본 폼 dex id → { move, ko, type, fn, power }
  //   거다이맥스 폼(PBS form 이름 Gigantamax)의 gmax_move, 원래 폼은 ungmax_form
  const gameMoves = dat('moves.dat');
  const moveBySym = new Map([...gameMoves].map(([k, v]) => [String(k), v]));
  const gmax = {};
  for (const [, g] of gameMon) {
    const s = g.data;
    if (!s.gmax_move || !/Gigantamax/i.test(String(s.real_form_name))) continue;
    const sp = String(s.species), un = +s.ungmax_form || 0;
    const baseKey = un ? `${sp}_${un}` : sp;
    const base = gameMon.get(baseKey)?.dex || defaultOf.get(sp);
    const mv = moveBySym.get(String(s.gmax_move));
    if (!base || !mv || gmax[base.id]) continue;
    const slug = moveSlug.get(toId(String(s.gmax_move))) || toId(String(s.gmax_move));
    gmax[base.id] = {
      move: slug, ko: [msg[5].get(String(mv.real_name)), moveKoApi.get(slug)].find(x => x && hasHangul(x)) || String(mv.real_name),
      type: String(mv.type).toLowerCase(), fn: String(mv.function_code), power: mv.power || 0,
    };
  }

  // ── 야생 포획 등급 (보드 사파리): 원래 포획률 120↑ 흔함(0) · 45↑ 보통(1) · 그 밖 희귀(2) → 한 번 던질 때 65 / 50 / 35% ──
  const catchTier = {};
  for (const [, g] of gameMon) {
    if (g.dex.mega) continue;
    const rate = +g.data.catch_rate || 0;
    const tier = rate >= 120 ? 0 : rate >= 45 ? 1 : 2;
    catchTier[g.dex.id] = Math.min(catchTier[g.dex.id] ?? 2, tier);
  }

  // ── 게임이 원작과 다른 타입·종족값 (있으면 게임 값 우선) ──
  const changed = {};
  for (const [k, g] of gameMon) {
    const s = g.data, p = g.dex;
    if (s.form !== 0 && p.id === defaultOf.get(String(s.species))?.id) continue;  // 코스튬 폼
    const t = s.types.map(x => String(x).toLowerCase()), st = statsOf(s);
    if (t.join() !== p.t.join() || st.join() !== p.st.join()) changed[p.id] = { t, st };
  }

  const out = {
    meta: { title: '포켓몬 파티!', engine: 'Pokémon Essentials v21.1', version, extracted: new Date().toISOString().slice(0, 10) },
    rules,
    battleModes: [{ key: 'single', name: '싱글' }, { key: 'double', name: '더블' }],
    finalLevel: levelTable[levelTable.length - 1] || 75,
    levelTable,
    tourneyShop,
    tourneyShopCount,
    signatureUsers,
    formItems,
    gmax,
    signaturePrice: priceOf('SIGNATURE_ITEM_PRICE'),
    // 기믹 상점 가격 (테라피스·마스터테라주얼·다이버섯·다이스프)
    gimmickPrices: Object.fromEntries([...block(shopSrc, 'GIMMICK_ITEM_PRICES', '{').matchAll(/(\w+):\s*(\d+)/g)].map(m => [item(m[1]), +m[2]])),
    evoItemPrice,
    maps,
    starters,
    areas,
    pool,
    items,
    itemInfo,
    itemNames,
    megas,
    evo,
    catchTier,
    illegal,
    changed,
  };
  // ── 스크린샷 인식용 아이콘 특징값 (Graphics/Pokemon/Icons · Icons shiny, 메가 폼 제외 · 암컷 아이콘 포함) ──
  // 아이콘의 두 번째 프레임은 첫 프레임을 위로 2px 옮긴 것이라 첫 프레임만 저장 (인식 때 위아래로 맞춰 봄)
  let iconFail = 0;
  const readIcons = dir => {
    const list = [];
    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      const m = file.match(/^([A-Z0-9_]+?)(_female)?\.png$/);
      const g = m && gameMon.get(m[1]);
      if (!g || g.dex.mega || g.data.mega_stone) continue;
      try {
        const img = decodePng(readFileSync(join(dir, file)));
        if (img.width < ICON_FRAME || img.height < ICON_FRAME) continue;
        list.push({ file, id: g.dex.id, cells: iconCells(img, 0) });
      } catch { iconFail++; }
    }
    return list;
  };
  const icons = readIcons(join(GAME, 'Graphics', 'Pokemon', 'Icons'));
  // 이로치(색이 다른 포켓몬, 보드의 '반짝이는 사탕' 칸 등으로 생김): 일반 아이콘과 색이 거의 같은 것은 뺀다
  const plain = new Map(icons.map(x => [x.file, x.cells]));
  const shiny = readIcons(join(GAME, 'Graphics', 'Pokemon', 'Icons shiny')).filter(x => !plain.has(x.file) || cellsDiff(plain.get(x.file), x.cells) > 6);
  // 보드 화면 고정 그림(상단 바 + 플레이어 패널 4장) → 위치 맞추기 템플릿 · 슬롯별 빈칸 배경
  const uiDir = join(GAME, 'Graphics', 'UI', 'PokemonParty');
  const panelFiles = [1, 2, 3, 4].map(i => join(uiDir, `PartyPlayer${i}.png`));
  const hud = panelFiles.every(existsSync)
    ? hudTemplate(composeHud(panelFiles.map(f => decodePng(readFileSync(f))), existsSync(join(uiDir, 'MainUI.png')) ? decodePng(readFileSync(join(uiDir, 'MainUI.png'))) : null))
    : undefined;
  const iconSize = icons.length
    ? writeJson(join(DATA_DIR, 'game', 'icons.json'), {
      grid: ICON_GRID, frame: ICON_FRAME, format: 'rgba4444',
      icons: icons.map(x => [x.id, packCells(x.cells)]), shiny: shiny.map(x => [x.id, packCells(x.cells)]), hud,
    })
    : Promise.resolve('없음');

  return Promise.all([writeJson(join(DATA_DIR, 'game', 'pokemon-party.json'), out), iconSize]).then(([size, isize]) => {
    console.log(`✔ game/icons.json · 아이콘 ${icons.length}개 + 이로치 ${shiny.length}개 · HUD 템플릿 ${hud ? '있음' : '없음'}${iconFail ? ` (읽기 실패 ${iconFail})` : ''} · ${isize}`);
    const legends = Object.values(pool).filter(x => x.l).length;
    console.log(`✔ game/pokemon-party.json · v${version} · ${size}`);
    console.log(`  지역 ${areas.length}곳 (${areas.reduce((a, x) => a + x.mons.length, 0)}종) · 전체 풀 ${Object.keys(pool).length}종 (전설류 ${legends}) · 맵 ${maps.map(m => m.name).join('/')}`);
    console.log(`  룰 ${rules.map(r => r.name).join("/")} · 배틀도구 ${items.battle.length} · 열매 ${items.berry.length} · 메가스톤 ${items.mega.length} · 못 지니는 도구 제외 ${notHeld.join(", ")}`);
    console.log(`  게임에서 못 배우는 세팅 기술이 있는 포켓몬 ${Object.keys(illegal).length} · 원작과 다른 타입/종족값 ${Object.keys(changed).length}`);
    if (unmapped.length) console.log('  ℹ 도감에 매핑 못 한 게임 종족:', [...new Set(unmapped)].slice(0, 40).join(', '));
  });
}

Promise.resolve().then(main).catch(e => { console.error('✖ 게임 데이터 추출 실패:', e.message); process.exit(1); });
