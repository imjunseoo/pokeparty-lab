import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const game = JSON.parse(readFileSync(new URL('../site/data/game/pokemon-party.json', import.meta.url), 'utf8'));

test('게임 도구: 지닐 수 없는 중요한 물건·기술머신·쓰는 도구는 도구 목록에 없다', () => {
  const all = Object.values(game.items).flat();
  for (const bad of ['rotom-catalog', 'reveal-glass', 'gracidea', 'prison-bottle', 'meteorite', 'tm100', 'terablast', 'masterterajewel', 'maxsoup']) {
    assert.ok(!all.includes(bad), bad);
  }
  assert.ok(game.items.battle.includes('choice-band') && game.items.berry.includes('sitrus-berry'));
});

test('게임 도구: 지닐 수 있는 도구마다 얻는 곳·상점 가격, 같은 이름 파티 아이템은 따로 표시', () => {
  for (const slug of Object.values(game.items).flat()) {
    const info = game.itemInfo[slug];
    assert.ok(info, slug);
    assert.ok(info[1] >= 500, `${slug} 가격`);
  }
  assert.deepEqual(game.itemInfo['choice-band'].slice(0, 2), ['battle', 5000]);
  // 돌격조끼: 배틀 아이템(지닐 수 있음)과 같은 이름의 파티 아이템(길막 돌파, 지닐 수 없음)이 따로 있음
  assert.equal(game.itemInfo['assault-vest'][2], '돌격조끼');
  assert.match(game.itemInfo['assault-vest'][3], /길을 막는 포켓몬/);
});
