// Собирает apps-script/CardData.gs из site/data/questionnaire.js и docs/nct-groups.csv.
// Запуск из корня проекта: node tools/build-card-data.js
// После правки анкеты или списка НЦТ: запустить, затем clasp push.
const fs = require("fs");
const Q = require("../site/data/questionnaire.js");

function parseCsv(text) {
  const rows = [];
  text
    .trim()
    .split(/\r?\n/)
    .forEach((line) => {
      const cells = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
          else if (ch === '"') quoted = false;
          else cur += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ",") cells.push(cur), (cur = "");
        else cur += ch;
      }
      cells.push(cur);
      rows.push(cells);
    });
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const fields = Q.fields.map((f) => ({ code: f.code, kk: f.name, ru: Q.ru.fields[f.code].name }));
const pairs = Object.keys(Q.pairs).map((p) => ({ code: p, kk: Q.pairs[p].name, ru: Q.ru.pairs[p], subjects: Q.pairs[p].subjects }));
const subjects = Q.subjects.map((s) => ({ key: s.key, kk: s.name, ru: Q.ru.subjects[s.key] }));
const groups = parseCsv(fs.readFileSync("docs/nct-groups.csv", "utf8")).map((g) => ({
  code: g.code,
  name: g.name_ru,
  pair: g.pair,
  field: g.field,
}));

const out = `/**
 * Справочники для карточки ученика (Cards.gs).
 * НЕ ПРАВИТЬ ВРУЧНУЮ: файл собирается командой node tools/build-card-data.js
 * из site/data/questionnaire.js и docs/nct-groups.csv.
 */

var CARD_FIELDS = ${JSON.stringify(fields, null, 2)};

var CARD_PAIRS = ${JSON.stringify(pairs, null, 2)};

var CARD_SUBJECTS = ${JSON.stringify(subjects, null, 2)};

// область → пары ЕНТ (как в анкете)
var CARD_FIELD_PAIRS = ${JSON.stringify(Q.fieldPairs)};

var CARD_NCT_GROUPS = ${JSON.stringify(groups)};
`;
fs.writeFileSync("apps-script/CardData.gs", out);
console.log(`CardData.gs: ${fields.length} областей, ${pairs.length} пар, ${subjects.length} предметов, ${groups.length} групп НЦТ`);
