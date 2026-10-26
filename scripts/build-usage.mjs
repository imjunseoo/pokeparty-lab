#!/usr/bin/env node
/**
 * Smogon 공개 사용률 통계(https://www.smogon.com/stats/)에서 최신 달의 실전 데이터를 받아
 * site/data/usage/<포맷>.json 을 생성한다. (기술·아이템·특성·성격·테라·동료·카운터 사용률)
 * 이름은 PokeAPI 한국어 이름으로 변환한다. build-pokedex.mjs 를 먼저 실행해야 한다.
 *
 *   node scripts/build-usage.mjs [--cache .cache/csv]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, LANG, fetchRetry, loadTables, nameOf, toId, writeJson } from './lib/pokeapi.mjs';

const STATS = 'https://www.smogon.com/stats/';
const SHOWDOWN = 'https://play.pokemonshowdown.com/data/';
const FAMILIES = [
  { key: 'champions-singles', label: '챔피언스 싱글', desc: '랭크배틀 싱글', re: /^gen9championsbssreg([a-z]+)$/, cutoffs: [1630, 1500] },
  { key: 'champions-doubles', label: '챔피언스 더블', desc: 'VGC 더블배틀', re: /^gen9championsvgc(\d{4})reg([a-z]+)$/, cutoffs: [1630, 1500] },
  { key: 'sv-ou', label: 'SV 싱글 OU', desc: '스칼렛·바이올렛 Smogon OU', re: /^gen9ou$/, cutoffs: [1695, 1500] },
];
const MAX_MONS = 160;      // 포맷당 사용률 상위 포켓몬 수
const MIN_USAGE = 0.004;   // 0.4% 미만은 제외
const ITEM_ALIAS = { leek: 'stick' }; // Showdown ID → PokeAPI identifier 가 다른 경우
const pct = v => Math.round(v * 1000) / 10;

async function smogonMonths() {
  const html = await (await fetchRetry(STATS)).text();
  return [...new Set([...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]))].sort().reverse();
}

async function formatsIn(month) {
  const html = await (await fetchRetry(STATS + month + '/')).text();
  const out = {};
  for (const [, id, cut] of html.matchAll(/href="([a-z0-9]+)-(\d+)\.txt"/g)) (out[id] ||= new Set()).add(+cut);
  return out;
}

// Showdown 데이터: PokeAPI에 아직 없는 신규 기술/아이템의 영어 이름·타입 보충용
async function showdownNames() {
  const result = { moves: {}, items: {}, abilities: {} };
  try {
    const moves = await (await fetchRetry(SHOWDOWN + 'moves.json')).json();
    for (const [id, m] of Object.entries(moves)) result.moves[id] = { name: m.name, type: m.type?.toLowerCase(), category: m.category };
    for (const file of ['items', 'abilities']) {
      const js = await (await fetchRetry(SHOWDOWN + file + '.js')).text();
      for (const [, id, name] of js.matchAll(/([a-z0-9]+):\{name:"([^"]+)"/g)) result[file][id] = { name };
    }
  } catch (e) {
    console.warn('⚠ Showdown 이름 데이터 실패 (영문 ID로 표시):', e.message);
  }
  return result;
}

async function main() {
  const dex = JSON.parse(await readFile(join(DATA_DIR, 'pokedex.json'), 'utf8'));
  const [T, sd] = await Promise.all([
    loadTables(['moves', 'move_names', 'items', 'item_names', 'natures', 'nature_names', 'pokemon_species']),
    showdownNames(),
  ]);
  const typeSlugById = ['', 'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
    'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'];

  // ── Smogon 이름 → PokeAPI 항목 매핑 테이블 ──
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

  const monKey = new Map();
  for (const p of dex.pokemon) monKey.set(toId(p.slug), p.id);
  const speciesSlug = Object.fromEntries(T.pokemon_species.map(s => [s.id, s.identifier]));
  for (const p of dex.pokemon) if (p.def) monKey.set(toId(speciesSlug[p.sp]), p.id);
  const keys = [...monKey.keys()];
  const unmapped = new Set();
  function mapMon(name) {
    const mega = name.match(/^(.+?)-Mega(?:-([XYZ]))?$/);
    if (mega) {
      const baseId = mapMon(mega[1]);
      const sp = dex.pokemon.find(p => p.id === baseId)?.sp;
      const hit = dex.pokemon.find(p => p.sp === sp && p.mega &&
        (mega[2] ? p.slug.endsWith('-mega-' + mega[2].toLowerCase()) : !/-mega-[xyz]$/.test(p.slug)));
      if (hit) return hit.id;
    }
    const id = toId(name);
    if (monKey.has(id)) return monKey.get(id);
    const starts = keys.filter(k => k.startsWith(id));
    if (starts.length === 1) return monKey.get(starts[0]);
    // 코스튬/색 차이 폼 등은 가장 긴 접두어(기본 종)로 매핑: "Polteageist-Antique" → polteageist
    const prefix = keys.filter(k => id.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (prefix && prefix.length >= 3) return monKey.get(prefix);
    unmapped.add(name);
    return null;
  }

  const months = await smogonMonths();
  const index = [];
  for (const fam of FAMILIES) {
    let found = null;
    for (const month of months.slice(0, 3)) {
      const formats = await formatsIn(month);
      const ids = Object.keys(formats).filter(id => fam.re.test(id)).sort().reverse();
      if (!ids.length) continue;
      const format = ids[0];
      const cutoff = fam.cutoffs.find(c => formats[format].has(c));
      if (cutoff) { found = { month, format, cutoff }; break; }
    }
    if (!found) { console.warn(`⚠ ${fam.key}: 최근 3개월 통계 없음, 건너뜀`); continue; }

    const { month, format, cutoff } = found;
    const reg = format.match(/reg([a-z]+)$/)?.[1];
    const regLabel = reg ? ` · 레귤레이션 ${reg.length === 2 ? reg[0].toUpperCase() + '-' + reg[1].toUpperCase() : reg.toUpperCase()}` : '';
    console.log(`${fam.key}: ${month} ${format} (레이팅 ${cutoff}+) 다운로드 중...`);
    const chaos = await (await fetchRetry(`${STATS}${month}/chaos/${format}-${cutoff}.json`)).json();

    const moves = {}, items = {}, natures = {};
    const addMove = id => {
      const m = moveById.get(id);
      const slug = m ? m.identifier : id;
      if (!moves[slug]) {
        const en = m ? moveEn[m.id] : sd.moves[id]?.name || id;
        // [한국어, 영어, 타입, 분류(0 변화 / 1 물리 / 2 특수)]
        const cls = m ? +m.damage_class_id - 1 : { Status: 0, Physical: 1, Special: 2 }[sd.moves[id]?.category] ?? 0;
        moves[slug] = [m && moveKo[m.id] || en, en, m ? typeSlugById[+m.type_id] || '' : sd.moves[id]?.type || '', cls];
      }
      return slug;
    };
    const addItem = id => {
      const it = itemById.get(id);
      const slug = it ? it.identifier : id;
      if (!items[slug]) { const en = it ? itemEn[it.id] : sd.items[id]?.name || id; items[slug] = [it && itemKo[it.id] || en, en]; }
      return slug;
    };
    const addNature = name => {
      const n = natById.get(toId(name));
      if (!n) return null;
      natures[n.identifier] ||= [natKo[n.id] || name, +n.increased_stat_id - 1, +n.decreased_stat_id - 1];
      return n.identifier;
    };

    const entries = Object.entries(chaos.data).filter(([, d]) => d.usage >= MIN_USAGE)
      .sort((a, b) => b[1].usage - a[1].usage).slice(0, MAX_MONS);
    const mons = {};
    let rank = 0;
    for (const [name, d] of entries) {
      const id = mapMon(name);
      rank++;
      if (!id || mons[id]) continue;
      const total = Object.values(d.Abilities).reduce((a, b) => a + b, 0) || 1;
      const top = (obj, n, min = 0.01) => Object.entries(obj || {}).filter(([k]) => k && k !== 'nothing')
        .sort((a, b) => b[1] - a[1]).filter(([, v]) => v / total >= min).slice(0, n);
      const mon = { r: rank, u: pct(d.usage) };
      mon.ab = top(d.Abilities, 3).map(([k, v]) => [abilityById.get(k) || k, pct(v / total)]);
      mon.it = top(d.Items, 4).map(([k, v]) => [addItem(k), pct(v / total)]);
      mon.mv = top(d.Moves, 8, 0.03).map(([k, v]) => [addMove(k), pct(v / total)]);
      const tera = top(d['Tera Types'], 3, 0.03);
      if (tera.length) mon.te = tera.map(([k, v]) => [k.toLowerCase(), pct(v / total)]);
      mon.sp = top(d.Spreads, 3).map(([k, v]) => { const [nat, evs] = k.split(':'); return [addNature(nat), evs, pct(v / total)]; })
        .filter(s => s[0]);
      mon.tm = top(d.Teammates, 15).map(([k, v]) => [mapMon(k), pct(v / total)]).filter(([tid]) => tid && tid !== id);
      // 실전 카운터: 대면 시 상대를 쓰러뜨리거나 교체시킨 비율 (Smogon 공식 점수 p - 4σ)
      mon.cc = Object.entries(d['Checks and Counters'] || {}).map(([k, v]) => [mapMon(k), v.p - 4 * v.d, v.n])
        .filter(([cid, s, n]) => cid && cid !== id && s > 0 && n >= 20).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([cid, s]) => [cid, pct(s)]);
      mons[id] = mon;
    }

    const file = `${fam.key}.json`;
    const out = {
      key: fam.key, label: fam.label, desc: fam.desc + regLabel, format, month, cutoff,
      battles: chaos.info['number of battles'],
      points: format.includes('champions') ? '능력 포인트' : '노력치',
      mons, moves, items, natures,
    };
    const size = await writeJson(join(DATA_DIR, 'usage', file), out);
    index.push({ key: fam.key, label: fam.label, desc: out.desc, file, format, month, cutoff, battles: out.battles, count: Object.keys(mons).length });
    console.log(`  ✔ ${file} · 포켓몬 ${Object.keys(mons).length}개, 기술 ${Object.keys(moves).length}개, 아이템 ${Object.keys(items).length}개 · ${size}`);
    const raw = Object.keys(moves).filter(s => !moveById.has(toId(s))).concat(Object.keys(items).filter(s => !T.items.some(i => i.identifier === s)));
    if (raw.length) console.log('  ℹ PokeAPI에 한글명이 없어 영문 표기:', raw.join(', '));
  }
  if (!index.length) throw new Error('사용률 데이터를 하나도 받지 못했습니다');
  await writeJson(join(DATA_DIR, 'usage', 'index.json'), { generated: new Date().toISOString(), source: 'Smogon University usage stats', formats: index });
  if (unmapped.size) console.log('ℹ 도감에 매핑하지 못한 이름:', [...unmapped].join(', '));
}

main().catch(e => { console.error('✖ 사용률 데이터 생성 실패:', e.message); process.exit(1); });
