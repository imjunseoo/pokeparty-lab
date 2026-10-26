import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chosung, createSearch } from '../site/assets/js/core/search.js';

const dex = JSON.parse(readFileSync(new URL('../site/data/pokedex.json', import.meta.url), 'utf8'));
const search = createSearch(dex.pokemon);
const first = q => search(q, 5)[0]?.ko;

test('초성 추출', () => {
  assert.equal(chosung('리자몽'), 'ㄹㅈㅁ');
});

test('검색: 한글·초성·입력 중 받침·영문·도감번호', () => {
  assert.equal(first('누오'), '누오');
  assert.equal(first('ㄹㅈㅁ'), '리자몽');
  assert.deepEqual(search('ㄴㅇ', 2).map(p => p.ko), ['나옹', '누오']); // 초성 완전 일치 우선
  assert.equal(first('눙'), '누오');          // "누오" 입력 도중
  assert.equal(first('garchomp'), '한카리아스');
  assert.equal(first('Iron Crown'), '무쇠감투');
  assert.equal(first('445'), '한카리아스');
  assert.ok(search('알로라').every(p => p.ko.startsWith('알로라')));
  assert.deepEqual(search('없는포켓몬이름'), []);
});
