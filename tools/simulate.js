// Симуляция: помогает ли адаптивный этап 2 (v3.0) точнее находить пары ЕНТ, чем v2.2.
// Запуск из корня проекта: node tools/simulate.js [число учеников на условие, по умолчанию 4000]
//
// Модель ученика (все числа — допущения, их стоит пересмотреть после пилота):
//   θ_f   — истинный интерес к области: N(0; 0,5), у 1–3 областей добавка U(0,8; 1,8)
//   b     — склонность завышать или занижать все ответы: N(0; 0,4)
//   ответ = округл(3 + b + a·θ_f + сдвиг_утверждения + шум), обрезка в 1..5
//   a     — различающая сила утверждения U(0,6; 1,4), сдвиг — N(0; 0,3), шум — N(0; σ)
// «Истина» — те же правила отбора, применённые к θ без шума. Развилки: у GEO и BCH есть
// скрытое предпочтение ветки δ; истинная ветка — та, что выше на 1 и больше.
//
// Сравниваются: v2.2 (только этап 1), v3.0 (этап 2), контроль (столько же доп. вопросов,
// но по случайным областям). Контроль отделяет пользу адаптивности от пользы «просто больше вопросов».

const Q = require("../site/data/questionnaire.js");
const A = require("../site/data/adaptive.js");
const S = require("../site/scoring.js");
const AD = require("../site/adaptive.js");

const N = Number(process.argv[2]) || 4000;
const CODES = Q.fields.map((f) => f.code);

function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  return { u, n };
}

// параметры утверждений фиксированы для всего прогона (один «банк»)
function makeBank(r) {
  const bank = {};
  const add = (id) => (bank[id] = { a: 0.6 + 0.8 * r.u(), off: 0.3 * r.n() });
  CODES.forEach((c) => {
    for (let i = 1; i <= 4; i++) add(c + i);
    A.deep[c].forEach((it) => add(it.id));
  });
  Object.values(A.forks).forEach((fk) => Object.values(fk.branches).forEach((list) => list.forEach((it) => add(it.id))));
  return bank;
}

function makeStudent(r) {
  const theta = {};
  CODES.forEach((c) => (theta[c] = 0.5 * r.n()));
  const k = r.u() < 0.35 ? 1 : r.u() < 0.6 ? 2 : 3;
  const pool = CODES.slice();
  for (let i = 0; i < k; i++) {
    const c = pool.splice(Math.floor(r.u() * pool.length), 1)[0];
    theta[c] += 0.8 + r.u();
  }
  return { theta, b: 0.4 * r.n(), delta: { GEO: 0.9 * r.n(), BCH: -0.4 + 0.9 * r.n() } };
}

function respond(r, bank, st, id, latent, sigma) {
  const p = bank[id];
  const y = 3 + st.b + p.a * latent + p.off + sigma * r.n();
  return Math.min(5, Math.max(1, Math.round(y)));
}

// латентный интерес для утверждения (ветки развилок — θ области ± δ/2)
function latentFor(st, item) {
  if (item.kind === "fork") {
    const fk = A.forks[item.field];
    const [p1] = Object.keys(fk.branches);
    const sign = item.branch === p1 ? 1 : -1;
    // для BCH δ = предпочтение CP над BC; p1 = BC
    const d = item.field === "BCH" ? -st.delta.BCH : st.delta.GEO;
    return st.theta[item.field] + (sign * d) / 2;
  }
  return st.theta[item.field];
}

function truth(st) {
  const m = CODES.reduce((s, c) => s + st.theta[c], 0) / CODES.length;
  const dev = {};
  CODES.forEach((c) => (dev[c] = st.theta[c] - m));
  const sel = S.selectCandidates(Q, dev);
  const fp = {};
  if (st.delta.GEO >= 1) fp.GEO = ["BG"];
  else if (st.delta.GEO <= -1) fp.GEO = ["MG"];
  if (st.delta.BCH >= 1) fp.BCH = ["BC", "CP"];
  return { shown: sel.shown, pairs: pairsOf(sel.shown, fp), top: sel.shown[0], fp };
}

function pairsOf(fields, overrides) {
  const out = new Set();
  fields.forEach((c) => ((overrides && overrides[c]) || Q.fieldPairs[c]).forEach((p) => out.add(p)));
  return out;
}

// неинформативный профиль: ученик сам выбирает две области — считаем, что выбирает свои истинные верхние
function shownOrChoice(s, tr) {
  return s.uninformative ? tr.shown.slice(0, 2) : s.shown;
}

function runOne(r, bank, sigma, zone) {
  const st = makeStudent(r);
  const tr = truth(st);
  const answers = {};
  CODES.forEach((c) => {
    for (let i = 1; i <= 4; i++) answers[c + i] = respond(r, bank, st, c + i, st.theta[c], sigma);
  });
  const s1 = S.scoreInterests(Q, answers);
  const out = {};

  // v2.2
  const shown1 = shownOrChoice(s1, tr);
  out.v2 = { shown: shown1, pairs: pairsOf(shown1), extra: 0 };

  // v3.0
  const plan = AD.planRound1(Q, A, s1, { zone });
  const a3 = Object.assign({}, answers);
  plan.items.forEach((it) => (a3[it.id] = respond(r, bank, st, it.id, latentFor(st, it), sigma)));
  const s2 = plan.borderline.length ? AD.rescore(Q, A, s1, a3, plan.borderline) : s1;
  const shown2 = shownOrChoice(s2, tr);
  const budget = plan.items.length ? AD.ADAPT.maxItems - plan.items.length - 1 : AD.ADAPT.maxItems;
  const forks = s2.uninformative ? [] : AD.planForks(A, shown2, budget);
  forks.forEach((it) => (a3[it.id] = respond(r, bank, st, it.id, latentFor(st, it), sigma)));
  const fp = AD.resolveForks(A, a3, shown2);
  const extra3 = plan.items.length + (plan.items.length ? 1 : 0) + forks.length;
  out.v3 = { shown: shown2, pairs: pairsOf(shown2, fp), extra: extra3, borderline: plan.borderline.length, forks: forks.length };
  // v3.0 без развилок: только пограничные области
  out.v3nf = { shown: shown2, pairs: pairsOf(shown2), extra: plan.items.length };

  // контроль: столько же доп. углубляющих вопросов, но по случайным не-лидирующим областям
  const nDeep = plan.items.length;
  const ac = Object.assign({}, answers);
  let blc = [];
  if (nDeep) {
    const leader = CODES.reduce((b, c) => (s1.dev[c] > s1.dev[b] ? c : b));
    const pool = CODES.filter((c) => c !== leader);
    for (let i = 0; i < nDeep / 3; i++) blc.push(pool.splice(Math.floor(r.u() * pool.length), 1)[0]);
    blc.forEach((c) => A.deep[c].forEach((it) => (ac[it.id] = respond(r, bank, st, it.id, st.theta[c], sigma))));
  }
  const sc = blc.length ? AD.rescore(Q, A, s1, ac, blc) : s1;
  const shownC = shownOrChoice(sc, tr);
  out.ctrl = { shown: shownC, pairs: pairsOf(shownC), extra: nDeep };

  return { tr, out };
}

function metrics(rows, key) {
  let exact = 0, rec = 0, prec = 0, topHit = 0, fieldFP = 0, fieldFN = 0, extra = 0, asked = 0;
  rows.forEach(({ tr, out }) => {
    const o = out[key];
    const inter = [...o.pairs].filter((p) => tr.pairs.has(p)).length;
    if (inter === o.pairs.size && inter === tr.pairs.size) exact++;
    rec += inter / tr.pairs.size;
    prec += o.pairs.size ? inter / o.pairs.size : 0;
    const topPairs = (tr.fp[tr.top] || Q.fieldPairs[tr.top]);
    if (topPairs.some((p) => o.pairs.has(p))) topHit++;
    fieldFP += o.shown.filter((c) => !tr.shown.includes(c)).length;
    fieldFN += tr.shown.filter((c) => !o.shown.includes(c)).length;
    extra += o.extra;
    if (o.extra) asked++;
  });
  const n = rows.length;
  const pct = (x) => (100 * x / n).toFixed(1) + "%";
  return {
    "Пары совпали полностью": pct(exact),
    "Найдено истинных пар": pct(rec),
    "Точность пар": pct(prec),
    "Пара главной области найдена": pct(topHit),
    "Лишних областей на ученика": (fieldFP / n).toFixed(2),
    "Пропущенных областей на ученика": (fieldFN / n).toFixed(2),
    "Доп. вопросов в среднем": (extra / n).toFixed(1),
    "Кому задан этап 2": pct(asked),
  };
}

function table(title, cols) {
  const keys = Object.keys(Object.values(cols)[0]);
  const names = Object.keys(cols);
  const lines = [`### ${title}`, "", "| Показатель | " + names.join(" | ") + " |", "|---|" + names.map(() => "---:").join("|") + "|"];
  keys.forEach((k) => lines.push(`| ${k} | ` + names.map((n) => cols[n][k]).join(" | ") + " |"));
  return lines.join("\n");
}

const out = [];
const summary = [];
for (const sigma of [0.8, 1.1, 1.4]) {
  for (const zone of [0.2, 0.3, 0.45]) {
    const r = rng(20261008 + Math.round(sigma * 100) * 7 + Math.round(zone * 100));
    const bank = makeBank(rng(42));
    const rows = [];
    for (let i = 0; i < N; i++) rows.push(runOne(r, bank, sigma, zone));
    const cols = { "v2.2": metrics(rows, "v2"), "v3.0": metrics(rows, "v3"), "v3.0 без развилок": metrics(rows, "v3nf"), "контроль": metrics(rows, "ctrl") };
    if (zone === 0.3) out.push(table(`Шум σ = ${sigma}, зона = ${zone}`, cols));
    summary.push(
      `| ${sigma} | ${zone} | ${cols["v2.2"]["Пары совпали полностью"]} | ${cols["v3.0"]["Пары совпали полностью"]} | ${cols["контроль"]["Пары совпали полностью"]} | ${cols["v3.0"]["Доп. вопросов в среднем"]} |`
    );
  }
}

console.log(`Учеников на условие: ${N}\n`);
console.log(out.join("\n\n"));
console.log("\n### Чувствительность: доля полного совпадения пар\n");
console.log("| Шум σ | Зона | v2.2 | v3.0 | контроль | Доп. вопросов v3.0 |\n|---:|---:|---:|---:|---:|---:|");
console.log(summary.join("\n"));
