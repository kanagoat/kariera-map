// Запуск из корня проекта: node --test tests/adaptive.test.js
// Проверяет банк вопросов этапа 2 (site/data/adaptive.js) и движок (site/adaptive.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../site/data/questionnaire.js");
const A = require("../site/data/adaptive.js");
const S = require("../site/scoring.js");
const AD = require("../site/adaptive.js");

const CODES = Q.fields.map((f) => f.code);

// ответы этапа 1: у каждой области своё значение
function answersFrom(byField, fallback = 3) {
  const a = {};
  CODES.forEach((c) => [1, 2, 3, 4].forEach((i) => (a[c + i] = byField[c] ?? fallback)));
  return a;
}

test("банк: у каждой области 3 углубляющих утверждения на двух языках, все id новые и уникальные", () => {
  const ids = [];
  CODES.forEach((c) => {
    assert.equal(A.deep[c].length, 3, c);
    A.deep[c].forEach((it) => {
      assert.ok(it.kk.trim() && it.ru.trim(), it.id);
      ids.push(it.id);
    });
  });
  Object.values(A.forks).forEach((fk) =>
    Object.keys(fk.branches).forEach((p) => {
      assert.ok(Q.pairs[p], p);
      fk.branches[p].forEach((it) => (assert.ok(it.kk && it.ru), ids.push(it.id)));
    })
  );
  Object.values(A.practical).forEach((list) => {
    assert.equal(list.length, 3);
    list.forEach((it) => (assert.ok(it.kk && it.ru), ids.push(it.id)));
  });
  assert.equal(new Set(ids).size, ids.length, "id повторяются");
  const old = new Set(Q.buildInterestSequence().map((s) => s.id).concat(Q.anxiety.map((a) => a.id)));
  ids.forEach((id) => assert.ok(!old.has(id), "id совпадает с этапом 1: " + id));
});

test("банк: каждая область входит ровно в одно широкое направление", () => {
  const seen = Object.values(A.directions).flatMap((d) => d.fields);
  assert.deepEqual(seen.slice().sort(), CODES.slice().sort());
  Object.keys(A.directions).forEach((d) => assert.ok(A.practical[d], d));
});

test("пограничные: лидер не углубляется, берутся области с обеих сторон порога", () => {
  // IT лидер; порог = dev(IT) − 0,8. PM чуть выше порога, ENG чуть ниже, MED далеко
  const s1 = S.scoreInterests(Q, answersFrom({ IT: 5, PM: 4, ENG: 4, MED: 1 }, 3));
  const cutoff = s1.dev.IT - S.THRESHOLDS.candidateWindow;
  const bl = AD.borderline(Q, s1, { zone: 1 });
  assert.ok(!bl.includes("IT"));
  bl.forEach((c) => assert.ok(Math.abs(s1.dev[c] - cutoff) < 1));
  assert.ok(bl.length <= AD.ADAPT.maxBorderline);
});

test("пограничные: при неинформативном профиле этап 2 не задаётся", () => {
  const s1 = S.scoreInterests(Q, answersFrom({}, 5));
  assert.equal(s1.uninformative, true);
  assert.deepEqual(AD.planRound1(Q, A, s1).items, []);
});

test("углубление может и добавить, и убрать область", () => {
  // IT 5, ECO 4 (на грани), остальные 3
  const a = answersFrom({ IT: 5, ECO: 4 });
  const s1 = S.scoreInterests(Q, a);
  const plan = AD.planRound1(Q, A, s1, { zone: 1 });
  assert.ok(plan.borderline.includes("ECO"));
  const down = Object.assign({}, a);
  A.deep.ECO.forEach((it) => (down[it.id] = 1));
  assert.ok(!AD.rescore(Q, A, s1, down, plan.borderline).candidates.includes("ECO"));
  const up = Object.assign({}, a);
  A.deep.ECO.forEach((it) => (up[it.id] = 5));
  assert.ok(AD.rescore(Q, A, s1, up, plan.borderline).candidates.includes("ECO"));
});

test("лимит: этап 2 не превышает 15 вопросов", () => {
  const s1 = S.scoreInterests(Q, answersFrom({ IT: 5, GEO: 4, BCH: 4, ECO: 4, MED: 4 }));
  const plan = AD.planRound1(Q, A, s1, { zone: 2 });
  const used = plan.items.length + 1;
  const forks = AD.planForks(A, ["GEO", "BCH"], AD.ADAPT.maxItems - used);
  assert.ok(used + forks.length <= AD.ADAPT.maxItems);
});

test("развилки: GEO оставляет одну пару при явном перевесе, BCH добавляет CP", () => {
  const a = {};
  A.forks.GEO.branches.BG.forEach((it) => (a[it.id] = 5));
  A.forks.GEO.branches.MG.forEach((it) => (a[it.id] = 2));
  A.forks.BCH.branches.BC.forEach((it) => (a[it.id] = 2));
  A.forks.BCH.branches.CP.forEach((it) => (a[it.id] = 4));
  assert.deepEqual(AD.resolveForks(A, a, ["GEO", "BCH"]), { GEO: ["BG"], BCH: ["BC", "CP"] });
  // разница меньше 1 — остаётся как в v2.2
  A.forks.GEO.branches.MG.forEach((it) => (a[it.id] = 5));
  assert.equal(AD.resolveForks(A, a, ["GEO"]).GEO, undefined);
});

test("практические условия: по направлениям двух первых областей, без повторов", () => {
  assert.equal(AD.planPractical(A, ["ENG", "IT", "ART"]).length, 3); // обе — TECH
  assert.equal(AD.planPractical(A, ["MED", "LAW"]).length, 6);
});

test("согласованность: разница повтора", () => {
  assert.equal(AD.consistency({ IT1: 5 }, { id: "IT1" }, 2), 3);
  assert.equal(AD.consistency({}, null, 2), null);
});
