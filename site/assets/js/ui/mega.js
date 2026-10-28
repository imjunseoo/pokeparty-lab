// 메가진화 추천 (메가진화를 쓰는 룰): 파티 중 누구를 메가진화할지 (파티에 하나만)
// 직접 고른 메가진화가 있으면 그대로 따르고, 없으면 상대 플레이어 포켓몬 후보와 1:1 평균 승률이 가장 많이 오르는 멤버를 자동 추천해
// 그 메가진화 모습 기준으로 파티 분석·최선 세팅(메가스톤 고정)·추천 세팅을 보여 준다 (state.js partyMembers 의 자동 추천)
import { store, getContext, getBuilder, megaOptions, battleForm, attackTypes, setMegaResolver } from '../state.js';
import { analyzeMember } from './builder.js';
import { winRate } from '../core/battle.js';
import { formSwapGain } from '../core/party.js';

const plans = new WeakMap();   // 평가기(기술 데이터 전이면 분석 컨텍스트) → Map(파티 키 → 계획)
const FIT_W = 1;               // 파티 상성 점수 1 = 평균 승률 1%p
export const FIT_WARN = -2;    // 파티 상성이 이만큼 내려가면 「약점 겹침」 경고

/**
 * @returns { options: [{ i, id, stone, mon(메가 모습), base(메가 전 모습), fit(파티 상성 변화), rate0, rate1(평균 승률 0~1 | null), gain, score }],
 *            pick: 지금 기준 메가진화 option | null, explicit: 직접 고른 멤버 번호 | null, rated: 승률로 골랐는지 } | null (메가진화할 수 있는 멤버 없음)
 */
export function megaPlan() {
  if (!store.party.some(m => megaOptions(battleForm({ ...m, mega: 0 }).mon).length)) return null;
  const ctx = getContext();
  const b = getBuilder();
  const holder = b || ctx;
  let map = plans.get(holder);
  if (!map) plans.set(holder, (map = new Map()));
  const key = JSON.stringify(store.party);
  if (map.has(key)) return map.get(key);

  const { engine } = store;
  // 메가진화하지 않은 파티 (메가진화 이득은 이 파티를 기준으로)
  const plain = store.party.map(m => {
    const { mon, caught } = battleForm({ ...m, mega: 0 });
    const ability = engine.abilitiesOf(mon).includes(m.ability) ? m.ability : undefined;
    return { m, mon, caught, pm: ctx.prep(mon, { ability, tera: m.tera || null, base: caught, atk: attackTypes(m.set) }) };
  });
  const members = plain.map(x => x.pm);
  const options = [];
  plain.forEach(({ m, mon, caught, pm }, i) => {
    for (const [id, stone] of megaOptions(mon)) {
      const mega = engine.byId.get(id);
      if (!mega) continue;
      const megaPm = ctx.prep(mega, { tera: m.tera || null, base: caught, stone, atk: attackTypes(m.set) });
      const fit = formSwapGain(ctx, members, i, megaPm);
      let rate0 = null, rate1 = null;
      if (b) {
        // 내 세팅을 입력했으면 그 기술로(메가스톤을 지니고), 아니면 모습마다 최선 세팅으로
        const r0 = analyzeMember(m, pm), r1 = analyzeMember(m, megaPm);
        const set0 = m.set ? r0.cur : r0.best;
        const set1 = m.set ? { ...r1.cur, it: stone } : r1.best;
        rate0 = winRate(ctx, b.targetTable(mon, set0));
        rate1 = winRate(ctx, b.targetTable(mega, set1));
      }
      options.push({ i, id, stone, mon: mega, base: mon, fit, rate0, rate1, gain: b ? rate1 - rate0 : null });
    }
  });
  // 평균 승률이 많이 오르는 순 + 파티 상성(점수 1 = 승률 1%p 로 덜 무겁게: 약점이 크게 겹치면 순위가 내려감),
  // 기술 데이터 전이면 파티 상성 순
  for (const o of options) o.score = b ? o.gain * 100 + FIT_W * o.fit : o.fit;
  options.sort((x, y) => y.score - x.score);
  const explicit = store.party.findIndex(m => m.mega > 0);
  const pick = explicit >= 0
    ? options.find(o => o.i === explicit && o.id === store.party[explicit].mega) || null
    : store.party.some(m => m.mega === null || m.mega === undefined)
      ? options.find(o => (store.party[o.i].mega ?? null) === null && o.score > 0) || null
      : null;
  const plan = { options, pick, explicit: explicit >= 0 ? explicit : null, rated: !!b };
  map.set(key, plan);
  return plan;
}

// 직접 고른 메가진화가 없으면 자동 추천을 파티 분석에 가정
setMegaResolver(() => {
  const p = megaPlan();
  return p && p.explicit === null && p.pick ? { i: p.pick.i, id: p.pick.id } : null;
});
