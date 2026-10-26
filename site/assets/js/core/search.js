// 포켓몬 이름 검색: 한글·영문·초성(ㄴㅇ → 누오)·도감번호, 입력 중인 받침도 처리 (눙 → 누오)

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
// 받침 인덱스 → 다음 글자 초성으로 넘어갈 수 있는 자음 (겹받침 제외)
const JONG_TO_CHO = { 1: 'ㄱ', 2: 'ㄲ', 4: 'ㄴ', 7: 'ㄷ', 8: 'ㄹ', 16: 'ㅁ', 17: 'ㅂ', 19: 'ㅅ', 20: 'ㅆ', 21: 'ㅇ', 22: 'ㅈ', 23: 'ㅊ', 24: 'ㅋ', 25: 'ㅌ', 26: 'ㅍ', 27: 'ㅎ' };
const HANGUL_BASE = 0xac00, HANGUL_END = 0xd7a3;

const isSyllable = ch => { const c = ch.charCodeAt(0); return c >= HANGUL_BASE && c <= HANGUL_END; };

export function chosung(text) {
  let out = '';
  for (const ch of text) out += isSyllable(ch) ? CHO[Math.floor((ch.charCodeAt(0) - HANGUL_BASE) / 588)] : ch;
  return out;
}

// NFC 사용: NFKC 는 키보드로 친 초성(호환 자모 ㄹ U+3139)을 조합용 자모(U+1105)로 바꿔 초성 검색이 깨진다
export const normalize = s => String(s).normalize('NFC').toLowerCase().replace(/[\s\-_.()'’:%]/g, '');

/** 마지막 글자의 받침을 떼어낸 형태와 그 받침(초성 형태). 받침이 없으면 null */
function splitLastJong(q) {
  const last = q[q.length - 1];
  if (!last || !isSyllable(last)) return null;
  const code = last.charCodeAt(0) - HANGUL_BASE;
  const jong = code % 28;
  if (!JONG_TO_CHO[jong]) return null;
  return { head: q.slice(0, -1) + String.fromCharCode(HANGUL_BASE + code - jong), cho: JONG_TO_CHO[jong] };
}

export function createSearch(pokemon) {
  const index = pokemon.map(p => {
    const ko = normalize(p.ko);
    return { p, ko, cho: chosung(ko), en: normalize(p.en), slug: normalize(p.slug) };
  });

  return function search(query, limit = 10) {
    const q = normalize(query);
    if (!q) return [];
    const num = /^\d+$/.test(q) ? +q : null;
    const choOnly = /^[ㄱ-ㅎ]+$/.test(q);
    const partial = splitLastJong(q);
    const hits = [];
    for (const e of index) {
      let s = -1;
      if (num !== null) {
        if (e.p.sp === num) s = 100;
      } else if (choOnly) {
        if (e.cho === q) s = 95;
        else if (e.cho.startsWith(q)) s = 80;
        else if (e.cho.includes(q)) s = 60;
      } else if (e.ko === q || e.en === q) s = 100;
      else if (e.ko.startsWith(q)) s = 85;
      else if (e.en.startsWith(q)) s = 80;
      else if (e.ko.includes(q)) s = 68;
      else if (e.en.includes(q) || e.slug.includes(q)) s = 58;
      else if (partial) {
        const at = e.ko.indexOf(partial.head);
        if (at >= 0 && e.cho[at + partial.head.length] === partial.cho) s = at === 0 ? 75 : 55;
      }
      if (s >= 0) hits.push([s + (e.p.def ? 4 : 0), e.p]);
    }
    hits.sort((a, b) => b[0] - a[0] || a[1].sp - b[1].sp || a[1].id - b[1].id);
    return hits.slice(0, limit).map(h => h[1]);
  };
}
