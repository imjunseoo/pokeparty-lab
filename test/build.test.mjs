import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEngine } from '../site/assets/js/core/engine.js';
import { createContext } from '../site/assets/js/core/party.js';
import { createMoveBook, createBuilder, statsAt, NATURES, LEVEL_BASE } from '../site/assets/js/core/build.js';

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const dex = load('../site/data/pokedex.json');
const data = load('../site/data/game/pokemon-party.json');
const sets = load('../site/data/sets.json');
const book = createMoveBook(load('../site/data/game/moves.json'));
const engine = createEngine(dex);
const ctx = createContext(engine, { game: { data, map: 'tour', legends: false, rule: data.rules[0] } });
const items = new Set([...data.items.battle, ...data.items.berry, ...data.items.signature]);
const builder = createBuilder(ctx, book, { level: 75, sets, items });
const mon = slug => engine.bySlug.get(slug);
const blank = m => ({ lv: 75, mv: [], ab: m.ab[0], na: 'hardy', it: null, iv: [] });

test('능력치: Lv.75 · 개체값 20/31 · 노력치 0 · 성격 보정', () => {
  const g = mon('garchomp');
  const plain = statsAt(g.st, 75);
  assert.equal(plain[0], Math.floor((2 * 108 + 20) * 75 / 100) + 85);   // HP 262
  const jolly = statsAt(g.st, 75, [false, false, false, false, false, true], 'jolly');
  assert.ok(jolly[5] > plain[5] && jolly[3] < plain[3], '명랑: 스피드↑ 특공↓');
  assert.equal(Object.keys(NATURES).length, 25);
});

test('기술 데이터: 모든 습득표 번호가 기술 표 안에 있고, 한글 이름이 있다', () => {
  const json = load('../site/data/game/moves.json');
  for (const list of Object.values(json.learn)) for (const i of list) assert.ok(json.list[i < 0 ? -i - 1 : i % LEVEL_BASE], `기술 번호 ${i}`);
  assert.ok(json.list.every(m => /[가-힣]/.test(m[1])), '한글 이름');
  assert.ok(book.learn(mon('garchomp').id).some(m => m.slug === 'earthquake'), '한카리아스는 지진을 배운다');
});

test('기술 떠올리기: 레벨업 기술은 배우는 레벨과 함께 (「내 포켓몬 확인 → 기술 떠올리기」로 다시 배움), 기술머신·가르침·교배 기술은 따로', () => {
  const g = mon('garchomp');
  const lvs = book.levels(g.id);
  assert.equal(lvs.get('dragon-claw'), 36, '드래곤클로는 한카리아스 Lv.36 레벨업 기술');
  assert.ok(lvs.has('sand-attack') && lvs.get('sand-attack') <= 1, '첫 진화 단계(딥상어동) 레벨업 기술도 떠올리기로');
  assert.ok(!lvs.has('earthquake') && book.learn(g.id).some(x => x.slug === 'earthquake'), '지진은 기술머신 → 기술 칸');
  // 레벨에 따라 떠올리기로 배울 수 있는 기술이 늘어남, 최선 세팅은 모든 기술로
  const at30 = new Set(builder.relearnable(g, 30).map(x => x.slug)), at75 = new Set(builder.relearnable(g, 75).map(x => x.slug));
  assert.ok(!at30.has('dragon-claw') && at75.has('dragon-claw'));
  assert.ok([...at75].every(sl => lvs.has(sl)), '떠올리기는 레벨업 기술만');
  assert.equal(builder.learnable(g).length, book.learn(g.id).length, '최선 세팅·입력 폼은 기술 칸 기술까지 전부');
});

test('최선 세팅: 배울 수 있는 기술 4개 · 고른 특성/성격이 유효 · 지금 세팅보다 점수가 높다', () => {
  for (const slug of ['garchomp', 'azumarill', 'scizor', 'gengar']) {
    const m = mon(slug);
    const best = builder.optimize(m, blank(m));
    const learnable = new Set(builder.learnable(m).map(x => x.slug));
    assert.equal(best.mv.length, 4, slug);
    assert.ok(best.mv.every(s => learnable.has(s)), `${slug}: 배울 수 있는 기술만`);
    assert.ok(engine.abilitiesOf(m).includes(best.ab), `${slug}: 특성`);
    assert.ok(NATURES[best.na], `${slug}: 성격`);
    assert.ok(!best.it || items.has(best.it), `${slug}: 게임에서 구할 수 있는 도구`);
    assert.ok(builder.evaluate(m, best).score > builder.evaluate(m, blank(m)).score, slug);
  }
  // 마릴리는 천하장사, 핫삼은 테크니션 (공격을 크게 올리는 특성을 고른다)
  assert.equal(builder.optimize(mon('azumarill'), blank(mon('azumarill'))).ab, 'huge-power');
  assert.equal(builder.optimize(mon('scizor'), blank(mon('scizor'))).ab, 'technician');
});

test('할 일: 이득이 큰 순서이고, 기술 할 일을 다 하면 최선 세팅의 기술이 된다', () => {
  const m = mon('charizard');
  const cur = { lv: 75, mv: ['flamethrower', 'dragon-breath', 'slash', 'smokescreen'], ab: 'blaze', na: 'adamant', it: null, iv: [] };
  const best = builder.optimize(m, cur);
  const steps = builder.plan(m, cur, best);
  assert.ok(steps.length > 0);
  // 개체값 올리기는 선택이라 맨 끝, 나머지는 이득이 큰 순서
  const main = steps.filter(x => !x.optional);
  main.forEach((s, k) => { assert.ok(s.gain > 0); if (k) assert.ok(main[k - 1].gain >= s.gain); });
  assert.ok(steps.findIndex(x => x.optional) === -1 || steps.findIndex(x => x.optional) === steps.length - 1);
  let mv = cur.mv.slice();
  for (const s of steps.filter(x => x.kind === 'move')) mv = s.forget ? mv.map(x => (x === s.forget ? s.learn : x)) : [...mv, s.learn];
  assert.deepEqual([...mv].sort(), [...best.mv].sort());
});

test('추천 도구 기준: 구애 도구를 빼면 구애 도구를 고르지 않고, 도구 없이는 도구를 비운다 · 못 구하면 대신 지닐 도구', () => {
  const CHOICE = ['choice-band', 'choice-specs', 'choice-scarf'];
  const noChoice = createBuilder(ctx, book, { level: 75, sets, items: new Set([...items].filter(i => !CHOICE.includes(i))) });
  const none = createBuilder(ctx, book, { level: 75, sets, items: new Set() });
  for (const slug of ['garchomp', 'charizard', 'gengar', 'dragapult', 'hydreigon']) {
    const m = mon(slug);
    assert.ok(!CHOICE.includes(noChoice.optimize(m, blank(m)).it), `${slug} 구애 도구 빼기`);
    assert.equal(none.optimize(m, blank(m)).it, null, `${slug} 도구 없이`);
  }
  // 못 구하면: 고를 수 있는 도구 중 점수가 높은 순 + 마지막은 도구 없이, 목표 도구 자신은 없음
  const g = mon('garchomp');
  const best = builder.optimize(g, blank(g));
  const alt = builder.itemAlternatives(g, best);
  assert.ok(best.it && alt.length >= 2);
  assert.equal(alt[alt.length - 1].it, null);
  assert.ok(alt.every(a => a.it !== best.it));
  assert.ok(alt.slice(0, -1).every((a, k, l) => k === 0 || l[k - 1].diff >= a.diff), '점수 높은 순');
  assert.ok(alt[alt.length - 1].diff <= alt[0].diff, '도구 없이가 가장 아쉽거나 같다');
  assert.deepEqual(none.itemAlternatives(g, { ...best, it: null }), []);
});

test('전용도구: 쓸 수 있는 포켓몬이 아니면 고르지 않는다 (플레이트 → 아르세우스만 상점에서 팜)', () => {
  assert.deepEqual(data.signatureUsers['draco-plate'], [493]);
  assert.deepEqual(data.signatureUsers['light-ball'], [25]);
  const itemOk = (m, it) => !data.signatureUsers[it] || data.signatureUsers[it].includes(m.sp);
  const b2 = createBuilder(ctx, book, { level: 75, sets, items, itemOk });
  const g = mon('garchomp');
  const best = b2.optimize(g, blank(g));
  assert.ok(!best.it?.endsWith('-plate'), '한카리아스에게 플레이트 없음');
  assert.ok(b2.itemAlternatives(g, best, { limit: 10 }).every(a => !a.it?.endsWith('-plate')));
});

test('개체값: 최선 세팅은 31을 가정하지 않고 지금 개체값(기본 20) 기준 · 올리기는 선택 할 일', () => {
  const m = mon('garchomp');
  const best = builder.optimize(m, blank(m));
  assert.ok(![0, 1, 2, 3, 4, 5].some(k => best.iv?.[k]), '입력 안 하면 개체값 전부 기본 20');
  // 입력한 개체값 31은 그대로
  const mine = { ...blank(m), iv: [false, true, false, false, false, true] };
  assert.deepEqual(builder.optimize(m, mine).iv, mine.iv);
  // 할 일: 개체값은 선택 할 일 한 줄(맨 끝), 올리면 점수가 오르는 능력만
  const steps = builder.plan(m, blank(m), best);
  const iv = steps.find(x => x.kind === 'iv');
  assert.ok(iv && iv.optional && steps[steps.length - 1] === iv);
  assert.ok(iv.gains.every(g => g > 0) && iv.stats.length === iv.gains.length);
  const up = builder.evaluate(m, { ...best, iv: [0, 1, 2, 3, 4, 5].map(k => iv.stats.includes(k)) }).score;
  assert.ok(up > builder.evaluate(m, best).score, '개체값을 올리면 점수가 오른다');
});

test('폼: 지방 폼 진화 갈래 · 폼 변경 도구 · 지닌 도구로 타입이 정해지는 전용기', () => {
  const ko = id => engine.byId.get(id)?.ko;
  // 마그케인 → 블레이범 · 히스이 블레이범(히스이의 골동품), 아라리 → 나시 · 알로라 나시
  const quilava = data.evo[mon('quilava').id];
  assert.ok(quilava.some(([id, it]) => id === mon('typhlosion-hisui').id && it === 'hisuiregion'));
  assert.ok(quilava.some(([id]) => id === mon('typhlosion').id));
  assert.ok(data.evo[mon('exeggcute').id].some(([id, it]) => id === mon('exeggutor-alola').id && it === 'alolaregion'));
  // 게임 규칙 그대로: 가디는 히스이 가디가 따로 있어 대상 아님, 모자 폼으로 가는 갈래는 뺌
  assert.ok(!data.evo[mon('growlithe').id].some(([, it]) => /region$/.test(it || '')));
  assert.ok(!(data.evo[mon('pichu').id] || []).some(([, it]) => it === 'alolaregion'), ko(mon('pichu').id));
  // 폼 변경 도구: 기라티나 오리진(지니면) · 로토무 5폼(쓰면) · 아르세우스 플레이트(타입만, 도감에 따로 없음)
  const gira = data.formItems[mon('giratina-altered').id];
  assert.deepEqual(gira.map(x => [x.id, x.item, x.hold]), [[mon('giratina-origin').id, 'griseous-core', true]]);
  assert.equal(data.formItems[mon('rotom').id].length, 5);
  assert.ok(data.formItems[mon('rotom').id].every(x => x.item === 'rotom-catalog' && !x.hold));
  const fire = data.formItems[mon('arceus').id].find(x => x.item === 'flame-plate');
  assert.ok(fire && fire.id === null && fire.t.join() === 'fire' && fire.hold);
  // 심판의뭉치는 플레이트 타입, 테크노버스터는 카세트 타입으로 계산 (상성이 바뀜)
  const arceus = mon('arceus');
  const fireArceus = { ...arceus, t: ['fire'] };
  const judg = { lv: 75, mv: ['judgment'], ab: 'multitype', na: 'modest', it: null, iv: [] };
  const plain = builder.targetTable(arceus, judg), plated = builder.targetTable(fireArceus, { ...judg, it: 'flame-plate' });
  const W = ctx.meta.reduce((a, m) => a + m.w, 0);
  const avg = t => ctx.meta.reduce((a, m, q) => a + m.w * Math.min(t.best[q], 100), 0) / W;
  assert.notEqual(avg(plain).toFixed(3), avg(plated).toFixed(3), '플레이트에 따라 심판의뭉치 데미지가 달라진다');
  const gene = mon('genesect');
  const tb = it => builder.targetTable(gene, { lv: 75, mv: ['techno-blast'], ab: gene.ab[0], na: 'modest', it, iv: [] });
  assert.notEqual(avg(tb(null)).toFixed(3), avg(tb('douse-drive')).toFixed(3), '카세트에 따라 테크노버스터 타입이 바뀐다');
});
