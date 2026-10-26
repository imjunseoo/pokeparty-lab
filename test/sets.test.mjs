import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderedSets } from '../site/assets/js/ui/sets.js';

const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = read('../site/data/pokedex.json');
const data = read('../site/data/sets.json');
const bySlug = new Map(dex.pokemon.map(p => [p.slug, p]));
const MODES = ['champions-singles', 'champions-doubles', 'sv-ou', 'type'];

test('모든 포켓몬에 추천 세팅이 있다 (모든 데이터 기준에서)', () => {
  const missing = dex.pokemon.filter(p => MODES.some(m => !orderedSets(data, p.id, m).length));
  assert.deepEqual(missing.map(p => p.slug), []);
  // 싱글 기준이면 싱글용 세팅(B·S·R·A)이 먼저 나온다
  const doublesFirst = dex.pokemon.filter(p => orderedSets(data, p.id, 'sv-ou')[0].key === 'D');
  assert.deepEqual(doublesFirst.map(p => p.slug), []);
});

test('세팅의 기술·도구·성격은 모두 한국어 사전에 있다', () => {
  for (const [id, slot] of Object.entries(data.sets)) {
    for (const s of Object.values(slot)) {
      assert.ok(s.mv.length > 0, `${id} 기술 없음`);
      for (const m of s.mv.flat()) assert.ok(data.moves[m], `${id} 기술 ${m}`);
      for (const i of s.it) assert.ok(data.items[i], `${id} 도구 ${i}`);
      for (const n of s.na.filter(Boolean)) assert.ok(data.natures[n], `${id} 성격 ${n}`);
      for (const a of s.ab) assert.ok(dex.abilities[a], `${id} 특성 ${a}`);
    }
  }
});

test('예시: 실전 통계가 없는 포켓몬도 세팅을 받는다', () => {
  const first = (slug, mode = 'champions-singles') => orderedSets(data, bySlug.get(slug).id, mode)[0];
  assert.ok(first('quagsire').ab.includes('unaware'));                  // Smogon 추천: 천진 누오
  assert.ok(first('luxray').mv.length >= 4);                            // 랜덤배틀 역할 세팅
  assert.equal(first('luxray', 'champions-doubles').key, 'D');          // 더블 기준이면 더블 세팅
  const clefable = first('clefable-mega');                              // Z-A 신규 메가: 자체 생성
  assert.equal(clefable.key, 'A');
  assert.equal(data.items[clefable.it[0]][0], '픽시나이트');
  assert.equal(first('weedle').key, 'A');                               // 약한 미진화도 자체 생성
});
