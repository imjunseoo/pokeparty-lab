// Ruby Marshal 4.8 리더 (Pokémon Essentials / RPG Maker XP 의 .dat · .rxdata 읽기용, 코드 실행 없음)
// 심볼은 Sym, 해시는 Map, 문자열은 encoding 정보에 따라 string 또는 Buffer 로 돌려준다.

export class Sym {
  constructor(name) { this.name = name; }
  toString() { return this.name; }
  toJSON() { return this.name; }
}

export function loadMarshal(buf) {
  let p = 0;
  const symbols = [], objects = [];
  if (buf[0] !== 4 || buf[1] !== 8) throw new Error('Marshal 4.8 형식이 아님');
  p = 2;

  const byte = () => buf[p++];
  function int() {
    const c = buf.readInt8(p++);
    if (c === 0) return 0;
    if (c >= 5) return c - 5;
    if (c <= -5) return c + 5;
    let n = 0;
    if (c > 0) {
      for (let i = 0; i < c; i++) n += buf[p++] * 2 ** (8 * i);
      return n;
    }
    for (let i = 0; i < -c; i++) n += buf[p++] * 2 ** (8 * i);
    return n - 2 ** (8 * -c);
  }
  function rawBytes() {
    const len = int();
    const s = buf.subarray(p, p + len);
    p += len;
    return s;
  }
  // 문자열 객체: 인코딩 ivar(E 또는 encoding)가 붙으면 'I' 처리부에서 문자열로 바꾼다
  class RStr { constructor(bytes) { this.bytes = bytes; } }

  function read() {
    const t = String.fromCharCode(byte());
    switch (t) {
      case '0': return null;
      case 'T': return true;
      case 'F': return false;
      case 'i': return int();
      case ':': { const s = new Sym(rawBytes().toString('utf8')); symbols.push(s); return s; }
      case ';': return symbols[int()];
      case '@': return objects[int()];
      case 'I': {
        const idx = objects.length;
        const v = read();
        const n = int();
        let utf8 = false;
        for (let i = 0; i < n; i++) {
          const k = read(), val = read();
          if (k?.name === 'E' || k?.name === 'encoding') utf8 = true;
        }
        if (v instanceof RStr) {
          const s = utf8 ? v.bytes.toString('utf8') : v.bytes;
          if (objects[idx] === v) objects[idx] = s;
          return s;
        }
        return v;
      }
      case '"': { const s = new RStr(Buffer.from(rawBytes())); objects.push(s); return s; }
      case '[': {
        const arr = []; objects.push(arr);
        const n = int();
        for (let i = 0; i < n; i++) arr.push(fix(read()));
        return arr;
      }
      case '{': case '}': {
        const h = new Map(); objects.push(h);
        const n = int();
        for (let i = 0; i < n; i++) { const k = fix(read()); h.set(k, fix(read())); }
        if (t === '}') h.default = fix(read());
        return h;
      }
      case 'f': {
        const s = rawBytes().toString();
        const v = s === 'inf' ? Infinity : s === '-inf' ? -Infinity : s === 'nan' ? NaN : parseFloat(s);
        objects.push(v);
        return v;
      }
      case 'l': {
        const sign = String.fromCharCode(byte());
        const len = int() * 2;
        let v = 0n;
        for (let i = 0; i < len; i++) v |= BigInt(buf[p++]) << BigInt(8 * i);
        const num = Number(sign === '-' ? -v : v);
        objects.push(num);
        return num;
      }
      case 'o': {
        const obj = {}; objects.push(obj);
        obj.__class = read().name;
        const n = int();
        for (let i = 0; i < n; i++) { const k = read().name.replace(/^@/, ''); obj[k] = fix(read()); }
        return obj;
      }
      case 'S': {
        const obj = {}; objects.push(obj);
        obj.__class = read().name;
        const n = int();
        for (let i = 0; i < n; i++) { const k = read().name; obj[k] = fix(read()); }
        return obj;
      }
      case 'u': { const cls = read().name; const obj = { __class: cls, __dump: Buffer.from(rawBytes()) }; objects.push(obj); return obj; }
      case 'U': { const obj = {}; objects.push(obj); obj.__class = read().name; obj.__data = fix(read()); return obj; }
      case 'e': { read(); return read(); }
      case 'C': { read(); return read(); }
      case 'c': case 'm': case 'M': { const v = { __classref: rawBytes().toString() }; objects.push(v); return v; }
      case '/': { const src = rawBytes().toString(); byte(); const v = { __regexp: src }; objects.push(v); return v; }
      default: throw new Error(`알 수 없는 Marshal 타입 '${t}' (offset ${p - 1})`);
    }
  }
  // 'I' 없이 들어간 바이너리 문자열(RStr)은 Buffer 로
  const fix = v => (v instanceof RStr ? v.bytes : v);
  return fix(read());
}
