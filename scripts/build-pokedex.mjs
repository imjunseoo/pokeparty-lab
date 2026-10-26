#!/usr/bin/env node
/**
 * PokeAPI 공개 데이터베이스(github.com/PokeAPI/pokeapi 의 data/v2/csv)를 내려받아
 * site/data/pokedex.json (포켓몬·타입 상성표·특성·게임별 도감) 을 생성한다.
 *
 *   node scripts/build-pokedex.mjs [--cache .cache/csv]
 */
import { join } from 'node:path';
import { DATA_DIR, LANG, cleanText, fetchRetry, groupBy, loadTables, nameOf, writeJson } from './lib/pokeapi.mjs';

const SPRITES_API = 'https://api.github.com/repos/PokeAPI/sprites';

// 화면 표시 순서 (게임 내 도감 필터 순서)
const TYPE_ORDER = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

// 게임별 도감 (pokedexes.csv 의 identifier)
const GAME_DEX = {
  champions: { name: 'Pokémon Champions', dexes: ['champions'] },
  sv: { name: '스칼렛·바이올렛', dexes: ['paldea', 'kitakami', 'blueberry'], noMega: true },
  za: { name: '레전즈 Z-A', dexes: ['lumiose-city', 'hyperspace'] },
};

// 지방 폼은 "알로라 라이츄"처럼 접두어로 표기
const REGION_PREFIX = { alola: '알로라', galar: '가라르', hisui: '히스이', paldea: '팔데아' };
const REGION_FORM_KO = { '알로라의 모습': '알로라', '가라르의 모습': '가라르', '히스이의 모습': '히스이', '팔데아의 모습': '팔데아' };
// PokeAPI에 한국어 폼 이름이 없는 경우의 보충 표기
const FORM_KO_FALLBACK = {
  origin: '오리진폼', therian: '영물폼', female: '암컷', 'white-striped': '백색근의 모습',
  roaming: '도보폼', hero: '마이티폼', terastal: '테라스탈폼', stellar: '스텔라폼',
  'paldea-combat-breed': '컴뱃종', 'paldea-blaze-breed': '블레이즈종', 'paldea-aqua-breed': '워터종',
  'three-segment': '세마디폼', 'family-of-three': '세식구', droopy: '늘어진 모습', stretchy: '뻗은 모습',
};
// 지방 폼에서 새 진화가 생겨 종(species) 기준으로는 "미진화"로 잡히지만 원래 폼은 최종진화인 경우
const FINAL_OVERRIDE = new Set(['farfetchd', 'mr-mime', 'corsola', 'linoone', 'qwilfish']);
// 배틀 중에만 되는 폼인데 PokeAPI 플래그가 빠진 경우
const BATTLE_OVERRIDE = new Set(['minior-red']);
// 데이터에서 제외: 거다이맥스·토템·피카츄 코스튬·레츠고 파트너 등 상성/능력치가 같은 연출용 폼
const EXCLUDE = [/-gmax$/, /-totem/, /^pikachu-(.*-cap|cosplay|rock-star|belle|pop-star|phd|libre|starter)$/, /^eevee-starter$/, /^eternatus-eternamax$/];

// PokeAPI/sprites 저장소의 디렉터리 목록으로 실제 존재하는 이미지 id 를 확인 (깨진 이미지 방지)
async function spriteIds() {
  const headers = { 'User-Agent': 'pokeparty-lab-build', Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const tree = async sha => (await (await fetchRetry(`${SPRITES_API}/git/trees/${sha}`, { headers })).json()).tree;
  const sub = (t, path) => t.find(e => e.path === path && e.type === 'tree').sha;
  const ids = t => new Set(t.filter(e => /^\d+\.png$/.test(e.path)).map(e => +e.path.slice(0, -4)));
  try {
    const root = await tree('master');
    const pokemon = await tree(sub(await tree(sub(root, 'sprites')), 'pokemon'));
    const other = await tree(sub(pokemon, 'other'));
    const [art, home] = await Promise.all([tree(sub(other, 'official-artwork')), tree(sub(other, 'home'))]);
    return { front: ids(pokemon), art: ids(art), home: ids(home) };
  } catch (e) {
    console.warn('⚠ 스프라이트 목록 확인 실패 (이미지는 런타임에 대체 처리):', e.message);
    return null;
  }
}

async function main() {
  console.log('PokeAPI 데이터 다운로드 중...');
  const [T, sprites] = await Promise.all([
    loadTables(['pokemon', 'pokemon_species', 'pokemon_species_names', 'pokemon_types', 'types', 'type_names',
      'type_efficacy', 'pokemon_stats', 'abilities', 'ability_names', 'ability_flavor_text', 'pokemon_abilities',
      'pokemon_forms', 'pokemon_form_names', 'pokemon_dex_numbers', 'pokedexes']),
    spriteIds(),
  ]);

  // ── 타입 & 상성표 ──
  const typeSlug = Object.fromEntries(T.types.map(t => [t.id, t.identifier]));
  const typeKo = nameOf(T.type_names, 'type_id', LANG.ko);
  const typeEn = nameOf(T.type_names, 'type_id', LANG.en);
  const typeNames = {};
  for (const t of T.types) {
    if ([...TYPE_ORDER, 'stellar'].includes(t.identifier)) typeNames[t.identifier] = { ko: typeKo[t.id], en: typeEn[t.id] };
  }
  const idx = Object.fromEntries(TYPE_ORDER.map((t, i) => [t, i]));
  const chart = TYPE_ORDER.map(() => TYPE_ORDER.map(() => 1));
  for (const e of T.type_efficacy) {
    const a = idx[typeSlug[e.damage_type_id]], d = idx[typeSlug[e.target_type_id]];
    if (a !== undefined && d !== undefined) chart[a][d] = +e.damage_factor / 100;
  }

  // ── 특성 (한국어 설명이 없으면 영어 설명) ──
  const abilityKo = nameOf(T.ability_names, 'ability_id', LANG.ko);
  const abilityEn = nameOf(T.ability_names, 'ability_id', LANG.en);
  const flavor = {};
  for (const r of T.ability_flavor_text) {
    const lang = r.language_id === LANG.ko ? 'ko' : r.language_id === LANG.en ? 'en' : null;
    if (!lang) continue;
    const cur = (flavor[r.ability_id] ||= {})[lang];
    if (!cur || +r.version_group_id > cur.vg) flavor[r.ability_id][lang] = { vg: +r.version_group_id, text: cleanText(r.flavor_text) };
  }
  const abilitySlug = Object.fromEntries(T.abilities.map(a => [a.id, a.identifier]));

  // ── 종(species) ──
  const species = Object.fromEntries(T.pokemon_species.map(s => [s.id, s]));
  const speciesKo = nameOf(T.pokemon_species_names, 'pokemon_species_id', LANG.ko);
  const genusKo = nameOf(T.pokemon_species_names, 'pokemon_species_id', LANG.ko, 'genus');
  const speciesEn = nameOf(T.pokemon_species_names, 'pokemon_species_id', LANG.en);
  const hasEvolution = new Set(T.pokemon_species.map(s => s.evolves_from_species_id).filter(Boolean));

  // ── 게임별 도감 ──
  const dexId = Object.fromEntries(T.pokedexes.map(d => [d.identifier, d.id]));
  const dexSpecies = groupBy(T.pokemon_dex_numbers, 'pokedex_id');
  const games = {};
  for (const [key, g] of Object.entries(GAME_DEX)) {
    const set = new Set();
    for (const d of g.dexes) for (const r of dexSpecies[dexId[d]] || []) set.add(+r.species_id);
    if (set.size) games[key] = { name: g.name, species: [...set].sort((a, b) => a - b), ...(g.noMega && { noMega: 1 }) };
  }

  // ── 폼 ──
  const defaultForm = {};
  for (const f of T.pokemon_forms) if (f.is_default === '1') defaultForm[f.pokemon_id] = f;
  const formKo = nameOf(T.pokemon_form_names, 'pokemon_form_id', LANG.ko, 'form_name');
  const formEnFull = nameOf(T.pokemon_form_names, 'pokemon_form_id', LANG.en, 'pokemon_name');

  const typesBy = groupBy(T.pokemon_types, 'pokemon_id');
  const statsBy = groupBy(T.pokemon_stats, 'pokemon_id');
  const abilBy = groupBy(T.pokemon_abilities, 'pokemon_id');

  const fallbackNames = [];
  function koreanName(p, form) {
    const base = speciesKo[p.species_id];
    if (p.is_default === '1') return base;
    const ident = form?.form_identifier || p.identifier.replace(species[p.species_id].identifier + '-', '');
    const ko = form && formKo[form.id];
    if (ko) {
      if (ko.includes(base)) return ko;                  // 메가리자몽X, 히트로토무
      if (REGION_FORM_KO[ko]) return `${REGION_FORM_KO[ko]} ${base}`;
      return `${base} (${ko})`;
    }
    if (/(^|-)mega(-|$)/.test(ident)) {                  // mega, mega-x, mega-male, curly-mega ...
      const letter = ident.match(/mega-([xyz])$/)?.[1]?.toUpperCase() || '';
      const extra = FORM_KO_FALLBACK[ident.replace(/-?mega(-[xyz])?-?/, '')];
      return `메가${base}${letter}${extra ? ` (${extra})` : ''}`;
    }
    if (ident === 'primal') return `원시${base}`;
    const region = Object.keys(REGION_PREFIX).find(r => ident === r || ident.startsWith(r + '-'));
    if (region) {
      const rest = FORM_KO_FALLBACK[ident];
      return `${REGION_PREFIX[region]} ${base}${rest ? ` (${rest})` : ''}`;
    }
    if (FORM_KO_FALLBACK[ident]) return `${base} (${FORM_KO_FALLBACK[ident]})`;
    fallbackNames.push(p.identifier);
    return `${base} (${ident})`;
  }

  const pokemon = [];
  const seen = new Set(); // 같은 종·타입·종족값의 중복 폼(색 차이 등) 제거
  for (const p of [...T.pokemon].sort((a, b) => +a.id - +b.id)) {
    if (EXCLUDE.some(re => re.test(p.identifier))) continue;
    const sp = species[p.species_id];
    const form = defaultForm[p.id];
    const types = (typesBy[p.id] || []).sort((a, b) => a.slot - b.slot).map(t => typeSlug[t.type_id]);
    if (!types.length || types.some(t => !TYPE_ORDER.includes(t))) { console.warn('⚠ 타입 이상:', p.identifier, types); continue; }
    const st = ['1', '2', '3', '4', '5', '6'].map(s => +(statsBy[p.id] || []).find(r => r.stat_id === s)?.base_stat || 0);
    const abil = (abilBy[p.id] || []).sort((a, b) => a.slot - b.slot);
    const hidden = abil.find(a => a.is_hidden === '1');
    const isMega = form?.is_mega === '1' || form?.form_identifier === 'primal';
    const key = [p.species_id, types.join('/'), st.join(','), isMega].join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const isDefault = p.is_default === '1';
    const entry = {
      id: +p.id,
      sp: +p.species_id,
      slug: p.identifier,
      ko: koreanName(p, form),
      en: isDefault ? speciesEn[p.species_id] : (form && formEnFull[form.id]) || `${speciesEn[p.species_id]} (${form?.form_identifier || p.identifier})`,
      t: types,
      st,                                                  // HP 공격 방어 특공 특방 스피드
      ab: abil.filter(a => a.is_hidden === '0').map(a => abilitySlug[a.ability_id]),
      ha: hidden ? abilitySlug[hidden.ability_id] : null,  // 숨겨진 특성
      gen: +sp.generation_id,
      genus: genusKo[p.species_id] || '',
    };
    // 필터용 플래그 (참일 때만 기록해 용량 절약)
    const flags = {
      def: isDefault,
      final: !hasEvolution.has(p.species_id) || (isDefault && FINAL_OVERRIDE.has(sp.identifier)),
      legend: sp.is_legendary === '1',
      myth: sp.is_mythical === '1',
      mega: isMega,
      battle: !isMega && (form?.is_battle_only === '1' || BATTLE_OVERRIDE.has(p.identifier)),
      region: Object.keys(REGION_PREFIX).some(r => (form?.form_identifier || '').startsWith(r)),
    };
    for (const [k, v] of Object.entries(flags)) if (v) entry[k] = 1;
    // 사용 가능한 이미지: f=도트, a=공식 일러스트, h=HOME 렌더
    if (sprites) entry.img = ['f', 'a', 'h'].filter((c, i) => [sprites.front, sprites.art, sprites.home][i].has(entry.id)).join('') || '-';
    pokemon.push(entry);
  }

  // 등장하는 특성만 저장: slug → [한국어, 영어, 설명]
  const used = new Set(pokemon.flatMap(p => [...p.ab, p.ha].filter(Boolean)));
  const abilities = {};
  for (const a of T.abilities) {
    if (!used.has(a.identifier)) continue;
    const f = flavor[a.id] || {};
    abilities[a.identifier] = [abilityKo[a.id] || abilityEn[a.id] || a.identifier, abilityEn[a.id] || a.identifier, (f.ko || f.en || {}).text || ''];
  }

  const data = {
    meta: { generated: new Date().toISOString(), source: 'PokeAPI', count: pokemon.length, species: Object.keys(speciesKo).length },
    types: TYPE_ORDER,
    typeNames,
    chart,
    games,
    abilities,
    pokemon,
  };
  const size = await writeJson(join(DATA_DIR, 'pokedex.json'), data);
  console.log(`✔ pokedex.json · 포켓몬 ${pokemon.length}개 (종 ${data.meta.species}), 특성 ${Object.keys(abilities).length}개, 도감 ${Object.keys(games).join('/')} · ${size}`);
  if (sprites) {
    const noImg = pokemon.filter(p => p.img === '-');
    if (noImg.length) console.log('  ℹ 이미지 없음:', noImg.map(p => p.slug).join(', '));
  }
  if (fallbackNames.length) console.log('  ℹ 한글 폼 이름 보충 필요:', fallbackNames.join(', '));
  const bad = pokemon.filter(p => !p.ko || p.ko.includes('undefined'));
  if (bad.length) throw new Error('한국어 이름 누락: ' + bad.map(p => p.slug).join(', '));
}

main().catch(e => { console.error('✖ pokedex 생성 실패:', e.message); process.exit(1); });
