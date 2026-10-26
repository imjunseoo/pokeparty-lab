// 스크린샷 → 포켓몬 인식 (선봉 추천의 상대 파티 입력용)
// 보드 화면 왼쪽 플레이어 패널 4개를 찾아 파티 아이콘을 게임 아이콘 특징값과 비교한다. 이미지는 브라우저 밖으로 나가지 않는다.
import { decodeIcons, decodeHud, analyze, LAYOUTS } from '../core/iconmatch.js';

let dataPromise = null;
/** 아이콘 특징값·보드 화면 템플릿(icons.json, 압축 전송 약 0.5MB)은 스크린샷 기능을 처음 쓸 때만 받는다 */
export const loadIconData = () => (dataPromise ||= fetch('data/game/icons.json')
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(json => ({ refs: decodeIcons(json), hud: decodeHud(json) }))
  .catch(err => { dataPromise = null; throw err; }));

/** 이미지 파일(Blob) → 캔버스 픽셀 */
export async function readImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('이미지를 읽을 수 없어요'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** rect(스크린샷 좌표로 플레이어 패널 4개를 감싼 상자)가 없으면 자동으로 보드 화면을 찾아서 인식 */
export async function analyzeShot(imageData, rect = null) {
  const { refs, hud } = await loadIconData();
  return analyze({ width: imageData.width, height: imageData.height, data: imageData.data }, refs, hud, rect);
}

/** 미리보기 캔버스에 스크린샷과 인식한 칸 표시 (파랑: 찾은 패널 영역 · 초록: 확실 · 주황: 확인 필요) */
export function drawPreview(canvas, imageData, result, { maxWidth = 520 } = {}) {
  const k = Math.min(1, maxWidth / imageData.width);
  canvas.width = Math.round(imageData.width * k);
  canvas.height = Math.round(imageData.height * k);
  const src = document.createElement('canvas');
  src.width = imageData.width;
  src.height = imageData.height;
  src.getContext('2d').putImageData(imageData, 0, 0);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 0, 0, canvas.width, canvas.height);
  if (!result) return k;
  const { view, players } = result;
  const layout = LAYOUTS.hud, R = layout.panelsRect, s = view.scale * k;
  const size = 64 * layout.zoom * s;
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(80,160,255,.9)';
  g.strokeRect(view.x * k + R.x * s, view.y * k + R.y * s, R.w * s, R.h * s);
  players.forEach((row, p) => row.forEach((cell, i) => {
    if (cell.empty) return;
    const c = layout.center(p, i);
    const x = view.x * k + c.x * s, y = view.y * k + c.y * s;
    g.strokeStyle = cell.unsure ? 'rgba(255,170,0,.95)' : 'rgba(40,200,120,.95)';
    g.strokeRect(x - size / 2 + 1, y - size / 2 + 1, size - 2, size - 2);
  }));
  return k;
}
