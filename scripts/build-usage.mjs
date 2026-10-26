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
import { DATA_DIR, fetchRetry, loadTables, writeJson } from './lib/pokeapi.mjs';
import { NAME_TABLES, createMonMapper, createTranslator, showdownNames } from './lib/names.mjs';

const STATS = 'https://www.smogon.com/stats/';
const FAMILIES = [
  { key: 'champions-singles', label: '챔피언스 싱글', desc: '랭크배틀 싱글', re: /^gen9championsbssreg([a-z]+)$/, cutoffs: [1630, 1500] },
  { key: 'champions-doubles', label: '챔피언스 더블', desc: 'VGC 더블배틀', re: /^gen9championsvgc(\d{4})reg([a-z]+)$/, cutoffs: [1630, 1500] },
  { key: 'sv-ou', label: 'SV 싱글 OU', desc: '스칼렛·바이올렛 Smogon OU', re: /^gen9ou$/, cutoffs: [1695, 1500] },
];
const MAX_MONS = 160;      // 포맷당 사용률 상위 포켓몬 수
const MIN_USAGE = 0.004;   // 0.4% 미만은 제외
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

async function main() {
  const dex = JSON.parse(await readFile(join(DATA_DIR, 'pokedex.json'), 'utf8'));
  const [T, sd] = await Promise.all([loadTables(NAME_TABLES), showdownNames()]);
  const { mapMon, unmapped } = createMonMapper(dex, T.pokemon_species);
  const translator = createTranslator(T, dex, sd);

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

    const dict = translator.dictionary();
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
      mon.ab = top(d.Abilities, 3).map(([k, v]) => [dict.ability(k) || k, pct(v / total)]);
      mon.it = top(d.Items, 4).map(([k, v]) => [dict.item(k), pct(v / total)]);
      mon.mv = top(d.Moves, 8, 0.03).map(([k, v]) => [dict.move(k), pct(v / total)]);
      const tera = top(d['Tera Types'], 3, 0.03);
      if (tera.length) mon.te = tera.map(([k, v]) => [k.toLowerCase(), pct(v / total)]);
      mon.sp = top(d.Spreads, 3).map(([k, v]) => { const [nat, evs] = k.split(':'); return [dict.nature(nat), evs, pct(v / total)]; })
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
      mons, moves: dict.moves, items: dict.items, natures: dict.natures,
    };
    const size = await writeJson(join(DATA_DIR, 'usage', file), out);
    index.push({ key: fam.key, label: fam.label, desc: out.desc, file, format, month, cutoff, battles: out.battles, count: Object.keys(mons).length });
    console.log(`  ✔ ${file} · 포켓몬 ${Object.keys(mons).length}개, 기술 ${Object.keys(dict.moves).length}개, 아이템 ${Object.keys(dict.items).length}개 · ${size}`);
    const raw = Object.keys(dict.moves).filter(s => !translator.isKnownMove(s)).concat(Object.keys(dict.items).filter(s => !translator.isKnownItem(s)));
    if (raw.length) console.log('  ℹ PokeAPI에 한글명이 없어 영문 표기:', raw.join(', '));
  }
  if (!index.length) throw new Error('사용률 데이터를 하나도 받지 못했습니다');
  await writeJson(join(DATA_DIR, 'usage', 'index.json'), { generated: new Date().toISOString(), source: 'Smogon University usage stats', formats: index });
  if (unmapped.size) console.log('ℹ 도감에 매핑하지 못한 이름:', [...unmapped].join(', '));
}

main().catch(e => { console.error('✖ 사용률 데이터 생성 실패:', e.message); process.exit(1); });
