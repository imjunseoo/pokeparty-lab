// 빌드 스크립트 공용: Smogon/Showdown 이름 ↔ PokeAPI 항목 매핑, 한국어 사전
import { LANG, fetchRetry, nameOf, toId } from './pokeapi.mjs';

export const SHOWDOWN = 'https://play.pokemonshowdown.com/data/';
export const TYPE_BY_ID = ['', 'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
  'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'];
export const NAME_TABLES = ['moves', 'move_names', 'items', 'item_names', 'natures', 'nature_names', 'pokemon_species'];
const ITEM_ALIAS = { leek: 'stick' }; // Showdown ID → PokeAPI identifier 가 다른 경우

/** Showdown 데이터: PokeAPI에 아직 없는 신규 기술/아이템의 영어 이름·타입·분류 보충용 */
export async function showdownNames() {
  const result = { moves: {}, items: {}, abilities: {} };
  try {
    const moves = await (await fetchRetry(SHOWDOWN + 'moves.json')).json();
    for (const [id, m] of Object.entries(moves)) result.moves[id] = m;
    for (const file of ['items', 'abilities']) {
      const js = await (await fetchRetry(SHOWDOWN + file + '.js')).text();
      for (const [, id, name] of js.matchAll(/([a-z0-9]+):\{name:"([^"]+)"/g)) result[file][id] = { name };
    }
  } catch (e) {
    console.warn('⚠ Showdown 이름 데이터 실패 (영문 ID로 표시):', e.message);
  }
  return result;
}

/**
 * Smogon/Showdown 포켓몬 이름 → pokedex.json id.
 * strict 가 아니면 폼 접두어로도 매핑 ("Polteageist-Antique" → 포트데스)
 */
// Showdown 이름이 여러 폼의 접두어라 자동 매핑이 안 되는 경우
const MON_ALIAS = { darmanitangalar: 'darmanitan-galar-standard' };

export function createMonMapper(dex, speciesRows) {
  const monKey = new Map();
  for (const p of dex.pokemon) monKey.set(toId(p.slug), p.id);
  const speciesSlug = Object.fromEntries(speciesRows.map(s => [s.id, s.identifier]));
  for (const p of dex.pokemon) if (p.def) monKey.set(toId(speciesSlug[p.sp]), p.id);
  for (const [alias, slug] of Object.entries(MON_ALIAS)) {
    const p = dex.pokemon.find(x => x.slug === slug);
    if (p) monKey.set(alias, p.id);
  }
  const keys = [...monKey.keys()];
  const unmapped = new Set();

  function mapMon(name, { strict = false } = {}) {
    const mega = name.match(/^(.+?)-Mega(?:-([XYZ]))?$/);
    if (mega) {
      const baseId = mapMon(mega[1]);  // "Meowstic-F-Mega" 처럼 기본 종 이름에 성별 접미어가 붙는 경우 포함
      const sp = dex.pokemon.find(p => p.id === baseId)?.sp;
      const hit = dex.pokemon.find(p => p.sp === sp && p.mega &&
        (mega[2] ? p.slug.endsWith('-mega-' + mega[2].toLowerCase()) : !/-mega-[xyz]$/.test(p.slug)));
      if (hit) return hit.id;
    }
    const id = toId(name);
    if (monKey.has(id)) return monKey.get(id);
    const starts = keys.filter(k => k.startsWith(id));
    if (starts.length === 1) return monKey.get(starts[0]);
    if (!strict) {
      // 코스튬/색 차이 폼 등은 가장 긴 접두어(기본 종)로 매핑
      const prefix = keys.filter(k => id.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      if (prefix && prefix.length >= 3) return monKey.get(prefix);
    }
    unmapped.add(name);
    return null;
  }
  return { mapMon, unmapped };
}

/**
 * Showdown ID(또는 영문 이름) → PokeAPI 한국어 이름 사전.
 * dictionary() 를 출력 파일마다 하나씩 만들어 실제로 쓰인 항목만 담는다.
 */
export function createTranslator(T, dex, sd) {
  const moveKo = nameOf(T.move_names, 'move_id', LANG.ko), moveEn = nameOf(T.move_names, 'move_id', LANG.en);
  const moveById = new Map(T.moves.map(m => [toId(m.identifier), m]));
  const itemKo = nameOf(T.item_names, 'item_id', LANG.ko), itemEn = nameOf(T.item_names, 'item_id', LANG.en);
  const itemById = new Map(T.items.map(i => [toId(i.identifier), i]));
  for (const [alias, ident] of Object.entries(ITEM_ALIAS)) {
    const it = T.items.find(i => i.identifier === ident);
    if (it) itemById.set(alias, it);
  }
  const natKo = nameOf(T.nature_names, 'nature_id', LANG.ko);
  const natById = new Map(T.natures.map(n => [toId(n.identifier), n]));
  const abilityById = new Map(Object.keys(dex.abilities).map(s => [toId(s), s]));

  function dictionary() {
    const moves = {}, items = {}, natures = {};
    return {
      moves, items, natures,
      /** 기술 → slug. 사전 값: [한국어, 영어, 타입, 분류(0 변화 / 1 물리 / 2 특수)] */
      move(name) {
        const id = toId(name);
        const m = moveById.get(id);
        const slug = m ? m.identifier : id;
        if (!moves[slug]) {
          const s = sd.moves[id];
          const en = m ? moveEn[m.id] : s?.name || name;
          const cls = m ? +m.damage_class_id - 1 : { Status: 0, Physical: 1, Special: 2 }[s?.category] ?? 0;
          const type = m ? TYPE_BY_ID[+m.type_id] || '' : s?.type?.toLowerCase() || '';
          // 구세대 세팅의 "Hidden Power Ice" 등은 "잠재파워(얼음)" 으로
          const hp = !m && /^hiddenpower[a-z]+$/.test(id) && dex.typeNames[type] ? `잠재파워(${dex.typeNames[type].ko})` : null;
          moves[slug] = [(m && moveKo[m.id]) || hp || en, en, type, cls];
        }
        return slug;
      },
      /** 도구 → slug. koFallback: PokeAPI에 없는 신규 도구(예: Z-A 메가스톤)의 한국어 이름 */
      item(name, koFallback) {
        const id = toId(name);
        const it = itemById.get(id);
        const slug = it ? it.identifier : id;
        if (!items[slug]) {
          const en = it ? itemEn[it.id] : sd.items[id]?.name || name;
          items[slug] = [(it && itemKo[it.id]) || koFallback || en, en];
        }
        return slug;
      },
      /** 성격 → slug. 사전 값: [한국어, 상승 능력치 index, 하락 능력치 index] (0 HP … 5 스피드) */
      nature(name) {
        const n = natById.get(toId(name));
        if (!n) return null;
        natures[n.identifier] ||= [natKo[n.id] || name, +n.increased_stat_id - 1, +n.decreased_stat_id - 1];
        return n.identifier;
      },
      ability: name => abilityById.get(toId(name)) || null,
    };
  }
  return { dictionary, isKnownMove: id => moveById.has(toId(id)), isKnownItem: s => T.items.some(i => i.identifier === s) };
}
