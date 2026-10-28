// 테라스탈·다이맥스 활용 카드 (파티 추천 화면, 그 기믹을 쓰는 룰일 때)
//   테라스탈: 파티 여럿이 약점인 타입을 누가 어떤 테라 타입으로 막는지 (테라피스를 지녀야 하고 한 번 쓰면 사라짐 · 마스터테라주얼로 테라 타입 바꾸기)
//   다이맥스: 누구를 다이맥스·거다이맥스하면 상대 플레이어 포켓몬과 1:1 평균 승률이 가장 오르는지 + 다이맥스 기술 추가 효과
import { store, gameRule, getBuilder } from '../state.js';
import { analyzeMember } from './builder.js';
import { teraPlan, MAX_MOVE, gmaxEffect } from '../core/gimmick.js';
import { winRate } from '../core/battle.js';
import { esc } from './dom.js';
import { sprite, typeBadge, mult, ICONS } from './components.js';

const pct = v => `${Math.round(v * 100)}%`;
const price = slug => (store.gameData.gimmickPrices?.[slug] || 0).toLocaleString();
const uses = key => !!gameRule()?.uses.includes(key);

/** 테라스탈 활용: 겹치는 약점마다 막을 멤버 · 테라 타입 */
export function teraCard(ctx, members) {
  if (!uses('tera') || members.length < 2) return '';
  const { engine } = store;
  const rows = teraPlan(ctx, members);
  const who = i => `${sprite(members[i].mon)}<b>${esc(members[i].mon.ko)}</b>`;
  const list = rows.map(r => `<li class="gm-row">
      <div class="gm-weak">${typeBadge(engine, r.type)} 약점 <b>${r.weak.length}마리</b>
        <span class="note">${r.weak.map(i => `${esc(members[i].mon.ko)}${members[i].def[engine.tIdx[r.type]] >= 4 ? '(4배)' : ''}`).join(' · ')}${r.resist.length ? ` · 반감 ${r.resist.length}마리` : ''}</span></div>
      ${r.picks.length ? `<ul class="gm-picks">${r.picks.map(p => `<li>${who(p.i)} → 테라 ${typeBadge(engine, p.tera, 'sm')} ${mult(p.mult, true)} 받음
        ${p.natural ? '<span class="pill-soft good" title="자기 타입이라 테라 타입이 이 타입이면 마스터테라주얼 없이 돼요 (두 타입이면 내 포켓몬 확인에서 테라 타입 확인)">자기 타입</span>'
          : `<span class="pill-soft accent" title="마스터테라주얼로 테라 타입을 바꿔야 해요">마스터테라주얼 ${price('masterterajewel')}원</span>`}
        ${p.fixes.length ? `<span class="note">같이 막음 ${p.fixes.map(t => typeBadge(engine, t, 'sm')).join('')}</span>` : ''}
        ${p.adds.length ? `<span class="note bad">대신 약해짐 ${p.adds.map(t => typeBadge(engine, t, 'sm')).join('')}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="note">테라스탈로 막을 멤버가 없어요.</p>'}
    </li>`).join('');
  return `<div class="card-head"><h3>${ICONS.spark} 테라스탈 활용</h3><span class="sub">${esc(gameRule().name)} · 파티 약점 막기</span></div>
    ${rows.length ? `<ol class="gm-list">${list}</ol>` : '<p class="note">파티 여럿이 겹쳐 약한 타입이 없어요. 테라스탈은 자기 타입으로 공격을 세게 하는 데 쓰면 돼요.</p>'}
    <p class="note">테라피스(기믹 상점 ${price('terapiece')}원)를 지녀야 테라스탈하고(메가스톤을 지닌 멤버는 못 해요), <b>한 번 쓰면 사라져요</b>. 테라 타입은 기본적으로 자기 타입 중 하나이고,
      마스터테라주얼(${price('masterterajewel')}원)을 쓰면 원하는 타입으로 바꿔요. 위험한 상대가 나왔을 때 아껴 쓰세요.</p>`;
}

/** 다이맥스 활용: 다이맥스·거다이맥스했을 때 평균 승률이 가장 오르는 멤버 */
export function dynamaxCard(ctx, members) {
  if (!uses('dynamax') || !members.length) return '';
  const b = getBuilder();
  if (!b) return '';
  const { engine } = store;
  const rows = store.party.map((m, i) => {
    const pm = members[i];
    if (pm.stone) return null;   // 메가스톤 등 정해진 도구를 지녀서 다이버섯을 못 지님
    const r = analyzeMember(m, pm);
    if (!r) return null;
    const set = r.best;
    const gm = store.gameData.gmax?.[pm.mon.id] || null;
    const base = winRate(ctx, b.targetTable(pm.mon, set));
    const dyna = winRate(ctx, b.dynamaxTable(pm.mon, set));
    const gmax = gm ? winRate(ctx, b.dynamaxTable(pm.mon, set, gm)) : null;
    const types = [...new Set(set.mv.map(s => store.moves.bySlug.get(s)).filter(mv => mv && mv.cat > 0 && mv.power).map(mv => mv.type))];
    const after = Math.max(dyna, gmax ?? 0);
    return { i, pm, gm, base, dyna, gmax, after, gain: after - base, types };
  }).filter(Boolean).sort((x, y) => y.gain - x.gain || y.after - x.after);
  if (!rows.length) return '';
  const top = rows[0];
  const row = x => `<li class="gm-row ${x === top ? 'on' : ''}">
      <div class="gm-weak">${sprite(x.pm.mon)}<b>${esc(x.pm.mon.ko)}</b>
        <span class="mega-stat" title="상대 플레이어 포켓몬 후보와 1:1로 붙었을 때 먼저 쓰러뜨리는 비율 (다이맥스 3턴 · HP 2배 · 다이맥스 기술 위력)"><span class="bt-k">평균 승률</span>${pct(x.base)} → <b>${pct(x.after)}</b> <em class="${x.gain >= 0 ? 'good' : 'bad'}">${x.gain >= 0 ? '+' : '−'}${Math.round(Math.abs(x.gain) * 100)}%p</em></span></div>
      <div class="note gm-moves">${x.types.map(t => `${typeBadge(engine, t, 'sm')} ${MAX_MOVE[t][0]} <em>${MAX_MOVE[t][1]}</em>`).join(' · ') || '공격 기술 없음'}</div>
      ${x.gm ? `<div class="note gm-gmax"><span class="pill-soft accent">거다이맥스 가능</span> 다이스프 ${price('maxsoup')}원 · ${typeBadge(engine, x.gm.type, 'sm')} <b>${esc(x.gm.ko)}</b> — ${esc(gmaxEffect(x.gm.fn) || '거다이맥스 전용 효과')}</div>` : ''}
    </li>`;
  return `<div class="card-head"><h3>${ICONS.spark} 다이맥스 활용</h3><span class="sub">${esc(gameRule().name)} · 3턴 · HP 2배</span></div>
    <p class="mega-state"><b>${esc(top.pm.mon.ko)}</b>${top.gmax !== null && top.gmax >= top.dyna ? ' (거다이맥스)' : ''} 다이맥스를 추천해요 — 평균 승률 ${pct(top.base)} → <b>${pct(top.after)}</b></p>
    <ol class="gm-list">${rows.map(row).join('')}</ol>
    <p class="note">다이버섯(기믹 상점 ${price('maxmushroom')}원)을 지녀야 다이맥스해요 (메가스톤을 지닌 멤버는 못 해요). 거다이맥스는 거다이맥스 모습이 있는 포켓몬에게 다이스프(${price('maxsoup')}원)를 먹이면 돼요.
      다이맥스 기술은 위력이 오르고 날씨·필드·능력 변화가 따라와요 (추천 세팅의 공격 기술 기준).</p>`;
}
