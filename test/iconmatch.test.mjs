import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { decodeIcons, decodeHud, analyze, LAYOUTS, GAME_W, GAME_H } from '../site/assets/js/core/iconmatch.js';
import { decodePng } from '../scripts/lib/png.mjs';
import { iconFingerprint, composeHud } from '../scripts/lib/icons.mjs';

const json = JSON.parse(readFileSync(new URL('../site/data/game/icons.json', import.meta.url), 'utf8'));
const refs = decodeIcons(json), hud = decodeHud(json), L = LAYOUTS.hud;
const GAME = 'C:/Users/imjun/Desktop/Pocketmon/Pokemon Party!_20261026/Pokemon Party!_20261026/Graphics';

// 결정적인 의사 난수
const rng = seed => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
// 플레이어별 파티 크기 (빈 칸 판정도 검사): 6 · 5 · 3 · 1마리
const SIZES = [6, 5, 3, 1];

/** 게임 화면(512×384) 한 장을 그릴 판: put(x, y, r, g, b, a) 로 알파 합성 */
function canvas(bg = [96, 150, 104]) {
  const frame = new Float32Array(GAME_W * GAME_H * 3);
  for (let i = 0; i < GAME_W * GAME_H; i++) frame.set(bg, i * 3);
  const put = (x, y, r, g, b, a = 1) => {
    if (a <= 0 || x < 0 || y < 0 || x >= GAME_W || y >= GAME_H) return;
    const o = (y * GAME_W + x) * 3;
    frame[o] += (r - frame[o]) * a; frame[o + 1] += (g - frame[o + 1]) * a; frame[o + 2] += (b - frame[o + 2]) * a;
  };
  return { frame, put };
}
/** 게임 화면 → 창 배율 + 제목 표시줄(31px)·테두리(1px) 가 붙은 스크린샷 (가장 가까운 픽셀로 확대) */
function screenshot(frame, scale, chrome = true) {
  const top = chrome ? 31 : 0, side = chrome ? 1 : 0, sw = Math.round(GAME_W * scale), sh = Math.round(GAME_H * scale);
  const width = sw + side * 2, height = sh + top + side, data = new Uint8Array(width * height * 4).fill(243);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const so = (Math.floor(y / scale) * GAME_W + Math.floor(x / scale)) * 3, o = ((y + top) * width + x + side) * 4;
    data[o] = frame[so]; data[o + 1] = frame[so + 1]; data[o + 2] = frame[so + 2];
  }
  return { width, height, data };
}
const accuracy = (players, truth) => {
  let ok = 0, n = 0;
  truth.forEach((row, p) => row.forEach((id, s) => { n++; if ((players[p][s].empty ? null : players[p][s].id) === id) ok++; }));
  return ok / n;
};

test('아이콘 인식: icons.json 의 HUD 템플릿·아이콘 특징값으로 합성한 창 스크린샷 (배율 1·2, 제목 표시줄)', () => {
  const pick = rng(7), { frame, put } = canvas();
  // HUD 고정 그림 칸 · 슬롯 빈칸 배경 → 아이콘(왼쪽 슬롯부터, 뒤 슬롯이 위)
  for (const c of hud.cells) for (let y = 0; y < hud.cell; y++) for (let x = 0; x < hud.cell; x++) put(c.x + x, c.y + y, c.r, c.g, c.b);
  const paint = (cells, cx, cy, alpha) => {
    for (let gy = 0; gy < 16; gy++) for (let gx = 0; gx < 16; gx++) {
      const i = gy * 16 + gx, a = alpha ? cells[i * 4 + 3] : 1;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) put(cx - 16 + gx * 2 + x, cy - 16 + gy * 2 + y, cells[i * 4], cells[i * 4 + 1], cells[i * 4 + 2], a);
    }
  };
  for (let p = 0; p < 4; p++) for (let s = 0; s < 6; s++) { const c = L.center(p, s); paint(hud.slotBg[p * 6 + s], c.x, c.y, false); }
  const plain = refs.filter(r => !r.shiny);
  const truth = SIZES.map((n, p) => Array.from({ length: 6 }, (_, s) => {
    if (s >= n) return null;
    const ref = plain[Math.floor(pick() * plain.length)], c = L.center(p, s);
    paint(ref.cells, c.x, c.y, true);
    return ref.id;
  }));
  for (const scale of [1, 2]) {
    const r = analyze(screenshot(frame, scale), refs, hud);
    assert.ok(r.found, `배율 ${scale}: 보드 화면을 찾아야 함 (quality ${r.quality})`);
    assert.ok(Math.abs(r.view.scale - scale) < 0.02 * scale, `배율 ${scale}: 찾은 배율 ${r.view.scale}`);
    const acc = accuracy(r.players, truth);
    assert.ok(acc >= 0.9, `배율 ${scale}: 정확도 ${(acc * 100).toFixed(0)}%`);
    truth.forEach((row, p) => row.forEach((id, s) => { if (!id) assert.ok(r.players[p][s].empty, `배율 ${scale}: ${p + 1}-${s + 1} 은 빈 칸`); }));
  }
});

test('아이콘 인식: 보드 화면이 아니면 찾지 못했다고 알린다', () => {
  const pick = rng(3), width = 800, height = 600, data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i & 3) === 3 ? 255 : Math.floor(pick() * 256);
  assert.equal(analyze({ width, height, data }, refs, hud).found, false);
});

// 게임 폴더가 있는 PC에서만: 실제 패널·아이콘 PNG 로 합성한 보드 화면 (지금 차례 패널 밝게 · 기절 · 이로치 포함)
test('아이콘 인식: 실제 게임 그림으로 합성한 보드 화면 (배율 1·1.5·2, 직접 지정 포함)', { skip: !existsSync(GAME) && '게임 파일 없음' }, () => {
  const UI = `${GAME}/UI/PokemonParty/`, ICONS = `${GAME}/Pokemon/Icons/`, SHINY = `${GAME}/Pokemon/Icons shiny/`;
  const comp = composeHud([1, 2, 3, 4].map(i => decodePng(readFileSync(`${UI}PartyPlayer${i}.png`))), decodePng(readFileSync(`${UI}MainUI.png`)));
  const pick = rng(42), { frame, put } = canvas();
  const [tr, tg, tb, ta] = L.activeTint;
  for (let y = 0; y < GAME_H; y++) for (let x = 0; x < GAME_W; x++) {
    const o = (y * GAME_W + x) * 4;
    let [r, g, b] = comp.data.slice(o, o + 3);
    if (L.panelOf(x, y) === 1) { r += (tr - r) * ta; g += (tg - g) * ta; b += (tb - b) * ta; }   // 2번 패널이 지금 차례
    put(x, y, r, g, b, comp.data[o + 3] / 255);
  }
  // 정답: 아이콘 파일의 특징값과 똑같은 icons.json 항목의 dex id
  const idByPrint = new Map(json.icons.map(([id, print]) => [print, id]));
  const files = readdirSync(ICONS).filter(f => f.endsWith('.png'));
  const truth = SIZES.map((n, p) => Array.from({ length: 6 }, (_, s) => {
    if (s >= n) return null;
    let png, id;
    do { const f = files[Math.floor(pick() * files.length)]; png = decodePng(readFileSync(ICONS + f)); id = png.width >= 64 ? idByPrint.get(iconFingerprint(png)) : undefined;
      if (id !== undefined && s === 1 && existsSync(SHINY + f)) png = decodePng(readFileSync(SHINY + f)); } while (id === undefined);
    const fainted = s === 2, c = L.center(p, s), [fr, fg, fb, fa] = L.faintTint;
    // 게임처럼 0.5배 (가장 가까운 픽셀 = 원본 홀수 픽셀), 기절하면 붉게 칠함
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const so = ((y * 2 + 1) * png.width + x * 2 + 1) * 4;
      let [r, g, b] = png.data.slice(so, so + 3);
      if (fainted) { r += (fr - r) * fa; g += (fg - g) * fa; b += (fb - b) * fa; }
      put(c.x - 16 + x, c.y - 16 + y, r, g, b, png.data[so + 3] / 255);
    }
    return id;
  }));
  for (const scale of [1, 1.5, 2]) {
    const shot = screenshot(frame, scale);
    const r = analyze(shot, refs, hud);
    assert.ok(r.found, `배율 ${scale}: 보드 화면을 찾아야 함 (quality ${r.quality})`);
    const acc = accuracy(r.players, truth);
    assert.ok(acc >= 0.9, `배율 ${scale}: 정확도 ${(acc * 100).toFixed(0)}%`);
    // 패널 4개를 대충 감싼 상자로 직접 지정해도 찾는다
    const R = L.panelsRect, top = 31;
    const manual = analyze(shot, refs, hud, { x: 1 + (R.x - 3) * scale, y: top + (R.y + 4) * scale, w: (R.w + 5) * scale, h: (R.h - 6) * scale });
    assert.ok(manual.found && accuracy(manual.players, truth) >= 0.9, `배율 ${scale}: 직접 지정`);
  }
});
