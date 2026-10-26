// 스크린샷에서 포켓몬 아이콘 인식 (브라우저·Node 공용)
// 1) 보드 화면의 고정 그림(플레이어 패널 테두리·초상화 칸·상단 바)으로 게임 화면이 스크린샷 어디에 몇 배로 있는지 찾고
// 2) 아이콘이 그려지는 자리를 잘라 게임 아이콘 특징값(16×16 평균색 + 불투명도)과 비교한다.

export const GAME_W = 512, GAME_H = 384;

// 게임 화면 배치 (보드 HUD 스크립트 상수: PANEL_X 4 · PANEL_TOP 28 · PANEL_H 67 · MON_X 6 · MON_Y 52 · MON_STEP 17 · 아이콘 0.5배)
export const LAYOUTS = {
  hud: {
    name: '보드 화면 (왼쪽 플레이어 패널)', zoom: 0.5, players: 4, slots: 6,
    panel: p => ({ x: 4, y: 28 + p * 67 }),
    // 패널 그림(118×75)은 y 2~68 만 불투명해서 4장이 빈틈없이 이어진다
    panelOf: (x, y) => (x >= 4 && x < 122 && y >= 30 && y < 298 ? Math.floor((y - 30) / 67) : -1),
    panelsRect: { x: 4, y: 30, w: 118, h: 268 },
    // 아이콘 그림 칸(64×64 → 0.5배 32×32)의 가운데. MON_STEP / 2 는 Ruby 정수 나눗셈이라 8,
    // PokemonIconSprite 의 CENTER 기준점은 세로 5/8 지점(oy=40)이라 칸 가운데는 기준점(MON_Y 52)보다 4px 위
    center: (p, s) => ({ x: 4 + 6 + s * 17 + 8, y: 28 + p * 67 + 52 - 4 }),
    // 오른쪽 이웃 아이콘이 위에 겹쳐 그려지므로 마지막 슬롯이 아니면 오른쪽 열은 덜 믿는다 (16칸 중 앞 11칸)
    visibleCols: (s, slots) => (s === slots - 1 ? 16 : 11),
    // 매번 바뀌는 곳 (패널 기준 좌표): 칭호·이름·소지금 글자, 포켓몬 아이콘 줄, 초상화 칸 안쪽(캐릭터) / 상단 바 글자(라운드·차례·룰)
    dynamic: [{ x: 42, y: 0, w: 72, h: 50 }, { x: 2, y: 30, w: 114, h: 45 }, { x: 18, y: 11, w: 22, h: 20 }],
    topDynamic: [{ x: 40, y: 7, w: 472, h: 20 }],
    // 소지금 글자가 아이콘 윗부분을 덮을 수 있는 곳 (패널 기준) → 인식 때 덜 믿는다
    text: { x: 45, y: 29, w: 67, h: 21 },
    activeTint: [255, 240, 160, 60 / 255],   // 지금 차례인 플레이어 패널은 밝게 칠해진다
    faintTint: [90, 0, 0, 130 / 255],        // 기절한 포켓몬 아이콘은 붉게 칠해진다
  },
};

const b64 = typeof atob === 'function' ? atob : s => Buffer.from(s, 'base64').toString('binary');

/** rgba4444 base64 → Float32Array(n*4) (r,g,b 0~255, a 0~1) */
function unpack(data, n) {
  const bin = b64(data), cells = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const hi = bin.charCodeAt(i * 2), lo = bin.charCodeAt(i * 2 + 1);
    cells[i * 4] = (hi >> 4) * 17; cells[i * 4 + 1] = (hi & 15) * 17;
    cells[i * 4 + 2] = (lo >> 4) * 17; cells[i * 4 + 3] = (lo & 15) / 15;
  }
  return cells;
}

/** icons.json → [{ id, cells, shiny }] (일반 아이콘 다음 이로치 아이콘) */
export function decodeIcons(json) {
  const n = json.grid * json.grid;
  const one = shiny => ([id, data]) => ({ id, cells: unpack(data, n), shiny });
  return [...json.icons.map(one(false)), ...(json.shiny || []).map(one(true))];
}

/** icons.json 의 hud → { cells: 위치 맞추기용 칸(게임 좌표 왼쪽 위, 색, 패널 번호, 밝게 칠한 색), slotBg: 슬롯별 빈칸 배경 } */
export function decodeHud(json, layout = LAYOUTS.hud) {
  const h = json.hud;
  if (!h) return null;
  const grid = unpack(h.data, h.w * h.h), [tr, tg, tb, ta] = layout.activeTint, cells = [];
  for (let gy = 0; gy < h.h; gy++) for (let gx = 0; gx < h.w; gx++) {
    const i = (gy * h.w + gx) * 4;
    if (grid[i + 3] < 0.5) continue;
    const x = h.x + gx * h.cell, y = h.y + gy * h.cell, r = grid[i], g = grid[i + 1], b = grid[i + 2];
    cells.push({ x, y, r, g, b, p: layout.panelOf(x, y), tr: r + (tr - r) * ta, tg: g + (tg - g) * ta, tb: b + (tb - b) * ta });
  }
  return { cell: h.cell, cells, slotBg: (h.slotBg || []).map(d => unpack(d, json.grid * json.grid)) };
}

/** 이미지(RGBA)에서 가운데 (cx, cy), 한 변 size 픽셀 정사각형을 grid×grid 칸 평균색으로 */
export function sampleSquare(img, cx, cy, size, grid = 16) {
  const out = new Float32Array(grid * grid * 3);
  const step = size / grid, x0 = cx - size / 2, y0 = cy - size / 2;
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
    // 칸 안쪽을 3×3 점으로 고르게 찍어 평균 (배율이 정수가 아니어도 안정적)
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const x = Math.floor(x0 + (gx + (sx + 0.5) / 3) * step), y = Math.floor(y0 + (gy + (sy + 0.5) / 3) * step);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4;
      r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
    }
    const o = (gy * grid + gx) * 3;
    if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; }
  }
  return out;
}

/** 슬롯 칸별 가중치: 오른쪽 이웃 아이콘이 덮는 열은 0, 소지금 글자가 덮을 수 있는 곳은 낮게 */
function slotWeights(layout, p, s, grid) {
  const w = new Float32Array(grid * grid), cols = layout.visibleCols(s, layout.slots);
  const c = layout.center(p, s), o = layout.panel(p), size = 64 * layout.zoom, cell = size / grid, t = layout.text;
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < cols; gx++) {
    const x = c.x - size / 2 + (gx + 0.5) * cell - o.x, y = c.y - size / 2 + (gy + 0.5) * cell - o.y;
    w[gy * grid + gx] = t && x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h ? 0.3 : 1;
  }
  return w;
}

/** 샘플과 아이콘 하나의 차이 (아이콘이 불투명한 칸만, 칸마다 상한을 둬 글자·겹침 같은 튀는 값에 덜 흔들림). 작을수록 비슷 */
function distance(sample, ref, weights) {
  const cells = ref.cells;
  let d = 0, w = 0, n = 0;
  for (let i = 0; i < weights.length; i++) {
    const a = cells[i * 4 + 3], k = weights[i];
    if (a < 0.35 || !k) continue;
    const e = Math.abs(sample[i * 3] - cells[i * 4]) + Math.abs(sample[i * 3 + 1] - cells[i * 4 + 1]) + Math.abs(sample[i * 3 + 2] - cells[i * 4 + 2]);
    d += a * k * Math.min(e, 240); w += a * k; n += a;
  }
  return n < 6 ? Infinity : d / w;   // 불투명한 칸이 너무 적은 아이콘은 비교하지 않음
}

/** 칠해진 색(tint)을 걷어낸 샘플 (기절한 포켓몬 아이콘을 원래 색으로 되돌려 비교) */
function untint(sample, [tr, tg, tb, ta]) {
  const out = new Float32Array(sample.length), t = [tr * ta, tg * ta, tb * ta], k = 1 - ta;
  for (let i = 0; i < sample.length; i++) out[i] = Math.max(0, Math.min(255, (sample[i] - t[i % 3]) / k));
  return out;
}

/**
 * 빈 칸인가 (패널 그림이 없을 때): 파티는 왼쪽 슬롯부터 채워지므로 빈 칸이면 슬롯 오른쪽 절반에는 패널 배경만 보인다.
 * 오른쪽 절반 칸들의 색이 거의 균일하면 빈 칸.
 */
export function looksEmpty(sample, grid = 16, maxSpread = 14) {
  let n = 0;
  const mean = [0, 0, 0];
  for (let gy = 2; gy < grid - 2; gy++) for (let gx = grid / 2; gx < grid; gx++) {
    const i = (gy * grid + gx) * 3;
    mean[0] += sample[i]; mean[1] += sample[i + 1]; mean[2] += sample[i + 2]; n++;
  }
  mean.forEach((v, k) => { mean[k] = v / n; });
  let spread = 0;
  for (let gy = 2; gy < grid - 2; gy++) for (let gx = grid / 2; gx < grid; gx++) {
    const i = (gy * grid + gx) * 3;
    spread += (Math.abs(sample[i] - mean[0]) + Math.abs(sample[i + 1] - mean[1]) + Math.abs(sample[i + 2] - mean[2])) / 3;
  }
  return spread / n < maxSpread;
}

/**
 * 빈 칸 점수 (패널 그림이 있을 때): 슬롯 오른쪽 절반·아래쪽(왼쪽 이웃 아이콘·소지금 글자가 닿지 않는 곳)이
 * 패널 그림과 가장 많이 다른 칸 12개의 평균 색 차이 (작은 아이콘도 놓치지 않게 평균 대신).
 * 지금 차례라 밝게 칠해진 패널과도 비교해 더 맞는 쪽으로.
 */
export function emptyScore(sample, bg, tint, grid = 16) {
  const [tr, tg, tb, ta] = tint, T = [tr, tg, tb], d = [], dT = [];
  for (let gy = 8; gy < grid; gy++) for (let gx = grid / 2; gx < grid; gx++) {
    const i = gy * grid + gx;
    if (bg[i * 4 + 3] < 0.9) continue;
    let e = 0, eT = 0;
    for (let k = 0; k < 3; k++) {
      const v = sample[i * 3 + k], b = bg[i * 4 + k];
      e += Math.abs(v - b); eT += Math.abs(v - (b + (T[k] - b) * ta));
    }
    d.push(e / 3); dT.push(eT / 3);
  }
  if (!d.length) return Infinity;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const worst = (sum(d) <= sum(dT) ? d : dT).sort((a, b) => b - a).slice(0, 12);
  return sum(worst) / worst.length;
}

const EMPTY = Object.freeze({ id: null, score: Infinity, alts: [], empty: true, unsure: false, shiny: false, fainted: false });

/**
 * 스크린샷에서 한 배치의 모든 슬롯을 인식.
 * view: 게임 화면이 스크린샷 안 어디에 있는지 { x, y, scale } (게임 좌표 × scale + x,y = 스크린샷 좌표)
 * hud: decodeHud 결과 (있으면 빈 칸을 패널 그림과 비교해서 판정)
 * @returns players[p][s] = { id, score, alts: [{id, score}], empty, unsure, shiny, fainted }
 *   empty: 빈 칸, unsure: 1·2순위 점수 차가 작거나 점수가 높아 확인이 필요한 칸 (작게 찍힌 화면은 더 엄격하게)
 */
export function recognize(img, refs, { layout = LAYOUTS.hud, view, hud = null, grid = 16, unsureScore = view.scale < 1.4 ? 65 : 85, unsureGap = 4 }) {
  const size = 64 * layout.zoom * view.scale, px = view.scale;   // px: 게임 1px
  const variants = smp => [smp, untint(smp, layout.faintTint)];
  // 기절 색을 걷어낸 샘플은 잡음도 커지므로 점수를 조금 깎아 준다 (합성 화면 실험값)
  const faintD = d => d * 0.85 + 2;
  const half = view.scale >= 1.5;
  const shifts = { dx: half ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1], dy: half ? [-2, -1.5, -1, -0.5, 0, 0.5, 1] : [-2, -1, 0, 1] };
  const players = [];
  for (let p = 0; p < layout.players; p++) {
    const row = [];
    for (let s = 0; s < layout.slots; s++) {
      const c = layout.center(p, s), cx = view.x + c.x * view.scale, cy = view.y + c.y * view.scale;
      const at = (dx, dy) => sampleSquare(img, cx + dx * px, cy + dy * px, size, grid);
      const base = at(0, 0), bg = hud?.slotBg[p * layout.slots + s];
      // 빈 칸: 패널 그림과 같으면 (1px 어긋남까지 봐 줌), 패널 그림이 없으면 오른쪽 절반이 균일한지로.
      // 애매하면(empty 30~48) 아이콘을 맞춰 보고 잘 맞는 아이콘이 없을 때만 빈 칸
      const empty = bg ? Math.min(...[[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => emptyScore(dx || dy ? at(dx, dy) : base, bg, layout.activeTint, grid))) : null;
      if (bg ? empty < 30 : looksEmpty(base, grid)) { row.push({ ...EMPTY }); continue; }
      const weights = slotWeights(layout, p, s, grid);
      // 1차: 제자리에서 전체 아이콘 비교 (보통 색 / 기절해서 칠해진 색을 걷어낸 색) → 상위 후보
      const [b0, b1] = variants(base);
      const cands = [];
      for (const ref of refs) cands.push({ ref, fainted: false, d: distance(b0, ref, weights) }, { ref, fainted: true, d: faintD(distance(b1, ref, weights)) });
      const top = cands.sort((a, b) => a.d - b.d).slice(0, 24);
      // 2차: 상위 후보만 위아래·좌우로 조금씩 옮겨 가며 다시 비교 (아이콘 들썩임·반올림 오차, 크게 찍힌 화면은 반 픽셀씩)
      for (const dy of shifts.dy) for (const dx of shifts.dx) {
        const [v0, v1] = dx || dy ? variants(at(dx, dy)) : [b0, b1];
        for (const t of top) t.best = Math.min(t.best ?? Infinity, t.fainted ? faintD(distance(v1, t.ref, weights)) : distance(v0, t.ref, weights));
      }
      // 같은 포켓몬(보통·이로치·기절)은 가장 잘 맞는 것 하나로
      const byId = new Map();
      for (const t of top) {
        const cur = byId.get(t.ref.id);
        if (!cur || t.best < cur.score) byId.set(t.ref.id, { id: t.ref.id, score: t.best, shiny: !!t.ref.shiny, fainted: t.fainted });
      }
      const ranked = [...byId.values()].sort((a, b) => a.score - b.score);
      const [best, second] = ranked;
      if (empty !== null && empty < 48 && (!best || best.score > 80)) { row.push({ ...EMPTY }); continue; }
      const unsure = !best || best.score > unsureScore || (second && second.score - best.score < unsureGap);
      row.push({
        id: best ? best.id : null, score: best ? best.score : Infinity, alts: ranked.slice(0, 4).map(({ id, score }) => ({ id, score })),
        empty: false, unsure, shiny: !!best?.shiny, fainted: !!best?.fainted,
      });
    }
    // 파티는 왼쪽부터 채워지므로 빈 칸 뒤의 '확인 필요' 칸은 빈 칸으로
    const firstEmpty = row.findIndex(x => x.empty);
    if (firstEmpty >= 0) for (let s = firstEmpty + 1; s < row.length; s++) if (row[s].unsure) row[s] = { ...EMPTY };
    players.push(row);
  }
  return players;
}

const HUD_CLIP = 60;
const PTS2 = [[0.5, 0.5], [1.5, 1.5]], PTS4 = [[0.5, 0.5], [1.5, 0.5], [0.5, 1.5], [1.5, 1.5]];

/** 템플릿 칸 하나의 스크린샷 평균색 (pts: 칸 안에서 찍을 점), 스크린샷 밖이면 null */
function cellColor(img, v, c, k, pts) {
  const { width: W, height: H, data } = img;
  let r = 0, g = 0, b = 0, m = 0;
  for (const [ox, oy] of pts) {
    const x = Math.floor(v.x + (c.x + ox * k) * v.scale), y = Math.floor(v.y + (c.y + oy * k) * v.scale);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const o = (y * W + x) * 4;
    r += data[o]; g += data[o + 1]; b += data[o + 2]; m++;
  }
  return m ? [r / m, g / m, b / m] : null;
}

/**
 * view 에서 HUD 템플릿 칸들과 스크린샷의 평균 색 차이 (칸마다 상한, 패널마다 '밝게 칠해진 경우'와 비교해 작은 쪽).
 * 스크린샷 밖으로 나간 칸은 그 비율만큼 조금 불리하게 (잘라 낸 스크린샷도 찾을 수 있게 크게 벌하지는 않음)
 */
function hudError(img, v, hud, layout, pts, stride) {
  const k = hud.cell / 2;
  const sum = new Float64Array(layout.players + 1), sumT = new Float64Array(layout.players + 1);
  let n = 0, out = 0;
  for (let i = 0; i < hud.cells.length; i += stride) {
    const c = hud.cells[i], rgb = cellColor(img, v, c, k, pts);
    if (!rgb) { out++; continue; }
    const [r, g, b] = rgb;
    sum[c.p + 1] += Math.min(HUD_CLIP, (Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)) / 3);
    sumT[c.p + 1] += Math.min(HUD_CLIP, (Math.abs(r - c.tr) + Math.abs(g - c.tg) + Math.abs(b - c.tb)) / 3);
    n++;
  }
  if (n < (n + out) * 0.4) return Infinity;
  let total = sum[0];
  for (let p = 1; p <= layout.players; p++) total += Math.min(sum[p], sumT[p]);
  return total / n + 20 * out / (n + out);
}

/**
 * HUD 가 그 자리에 있는지 판정용 점수: 칸별 색 차이 중 작은 쪽 75% 의 평균.
 * 초상화 캐릭터·감정표현 말풍선처럼 템플릿을 가리는 것이 있어도 나머지가 잘 맞으면 낮게 나온다.
 */
function hudFit(img, v, hud, layout, keep = 0.75) {
  const k = hud.cell / 2, P = layout.players + 1;
  // 스크린샷 안에 들어온 칸만 (잘라 낸 스크린샷), 패널 칸이 절반도 안 들어오면 판정 불가
  const inside = [];
  for (const c of hud.cells) {
    const rgb = cellColor(img, v, c, k, PTS4);
    if (!rgb) continue;
    const [r, g, b] = rgb;
    inside.push({ c, e: (Math.abs(r - c.r) + Math.abs(g - c.g) + Math.abs(b - c.b)) / 3, eT: (Math.abs(r - c.tr) + Math.abs(g - c.tg) + Math.abs(b - c.tb)) / 3 });
  }
  const panelCells = hud.cells.filter(c => c.p >= 0).length;
  if (inside.filter(x => x.c.p >= 0).length < panelCells * 0.5) return Infinity;
  // 패널마다 밝게 칠한 쪽이 더 맞으면 그쪽 오차를 쓴다
  const sum = Array.from({ length: P }, () => [0, 0]);
  for (const x of inside) { sum[x.c.p + 1][0] += x.e; sum[x.c.p + 1][1] += x.eT; }
  const e = inside.map(x => (x.c.p >= 0 && sum[x.c.p + 1][1] < sum[x.c.p + 1][0] ? x.eT : x.e)).sort((a, b) => a - b);
  const n = Math.max(1, Math.round(e.length * keep));
  return e.slice(0, n).reduce((a, x) => a + x, 0) / n;
}

const steps = (lo, hi, step) => {
  const out = [];
  for (let x = lo; x <= hi + 1e-9; x += step) out.push(Math.round(x * 1e4) / 1e4);
  return out;
};

/**
 * 보드 화면 고정 그림(패널 테두리·초상화 칸·상단 바 테두리)으로 게임 화면 위치 찾기.
 * start 주변에서 배율 ±scaleRange, 위치 ±range 게임px 를 성기게(2px·1%) → 좋은 후보 몇 곳 주변을 촘촘하게(1px·0.25%)
 * → 가장 좋은 곳 주변을 더 촘촘하게(0.25px).
 * @returns { view, quality: 잘 맞는 칸 75% 의 평균 색 차이(작을수록 잘 맞음), found: 보드 화면으로 볼 만큼 잘 맞았는지 }
 */
export function alignHud(img, hud, start, { layout = LAYOUTS.hud, range = 32, scaleRange = 0.06, okQuality = 14 } = {}) {
  const starts = Array.isArray(start) ? start : [start];
  // 배율은 패널 가운데를 기준으로 바꾼다 (가장자리만 움직이게)
  const ax = 64, ay = 164;
  const at = (base, f, dx, dy) => {
    const s = base.scale * f, cx = base.x + (ax + dx) * base.scale, cy = base.y + (ay + dy) * base.scale;
    return { x: cx - ax * s, y: cy - ay * s, scale: s };
  };
  // 격자 위의 모든 위치 점수 (성긴 단계는 일부 칸만 먼저 보고 가망 없으면 건너뜀)
  const scan = (base, factors, offsets, pts, stride) => {
    const all = [];
    let bestQ = Infinity;
    for (const f of factors) for (const dy of offsets) for (const dx of offsets) {
      const v = at(base, f, dx, dy);
      if (stride > 1 && hudError(img, v, hud, layout, pts, stride * 4) > bestQ + 12) continue;
      const q = hudError(img, v, hud, layout, pts, stride);
      bestQ = Math.min(bestQ, q);
      all.push({ v, q });
    }
    return all;
  };
  const bestOf = list => list.reduce((a, b) => (b.q < a.q ? b : a));
  // 성긴 단계 후보: 점수 좋은 순으로, 서로 3게임px·1.5% 이상 떨어진 곳 4개
  const coarse = starts.flatMap(s0 => scan(s0, steps(1 - scaleRange, 1 + scaleRange, 0.01), steps(-range, range, 2), PTS2, 2)).sort((a, b) => a.q - b.q);
  const seeds = [];
  for (const c of coarse) {
    if (seeds.length >= 4) break;
    const far = seeds.every(s => Math.abs(c.v.scale / s.v.scale - 1) > 0.015
      || Math.abs(c.v.x - s.v.x) > 3 * c.v.scale || Math.abs(c.v.y - s.v.y) > 3 * c.v.scale);
    if (far) seeds.push(c);
  }
  if (!seeds.length) return { view: starts[0], quality: Infinity, found: false };
  const mid = bestOf(seeds.map(s => bestOf(scan(s.v, steps(0.985, 1.015, 0.0025), steps(-3, 3, 1), PTS4, 1))));
  // 마지막: 최소 점수와 거의 같은 곳들의 가운데 (화면이 정수배로 커지면 몇 픽셀 범위가 모두 같은 점수라 한쪽 끝을 고르지 않게)
  const last = scan(mid.v, steps(0.99875, 1.00125, 0.000625), steps(-0.75, 0.75, 0.25), PTS4, 1), top = bestOf(last);
  const near = last.filter(x => x.q <= top.q + 0.05), mean = k => near.reduce((a, x) => a + x.v[k], 0) / near.length;
  const fine = { v: { x: mean('x'), y: mean('y'), scale: mean('scale') }, q: top.q };
  const quality = hudFit(img, fine.v, hud, layout);
  return { view: fine.v, quality, found: quality < okQuality };
}

/**
 * HUD 를 못 찾았을 때의 보정: 아이콘이 가장 잘 맞는 위치를 찾는다.
 * 1단계: 배율 ±4%, 위치 ±16px(게임 기준)를 4px 간격으로 → 2단계: 가장 좋은 곳 주변을 1px 간격으로.
 * 점수 = 슬롯마다 "아이콘과 가장 닮은 정도"의 평균 (상위 후보 아이콘만 비교해 빠르게).
 */
export function refineView(img, refs, view, { layout = LAYOUTS.hud, grid = 16 } = {}) {
  const slots = [];
  for (let p = 0; p < layout.players; p++) for (let s = 0; s < layout.slots; s++) slots.push({ c: layout.center(p, s), w: slotWeights(layout, p, s, grid) });
  const size0 = 64 * layout.zoom;
  const at = (v, sl) => sampleSquare(img, v.x + sl.c.x * v.scale, v.y + sl.c.y * v.scale, size0 * v.scale, grid);
  // 슬롯별 후보: 여러 위치에서 뽑은 상위 아이콘을 합친다 (처음 위치가 많이 어긋나도 정답 아이콘이 들어가도록)
  const seeds = [[0, 0], [-8, -8], [8, 8], [-8, 8], [8, -8], [0, -12], [0, 12]];
  const cand = slots.map(sl => {
    const set = new Set();
    for (const [dx, dy] of seeds) {
      const smp = at({ x: view.x + dx * view.scale, y: view.y + dy * view.scale, scale: view.scale }, sl);
      refs.map(ref => ({ ref, d: distance(smp, ref, sl.w) })).sort((a, b) => a.d - b.d).slice(0, 8).forEach(x => set.add(x.ref));
    }
    return [...set];
  });
  // 빈 칸은 점수에서 빼되, 칸이 너무 많이 비면(위치가 크게 어긋남) 불리하게
  const quality = v => {
    let sum = 0, n = 0;
    slots.forEach((sl, i) => {
      const smp = at(v, sl);
      if (looksEmpty(smp, grid)) return;
      let best = Infinity;
      for (const ref of cand[i]) best = Math.min(best, distance(smp, ref, sl.w));
      sum += best; n++;
    });
    return n ? sum / n + 40 * (1 - n / slots.length) : Infinity;
  };
  const search = (base, factors, offsets) => {
    let best = { v: base, q: quality(base) };
    for (const f of factors) for (const dx of offsets) for (const dy of offsets) {
      const v = { x: base.x + dx * base.scale, y: base.y + dy * base.scale, scale: base.scale * f };
      const q = quality(v);
      if (q < best.q) best = { v, q };
    }
    return best.v;
  };
  const coarse = search(view, [0.96, 0.98, 1, 1.02, 1.04], [-16, -12, -8, -4, 0, 4, 8, 12, 16]);
  return search(coarse, [0.993, 1, 1.007], [-2, -1, 0, 1, 2]);
}

/** 스크린샷 크기만으로 게임 화면 위치 추정: 4:3 이면 전체가 게임 화면, 넓으면 가운데 정렬(전체화면 레터박스) */
export function guessView(width, height) {
  const scale = Math.min(width / GAME_W, height / GAME_H);
  return { x: (width - GAME_W * scale) / 2, y: (height - GAME_H * scale) / 2, scale };
}

/**
 * 자동 위치 찾기의 출발점들: 크기로 추정한 위치 + 게임 화면 왼쪽만 잘라 낸 경우(높이에 맞춰 왼쪽 정렬)
 * + 플레이어 패널 부분만 잘라 낸 세로로 긴 그림(패널 상자가 높이의 70~95% 라고 보고 가운데 정렬)
 */
export function startViews(width, height, layout = LAYOUTS.hud) {
  const out = [guessView(width, height)];
  const add = v => { if (out.every(o => Math.abs(v.scale / o.scale - 1) > 0.05)) out.push(v); };
  add({ x: 0, y: 0, scale: height / GAME_H });
  if (width < height) {
    const R = layout.panelsRect;
    for (const m of [1.05, 1.2, 1.4]) {
      const s = height / (R.h * m);
      add({ x: (width - R.w * s) / 2 - R.x * s, y: (height - R.h * s) / 2 - R.y * s, scale: s });
    }
  }
  return out;
}

/**
 * 스크린샷 하나 인식: HUD 그림으로 위치 찾기(rect 가 있으면 그 상자에서 출발) → 못 찾으면 아이콘 기준 보정 → 슬롯 인식.
 * @returns { view, found: HUD 를 찾았는지, quality, players }
 */
export function analyze(img, refs, hud, rect = null, layout = LAYOUTS.hud) {
  const starts = rect ? [viewFromRect(rect, layout)] : startViews(img.width, img.height, layout);
  const best = hud ? alignHud(img, hud, starts, rect ? { layout, range: 24, scaleRange: 0.1 } : { layout }) : null;
  const found = !!best?.found;
  const view = found ? best.view : refineView(img, refs, starts[0], { layout });
  return { view, found, quality: best ? best.quality : null, players: recognize(img, refs, { layout, view, hud: found ? hud : null }) };
}

/** 사용자가 드래그한 사각형(스크린샷 좌표, 플레이어 패널 4개를 감싼 상자) → 게임 화면 위치 */
export function viewFromRect(rect, layout = LAYOUTS.hud) {
  const R = layout.panelsRect, scale = (rect.w / R.w + rect.h / R.h) / 2;
  return { x: rect.x + (rect.w - R.w * scale) / 2 - R.x * scale, y: rect.y + (rect.h - R.h * scale) / 2 - R.y * scale, scale };
}
