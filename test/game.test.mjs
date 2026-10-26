import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext, gamePool, recommendTypes, leadAnalysis } from '../site/assets/js/core/party.js';
import { gameItemSet } from '../site/assets/js/ui/sets.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = read('../site/data/pokedex.json');
const game = read('../site/data/game/pokemon-party.json');
const sets = read('../site/data/sets.json');
const E = createEngine(dex);
const mon = slug => E.bySlug.get(slug);

test('「포켓몬 파티!」 게임 데이터: 지역·맵·룰·아이템', () => {
  assert.equal(game.areas.length, 16);
  assert.deepEqual(game.maps.map(m => m.key), ['tour', 'board', 'outlet', 'island', 'maze']);
  assert.deepEqual(game.rules.map(r => r.key), ['normal', 'mega', 'zmove', 'dynamax', 'terastal', 'all', 'first', 'alola']);
  assert.deepEqual(game.rules.find(r => r.key === 'alola').uses, ['mega', 'z']);
  assert.equal(game.finalLevel, 75);
  // 누오는 늪지에서 나오고, 리자몽은 메가스톤 2종이 기믹 상점에 있다
  assert.ok(game.areas.find(a => a.name === '늪지').mons.some(([id]) => id === mon('quagsire').id));
  assert.equal(game.megas[mon('charizard').id].length, 2);
  for (const list of Object.values(game.items)) assert.ok(list.length > 0);
  // 지닐 수 있는 도구: 기본 룰엔 메가스톤이 없고, 메가 룰엔 있다
  const rule = k => game.rules.find(r => r.key === k);
  assert.ok(gameItemSet(game, rule('normal')).has('leftovers'));
  assert.ok(!gameItemSet(game, rule('normal')).has('charizardite-x'));
  assert.ok(gameItemSet(game, rule('mega')).has('charizardite-x'));
  // 못 배우는 기술 표시는 기술 slug 목록 (매달 세팅 데이터가 갱신돼도 깨지지 않게 형태만 검사)
  for (const moves of Object.values(game.illegal)) assert.ok(moves.every(m => typeof m === 'string' && m.length > 0));
  assert.ok(Object.keys(sets.sets).length > 1000);
});

test('게임 출현 풀: 맵·전설 옵션에 따라 달라진다', () => {
  const tour = gamePool(E, { data: game, map: 'tour' });
  const tourLegend = gamePool(E, { data: game, map: 'tour', legends: true });
  const outlet = gamePool(E, { data: game, map: 'outlet' });
  assert.ok(tour.length > 300 && tour.every(e => !game.pool[e.mon.id]?.l));
  assert.ok(tourLegend.length > tour.length && tourLegend.some(e => game.pool[e.mon.id]?.l));
  assert.ok(outlet.length > tour.length);
  assert.ok(tour.find(e => e.mon.slug === 'raticate').w > tour.find(e => e.mon.slug === 'garchomp').w, '출현 빈도 가중치');
});

test('추천 속성: 땅 약점이 겹친 파티엔 땅을 받아주는 속성이 상위', () => {
  const ctx = createContext(E, { game: { data: game, map: 'tour' } });
  const members = ['delphox', 'luxray', 'iron-crown'].map(s => ctx.prep(mon(s)));
  const recs = recommendTypes(ctx, members, { limit: 6 });
  assert.ok(recs.length >= 3);
  assert.ok(recs.every(r => r.list.length > 0 && r.list.every((x, i, l) => i === 0 || l[i - 1].gain >= x.gain)));
  assert.ok(recs.slice(0, 3).some(r => r.reasons.some(x => x.kind === 'def' && x.type === 'ground')), '상위 3개 중 땅 반감/무효 이유');
  // 예시는 같은 종을 다시 추천하지 않는다
  assert.ok(recs.every(r => r.list.every(x => !members.some(m => m.sp === x.c.sp))));
});

test('선봉 추천: 누오 상대로는 풀 타입이 1순위, 더블은 2마리 조합', () => {
  const ctx = createContext(E, { game: { data: game, map: 'tour' } });
  const mine = ['venusaur', 'charizard', 'blastoise'].map(s => ctx.prep(mon(s)));
  const foes = ['quagsire', 'golem'].map(s => ctx.prep(mon(s)));
  const a = leadAnalysis(ctx, mine, foes);
  assert.equal(a.ranked[0].m.mon.slug, 'venusaur');
  assert.equal(a.ranked[0].se, 2);
  const d = leadAnalysis(ctx, mine, foes, { double: true });
  assert.equal(d.pair.rows.length, 2);
  assert.ok(d.threats.length === 2);
});
