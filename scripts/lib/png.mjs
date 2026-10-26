// 최소 PNG 디코더 (8비트 그레이/RGB/팔레트/그레이+알파/RGBA, 인터레이스 없음) → { width, height, data: RGBA Uint8Array }
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 아님');
  let p = 8, width, height, depth, ctype, interlace, palette = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('인터레이스 PNG 미지원');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels || (depth !== 8 && !(ctype === 3 && depth < 8))) throw new Error(`지원하지 않는 PNG 형식 (color ${ctype}, depth ${depth})`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3);           // 필터 계산용 바이트/픽셀
  const stride = Math.ceil((width * channels * depth) / 8);
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = lines.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[i] = v & 255;
    }
    prev = out;
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (ctype === 6) { data.set(row.subarray(x * 4, x * 4 + 4), o); continue; }
      if (ctype === 2) { data.set(row.subarray(x * 3, x * 3 + 3), o); data[o + 3] = 255; continue; }
      if (ctype === 0 || ctype === 4) {
        const g = row[x * channels];
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = ctype === 4 ? row[x * 2 + 1] : 255;
        continue;
      }
      // 팔레트 (비트 깊이 1/2/4/8)
      const bit = x * depth;
      const idx = depth === 8 ? row[x] : (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      data[o] = palette[idx * 3]; data[o + 1] = palette[idx * 3 + 1]; data[o + 2] = palette[idx * 3 + 2];
      data[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width, height, data };
}
