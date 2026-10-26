import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { analyze, createContext, findCounters, partyVersus, recommend } from '../site/assets/js/core/party.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = read('../site/data/pokedex.json');
const E = createEngine(dex);
const mon = slug => E.bySlug.get(slug);
const usageFiles = readdirSync(new URL('../site/data/usage/', import.meta.url)).filter(f => f !== 'index.json');

function checkParty(ctx, seed) {
  const members = seed.map(s => ctx.prep(mon(s), { locked: true }));
  const r = recommend(ctx, members);
  assert.equal(r.party.length, 6);
  assert.equal(new Set(r.party.map(m => m.sp)).size, 6, '같은 종 중복 금지');
  assert.ok(r.party.filter(m => m.mega).length <= 1, '메가진화는 1마리까지');
  assert.deepEqual(r.party.slice(0, seed.length).map(m => m.mon.slug), seed, '입력한 포켓몬 유지');
  for (const id of r.picks) {
    assert.ok(r.alternatives.get(id).length > 0);
    assert.ok(Array.isArray(r.reasons.get(id)));
  }
  return r;
}

test('타입 시너지 모드: 빈 슬롯을 채우고 땅 약점 겹침을 해소한다', () => {
  const ctx = createContext(E, {});
  const r = checkParty(ctx, ['delphox', 'luxray', 'iron-crown']); // 셋 다 땅 약점
  const ground = analyze(ctx, r.party).rows.find(x => x.type === 'ground');
  assert.ok(ground.level !== 'danger', '추천 후에는 땅 위험이 없어야 함');
  assert.ok(r.party.every(m => m.mon.slug !== 'slaking'), '게으름 특성 게을킹은 추천하지 않음');
});

test('필터: 게임 도감·전설 제외·최소 종족값', () => {
  const ctx = createContext(E, { filters: { game: 'sv', legend: false, minBst: 500 } });
  const sv = new Set(dex.games.sv.species);
  assert.ok(ctx.pool.length > 50);
  assert.ok(ctx.pool.every(c => sv.has(c.sp) && !c.mon.legend && !c.mon.mega && E.bst(c.mon) >= 500));
  checkParty(ctx, ['pikachu']);
});

for (const file of usageFiles) {
  test(`실전 데이터 모드 (${file})`, () => {
    const usage = read('../site/data/usage/' + file);
    const ctx = createContext(E, { usage });
    assert.ok(ctx.pool.length >= 50);
    assert.ok(ctx.pool.every(c => usage.mons[c.id]));
    checkParty(ctx, ['charizard']);
    checkParty(ctx, ['quagsire', 'sableye']);
  });
}

test('분석: 예시 파티의 땅 약점 3마리를 위험으로 진단', () => {
  const ctx = createContext(E, {});
  const party = ['delphox', 'luxray', 'iron-crown', 'quagsire', 'sableye', 'vivillon'].map(s => ctx.prep(mon(s)));
  const a = analyze(ctx, party);
  const ground = a.rows.find(x => x.type === 'ground');
  assert.equal(ground.weak, 3);
  assert.equal(ground.level, 'danger');
  assert.ok(a.diag.some(d => d.level === 'danger' && d.type === 'ground'));
  // 무쇠감투 비행 테라 → 땅 약점 2마리로 감소
  party[2] = ctx.prep(mon('iron-crown'), { tera: 'flying' });
  assert.equal(analyze(ctx, party).rows.find(x => x.type === 'ground').weak, 2);
  assert.ok(a.scores.total > 0 && a.scores.total <= 100);
});

test('카운터·대면: 누오 상대로는 풀 타입이 상위', () => {
  const ctx = createContext(E, {});
  const list = findCounters(ctx, mon('quagsire'));
  assert.ok(list.length > 0);
  assert.ok(list.slice(0, 5).every(r => r.off === 4));
  const vs = partyVersus(ctx, [ctx.prep(mon('venusaur')), ctx.prep(mon('charizard'))], mon('quagsire'));
  assert.equal(vs[0].atk, 4);
  assert.equal(vs[0].verdict, 'good');
});
