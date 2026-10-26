import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine, formatMult } from '../site/assets/js/core/engine.js';

const dex = JSON.parse(readFileSync(new URL('../site/data/pokedex.json', import.meta.url), 'utf8'));
const E = createEngine(dex);
const mon = slug => E.bySlug.get(slug);
const at = (profile, type) => profile[E.tIdx[type]];

test('상성표: PokeAPI 데이터가 18×18 이고 대표 상성이 맞다', () => {
  assert.equal(dex.chart.length, 18);
  assert.ok(dex.chart.every(r => r.length === 18));
  assert.equal(E.effectiveness('ground', ['flying']), 0);
  assert.equal(E.effectiveness('dragon', ['fairy']), 0);
  assert.equal(E.effectiveness('ghost', ['normal']), 0);
  assert.equal(E.effectiveness('fire', ['grass', 'steel']), 4);
  assert.equal(E.effectiveness('fighting', ['steel', 'dark']), 4);
  // 타입별 무효 상성은 정확히 8개 (노→고, 격→고, 독→강, 땅→비, 전→땅, 에→악, 고→노, 드→페)
  assert.equal(dex.chart.flat().filter(x => x === 0).length, 8);
});

test('누오: 풀 4배, 전기 무효, 저수 특성이면 물 무효', () => {
  const q = mon('quagsire');
  assert.equal(q.ko, '누오');
  const p = E.defenseProfile(q);
  assert.equal(at(p, 'grass'), 4);
  assert.equal(at(p, 'electric'), 0);
  assert.equal(at(p, 'water'), 1);
  assert.equal(at(E.defenseProfile(q, { ability: 'water-absorb' }), 'water'), 0);
});

test('깜까미(악/고스트): 약점은 페어리 하나뿐', () => {
  const groups = E.groupProfile(E.defenseProfile(mon('sableye')));
  const weak = groups.filter(g => g.mult > 1).flatMap(g => g.types);
  assert.deepEqual(weak, ['fairy']);
});

test('테라스탈: 방어 타입이 테라 타입으로 바뀌고 자속이 추가된다', () => {
  const crown = mon('iron-crown'); // 강철/에스퍼
  assert.equal(at(E.defenseProfile(crown), 'ground'), 2);
  assert.equal(at(E.defenseProfile(crown, { tera: 'flying' }), 'ground'), 0);
  assert.equal(at(E.defenseProfile(crown, { tera: 'stellar' }), 'ground'), 2); // 스텔라는 원래 타입 유지
  assert.deepEqual(E.stabTypes(crown, 'flying'), ['steel', 'psychic', 'flying']);
});

test('특성: 부유·불가사의부적·필터', () => {
  assert.equal(at(E.defenseProfile(mon('rotom-wash'), { ability: 'levitate' }), 'ground'), 0);
  const shedinja = E.defenseProfile(mon('shedinja'), { ability: 'wonder-guard' });
  assert.equal(shedinja.filter(x => x > 0).length, 5); // 불꽃·비행·바위·고스트·악
  assert.equal(at(E.defenseProfile(mon('mr-mime'), { ability: 'filter' }), 'steel'), 1.5);
});

test('한국어 데이터: 폼 이름과 게임 도감', () => {
  assert.equal(mon('raichu-alola').ko, '알로라 라이츄');
  assert.equal(mon('charizard-mega-x').ko, '메가리자몽X');
  assert.equal(mon('rotom-wash').ko, '워시로토무');
  assert.equal(dex.typeNames.fairy.ko, '페어리');
  assert.ok(dex.games.sv.species.includes(1023));
  assert.equal(formatMult(0.25), '¼');
});
