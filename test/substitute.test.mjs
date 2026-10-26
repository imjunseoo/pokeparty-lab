import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const { store, initStore, allowedItems } = await import('../site/assets/js/state.js');
const { createMoveBook } = await import('../site/assets/js/core/build.js');
initStore(load('../site/data/pokedex.json'), load('../site/data/usage/index.json'), load('../site/data/game/pokemon-party.json'));
store.mode = 'game';
store.sets = load('../site/data/sets.json');
store.moves = createMoveBook(load('../site/data/game/moves.json'));
const { substitutesFor } = await import('../site/assets/js/ui/builder.js');
const { orderedSets } = await import('../site/assets/js/ui/sets.js');
const mon = slug => store.engine.bySlug.get(slug);

test('대체 기술: 못 배우는 기술은 같은 타입·분류의 배울 수 있는 기술로 (피츄 볼트태클 → 전기 물리기)', () => {
  const pichu = mon('pichu');
  const set = orderedSets(store.sets, pichu.id, 'game-single').find(s => s.mv.flat().includes('volt-tackle'));
  assert.ok(set, '볼트태클 세팅');
  const sub = substitutesFor(pichu, set).moves.get('volt-tackle');
  assert.ok(sub, '대체 기술이 있음');
  assert.equal(sub.type, 'electric');
  assert.equal(sub.cat, 1);
  assert.ok(store.moves.learn(pichu.id).some(m => m.slug === sub.slug), '배울 수 있는 기술');
});

test('대체 도구: 기본 룰에서 못 쓰는 메가스톤·Z크리스탈은 이 게임에서 구할 수 있는 화력·스피드·내구 도구로', () => {
  const allowed = allowedItems();
  let checked = 0;
  for (const id of Object.keys(store.gameData.illegal).map(Number)) {
    const m = store.engine.byId.get(id);
    for (const s of orderedSets(store.sets, id, 'game-single')) {
      const sub = substitutesFor(m, s);
      if (!sub?.item) continue;
      assert.ok(allowed.has(sub.item[1].slug), `${m.ko}: ${sub.item[1].ko}`);
      assert.notEqual(sub.item[1].slug, 'power-herb');
      checked++;
    }
  }
  assert.ok(checked > 3);
});
