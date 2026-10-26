import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext, finalsOf, catchValue, recommendTypes, memberValues } from '../site/assets/js/core/party.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = load('../site/data/pokedex.json');
const data = load('../site/data/game/pokemon-party.json');
const engine = createEngine(dex);
const mon = slug => engine.bySlug.get(slug);
const rule = key => data.rules.find(r => r.key === key);
const ctxOf = (key, map = 'tour') => createContext(engine, { game: { data, map, legends: false, rule: rule(key) } });

test('진화: 진화 전 포켓몬의 최종 진화 (갈래·리전폼·진화 도구)', () => {
  assert.deepEqual(finalsOf(engine, data, mon('charmander')).map(f => f.mon.slug), ['charizard']);
  assert.equal(finalsOf(engine, data, mon('eevee')).length, 8);
  assert.equal(finalsOf(engine, data, mon('vulpix-alola'))[0].mon.slug, 'ninetales-alola');
  assert.equal(finalsOf(engine, data, mon('vulpix-alola'))[0].item, 'ice-stone');
  assert.deepEqual(finalsOf(engine, data, mon('charizard')), []);
});

test('후보: 진화 전 포켓몬은 최종 진화로 모으고, 메가진화 룰이면 메가진화 후보가 생긴다', () => {
  const normal = ctxOf('normal'), mega = ctxOf('mega');
  assert.ok(normal.pool.every(c => !finalsOf(engine, data, c.mon).length), '후보는 모두 최종 진화');
  assert.ok(normal.pool.some(c => !c.direct && c.from.length), '진화 전으로만 잡히는 후보');
  assert.equal(normal.pool.filter(c => c.mega).length, 0);
  const megas = mega.pool.filter(c => c.mega);
  assert.ok(megas.length > 20);
  assert.ok(megas.every(c => c.stone && data.items.mega.includes(c.stone) && c.base.id !== c.mon.id));
  // 메가진화 룰에서는 추천 속성의 예시가 달라진다
  const party = [mon('charizard'), mon('raichu')].map(m => normal.prep(m));
  const a = recommendTypes(normal, party, { limit: 3 }).map(r => r.list[0].c.mon.id);
  const b = recommendTypes(mega, party.map(m => mega.prep(m.mon)), { limit: 3 }).map(r => r.list[0].c.mon.id);
  assert.notDeepEqual(a, b);
});

test('포획: 빈 자리가 있으면 넣는 기준, 꽉 찼으면 가장 덜 아까운 멤버와 바꾸는 기준, 같은 종은 막힘', () => {
  const ctx = ctxOf('normal');
  const three = ['charizard', 'raichu', 'garchomp'].map(s => ctx.prep(mon(s)));
  const v = catchValue(ctx, three, ctx.prep(mon('blastoise')));
  assert.equal(v.replace, null);
  assert.ok(Number.isFinite(v.gain) && v.reasons.length);
  const six = ['charizard', 'raichu', 'garchomp', 'blastoise', 'venusaur', 'snorlax'].map(s => ctx.prep(mon(s)));
  const full = catchValue(ctx, six, ctx.prep(mon('gengar')));
  assert.ok(full.replace >= 0 && full.replace < 6);
  assert.equal(catchValue(ctx, six, ctx.prep(mon('charizard'))).blocked, true);
});

test('멤버 기여도: 약점이 겹치는 멤버는 기여가 낮고, 빼면 약점이 몰리는 멤버는 높다', () => {
  const ctx = ctxOf('normal');
  const dragons = ['garchomp', 'dragonite', 'salamence', 'flygon', 'haxorus', 'kingdra'].map(s => ctx.prep(mon(s)));
  assert.ok(memberValues(ctx, dragons).every(v => v.synergy < 0), '드래곤만 6마리: 모두 약점 겹침');
  const mixed = ['delphox', 'luxray', 'iron-crown', 'quagsire', 'sableye', 'vivillon'].map(s => ctx.prep(mon(s)));
  const v = memberValues(ctx, mixed);
  const by = slug => v[mixed.findIndex(m => m.mon.slug === slug)];
  assert.ok(by('quagsire').synergy > by('delphox').synergy, '땅 약점을 받아주는 누오가 약점을 더하는 마폭시보다 기여가 크다');
  assert.ok(v.every(x => Array.isArray(x.reasons)));
});
