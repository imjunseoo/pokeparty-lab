import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext, partyNeed } from '../site/assets/js/core/party.js';
import { createMoveBook, createBuilder, maxPower, TECH_COST } from '../site/assets/js/core/build.js';
import { winRate } from '../site/assets/js/core/battle.js';
import { teraPlan, MAX_MOVE, gmaxEffect } from '../site/assets/js/core/gimmick.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const engine = createEngine(load('../site/data/pokedex.json'));
const data = load('../site/data/game/pokemon-party.json');
const sets = load('../site/data/sets.json');
const book = createMoveBook(load('../site/data/game/moves.json'));
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const b = createBuilder(ctx, book, { level: 75, sets, items: new Set([...data.items.battle, ...data.items.berry]) });
const mon = slug => engine.bySlug.get(slug);
const cur = (m, extra = {}) => ({ lv: 75, mv: [], it: null, na: null, iv: [], ab: m.ab[0], ...extra });
const prep = slugs => slugs.map(s => ctx.prep(mon(s)));

test('게임 추천 세팅: 도구 없이 · 지금 성격·특성 그대로 · 기술만 고르고, 성격·특성·도구는 선택으로', () => {
  const g = mon('garchomp');
  const best = b.recommend(g, cur(g, { na: 'jolly', it: 'leftovers' }));
  assert.equal(best.it, null, '도구 없이');
  assert.equal(best.na, 'jolly', '지금 성격 그대로');
  assert.equal(best.ab, g.ab[0], '지금 특성 그대로');
  assert.equal(best.mv.length, 4);
  // 메가스톤처럼 정해진 도구는 그대로
  assert.equal(b.recommend(g, cur(g), { fixedItem: 'garchompite' }).it, 'garchompite');
  // 할 일: 성격·특성·도구는 선택(optional)으로만
  const steps = b.plan(g, cur(g), b.recommend(g, cur(g)));
  assert.ok(steps.filter(s => ['na', 'ab', 'it'].includes(s.kind)).every(s => s.optional));
  assert.ok(steps.some(s => s.kind === 'na' && s.optional), '무보정이면 성격을 바꾸면 좋다');
});

test('게임 추천 세팅: 레벨업으로 못 배우는 기술은 구하기 어려운 만큼 감점, 승리 플랜(랭크업 후 1타 비율)이 분명한 조합', () => {
  const bl = mon('blastoise');
  const best = b.recommend(bl, cur(bl));
  const lvs = b.learnLevels(bl);
  assert.ok(best.mv.includes('shell-smash') && lvs.has('shell-smash'), '거북왕은 레벨업 기술 껍질깨기로 승리 플랜');
  const plan = b.winPlan(bl, best);
  assert.ok(plan.setup && plan.setup.ko > plan.ko + 0.3, '껍질깨기 한 번 뒤 1타 비율이 크게 오름');
  assert.ok(plan.setup.fast > plan.fast, '스피드도 오름');
  // 감점: 같은 세팅이면 기술 칸 기술이 많을수록 손해 → 레벨업 기술 비율이 예전 최선 세팅(감점 없음)보다 높거나 같다
  const tech = s => s.mv.filter(x => !lvs.has(x)).length;
  assert.ok(tech(best) <= tech(b.optimize(bl, cur(bl))));
  assert.ok(TECH_COST > 0);
});

test('파티 약점 보충: 팀원이 못 찌르고 파티를 위협하는 상대일수록 무겁게', () => {
  const fire = prep(['arcanine', 'charizard', 'typhlosion']);
  const need = partyNeed(ctx, fire);
  const W = q => need[q];
  const qOf = type => ctx.meta.map((m, q) => [m, q]).filter(([m]) => m.mon.t.length === 1 && m.mon.t[0] === type).map(([, q]) => q);
  const avg = qs => qs.reduce((a, q) => a + W(q), 0) / qs.length;
  assert.ok(avg(qOf('water')) > avg(qOf('grass')), '불꽃 파티에는 물 상대가 풀 상대보다 무거움');
  assert.ok(Math.min(...need) >= 1);
  // 파티 밖이면 파티 전체, 멤버면 그 멤버를 뺀 팀원 기준
  assert.notDeepEqual([...partyNeed(ctx, fire, 0)], [...need]);
});

test('테라스탈 활용: 겹치는 약점을 누가 어떤 테라 타입으로 막는지 (이미 반감인 멤버 · 메가스톤을 지닌 멤버는 빼고)', () => {
  const party = prep(['garchomp', 'salamence', 'blastoise']);
  const rows = teraPlan(ctx, party);
  const ice = rows.find(r => r.type === 'ice');
  assert.ok(ice && ice.weak.length === 2, '한카리아스·보만다 얼음 약점');
  assert.ok(ice.picks.length && ice.picks.every(p => p.mult <= 0.5 && party[p.i].def[engine.tIdx.ice] > 0.5));
  // 메가스톤을 지닌 멤버는 테라피스를 못 지님
  const withStone = [party[0], { ...party[1], stone: 'salamencite' }, party[2]];
  assert.ok(teraPlan(ctx, withStone).every(r => r.picks.every(p => p.i !== 1)));
});

test('다이맥스: 다이맥스 기술 위력 · HP 2배로 평균 승률이 오르고, 거다이맥스 데이터·효과 설명이 있다', () => {
  assert.equal(maxPower({ power: 90, cat: 1, type: 'ground' }), 130);
  assert.equal(maxPower({ power: 120, cat: 1, type: 'fighting' }), 95);
  assert.equal(maxPower({ power: 0, cat: 0, type: 'normal' }), 0);
  const g = mon('gengar');
  const set = b.recommend(g, cur(g));
  assert.ok(winRate(ctx, b.dynamaxTable(g, set)) >= winRate(ctx, b.targetTable(g, set)));
  const gm = data.gmax[mon('charizard').id];
  assert.ok(gm && gm.type === 'fire' && gmaxEffect(gm.fn));
  assert.equal(Object.keys(MAX_MOVE).length, 18);
});
