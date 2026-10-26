import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext } from '../site/assets/js/core/party.js';
import { createMoveBook, createBuilder, statsAt, NATURES } from '../site/assets/js/core/build.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = load('../site/data/pokedex.json');
const data = load('../site/data/game/pokemon-party.json');
const sets = load('../site/data/sets.json');
const book = createMoveBook(load('../site/data/game/moves.json'));
const engine = createEngine(dex);
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const items = new Set([...data.items.battle, ...data.items.berry, ...data.items.signature]);
const builder = createBuilder(ctx, book, { level: 75, sets, items });
const mon = slug => engine.bySlug.get(slug);
const blank = m => ({ lv: 75, mv: [], ab: m.ab[0], na: 'hardy', it: null, iv: [] });

test('능력치: Lv.75 · 개체값 20/31 · 노력치 0 · 성격 보정', () => {
  const g = mon('garchomp');
  const plain = statsAt(g.st, 75);
  assert.equal(plain[0], Math.floor((2 * 108 + 20) * 75 / 100) + 85);   // HP 262
  const jolly = statsAt(g.st, 75, [false, false, false, false, false, true], 'jolly');
  assert.ok(jolly[5] > plain[5] && jolly[3] < plain[3], '명랑: 스피드↑ 특공↓');
  assert.equal(Object.keys(NATURES).length, 25);
});

test('기술 데이터: 모든 습득표 번호가 기술 표 안에 있고, 한글 이름이 있다', () => {
  const json = load('../site/data/game/moves.json');
  for (const list of Object.values(json.learn)) for (const i of list) assert.ok(json.list[i], `기술 번호 ${i}`);
  assert.ok(json.list.every(m => /[가-힣]/.test(m[1])), '한글 이름');
  assert.ok(book.learn(mon('garchomp').id).some(m => m.slug === 'earthquake'), '한카리아스는 지진을 배운다');
});

test('최선 세팅: 배울 수 있는 기술 4개 · 고른 특성/성격이 유효 · 지금 세팅보다 점수가 높다', () => {
  for (const slug of ['garchomp', 'azumarill', 'scizor', 'gengar']) {
    const m = mon(slug);
    const best = builder.optimize(m, blank(m));
    const learnable = new Set(builder.learnable(m).map(x => x.slug));
    assert.equal(best.mv.length, 4, slug);
    assert.ok(best.mv.every(s => learnable.has(s)), `${slug}: 배울 수 있는 기술만`);
    assert.ok(engine.abilitiesOf(m).includes(best.ab), `${slug}: 특성`);
    assert.ok(NATURES[best.na], `${slug}: 성격`);
    assert.ok(!best.it || items.has(best.it), `${slug}: 게임에서 구할 수 있는 도구`);
    assert.ok(builder.evaluate(m, best).score > builder.evaluate(m, blank(m)).score, slug);
  }
  // 마릴리는 천하장사, 핫삼은 테크니션 (공격을 크게 올리는 특성을 고른다)
  assert.equal(builder.optimize(mon('azumarill'), blank(mon('azumarill'))).ab, 'huge-power');
  assert.equal(builder.optimize(mon('scizor'), blank(mon('scizor'))).ab, 'technician');
});

test('할 일: 이득이 큰 순서이고, 기술 할 일을 다 하면 최선 세팅의 기술이 된다', () => {
  const m = mon('charizard');
  const cur = { lv: 75, mv: ['flamethrower', 'dragon-breath', 'slash', 'smokescreen'], ab: 'blaze', na: 'adamant', it: null, iv: [] };
  const best = builder.optimize(m, cur);
  const steps = builder.plan(m, cur, best);
  assert.ok(steps.length > 0);
  steps.forEach((s, k) => { assert.ok(s.gain > 0); if (k) assert.ok(steps[k - 1].gain >= s.gain); });
  let mv = cur.mv.slice();
  for (const s of steps.filter(x => x.kind === 'move')) mv = s.forget ? mv.map(x => (x === s.forget ? s.learn : x)) : [...mv, s.learn];
  assert.deepEqual([...mv].sort(), [...best.mv].sort());
});
