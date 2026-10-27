import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext } from '../site/assets/js/core/party.js';
import { createMoveBook, createBuilder } from '../site/assets/js/core/build.js';
import { duelRank, typeBoard, memberGuide } from '../site/assets/js/core/battle.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = load('../site/data/pokedex.json');
const data = load('../site/data/game/pokemon-party.json');
const sets = load('../site/data/sets.json');
const book = createMoveBook(load('../site/data/game/moves.json'));
const engine = createEngine(dex);
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const b = createBuilder(ctx, book, { level: 75, sets, items: new Set([...data.items.battle, ...data.items.berry]) });
const mon = slug => engine.bySlug.get(slug);
const set = (slug, mv, extra = {}) => ({ lv: 75, mv, ab: mon(slug).ab[0], na: 'hardy', it: null, iv: [true, true, true, true, true, true], ...extra });
const rows = [
  { i: 0, mon: mon('garchomp'), set: set('garchomp', ['earthquake', 'dragon-claw', 'stone-edge', 'fire-fang'], { na: 'jolly' }) },
  { i: 1, mon: mon('charizard'), set: set('charizard', ['fire-blast', 'focus-blast', 'air-slash', 'roost'], { na: 'timid' }) },
];

test('대면: 데미지·타수·선후공으로 판정하고, 명중이 낮은 기술로 이기면 아슬아슬', () => {
  const tyranitar = mon('tyranitar');
  const res = duelRank(b, rows, tyranitar, set('tyranitar', ['stone-edge', 'crunch', 'earthquake', 'ice-punch'], { na: 'adamant' }));
  const chomp = res.find(x => x.i === 0), zard = res.find(x => x.i === 1);
  assert.equal(chomp.best.slug, 'earthquake', '한카리아스는 지진');
  assert.ok(chomp.win, '한카리아스가 마기라스를 이긴다');
  assert.equal(zard.best.slug, 'focus-blast', '리자몽은 기합구슬');
  assert.ok(zard.best.acc < 1 && zard.sure < 0.85 && zard.verdict !== 'good', '기합구슬(명중 70%)은 아슬아슬');
  assert.ok(res[0].margin >= res[1].margin, '유리한 순');
  // 상대 기술이 없으면 자속 위력 90 으로 받는 피해
  const blank = duelRank(b, rows, tyranitar, set('tyranitar', []));
  assert.ok(blank.every(x => x.taken > 0));
});

test('대면: 땅 기술은 비행·부유 상대에게 0, 때릴 기술이 없으면 못 때림', () => {
  const res = duelRank(b, [{ i: 0, mon: mon('garchomp'), set: set('garchomp', ['earthquake']) }], mon('corviknight'), set('corviknight', ['brave-bird']));
  assert.equal(res[0].verdict, 'stuck');
  assert.equal(res[0].myHits, Infinity);
});

test('상대 타입별 대응: 18타입 · 멤버마다 공격·받기 · 운용법', () => {
  const tables = rows.map(r => ({ i: r.i, t: b.targetTable(r.mon, r.set) }));
  const board = typeBoard(ctx, tables);
  assert.equal(board.length, 18);
  const water = board.find(x => x.type === 'water');
  assert.ok(water.n > 0 && water.list.length === 2 && water.tank);
  assert.ok(water.list.every(l => l.ko >= 0 && l.ko <= 1 && l.off <= 100));
  // 강철 상대는 리자몽 불꽃 기술이 1순위
  const steel = board.find(x => x.type === 'steel');
  assert.equal(steel.list[0].i, 1);
  const g = memberGuide(ctx, rows[0], tables[0].t, board);
  assert.deepEqual(g.weak.slice(0, 1), ['ice'], '한카리아스는 얼음 4배가 먼저');
  assert.ok(g.immune.includes('electric'));
  assert.ok(g.jobs.length === 4 && Math.abs(g.jobs.reduce((a, j) => a + j.share, 0) - 1) < 0.05, '주력 비율 합 ≈ 1');
});

test('메가진화 추천 재료: 평균 승률(1:1 먼저 쓰러뜨리는 비율)과 메가진화 모습으로 바꿨을 때 파티 상성 변화', async () => {
  const { winRate } = await import('../site/assets/js/core/battle.js');
  const { formSwapGain } = await import('../site/assets/js/core/party.js');
  const zard = mon('charizard'), megaX = engine.byId.get(data.megas[zard.id].find(([, s]) => s === 'charizardite-x')[0]);
  const set0 = b.optimize(zard, set('charizard', []));
  const set1 = b.optimize(megaX, set('charizard', [], { ab: megaX.ab[0] }), { fixedItem: 'charizardite-x' });
  const r0 = winRate(ctx, b.targetTable(zard, set0)), r1 = winRate(ctx, b.targetTable(megaX, set1));
  assert.ok(r0 > 0 && r0 < 1 && r1 > 0 && r1 <= 1);
  assert.ok(r1 > r0, '메가리자몽X 가 리자몽보다 평균 승률이 높다');
  // 한카리아스와 함께면 메가리자몽X(드래곤)는 약점이 겹쳐 파티 상성이 내려가고, 메가리자몽Y(불꽃·비행)는 그렇지 않다
  const members = ['garchomp', 'charizard', 'blastoise'].map(s => ctx.prep(mon(s)));
  const megaY = engine.byId.get(data.megas[zard.id].find(([, s]) => s === 'charizardite-y')[0]);
  const fitX = formSwapGain(ctx, members, 1, ctx.prep(megaX, { stone: 'charizardite-x' }));
  const fitY = formSwapGain(ctx, members, 1, ctx.prep(megaY, { stone: 'charizardite-y' }));
  assert.ok(fitY > fitX);
});
