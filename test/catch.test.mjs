import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext, catchValue, prepareCatch, swapDecision, SWAP_MIN, SWAP_GOOD, TRAINED_COST } from '../site/assets/js/core/party.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const engine = createEngine(load('../site/data/pokedex.json'));
const data = load('../site/data/game/pokemon-party.json');
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const prep = slug => ctx.prep(engine.bySlug.get(slug));
const party = ['garchomp', 'charizard', 'blastoise', 'gengar', 'snorlax', 'scizor'].map(prep);
const prepared = prepareCatch(ctx, party);

test('꽉 찬 파티 포획: 멤버마다 바꾼 경우를 재고, 바꿀지 · 바꾸지 말지 판단', () => {
  // 마기라스: 누군가와 바꾸면 파티가 확실히 좋아짐
  const tyranitar = catchValue(ctx, party, prep('tyranitar'), { prepared, reasons: false });
  assert.equal(tyranitar.swaps.length, 6);
  assert.ok(tyranitar.swaps.every((x, k, l) => k === 0 || l[k - 1].gain >= x.gain), 'gain 큰 순');
  assert.equal(tyranitar.swaps[0].i, tyranitar.replace);
  const d = swapDecision(tyranitar.swaps);
  assert.equal(d.kind, 'swap');
  assert.ok(d.pick.net >= SWAP_GOOD);
  // 버터플: 누구와 바꿔도 손해 → 바꾸지 말기
  const butterfree = swapDecision(catchValue(ctx, party, prep('butterfree'), { prepared, reasons: false }).swaps);
  assert.equal(butterfree.kind, 'keep');
  assert.equal(butterfree.pick, null);
});

test('꽉 찬 파티 포획: 세팅을 키워 둔 멤버는 다시 맞추는 수고만큼 더 이득이어야 바꾼다', () => {
  const swaps = [{ i: 0, gain: SWAP_MIN + 0.05 }, { i: 1, gain: SWAP_MIN - 0.02 }];
  assert.equal(swapDecision(swaps).kind, 'maybe');
  const kept = swapDecision(swaps, new Set([0]));
  assert.equal(kept.kind, 'keep', '키운 멤버를 빼면 남는 이득이 기준보다 작음');
  assert.ok(Math.abs(kept.list.find(x => x.i === 0).net - (SWAP_MIN + 0.05 - TRAINED_COST)) < 1e-9);
  // 키운 멤버 대신 덜 아까운 멤버와 바꾸기
  const other = swapDecision([{ i: 0, gain: 1.0 }, { i: 1, gain: 0.8 }], new Set([0]));
  assert.equal(other.pick.i, 1);
});
