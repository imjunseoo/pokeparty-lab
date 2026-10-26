// DOM 헬퍼

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);

/** 받침에 따라 조사 선택: josa('누오', '을를') → '누오를', josa('리자몽', '으로') → '리자몽으로' (ㄹ 받침은 '로') */
export function josa(word, pair) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (pair === '으로') {
    if (code < 0 || code > 11171) return `${word}(으)로`;
    return word + (code % 28 && code % 28 !== 8 ? '으로' : '로');
  }
  const [withJong, withoutJong] = { 을를: ['을', '를'], 와과: ['과', '와'], 이가: ['이', '가'], 은는: ['은', '는'] }[pair];
  if (code < 0 || code > 11171) return `${word}${withJong}(${withoutJong})`;
  return word + (code % 28 ? withJong : withoutJong);
}

/** 이벤트 위임: root 안에서 selector 에 맞는 요소에 대해 fn(event, element) */
export function on(root, type, selector, fn) {
  root.addEventListener(type, e => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  });
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 사생활 보호 모드 등 */ }
  },
};
