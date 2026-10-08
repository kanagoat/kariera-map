// Запуск из корня проекта: node --test tests/summary.test.js
// Проверяет подсчёт листа «Сводка» (apps-script/Summary.gs) без Google.
const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize_, ALL, ALL_NO_TEST } = require("../apps-script/Summary.gs");

const row = (o) =>
  Object.assign(
    { submission_id: "x" + Math.random(), cohort: "lek-1", lang: "kk", grade: "10", status: "бағыт айқындалып келеді",
      quality_valid: true, pairs: "Математика – Информатика", candidates: "Ақпараттық технологиялар",
      ranking: "Ақпараттық технологиялар; Инженерия және техника", stated_pair: "", flagged_pairs: "",
      contradicts_stated: false, wide: false, uninformative: false, fear_math: false, fear_text: false, dev_IT: 2 },
    o
  );

const rows = [
  { submission_id: "selftest", status: "тест" },
  row({ cohort: "test" }),
  row({}),
  row({ lang: "ru", grade: "9", status: "бағыт әлі ашық", pairs: "Математика – Физика; Химия – Физика", dev_IT: "1,0",
        ranking: "Инженерия және техника", fear_math: true, quality_valid: "TRUE" }),
  row({ quality_valid: false, pairs: "Биология – Химия" }),
  row({ cohort: "lek-2", grade: "11" }),
];
const get = (s, name) => s.general.find((g) => g[0] === name);

test("сводка: по умолчанию без test и без строк selfTest", () => {
  const s = summarize_(rows, ALL_NO_TEST);
  assert.deepEqual(s.cohorts, ["lek-1", "lek-2", "test"]);
  assert.equal(get(s, "Анкет всего")[1], 4);
  assert.equal(get(s, "Из них качественных (quality_valid)")[1], 3);
  assert.equal(get(s, "Проходили на русском")[1], 1);
  assert.equal(get(s, "Тревожность: математика")[1], 1);
});

test("сводка: пары и области считаются только по качественным анкетам", () => {
  const s = summarize_(rows, "lek-1");
  const pair = (p) => s.pairs.find((x) => x[0] === p);
  assert.equal(pair("Математика – Информатика")[1], 1);
  assert.equal(pair("Математика – Физика")[1], 1);
  assert.equal(pair("Химия – Физика")[1], 1);
  assert.equal(pair("Биология – Химия")[1], 0); // анкета с quality_valid = false
  const it = s.fields.find((f) => f[0] === "Ақпараттық технологиялар");
  assert.equal(it[2], 1); // на 1-м месте
  assert.equal(it[3], 1.5); // среднее dev: 2 и «1,0»
  assert.deepEqual(s.grades.map((g) => g[1]), [1, 2, 0]);
});

test("сводка: «все» включает test", () => {
  assert.equal(get(summarize_(rows, ALL), "Анкет всего")[1], 5);
});
