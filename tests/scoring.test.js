// Запуск из корня проекта: node --test tests/scoring.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../site/data/questionnaire.js");
const S = require("../site/scoring.js");

function answersFrom(byField, fallback = 3) {
  const a = {};
  Q.fields.forEach((f) => f.items.forEach((_, i) => (a[f.code + (i + 1)] = byField[f.code] ?? fallback)));
  return a;
}

test("анкета: 14 областей по 4 утверждения, 58 шагов, все id уникальны", () => {
  assert.equal(Q.fields.length, 14);
  Q.fields.forEach((f) => assert.equal(f.items.length, 4));
  const seq = Q.buildInterestSequence();
  assert.equal(seq.length, 58);
  assert.equal(new Set(seq.map((s) => s.id)).size, 58);
  // утверждения одной области не идут подряд
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].field && seq[i - 1].field) assert.notEqual(seq[i].field, seq[i - 1].field);
  }
});

test("каждая область ведёт к существующей паре", () => {
  Q.fields.forEach((f) => {
    assert.ok(Q.fieldPairs[f.code].length >= 1);
    Q.fieldPairs[f.code].forEach((p) => assert.ok(Q.pairs[p], p));
  });
  const subjectKeys = Q.subjects.map((s) => s.key);
  Object.values(Q.pairs).forEach((p) => p.subjects.forEach((s) => assert.ok(subjectKeys.includes(s), s)));
});

test("ясный профиль: две близкие области выше остальных", () => {
  const r = S.scoreInterests(Q, answersFrom({ MED: 5, BCH: 4.5 }, 2));
  assert.deepEqual(r.candidates, ["MED", "BCH"]);
  assert.equal(r.uninformative, false);
  assert.equal(r.wide, false);
});

test("одна область с отрывом: кандидат один, но для ранжирования показываем две", () => {
  const r = S.scoreInterests(Q, answersFrom({ IT: 5 }, 2));
  assert.deepEqual(r.candidates, ["IT"]);
  assert.equal(r.shown.length, 2);
});

test("всё на пятёрки: профиль неинформативен", () => {
  const r = S.scoreInterests(Q, answersFrom({}, 5));
  assert.equal(r.uninformative, true);
});

test("много близких областей: профиль широкий, показываем не больше четырёх", () => {
  const r = S.scoreInterests(Q, answersFrom({ ENG: 4, PM: 4, IT: 4, ECO: 4, MED: 4, BCH: 4 }, 2));
  assert.equal(r.wide, true);
  assert.equal(r.candidates.length, 4);
});

test("качество: проваленная проверка внимания и одинаковые ответы подряд", () => {
  const seq = Q.buildInterestSequence();
  const answers = {};
  const times = {};
  seq.forEach((s) => {
    answers[s.id] = 3;
    times[s.id] = 1000;
  });
  const q = S.scoreQuality(seq, answers, times);
  assert.deepEqual(q.attentionFailed, ["ZE1", "ZE2"]);
  assert.ok(q.flags.includes("straightline"));
  assert.ok(q.flags.includes("fast"));
  assert.equal(q.valid, false);
});

test("качество: добросовестные ответы проходят", () => {
  const seq = Q.buildInterestSequence();
  const answers = {};
  const times = {};
  seq.forEach((s, i) => {
    answers[s.id] = s.kind === "attention" ? s.expected : (i % 5) + 1;
    times[s.id] = 5000;
  });
  assert.equal(S.scoreQuality(seq, answers, times).valid, true);
});

function matrixOf(over) {
  const m = {};
  Q.subjects.forEach((s) => (m[s.key] = Object.assign({ can: 3, like: 3, keep: 3 }, over[s.key])));
  return m;
}

test("матрица: четыре сочетания читаются правильно", () => {
  const m = S.scoreMatrix(
    Q,
    matrixOf({
      math: { can: 5, like: 5 },
      physics: { can: 5, like: 1, keep: 1 },
      history: { can: 1, like: 5 },
      chemistry: { like: 1, keep: 5 },
    })
  );
  assert.equal(m.reading.math, "like+can");
  assert.equal(m.reading.physics, "can-not-like");
  assert.equal(m.reading.history, "like-not-can");
  assert.equal(m.reading.chemistry, "keep-not-like");
});

test("матрица: «оқымаймын» не участвует в расчёте", () => {
  const m = matrixOf({});
  m.law = null;
  const r = S.scoreMatrix(Q, m);
  assert.equal(r.reading.law, "missing");
});

test("тревожность: флаг при среднем 4,0 и выше", () => {
  const a = S.scoreAnxiety(Q, { MA1: 5, MA2: 4, MA3: 4, TA1: 2, TA2: 2, TA3: 3 });
  assert.equal(a.fearMath, true);
  assert.equal(a.fearText, false);
});

test("итог: одна пара без противоречий — направление проясняется", () => {
  const interests = S.scoreInterests(Q, answersFrom({ MED: 5, BCH: 4.5 }, 2));
  const matrix = S.scoreMatrix(Q, matrixOf({ biology: { like: 5 }, chemistry: { like: 4 } }));
  const fin = S.finalize(Q, { interests, ranking: ["MED", "BCH"], statedPair: "BC", matrix });
  assert.deepEqual(fin.pairs, ["BC"]);
  assert.equal(fin.status, "emerging");
});

test("итог: названная учеником пара не совпадает — направление открыто", () => {
  const interests = S.scoreInterests(Q, answersFrom({ MED: 5, BCH: 4.5 }, 2));
  const matrix = S.scoreMatrix(Q, matrixOf({}));
  const fin = S.finalize(Q, { interests, ranking: ["MED", "BCH"], statedPair: "MP", matrix });
  assert.equal(fin.status, "open");
  assert.ok(fin.reasons.includes("stated-differs"));
});

test("итог: предмет пары сильно не нравится — пара помечена", () => {
  const interests = S.scoreInterests(Q, answersFrom({ ENG: 5, PM: 4.5 }, 2));
  const matrix = S.scoreMatrix(Q, matrixOf({ physics: { like: 1 }, math: { like: 5 }, history: { like: 5 }, law: { like: 5 } }));
  const fin = S.finalize(Q, { interests, ranking: ["ENG", "PM"], statedPair: "none", matrix });
  assert.deepEqual(fin.flaggedPairs, ["MP"]);
  assert.equal(fin.status, "open");
});

test("итог: три разные пары — направление открыто", () => {
  const interests = S.scoreInterests(Q, answersFrom({ IT: 5, LAW: 5, MED: 5 }, 2));
  const matrix = S.scoreMatrix(Q, matrixOf({}));
  const fin = S.finalize(Q, { interests, ranking: ["IT", "LAW", "MED"], statedPair: "none", matrix });
  assert.equal(fin.pairs.length, 3);
  assert.ok(fin.reasons.includes("many-pairs"));
});

test("русская версия: перевод есть для каждого id и кода", () => {
  const R = Q.ru;
  assert.equal(R.interestScale.length, 5);
  assert.equal(R.agreeScale.length, 5);
  Q.fields.forEach((f) => {
    const t = R.fields[f.code];
    assert.ok(t && t.name && t.blurb, f.code);
    assert.equal(t.items.length, f.items.length, f.code);
    t.items.forEach((s) => assert.ok(s.trim(), f.code));
  });
  Q.attention.forEach((a) => assert.ok(R.attention[a.id], a.id));
  // проверка внимания ссылается на ту же метку шкалы, что и в казахской версии
  Q.attention.forEach((a) => assert.ok(R.attention[a.id].includes(R.interestScale[a.expected - 1]), a.id));
  Object.keys(Q.pairs).forEach((p) => assert.ok(R.pairs[p], p));
  Q.subjects.forEach((s) => assert.ok(R.subjects[s.key], s.key));
  Q.matrixRatings.forEach((r) => assert.ok(R.matrixRatings[r.key].short && R.matrixRatings[r.key].text, r.key));
  Q.anxiety.forEach((a) => assert.ok(R.anxiety[a.id], a.id));
  Q.open.forEach((o) => assert.ok(R.open[o.id], o.id));
});

test("интерфейс: в kk и ru одинаковый набор ключей", () => {
  const I18N = require("../site/i18n.js");
  const kk = Object.keys(I18N.kk).sort();
  assert.deepEqual(Object.keys(I18N.ru).sort(), kk);
  kk.forEach((k) => assert.equal(typeof I18N.ru[k], typeof I18N.kk[k], k));
  assert.equal(I18N.ru.stages.length, I18N.kk.stages.length);
  assert.deepEqual(Object.keys(I18N.ru.milestones), Object.keys(I18N.kk.milestones));
});

test("ровный профиль в середине шкалы — неинформативный (v2.4)", () => {
  // всё на 3: среднее 3,0 — по старому правилу проходило как «широкий»
  const flat = S.scoreInterests(Q, answersFrom({}, 3));
  assert.equal(flat.spread, 0);
  assert.equal(flat.uninformative, true);
  // почти всё на 4, одна область чуть выше: разброс меньше 0,8
  const a = answersFrom({}, 4);
  a.IT1 = 5;
  a.IT2 = 5;
  const nearlyFlat = S.scoreInterests(Q, a);
  assert.ok(nearlyFlat.spread < S.THRESHOLDS.minSpread);
  assert.equal(nearlyFlat.uninformative, true);
  // выраженный профиль остаётся информативным
  const clear = S.scoreInterests(Q, answersFrom({ IT: 5, ECO: 1 }, 3));
  assert.ok(clear.spread >= S.THRESHOLDS.minSpread);
  assert.equal(clear.uninformative, false);
});
