// Запуск из корня проекта: node --test tests/cards.test.js
// Проверяет содержание карточки ученика (apps-script/Cards.gs) без Google.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const vm = require("vm");

// В Apps Script все .gs файлы — одно общее пространство имён: грузим справочник и карточку вместе.
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("apps-script/CardData.gs", "utf8"), ctx);
vm.runInContext(fs.readFileSync("apps-script/Cards.gs", "utf8"), ctx);
const buildCard = ctx.buildCard_;

const devs = { ENG: 0.6, PM: 0.7, IT: 1.4, ECO: -0.2, MED: -0.9, BCH: -0.4, PSY: -0.6, GEO: -0.3, LAW: -0.8, HIS: -0.5, INT: 0.1, PHI: -0.7, TUR: -0.4, ART: 0.0 };
const good = Object.assign(
  {
    submission_id: "abc-1", status: "бағыт әлі ашық", cohort: "lek-1", submitted_at: "2026-11-02T09:00:00.000Z",
    lang: "kk", name: "Айдана", code_student: "Айдана Серікқызы", grade: 11, reasons: "stated-differs",
    pairs: "Математика – Информатика; Математика – Физика",
    ranking: "Ақпараттық технологиялар; Физика және математика ғылымдары; Инженерия және техника",
    candidates: "Ақпараттық технологиялар; Физика және математика ғылымдары; Инженерия және техника",
    rejected: "Медицина және денсаулық; Құқық", stated_pair: "Биология – Химия", contradicts_stated: true,
    flagged_pairs: "", quality_valid: true, quality_flags: "", personal_mean: 2.9, spread: 2.3,
    anxiety_math: 4.3, anxiety_text: 2, fear_math: true, fear_text: false,
    read_math: "like+can", like_dev_math: 1.1, read_physics: "can-not-like", like_dev_physics: -0.6,
    read_informatics: "like+can", like_dev_informatics: 1.3, read_biology: "neutral", like_dev_biology: -0.2,
    teacher: "no", sport_art: "no", access_code: "K7PM3Q", matrix_skipped: 1,
  },
  Object.fromEntries(Object.entries(devs).map(([k, v]) => ["dev_" + k, v]))
);
const goodResp = { submission_id: "abc-1", version: "v2.5", plan: "IT", confidence: 30, grant: "must", added_field: "", open_label: "", open_dislike: "" };

const section = (card, h) => card.sections.find((s) => s.heading === h);

test("карточка: заголовок, мета и состояние", () => {
  const c = buildCard(good, goodResp);
  assert.equal(c.title, "Карточка — Айдана Серікқызы, 11 класс");
  assert.equal(c.meta.find((m) => m[0] === "Дата анкеты")[1], "02.11.2026");
  assert.equal(c.alerts.length, 1, "достоверная анкета — только строка состояния");
  assert.match(c.alerts[0], /не входит в полученные/);
});

test("карточка: профиль отсортирован, отметки ученика стоят", () => {
  const t = section(buildCard(good, goodResp), "Профиль интересов").table;
  assert.equal(t.length, 15);
  assert.equal(t[1][0], "Информационные технологии");
  assert.equal(t[1][3], "№ 1 у ученика");
  assert.ok(t.find((r) => r[0] === "Право")[3] === "сейчас неинтересно");
});

test("карточка: пары с областями и группами НЦТ", () => {
  const t = section(buildCard(good, goodResp), "Возможные пары ЕНТ и программы").table;
  const mi = t.find((r) => r[0] === "Математика – Информатика");
  assert.equal(mi[1], "Информационные технологии");
  assert.match(mi[2], /^B\d{3} /);
  const mp = t.find((r) => r[0] === "Математика – Физика");
  assert.match(mp[1], /Физико-математические науки/);
  assert.match(mp[1], /Инженерия и техника/);
  // ученик не рассматривает профессию учителя — педагогических программ нет
  assert.ok(!/Подготовка учителей/.test(mp[2]));
});

test("карточка: вопросы для консультации по флагам", () => {
  const q = section(buildCard(good, goodResp), "Вопросы для консультации").bullets.join("\n");
  assert.match(q, /назвал другую пару/);
  assert.match(q, /Физика: получается, но неинтересно/);
  assert.match(q, /тревожность по математике/);
  assert.match(q, /Без гранта/);
  assert.match(q, /Уверенность в выборе низкая \(30%\)/);
});

test("карточка: roadmap зависит от класса", () => {
  const r11 = section(buildCard(good, goodResp), "Черновик roadmap").table;
  assert.equal(r11[1][0], "Ближайшие 2 недели");
  const r10 = section(buildCard(Object.assign({}, good, { grade: 10 }), goodResp), "Черновик roadmap").table;
  assert.equal(r10[1][0], "Ближайший месяц");
});

test("карточка: педагогические программы, если рассматривает профессию учителя", () => {
  const t = section(buildCard(Object.assign({}, good, { teacher: "maybe" }), goodResp), "Возможные пары ЕНТ и программы").table;
  assert.match(t.find((r) => r[0] === "Математика – Информатика")[2], /Подготовка учителей информатики/);
});

test("карточка: недостоверная анкета — предупреждение первым", () => {
  const bad = Object.assign({}, good, { quality_valid: false, quality_flags: "attention, straightline, fast", longest_run: 27, median_ms: 789 });
  const c = buildCard(bad, null);
  assert.match(c.alerts[0], /недостоверна/);
  assert.match(c.alerts[0], /27 одинаковых ответов подряд/);
  assert.match(c.alerts[0], /0,79 с/);
  assert.match(section(c, "Вопросы для консультации").bullets[0], /пройти заново/);
});
