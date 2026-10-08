/**
 * Лист «Сводка»: итоги по потоку для выводов. Считается скриптом по листу Scores и записывается
 * готовыми числами (без формул: так не зависит от языка и региональных настроек таблицы).
 * Code.gs этот файл не меняет.
 *
 * Когда обновляется:
 *   - при выборе потока в ячейке B2;
 *   - из меню «Профориентация → Обновить сводку»;
 *   - каждые 10 минут, если один раз включить «Профориентация → Включить автообновление».
 * По умолчанию тестовый поток «test» не учитывается.
 * Пары и области записаны так же, как их пишет сайт в Scores (на казахском).
 */

var SHEET_SUMMARY = 'Сводка';
var ALL_NO_TEST = 'все (без test)';
var ALL = 'все';
var EMERGING = 'бағыт айқындалып келеді';
var OPEN = 'бағыт әлі ашық';

var SUMMARY_PAIRS = [
  'Математика – Физика', 'Математика – Информатика', 'Математика – География', 'Биология – Химия',
  'Биология – География', 'Химия – Физика', 'Дүниежүзі тарихы – Құқық негіздері',
  'Дүниежүзі тарихы – География', 'Шет тілі – Дүниежүзі тарихы', 'География – Шет тілі',
  'Қазақ (орыс) тілі – әдебиеті', 'Шығармашылық емтихан',
];

var SUMMARY_FIELDS = [
  ['ENG', 'Инженерия және техника'], ['PM', 'Физика және математика ғылымдары'],
  ['IT', 'Ақпараттық технологиялар'], ['ECO', 'Экономика, қаржы, басқару'],
  ['MED', 'Медицина және денсаулық'], ['BCH', 'Биология, химия, агроғылым'],
  ['PSY', 'Психология, педагогика, әлеуметтік жұмыс'], ['GEO', 'Жер және қоршаған орта'],
  ['LAW', 'Құқық'], ['HIS', 'Тарих, философия, мәдениет'],
  ['INT', 'Халықаралық қатынастар, саясат, шет тілдері'], ['PHI', 'Тіл және әдебиет'],
  ['TUR', 'Туризм және қонақжайлылық'], ['ART', 'Өнер, дизайн, медиа, сәулет'],
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Профориентация')
    .addItem('Обновить сводку', 'buildSummary')
    .addItem('Включить автообновление (каждые 10 минут)', 'enableAutoSummary')
    .addToUi();
}

/** Простой триггер: смена потока в B2 сразу пересчитывает сводку. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() === SHEET_SUMMARY && e.range.getA1Notation() === 'B2') buildSummary();
}

function enableAutoSummary() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildSummary') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildSummary').timeBased().everyMinutes(10).create();
  buildSummary();
  SpreadsheetApp.getActiveSpreadsheet().toast('Сводка будет обновляться каждые 10 минут.');
}

/** Строки листа Scores как объекты {заголовок: значение}. */
function readScores_(ss) {
  var sh = ss.getSheetByName('Scores');
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

var isTrue_ = function (v) { return v === true || String(v).toUpperCase() === 'TRUE'; };
var num_ = function (v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
};

/** Чистый подсчёт (без обращения к таблице): rows — строки Scores, cohort — выбор из B2. */
function summarize_(rows, cohort) {
  var real = rows.filter(function (r) {
    // строки selfTest пишут в Scores submission_id = "selftest" без имени — это не анкеты
    return r.submission_id && r.status !== 'тест' && String(r.submission_id).indexOf('selftest') !== 0;
  });
  var cohorts = [];
  real.forEach(function (r) {
    var c = String(r.cohort || '');
    if (c && cohorts.indexOf(c) === -1) cohorts.push(c);
  });
  cohorts.sort();

  var sel = real.filter(function (r) {
    var c = String(r.cohort || '');
    if (cohort === ALL) return true;
    if (!cohort || cohort === ALL_NO_TEST) return c !== 'test';
    return c === cohort;
  });
  var valid = sel.filter(function (r) { return isTrue_(r.quality_valid); });
  var count = function (list, fn) { return list.filter(fn).length; };
  var has = function (s, part) { return String(s || '').split(';').map(function (x) { return x.trim(); }).indexOf(part) !== -1; };
  var first = function (s) { return String(s || '').split(';')[0].trim(); };

  var general = [
    ['Анкет всего', sel.length, ''],
    ['Из них качественных (quality_valid)', valid.length, sel.length ? valid.length / sel.length : ''],
    ['«' + EMERGING + '»', count(valid, function (r) { return r.status === EMERGING; })],
    ['«' + OPEN + '»', count(valid, function (r) { return r.status === OPEN; })],
    ['Пара не совпала с названной учеником', count(valid, function (r) { return isTrue_(r.contradicts_stated); })],
    ['«Широкий» профиль', count(valid, function (r) { return isTrue_(r.wide); })],
    ['«Неинформативный» профиль', count(valid, function (r) { return isTrue_(r.uninformative); })],
    ['Тревожность: математика', count(valid, function (r) { return isTrue_(r.fear_math); })],
    ['Тревожность: письмо и устный ответ', count(valid, function (r) { return isTrue_(r.fear_text); })],
  ].map(function (row, i) {
    if (i >= 2) row[2] = valid.length ? row[1] / valid.length : '';
    return row;
  });
  general.push(['Проходили на казахском', count(sel, function (r) { return r.lang === 'kk'; }), sel.length ? count(sel, function (r) { return r.lang === 'kk'; }) / sel.length : '']);
  general.push(['Проходили на русском', count(sel, function (r) { return r.lang === 'ru'; }), sel.length ? count(sel, function (r) { return r.lang === 'ru'; }) / sel.length : '']);

  var grades = ['9', '10', '11'].map(function (g) {
    var all = sel.filter(function (r) { return String(r.grade) === g; });
    var v = all.filter(function (r) { return isTrue_(r.quality_valid); });
    var em = count(v, function (r) { return r.status === EMERGING; });
    return [g + ' класс', all.length, v.length, em, v.length ? em / v.length : ''];
  });

  var pairs = SUMMARY_PAIRS.map(function (p) {
    var offered = count(valid, function (r) { return has(r.pairs, p); });
    return [
      p,
      offered,
      valid.length ? offered / valid.length : '',
      count(valid, function (r) { return r.stated_pair === p; }),
      count(valid, function (r) { return has(r.flagged_pairs, p); }),
    ];
  });

  var fields = SUMMARY_FIELDS.map(function (f) {
    var devs = valid.map(function (r) { return num_(r['dev_' + f[0]]); }).filter(function (x) { return x !== null; });
    var mean = devs.length ? Math.round((devs.reduce(function (a, b) { return a + b; }, 0) / devs.length) * 100) / 100 : '';
    return [
      f[1],
      count(valid, function (r) { return has(r.candidates, f[1]); }),
      count(valid, function (r) { return first(r.ranking) === f[1]; }),
      mean,
    ];
  });

  return { cohorts: cohorts, general: general, grades: grades, pairs: pairs, fields: fields };
}

function buildSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_SUMMARY);
  var cohort = ALL_NO_TEST;
  if (sh) {
    cohort = String(sh.getRange('B2').getValue() || ALL_NO_TEST);
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
    sh.getRange('B2').clearDataValidations();
    sh.clear();
  } else {
    sh = ss.insertSheet(SHEET_SUMMARY, 0);
  }

  var s = summarize_(readScores_(ss), cohort);
  var options = [ALL_NO_TEST, ALL].concat(s.cohorts);
  if (options.indexOf(cohort) === -1) cohort = ALL_NO_TEST;

  var tz = ss.getSpreadsheetTimeZone();
  sh.getRange('A1').setValue('Сводка по диагностике');
  sh.getRange('D1').setValue('Обновлено: ' + Utilities.formatDate(new Date(), tz, 'dd.MM.yyyy HH:mm') +
    '. Пары и области — только по качественным анкетам (quality_valid).');
  sh.getRange('A2:B2').setValues([['Поток (cohort):', cohort]]);
  sh.getRange('B2').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build()
  );

  var r = 4;
  var block = function (header, rows, pctCols) {
    sh.getRange(r, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#dff1f8').setWrap(true).setVerticalAlignment('middle');
    if (rows.length) {
      sh.getRange(r + 1, 1, rows.length, header.length).setValues(rows);
      (pctCols || []).forEach(function (c) { sh.getRange(r + 1, c, rows.length, 1).setNumberFormat('0%'); });
    }
    var start = r;
    r += rows.length + 2;
    return start;
  };

  block(['Общее', 'Число', 'Доля'], s.general, [3]);
  block(['По классам', 'Анкет', 'Качественных', '«Айқындалып келеді»', 'Доля'], s.grades, [5]);
  var pairsRow = block(['Пары ЕНТ', 'Предложено сайтом', 'Доля учеников', 'Ученик назвал сам', 'Помечено (предмет пары не нравится)'], s.pairs, [3]);
  var fieldsRow = block(['Области интереса', 'Среди возможных', 'На 1-м месте у ученика', 'Средний личный интерес (dev)'], s.fields, []);

  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 330);
  sh.setColumnWidths(2, 4, 150);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.getRange('D1').setFontColor('#56677f').setFontStyle('italic');
  sh.getRange('A2:B2').setFontWeight('bold');
  sh.getRange('B2').setBackground('#fdf1d3');

  sh.insertChart(
    sh.newChart().asBarChart()
      .addRange(sh.getRange(pairsRow, 1, s.pairs.length + 1, 2))
      .setNumHeaders(1)
      .setPosition(4, 7, 0, 0)
      .setOption('title', 'Какие пары ЕНТ предлагает сайт')
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#0e86b4'])
      .build()
  );
  sh.insertChart(
    sh.newChart().asBarChart()
      .addRange(sh.getRange(fieldsRow, 1, s.fields.length + 1, 3))
      .setNumHeaders(1)
      .setPosition(pairsRow, 7, 0, 0)
      .setOption('title', 'Области интереса: среди возможных и на 1-м месте')
      .setOption('colors', ['#0e86b4', '#f4b740'])
      .build()
  );
}

// для проверки в Node (tests/summary.test.js); в Apps Script module не определён
if (typeof module !== 'undefined') module.exports = { summarize_: summarize_, ALL: ALL, ALL_NO_TEST: ALL_NO_TEST };
