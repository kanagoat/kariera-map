/**
 * Лист «Сводка»: итоги по потоку для выводов. Всё считается формулами из листа Scores,
 * поэтому сводка обновляется сама при каждой новой анкете. Code.gs этот файл не меняет.
 *
 * Меню таблицы «Профориентация → Пересобрать сводку» создаёт лист заново
 * (нужно, например, если добавились новые столбцы или лист удалили).
 * В ячейке B2 выбирается поток (cohort). По умолчанию тестовый поток «test» не учитывается.
 *
 * Пары и области здесь записаны так же, как их пишет сайт в Scores (на казахском).
 */

const SHEET_SUMMARY = 'Сводка';
const ALL_NO_TEST = 'все (без test)';
const ALL = 'все';

const SUMMARY_PAIRS = [
  'Математика – Физика', 'Математика – Информатика', 'Математика – География', 'Биология – Химия',
  'Биология – География', 'Химия – Физика', 'Дүниежүзі тарихы – Құқық негіздері',
  'Дүниежүзі тарихы – География', 'Шет тілі – Дүниежүзі тарихы', 'География – Шет тілі',
  'Қазақ (орыс) тілі – әдебиеті', 'Шығармашылық емтихан',
];

const SUMMARY_FIELDS = [
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
    .addItem('Пересобрать сводку', 'buildSummary')
    .addToUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_SUMMARY) && ss.getSheetByName(SHEET_SCORES)) buildSummary();
}

/** Столбец листа Scores по имени заголовка. */
function col_(name) {
  return 'INDEX(Scores!$A:$ZZ,0,MATCH("' + name + '",Scores!$1:$1,0))';
}

function buildSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_SCORES)) {
    throw new Error('Листа Scores ещё нет: сначала запустите selfTest или дождитесь первой анкеты.');
  }
  let sh = ss.getSheetByName(SHEET_SUMMARY);
  if (sh) {
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
    sh.clear();
    sh.getDataRange().clearDataValidations();
  } else {
    sh = ss.insertSheet(SHEET_SUMMARY, 0);
  }

  // базовые условия: настоящая строка (есть submission_id, не заголовок) + выбранный поток
  const BASE = col_('submission_id') + ',"?*",' + col_('submission_id') + ',"<>submission_id",' + col_('cohort') + ',$B$3';
  const VALID = BASE + ',' + col_('quality_valid') + ',TRUE';
  const cnt = function (extra, onlyValid) {
    return '=IFERROR(COUNTIFS(' + (onlyValid ? VALID : BASE) + (extra ? ',' + extra : '') + '),0)';
  };
  const share = function (num, den) { return '=IFERROR(' + num + '/' + den + ',0)'; };

  const rows = [];
  const put = function (r, values) { rows.push([r, values]); };

  put(1, ['Сводка по диагностике', '', '', 'Считается только по листу Scores. Строки с quality_valid = FALSE в разборе пар и областей не участвуют.']);
  put(2, ['Поток (cohort):', ALL_NO_TEST]);
  put(3, ['', '=IF(B2="' + ALL + '","*",IF(B2="' + ALL_NO_TEST + '","<>test",B2))']);

  put(5, ['Общее', 'Число', 'Доля']);
  put(6, ['Анкет всего', cnt('', false), '']);
  put(7, ['Из них качественных (quality_valid)', cnt('', true), share('B7', 'B6')]);
  put(8, ['«Бағыт айқындалып келеді»', cnt(col_('status') + ',"бағыт айқындалып келеді"', true), share('B8', 'B7')]);
  put(9, ['«Бағыт әлі ашық»', cnt(col_('status') + ',"бағыт әлі ашық"', true), share('B9', 'B7')]);
  put(10, ['Пара не совпала с названной учеником', cnt(col_('contradicts_stated') + ',TRUE', true), share('B10', 'B7')]);
  put(11, ['«Широкий» профиль', cnt(col_('wide') + ',TRUE', true), share('B11', 'B7')]);
  put(12, ['«Неинформативный» профиль', cnt(col_('uninformative') + ',TRUE', true), share('B12', 'B7')]);
  put(13, ['Тревожность: математика', cnt(col_('fear_math') + ',TRUE', true), share('B13', 'B7')]);
  put(14, ['Тревожность: письмо и устный ответ', cnt(col_('fear_text') + ',TRUE', true), share('B14', 'B7')]);
  put(15, ['Проходили на казахском', cnt(col_('lang') + ',"kk"', false), share('B15', 'B6')]);
  put(16, ['Проходили на русском', cnt(col_('lang') + ',"ru"', false), share('B16', 'B6')]);

  put(18, ['По классам', 'Анкет', 'Качественных', '«Айқындалып келеді»', 'Доля']);
  ['9', '10', '11'].forEach(function (g, i) {
    const r = 19 + i;
    const gr = col_('grade') + ',"' + g + '"';
    put(r, [g + ' класс', cnt(gr, false), cnt(gr, true), cnt(gr + ',' + col_('status') + ',"бағыт айқындалып келеді"', true), share('D' + r, 'C' + r)]);
  });

  const P0 = 24;
  put(P0 - 1, ['Пары ЕНТ (только качественные анкеты)', 'Предложено сайтом', 'Доля учеников', 'Ученик назвал сам', 'Помечено (предмет пары не нравится)']);
  SUMMARY_PAIRS.forEach(function (p, i) {
    const r = P0 + i;
    put(r, [
      p,
      cnt(col_('pairs') + ',"*' + p + '*"', true),
      share('B' + r, '$B$7'),
      cnt(col_('stated_pair') + ',"' + p + '"', true),
      cnt(col_('flagged_pairs') + ',"*' + p + '*"', true),
    ]);
  });

  const F0 = P0 + SUMMARY_PAIRS.length + 2;
  put(F0 - 1, ['Области интереса (только качественные)', 'Среди возможных', 'На 1-м месте у ученика', 'Средний личный интерес (dev)']);
  SUMMARY_FIELDS.forEach(function (f, i) {
    const r = F0 + i;
    put(r, [
      f[1],
      cnt(col_('candidates') + ',"*' + f[1] + '*"', true),
      cnt(col_('ranking') + ',"' + f[1] + '*"', true),
      '=IFERROR(ROUND(AVERAGEIFS(' + col_('dev_' + f[0]) + ',' + VALID + '),2),"")',
    ]);
  });

  rows.forEach(function (item) {
    const r = item[0];
    const v = item[1];
    const range = sh.getRange(r, 1, 1, v.length);
    range.setValues([v.map(function (x) { return typeof x === 'string' && x.charAt(0) === '=' ? '' : x; })]);
    v.forEach(function (x, j) {
      if (typeof x === 'string' && x.charAt(0) === '=') sh.getRange(r, j + 1).setFormula(x);
    });
  });

  // выпадающий список потоков (в скрытом столбце Z)
  sh.getRange('Z1').setFormula(
    '={"' + ALL_NO_TEST + '";"' + ALL + '";IFERROR(SORT(UNIQUE(FILTER(' + col_('cohort') + ',ROW(' + col_('cohort') + ')>1,' +
      col_('cohort') + '<>""))),"")}'
  );
  sh.getRange('B2').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange('Z1:Z200'), true).setAllowInvalid(false).build()
  );
  sh.hideColumns(26);
  sh.hideRows(3);

  // оформление
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 330);
  sh.setColumnWidths(2, 4, 150);
  sh.getRange('A1').setFontSize(16).setFontWeight('bold');
  sh.getRange('D1').setFontColor('#56677f').setFontStyle('italic');
  sh.getRange('A2:B2').setFontWeight('bold');
  sh.getRange('B2').setBackground('#fdf1d3');
  [5, 18, P0 - 1, F0 - 1].forEach(function (r) {
    sh.getRange(r, 1, 1, 5).setFontWeight('bold').setBackground('#dff1f8').setWrap(true);
  });
  sh.getRange('C6:C16').setNumberFormat('0%');
  sh.getRange('E19:E21').setNumberFormat('0%');
  sh.getRange(P0, 3, SUMMARY_PAIRS.length, 1).setNumberFormat('0%');

  // диаграммы
  sh.insertChart(
    sh.newChart().asBarChart()
      .addRange(sh.getRange(P0 - 1, 1, SUMMARY_PAIRS.length + 1, 2))
      .setPosition(5, 7, 0, 0)
      .setOption('title', 'Какие пары ЕНТ предлагает сайт')
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#0e86b4'])
      .setNumHeaders(1)
      .build()
  );
  sh.insertChart(
    sh.newChart().asBarChart()
      .addRange(sh.getRange(F0 - 1, 1, SUMMARY_FIELDS.length + 1, 3))
      .setPosition(P0 + 4, 7, 0, 0)
      .setOption('title', 'Области интереса: среди возможных и на 1-м месте')
      .setOption('colors', ['#0e86b4', '#f4b740'])
      .setNumHeaders(1)
      .build()
  );

  ss.setActiveSheet(sh);
}
