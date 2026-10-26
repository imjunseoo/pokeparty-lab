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
  const items = {
    battle: syms(block(itemSrc, 'BATTLE_ITEMS')).map(item),
    berry: syms(block(itemSrc, 'BERRY_ITEMS')).map(item),
    signature: syms(block(shopSrc, 'SIGNATURE_ITEMS')).map(item),
    mega: syms(block(shopSrc, 'MEGA_STONES')).map(item),
    z: syms(block(shopSrc, 'Z_CRYSTALS')).map(item),
    dynamax: syms(block(shopSrc, 'DYNAMAX_ITEMS')).map(item),
    tera: syms(block(shopSrc, 'TERA_ITEMS')).map(item),
  };
  // 토너먼트 직전 상점: 파티 아이템 키 → 게임 표시 이름
  const tourneyShop = [...block(shopSrc, 'TOURNEY_SHOP_ITEMS').matchAll(/:(\w+)/g)].map(([, key]) => ({
    key, name: itemSrc.match(new RegExp(`key:\\s*:${key}\\b[^}]*?name:\\s*"([^"]+)"`))?.[1] || key,
  }));
  const levelTable = (block(lvSrc, 'LEVEL_TABLE').replace(/#.*$/gm, '').match(/\d+/g) || []).map(Number);

  // ── 기술 습득: 추천 세팅의 기술 중 게임에서 배울 수 없는 것 표시 ──
  const learn = new Map();   // dex id → Set(move id)
  for (const [k, g] of gameMon) {
    const s = g.data;
    const set = learn.get(g.dex.id) || new Set();
    for (const [, mv] of s.moves || []) set.add(toId(String(mv)));
    for (const mv of [...(s.tutor_moves || []), ...(s.egg_moves || [])]) set.add(toId(String(mv)));
    learn.set(g.dex.id, set);
  }
  // 진화 전 단계의 기술(알 기술 등)도 물려받음
  const prevOf = new Map();
  for (const [, g] of gameMon) for (const e of g.data.evolutions || []) {
    if (e.length >= 4 && e[3]) continue;
    const t = gameMon.get(String(e[0]));
    if (t) (prevOf.get(t.dex.id) || prevOf.set(t.dex.id, new Set()).get(t.dex.id)).add(g.dex.id);
  }
  const fullLearn = id => {
    const out = new Set(learn.get(id) || []);
    const seen = new Set([id]);
    const stack = [...(prevOf.get(id) || [])];
    while (stack.length) {
      const pid = stack.pop();
      if (seen.has(pid)) continue;
      seen.add(pid);
      for (const m of learn.get(pid) || []) out.add(m);
      for (const q of prevOf.get(pid) || []) stack.push(q);
    }
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
    learnOf: fullLearn, ids: [...new Set([...gameMon.values()].map(g => g.dex.id))],
  });
  writeJson(join(DATA_DIR, 'game', 'moves.json'), moveData)
    .then(size => console.log(`✔ game/moves.json · 기술 ${moveData.list.length}개 · 습득표 ${Object.keys(moveData.learn).length}종 · ${size}`));

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
  const nextOf = key => {
    const g = gameMon.get(key), form = g.data.form;
    return (g.data.evolutions || []).filter(e => !(e.length >= 4 && e[3]) && String(e[1]) !== 'None').map(e => {
      const target = String(e[0]);
      const to = (form && gameMon.has(`${target}_${form}`)) ? `${target}_${form}` : target;
      const how = /^Item/.test(String(e[1])) && e[2] ? item(String(e[2])) : null;
      return gameMon.has(to) ? [to, how] : null;
    }).filter(Boolean);
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
    maps,
    starters,
    areas,
    pool,
    items,
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
    console.log(`  룰 ${rules.map(r => r.name).join('/')} · 배틀도구 ${items.battle.length} · 열매 ${items.berry.length} · 메가스톤 ${items.mega.length}`);
    console.log(`  게임에서 못 배우는 세팅 기술이 있는 포켓몬 ${Object.keys(illegal).length} · 원작과 다른 타입/종족값 ${Object.keys(changed).length}`);
    if (unmapped.length) console.log('  ℹ 도감에 매핑 못 한 게임 종족:', [...new Set(unmapped)].slice(0, 40).join(', '));
  });
}

Promise.resolve().then(main).catch(e => { console.error('✖ 게임 데이터 추출 실패:', e.message); process.exit(1); });
