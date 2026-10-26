// "누오, 한카리아스 알로라 라이츄" 같은 글 → 포켓몬 목록
import { store } from '../state.js';
import { normalize } from '../core/search.js';

/** 띄어쓰기가 이름 안에도 있을 수 있어(알로라 라이츄) 앞에서부터 가장 긴 일치를 고른다. { found, missed } */
export function parseNames(text) {
  const found = [], missed = [];
  const exact = q => {
    const n = normalize(q);
    return store.search(q, 5).find(p => normalize(p.ko) === n || normalize(p.en) === n) || null;
  };
  for (const chunk of String(text).split(/[,\n/·|]+/).map(s => s.trim()).filter(Boolean)) {
    const words = chunk.split(/\s+/);
    for (let i = 0; i < words.length;) {
      let hit = null, len = 0;
      for (let j = Math.min(words.length, i + 3); j > i && !hit; j--) {
        hit = exact(words.slice(i, j).join(' '));
        len = j - i;
      }
      if (!hit) { hit = store.search(words[i], 1)[0] || null; len = 1; }
      if (hit) found.push(hit); else missed.push(words[i]);
      i += len;
    }
  }
  return { found, missed };
}
