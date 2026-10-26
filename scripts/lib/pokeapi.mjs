// 빌드 스크립트 공용: PokeAPI CSV 다운로드/파싱/캐시
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'site', 'data');
export const LANG = { ko: '3', en: '9' };
const CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';

const args = process.argv.slice(2);
const cacheDir = args.includes('--cache') ? resolve(ROOT, args[args.indexOf('--cache') + 1]) : null;

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

export async function fetchRetry(url, opts = {}, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}

export async function csv(name) {
  const cached = cacheDir && join(cacheDir, name + '.csv');
  if (cached && existsSync(cached)) return parseCsv(await readFile(cached, 'utf8'));
  const text = await (await fetchRetry(CSV_BASE + name + '.csv')).text();
  if (cached) { await mkdir(cacheDir, { recursive: true }); await writeFile(cached, text); }
  return parseCsv(text);
}

export async function loadTables(names) {
  const list = await Promise.all(names.map(csv));
  return Object.fromEntries(names.map((n, i) => [n, list[i]]));
}

export const cleanText = s => s.replace(/[\n\f\r­]+/g, ' ').replace(/\s+/g, ' ').trim();
export const groupBy = (rows, key) => rows.reduce((m, r) => ((m[r[key]] ||= []).push(r), m), {});
export const nameOf = (rows, idKey, lang, field = 'name') => Object.fromEntries(
  rows.filter(r => r.local_language_id === lang).map(r => [r[idKey], cleanText(r[field] || '')]));
// Showdown/Smogon 식 ID: 영문 소문자+숫자만 ("U-turn" → "uturn", "kings-shield" → "kingsshield")
export const toId = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(data);
  await writeFile(path, text);
  return (Buffer.byteLength(text) / 1024).toFixed(0) + 'KB';
}
