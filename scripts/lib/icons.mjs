// 스크린샷 인식용 데이터 (build-game 과 테스트 공용)
// - 아이콘: 64×64 한 프레임 → 16×16 칸 평균색(알파 가중)·불투명도 → RGBA 각 4비트(칸당 2바이트) base64
// - HUD: 보드 화면의 고정 그림(상단 바·플레이어 패널)을 합성해 위치 맞추기용 템플릿과 슬롯별 빈칸 배경을 만든다
import { LAYOUTS, GAME_W, GAME_H } from '../../site/assets/js/core/iconmatch.js';

export const ICON_GRID = 16, ICON_FRAME = 64, HUD_CELL = 2;

export function iconCells(img, frameX = 0) {
  const cell = ICON_FRAME / ICON_GRID, out = new Uint8Array(ICON_GRID * ICON_GRID * 4);
  for (let gy = 0; gy < ICON_GRID; gy++) for (let gx = 0; gx < ICON_GRID; gx++) {
    let sa = 0, sr = 0, sg = 0, sb = 0;
    for (let y = gy * cell; y < (gy + 1) * cell; y++) for (let x = frameX + gx * cell; x < frameX + (gx + 1) * cell; x++) {
      const o = (y * img.width + x) * 4, a = img.data[o + 3];
      sa += a; sr += img.data[o] * a; sg += img.data[o + 1] * a; sb += img.data[o + 2] * a;
    }
    const o = (gy * ICON_GRID + gx) * 4;
    if (sa > 0) { out[o] = Math.round(sr / sa); out[o + 1] = Math.round(sg / sa); out[o + 2] = Math.round(sb / sa); }
    out[o + 3] = Math.round(sa / (cell * cell));
  }
  return out;
}

/** 0~255 → 4비트 (반올림, 디코딩은 ×17) */
export function pack4444(cells) {
  const q = v => Math.round(v / 17);
  const out = new Uint8Array(cells.length / 2);
  for (let i = 0, j = 0; i < cells.length; i += 4, j += 2) {
    out[j] = (q(cells[i]) << 4) | q(cells[i + 1]);
    out[j + 1] = (q(cells[i + 2]) << 4) | q(cells[i + 3]);
  }
  return out;
}

export const packCells = cells => Buffer.from(pack4444(cells)).toString('base64');

/** 아이콘 PNG(디코딩된 이미지) → icons.json 에 들어가는 base64 특징값 */
export const iconFingerprint = img => packCells(iconCells(img, 0));

/** 두 아이콘 칸의 평균 색 차이 (둘 다 불투명한 칸만) — 이로치 아이콘이 일반 아이콘과 같은지 볼 때 */
export function cellsDiff(a, b) {
  let d = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 90 || b[i + 3] < 90) continue;
    d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n++;
  }
  return n ? d / (n * 3) : 0;
}

/** 보드 HUD 고정 그림 합성: 상단 바 → 플레이어 패널 1~4 (게임이 그리는 순서) → 512×384 RGBA, 나머지는 투명 */
export function composeHud(panels, topBar = null, layout = LAYOUTS.hud) {
  const out = { width: GAME_W, height: GAME_H, data: new Uint8Array(GAME_W * GAME_H * 4) };
  const draw = (src, ox, oy) => {
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      const X = ox + x, Y = oy + y, so = (y * src.width + x) * 4, a = src.data[so + 3] / 255;
      if (!a || X < 0 || Y < 0 || X >= GAME_W || Y >= GAME_H) continue;
      const o = (Y * GAME_W + X) * 4, da = out.data[o + 3] / 255, oa = a + da * (1 - a);
      for (let k = 0; k < 3; k++) out.data[o + k] = Math.round((src.data[so + k] * a + out.data[o + k] * da * (1 - a)) / oa);
      out.data[o + 3] = Math.round(oa * 255);
    }
  };
  if (topBar) draw(topBar, 0, 0);
  panels.forEach((png, p) => { const o = layout.panel(p); draw(png, o.x, o.y); });
  return out;
}

/**
 * HUD 위치 맞추기용 템플릿: 2게임px 칸 평균색.
 * 칸 안이 전부 불투명하고(상단 바 가운데처럼 비치는 곳 제외) 매번 바뀌는 곳(글자·아이콘 줄)이 아닌 칸만 남긴다 (a=15, 나머지 0).
 */
export function hudTemplate(hud, layout = LAYOUTS.hud) {
  const k = HUD_CELL, dyn = new Uint8Array(GAME_W * GAME_H);
  const mark = r => {
    for (let y = Math.max(0, r.y); y < Math.min(GAME_H, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(GAME_W, r.x + r.w); x++) dyn[y * GAME_W + x] = 1;
  };
  for (let p = 0; p < layout.players; p++) {
    const o = layout.panel(p);
    layout.dynamic.forEach(r => mark({ ...r, x: o.x + r.x, y: o.y + r.y }));
  }
  layout.topDynamic.forEach(mark);
  const cells = [];
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let gy = 0; gy < GAME_H / k; gy++) for (let gx = 0; gx < GAME_W / k; gx++) {
    let good = true;
    const sum = [0, 0, 0];
    for (let y = gy * k; y < gy * k + k && good; y++) for (let x = gx * k; x < gx * k + k; x++) {
      const o = (y * GAME_W + x) * 4;
      if (hud.data[o + 3] < 250 || dyn[y * GAME_W + x]) { good = false; break; }
      for (let c = 0; c < 3; c++) sum[c] += hud.data[o + c];
    }
    if (!good) continue;
    cells.push([gx, gy, ...sum.map(v => v / (k * k))]);
    x0 = Math.min(x0, gx); y0 = Math.min(y0, gy); x1 = Math.max(x1, gx); y1 = Math.max(y1, gy);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, grid = new Uint8Array(w * h * 4);
  for (const [gx, gy, r, g, b] of cells) grid.set([r, g, b, 255], ((gy - y0) * w + gx - x0) * 4);
  return { cell: k, x: x0 * k, y: y0 * k, w, h, data: packCells(grid), slotBg: slotBackgrounds(hud, layout) };
}

/** 빈 칸 판정용: 슬롯마다 아이콘 자리(32×32 게임px)에 보이는 패널 그림을 16×16 칸으로 (패널 → 슬롯 순서) */
export function slotBackgrounds(hud, layout = LAYOUTS.hud) {
  const size = ICON_FRAME * layout.zoom, cell = size / ICON_GRID, out = [];
  for (let p = 0; p < layout.players; p++) for (let s = 0; s < layout.slots; s++) {
    const c = layout.center(p, s), cells = new Uint8Array(ICON_GRID * ICON_GRID * 4);
    for (let gy = 0; gy < ICON_GRID; gy++) for (let gx = 0; gx < ICON_GRID; gx++) {
      let sa = 0, sr = 0, sg = 0, sb = 0;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const o = ((c.y - size / 2 + gy * cell + y) * GAME_W + c.x - size / 2 + gx * cell + x) * 4, a = hud.data[o + 3];
        sa += a; sr += hud.data[o] * a; sg += hud.data[o + 1] * a; sb += hud.data[o + 2] * a;
      }
      const o = (gy * ICON_GRID + gx) * 4;
      if (sa > 0) { cells[o] = sr / sa; cells[o + 1] = sg / sa; cells[o + 2] = sb / sa; }
      cells[o + 3] = sa / (cell * cell);
    }
    out.push(packCells(cells));
  }
  return out;
}
