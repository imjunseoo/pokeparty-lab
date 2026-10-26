import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphOf, paths, backward, rankMoves, moveValue, landType, passService } from '../site/assets/js/core/board.js';

const data = JSON.parse(readFileSync(new URL('../site/data/game/pokemon-party.json', import.meta.url), 'utf8'));
const maps = data.board.maps;

test('칸 표: 5개 맵 모두 시작 칸이 있고 모든 다음 칸이 존재한다', () => {
  assert.deepEqual(Object.keys(maps).sort(), ['board', 'island', 'maze', 'outlet', 'tour']);
  for (const [key, map] of Object.entries(maps)) {
    assert.ok(map.nodes.some(n => n.type === 'start'), key);
    const g = graphOf(map);
    for (const n of g.values()) for (const [to] of n.outs) assert.ok(g.has(to), `${key} ${n.id}→${to}`);
  }
});

test('이동: 갈림길에서 길이 갈라지고 고른 길이 기록된다 (보드맵 5번에서 3칸)', () => {
  const g = graphOf(maps.board);
  const routes = paths(g, 5, 3);
  assert.deepEqual(routes.map(r => r.land).sort((a, b) => a - b), [8, 36]);
  for (const r of routes) {
    assert.equal(r.choices.length, 1);
    assert.equal(r.choices[0].at, 6);
    assert.deepEqual(r.passed[0], 6);
  }
  // 지나가는 센터 갈림길(6번)은 지나가며 회복 · 멈추면 센터 이벤트
  assert.ok(passService(g.get(6)));
  assert.equal(landType(g.get(6)), 'center');
});

test('메이즈: 스위치에 따라 열리는 길이 다르다', () => {
  const off = graphOf(maps.maze, 'off'), on = graphOf(maps.maze, 'on');
  assert.deepEqual(off.get(20).outs.map(([to]) => to), [52]);
  assert.deepEqual(on.get(20).outs.map(([to]) => to), [21]);
});

test('자전거 뒤로: 합류 칸에서는 들어오는 길 모두', () => {
  const g = graphOf(maps.board);
  assert.deepEqual(backward(g, 1, 1).sort((a, b) => a - b), [30, 34, 57]);
});

test('추천: 멈춘 칸 + 지나간 서비스 칸 가치의 합으로 순위', () => {
  const g = graphOf(maps.board);
  const valueOf = node => ({ value: landType(node) === 'skill' ? 5 : landType(node) === 'shop' ? 1 : 0, note: '' });
  const ranked = rankMoves(g, 5, 2, valueOf);
  assert.equal(ranked[0].land, 7);   // 6번 갈림길에서 왼쪽 → 7번 기술 칸
  assert.equal(moveValue(g, { land: 12, passed: [10, 11] }, valueOf).value, 1);   // 11번 상점을 지나감
});
