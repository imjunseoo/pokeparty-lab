import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext } from '../site/assets/js/core/party.js';
import { createMoveBook, createBuilder } from '../site/assets/js/core/build.js';
import { tileActions, growthPicks, holderRank } from '../site/assets/js/core/strategy.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = load('../site/data/pokedex.json');
const data = load('../site/data/game/pokemon-party.json');
const sets = load('../site/data/sets.json');
const book = createMoveBook(load('../site/data/game/moves.json'));
const engine = createEngine(dex);
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const items = new Set([...data.items.battle, ...data.items.berry, ...data.items.signature]);
const b = createBuilder(ctx, book, { level: 75, sets, items });
const mon = slug => engine.bySlug.get(slug);
const NO_IV = [false, false, false, false, false, false];

// 멤버 한 줄 (칸별 전략 화면의 rowsOf 와 같은 모양)
function row(i, slug, cur, known = true) {
  const m = mon(slug);
  cur = { lv: 75, mv: [], it: null, na: null, iv: NO_IV, ab: m.ab[0], ...cur };
  const target = b.optimize(m, cur);
  return { i, mon: m, known, cur, target, steps: b.plan(m, cur, target), stone: null };
}

const rows = [
  row(0, 'garchomp', { mv: ['dig', 'tackle', 'sand-attack', 'bite'], na: 'modest' }),
  row(1, 'quagsire', {}, false),
];

test('칸별 전략: 기술 칸은 세팅을 입력한 멤버만, 이득이 큰 순서로 배울 기술 ← 잊을 기술', () => {
  const { skill, training } = tileActions(rows);
  assert.ok(skill.length >= 1, '한카리아스는 배울 기술이 있다');
  assert.ok(skill.every(a => a.i === 0), '세팅을 입력 안 한 멤버는 기술 칸 순위에서 빠진다');
  assert.ok(skill.every((a, k) => k === 0 || skill[k - 1].gain >= a.gain), '이득 큰 순');
  assert.ok(skill.every(a => rows[0].cur.mv.includes(a.forget)), '기술이 4개라 지금 기술 하나를 잊는다');
  // 트레이닝 칸: 성격(특공↑ 조심 → 공격형) 바꾸기가 있고, 개체값은 능력 하나씩
  assert.ok(training.some(a => a.i === 0 && a.kind === 'na'), '조심 → 다른 성격');
  assert.ok(training.filter(a => a.kind === 'iv').every(a => Number.isInteger(a.stat)), '개체값은 능력 하나씩');
  assert.ok(training.some(a => a.i === 1 && a.assumed), '세팅 모름 멤버는 기본값 기준으로 표시');
});

test('칸별 전략: 육성 아이템마다 가장 이득이 큰 멤버, 나온 도구를 누가 지니면 좋은지', () => {
  const g = growthPicks(b, rows);
  assert.equal(g.exp_share?.i, 0, '학습장치는 기술을 아는 멤버에게');
  assert.ok(g.mint && g.mint.step.kind === 'na');
  assert.ok(g.gold_bottle_cap && g.gold_bottle_cap.step.kind === 'iv');
  const rank = holderRank(b, rows, 'choice-band');
  assert.equal(rank.length, 2);
  assert.ok(rank[0].gain >= rank[1].gain);
  assert.ok(holderRank(b, [{ ...rows[0], stone: 'garchompite' }], 'life-orb').length === 0, '메가진화 멤버는 뺀다');
});

test('게임 데이터: 마지막 상점 가격·일반 상점 가격·진화도구 가격', () => {
  const cap = data.tourneyShop.find(t => t.key === 'gold_bottle_cap');
  assert.deepEqual([cap.price, cap.shop], [8000, 5000]);
  assert.ok(data.tourneyShop.every(t => t.desc && t.price >= 5000));
  assert.equal(data.tourneyShopCount, 3);
  assert.equal(data.evoItemPrice, 2000);
});
