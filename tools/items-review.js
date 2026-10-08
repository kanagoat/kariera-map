// Собирает docs/adaptive-items.md из site/data/adaptive.js — таблица для вычитки владельцем.
// Запуск из корня проекта: node tools/items-review.js
const fs = require("fs");
const Q = require("../site/data/questionnaire.js");
const A = require("../site/data/adaptive.js");
const name = Object.fromEntries(Q.fields.map((f) => [f.code, f.name]));
const row = (it) => `| \`${it.id}\` | ${it.kk} | ${it.ru} |`;
const head = "| id | Қазақша | Русский |\n|---|---|---|";
const out = [
  "# Вопросы этапа 2 — на вычитку",
  "",
  "Файл собран автоматически из `site/data/adaptive.js` (`node tools/items-review.js`). Правки пишите",
  "сюда или в чат — перенесу в источник. Тексты на обоих языках писал ИИ.",
  "",
  "## 1. Углубляющие утверждения (шкала «қаншалықты қызық», 1–5)",
  "",
  "Задаются только по пограничным областям, вперемешку и без названия области.",
];
Q.fields.forEach((f) => out.push("", `### ${f.code} — ${name[f.code]}`, "", head, ...A.deep[f.code].map(row)));
out.push("", "## 2. Развилки внутри области (шкала 1–5)", "");
Object.keys(A.forks).forEach((c) => {
  Object.keys(A.forks[c].branches).forEach((p) =>
    out.push(`### ${c} → ${Q.pairs[p].name}`, "", head, ...A.forks[c].branches[p].map(row), "")
  );
});
out.push("## 3. Практические условия (иә / мүмкін / жоқ), по широким направлениям", "");
Object.keys(A.directions).forEach((d) => {
  const dir = A.directions[d];
  out.push(`### ${dir.kk} / ${dir.ru} (${dir.fields.join(", ")})`, "", head, ...A.practical[d].map(row), "");
});
out.push("## 4. Тексты экранов", "", "| Ключ | Қазақша | Русский |", "|---|---|---|");
Object.keys(A.ui.kk).forEach((k) => out.push(`| ${k} | ${A.ui.kk[k]} | ${A.ui.ru[k]} |`));
fs.writeFileSync("docs/adaptive-items.md", out.join("\n") + "\n");
console.log("docs/adaptive-items.md:", out.length, "строк");
