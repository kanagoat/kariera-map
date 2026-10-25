/**
 * Карточка ученика для консультации — документ Google в вашем Диске.
 *
 * Как сделать:
 *   - одну: выделите любую ячейку в строке ученика на листе Scores →
 *     «Профориентация → Карточка ученика»;
 *   - всем, у кого карточки ещё нет: «Профориентация → Карточки для всех».
 * Ссылка на документ записывается в столбец card_url листа Scores.
 *
 * Карточка — для учителя, на русском. Справочники (области, пары, группы НЦТ) — CardData.gs.
 * Содержание собирает чистая функция buildCard_ (проверяется тестами tests/cards.test.js),
 * в документ его переносит renderCardDoc_.
 */

var CARD_REASONS = {
  uninformative: 'Профиль ровный или ответы почти одинаковые: сайт не предлагал области, ученик выбирал сам.',
  wide: 'Широкий профиль: больше четырёх областей интересны почти одинаково.',
  'many-pairs': 'Выбранные области ведут больше чем к двум парам.',
  'stated-differs': 'Пара, которую ученик назвал сам, не входит в полученные.',
  'pair-disliked': 'Предмет одной из пар ученику явно неинтересен.',
};

var CARD_READINGS = {
  'like+can': ['интересно и получается', 'поддерживает пару с этим предметом'],
  'can-not-like': ['получается, но неинтересно', 'не выбирать пару только из-за хорошей оценки'],
  'like-not-can': ['интересно, но не получается', 'смотреть тревожность и срез; предмет не закрывать'],
  'keep-not-like': ['оставил бы, но неинтересно', 'выбор ради пользы или под давлением — обсудить'],
  neutral: ['без выраженного сочетания', ''],
  missing: ['не изучает', ''],
};

var CARD_ANSWERS = {
  yes: 'да', maybe: 'возможно', no: 'нет',
  must: 'без гранта учиться не сможет', prefer: 'грант желателен, но можно и платно', any: 'не важно',
  school: '10 класс', college: 'колледж', unsure: 'ещё не решил',
};

function cardSplit_(s) {
  return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
}
function cardBool_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}
function cardNum_(v) {
  if (typeof v === 'number') return v;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}
function cardFmt_(x) {
  return x === null || x === undefined ? '—' : (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
}
function cardBar_(dev) {
  if (dev === null) return '';
  var n = Math.max(0, Math.min(10, Math.round((dev + 2) * 2)));
  return new Array(n + 1).join('█') + new Array(11 - n).join('·');
}
function cardDate_(v) {
  if (v instanceof Date) return ('0' + v.getDate()).slice(-2) + '.' + ('0' + (v.getMonth() + 1)).slice(-2) + '.' + v.getFullYear();
  var m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(v || '');
}

/**
 * Содержание карточки. s — строка Scores, r — строка Responses того же submission_id (может не быть).
 * Возвращает { title, meta: [[подпись, значение]], alerts: [строки], sections: [{heading, lead?, table?, bullets?}] }.
 */
function buildCard_(s, r) {
  r = r || {};
  var fieldByKk = {};
  var fieldByCode = {};
  CARD_FIELDS.forEach(function (f) { fieldByKk[f.kk] = f; fieldByCode[f.code] = f; });
  var pairByKk = {};
  var pairByCode = {};
  CARD_PAIRS.forEach(function (p) { pairByKk[p.kk] = p; pairByCode[p.code] = p; });
  var subjByKey = {};
  CARD_SUBJECTS.forEach(function (x) { subjByKey[x.key] = x; });
  var toCodes = function (list) {
    return cardSplit_(list).map(function (n) { return fieldByKk[n] && fieldByKk[n].code; }).filter(Boolean);
  };

  var name = String(s.code_student || s.name || 'Без имени').trim();
  var grade = String(s.grade || r.grade || '');
  var valid = cardBool_(s.quality_valid);
  var ranking = toCodes(s.ranking);
  var added = String(r.added_field || '');
  var candidates = toCodes(s.candidates);
  var rejected = toCodes(s.rejected);
  var pairs = cardSplit_(s.pairs).map(function (n) { return pairByKk[n]; }).filter(Boolean);
  var flagged = cardSplit_(s.flagged_pairs);
  var stated = String(s.stated_pair || '').trim();
  var reasons = String(s.reasons || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var teacherOpen = s.teacher === 'yes' || s.teacher === 'maybe';

  var card = {
    title: 'Карточка — ' + name + (grade ? ', ' + grade + ' класс' : ''),
    meta: [
      ['Ученик', name],
      ['Класс', grade || '—'],
      ['Поток', String(s.cohort || '—')],
      ['Дата анкеты', cardDate_(s.submitted_at || s.received_at)],
      ['Язык анкеты', s.lang === 'ru' ? 'русский' : s.lang === 'kk' ? 'казахский' : '—'],
      ['Версия анкеты', String(r.version || '—')],
      ['Код', String(s.access_code || '—')],
    ],
    alerts: [],
    sections: [],
  };

  // ---------- предупреждения ----------
  if (!valid) {
    var why = [];
    var flags = String(s.quality_flags || '');
    if (flags.indexOf('attention') !== -1) why.push('провалена проверка внимания');
    if (flags.indexOf('straightline') !== -1) why.push(String(s.longest_run || '') + ' одинаковых ответов подряд');
    if (flags.indexOf('fast') !== -1) why.push('в среднем ' + cardFmt_(cardNum_(s.median_ms) / 1000) + ' с на утверждение');
    card.alerts.push('Анкета недостоверна (' + (why.join('; ') || flags) + '). Выводы ниже не опираются на внимательные ответы: лучше выдать новый код и пройти заново.');
  }
  card.alerts.push('Состояние: «' + String(s.status || '—') + '».' + (reasons.length ? ' Причины: ' + reasons.map(function (x) { return CARD_REASONS[x] || x; }).join(' ') : ''));

  // ---------- 1. профиль интересов ----------
  var rows = CARD_FIELDS.map(function (f) {
    var dev = cardNum_(s['dev_' + f.code]);
    var mark = '';
    var pos = ranking.indexOf(f.code);
    if (f.code === added) mark = 'добавил сам';
    else if (pos >= 0) mark = '№ ' + (pos + 1) + ' у ученика';
    else if (candidates.indexOf(f.code) >= 0) mark = 'возможная';
    else if (rejected.indexOf(f.code) >= 0) mark = 'сейчас неинтересно';
    return { f: f, dev: dev, mark: mark };
  }).sort(function (a, b) { return (b.dev === null ? -99 : b.dev) - (a.dev === null ? -99 : a.dev); });
  card.sections.push({
    heading: 'Профиль интересов',
    lead: 'Балл — насколько область интереснее обычного для этого ученика: 0 — его собственное среднее. ' +
      'Среднее всех ответов: ' + cardFmt_(cardNum_(s.personal_mean)) + ' из 5, разброс между областями: ' + cardFmt_(cardNum_(s.spread)) + '.',
    table: [['Область', 'Балл', '', 'Отметка']].concat(rows.map(function (x) {
      return [x.f.ru, cardFmt_(x.dev), cardBar_(x.dev), x.mark];
    })),
  });

  // ---------- 2. пары и программы ----------
  var chosen = ranking.concat(added && ranking.indexOf(added) < 0 ? [added] : []);
  var pairRows = pairs.map(function (p) {
    var from = chosen.filter(function (c) { return (CARD_FIELD_PAIRS[c] || []).indexOf(p.code) >= 0; });
    var groups = CARD_NCT_GROUPS.filter(function (g) {
      return g.pair === p.code && (from.indexOf(g.field) >= 0 || (teacherOpen && g.field === 'TEACH'));
    });
    var notes = [];
    if (flagged.indexOf(p.kk) >= 0) notes.push('предмет пары ученику неинтересен');
    if (stated === p.kk) notes.push('ученик назвал сам');
    return [
      p.ru,
      from.map(function (c) { return fieldByCode[c].ru; }).join('; '),
      groups.map(function (g) { return g.code + ' ' + g.name; }).join('\n') || '—',
      notes.join('; '),
    ];
  });
  var pairsLead = 'Пары выведены из областей, которые ученик поставил выше, по списку НЦТ.';
  if (stated && !pairs.some(function (p) { return p.kk === stated; })) {
    var sp = pairByKk[stated];
    pairsLead += ' Сам ученик назвал пару «' + (sp ? sp.ru : stated) + '» — среди возможных её нет.';
  } else if (!stated) {
    pairsLead += ' Сам ученик пару ещё не выбрал.';
  }
  if (teacherOpen) pairsLead += ' Ученик рассматривает профессию учителя — педагогические программы добавлены.';
  card.sections.push({
    heading: 'Возможные пары ЕНТ и программы',
    lead: pairsLead,
    table: [['Пара', 'Из каких областей', 'Группы программ НЦТ', 'Пометки']].concat(pairRows),
  });

  // ---------- 3. предметы ----------
  var pairSubjects = {};
  pairs.forEach(function (p) { p.subjects.forEach(function (k) { pairSubjects[k] = true; }); });
  var subjRows = CARD_SUBJECTS.slice().sort(function (a, b) {
    return (pairSubjects[b.key] ? 1 : 0) - (pairSubjects[a.key] ? 1 : 0);
  }).map(function (x) {
    var reading = String(s['read_' + x.key] || '');
    var t = CARD_READINGS[reading] || [reading, ''];
    return [x.ru + (pairSubjects[x.key] ? ' ★' : ''), t[0], t[1], cardFmt_(cardNum_(s['like_dev_' + x.key]))];
  });
  card.sections.push({
    heading: 'Школьные предметы',
    lead: '★ — предмет из возможных пар. «Интерес» — отклонение ответа «маған қызық» от среднего ученика по всем предметам. ' +
      'Отмечено «оқымаймын»: ' + (s.matrix_skipped === '' || s.matrix_skipped === undefined ? '—' : s.matrix_skipped) + '.',
    table: [['Предмет', 'Сочетание', 'Что делать', 'Интерес']].concat(subjRows),
  });

  // ---------- 4. тревожность ----------
  var fearMath = cardBool_(s.fear_math);
  var fearText = cardBool_(s.fear_text);
  card.sections.push({
    heading: 'Тревожность',
    bullets: [
      'Математика: ' + cardFmt_(cardNum_(s.anxiety_math)) + ' из 5' + (fearMath ? ' — высокая.' : '.'),
      'Письмо и устный ответ: ' + cardFmt_(cardNum_(s.anxiety_text)) + ' из 5' + (fearText ? ' — высокая.' : '.'),
    ].concat(fearMath || fearText ? ['При высокой тревожности низкий интерес к предмету — не доказательство: срез давать без оценки и таймера.'] : []),
  });

  // ---------- 5. что написал сам ----------
  var own = [
    ['О какой профессии думает', String(r.plan || '—')],
    ['Уверенность в этом выборе', r.confidence === undefined || r.confidence === '' ? '—' : r.confidence + '%'],
    ['Пара, которую назвал', stated ? (pairByKk[stated] ? pairByKk[stated].ru : stated) : 'ещё не выбрал'],
    ['Рассматривает профессию учителя', (CARD_ANSWERS[s.teacher] || '—') + (r.teacher_subject ? ' (' + r.teacher_subject + ')' : '')],
    ['Спорт или искусство профессионально', CARD_ANSWERS[s.sport_art] || '—'],
    ['Грант', CARD_ANSWERS[r.grant] || '—'],
    ['Называли «гуманитарием» / «технарём»', String(r.open_label || '—')],
    ['Нелюбимый предмет и причина', String(r.open_dislike || '—')],
  ];
  card.sections.push({ heading: 'Что ученик написал сам', table: [['Вопрос', 'Ответ']].concat(own) });

  // ---------- 6. вопросы для консультации ----------
  var q = [];
  if (!valid) q.push('Спросить, как проходил анкету (спешил, отвлекался?), и договориться пройти заново.');
  if (reasons.indexOf('uninformative') >= 0) q.push('Профиль ровный: что из списка направлений хоть немного «цепляет»? Что точно нет?');
  if (reasons.indexOf('wide') >= 0 || reasons.indexOf('many-pairs') >= 0) q.push('Направлений много: попросить выбрать одно, без которого будет жалко, и одно, от которого легко отказаться.');
  if (stated && !pairs.some(function (p) { return p.kk === stated; })) q.push('Ученик назвал другую пару: откуда этот выбор — свой интерес, совет родителей, оценки, друзья?');
  pairs.forEach(function (p) {
    if (flagged.indexOf(p.kk) >= 0) q.push('«' + p.ru + '»: предмет этой пары неинтересен. Готов ли он два года готовиться к нему?');
  });
  CARD_SUBJECTS.forEach(function (x) {
    var rd = String(s['read_' + x.key] || '');
    if (!pairSubjects[x.key]) return;
    if (rd === 'can-not-like') q.push(x.ru + ': получается, но неинтересно — не выбирать пару только из-за оценки.');
    if (rd === 'like-not-can') q.push(x.ru + ': интересно, но не получается — что мешает? Срез покажет реальный уровень.');
    if (rd === 'keep-not-like') q.push(x.ru + ': оставил бы, хотя неинтересно — ради чего? Не давление ли это?');
  });
  if (fearMath) q.push('Высокая тревожность по математике: обсудить, предложить срез без таймера.');
  if (r.grant === 'must') q.push('Без гранта учиться не сможет: смотреть проходные баллы на грант и запасную программу с меньшим конкурсом.');
  var conf = cardNum_(r.confidence);
  if (conf !== null && conf <= 30) q.push('Уверенность в выборе низкая (' + conf + '%): что помогло бы определиться?');
  if (s.sport_art === 'yes') q.push('Профессионально занимается спортом или искусством: нужен ли творческий экзамен?');
  q.push('Какие 2 программы из таблицы выше он изучил после вебинара 2? Что узнал?');
  card.sections.push({ heading: 'Вопросы для консультации', bullets: q });

  // ---------- 7. черновик roadmap ----------
  var target = pairs.length ? pairs.map(function (p) { return p.ru; }).join(' или ') : 'пара ещё не определена';
  var plan = grade === '11'
    ? [
        ['Ближайшие 2 недели', 'Закрепить пару (' + target + '); пробный тест по двум профильным предметам; выбрать 3 программы: основную, запасную и с меньшим конкурсом.'],
        ['До конца полугодия', 'Закрыть слабые темы по итогам пробника; пробник раз в месяц.'],
        ['Второе полугодие', 'Систематическая подготовка по обоим предметам; пробник каждые 2–3 недели; проверить сроки и документы на грант.'],
        ['Последние 2 месяца до ЕНТ', 'Интенсив и повторение; полный пробник ЕНТ раз в неделю.'],
      ]
    : [
        ['Ближайший месяц', 'Проверить пару (' + target + ') предметными срезами; найти кружок, курс или олимпиаду в выбранной области.'],
        ['До конца 10 класса', 'База по двум профильным предметам; пробный тест в конце года.'],
        ['Лето', 'Проба в профессии: летняя школа, волонтёрство, разговор с людьми из профессии; изучить 3–5 программ.'],
        ['11 класс', 'Если пара подтвердилась — систематическая подготовка; если нет — пересмотреть до осени.'],
      ];
  card.sections.push({ heading: 'Черновик roadmap', lead: 'Шаблон под ' + (grade || '?') + ' класс — поправьте на консультации.', table: [['Этап', 'Что сделать']].concat(plan) });

  // ---------- 8. решение ----------
  card.sections.push({
    heading: 'Решение консультации (заполняет учитель)',
    table: [['', ''], ['Итоговые пары', ''], ['Программы: основная / запасная', ''], ['Следующий шаг ученика', ''], ['Следующая встреча', ''], ['Заметки', '']],
  });

  card.footer = 'Диагностика — не валидированный тест: результат — повод для разговора, а не вывод. Опросники интересов попадают в будущую сферу примерно в 40–50% случаев.';
  return card;
}

// ---------- документ ----------

function renderCardDoc_(card) {
  var doc = DocumentApp.create(card.title);
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(48).setMarginRight(48);
  var first = body.getParagraphs()[0];
  first.setText(card.title);
  first.setHeading(DocumentApp.ParagraphHeading.TITLE);

  var meta = body.appendTable(card.meta);
  meta.setBorderWidth(0);
  for (var i = 0; i < meta.getNumRows(); i++) meta.getRow(i).getCell(0).editAsText().setBold(true).setForegroundColor('#56677f');

  card.alerts.forEach(function (a, i) {
    var bad = a.indexOf('недостоверна') !== -1;
    var text = body.appendParagraph(a).editAsText();
    text.setBold(bad);
    text.setBackgroundColor(bad ? '#fbebeb' : '#e7f1fb');
  });

  card.sections.forEach(function (sec) {
    body.appendParagraph(sec.heading).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (sec.lead) body.appendParagraph(sec.lead).editAsText().setForegroundColor('#56677f').setFontSize(10);
    if (sec.table) {
      var t = body.appendTable(sec.table);
      t.setBorderColor('#d5e3ec');
      var head = t.getRow(0);
      for (var c = 0; c < head.getNumCells(); c++) head.getCell(c).setBackgroundColor('#dff1f8').editAsText().setBold(true);
      t.editAsText().setFontSize(10);
    }
    (sec.bullets || []).forEach(function (b) { body.appendListItem(b).setGlyphType(DocumentApp.GlyphType.BULLET); });
  });
  body.appendParagraph(card.footer).editAsText().setItalic(true).setFontSize(9).setForegroundColor('#56677f');
  doc.saveAndClose();
  return doc.getUrl();
}

// ---------- меню ----------

/** Лист как массив объектов { row, values } + заголовки. */
function cardRows_(sheet) {
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(String);
  return {
    headers: headers,
    rows: data.slice(1).map(function (r, i) {
      var o = {};
      headers.forEach(function (h, j) { o[h] = r[j]; });
      return { row: i + 2, values: o };
    }),
  };
}

function cardUrlColumn_(sheet, headers) {
  var col = headers.indexOf('card_url') + 1;
  if (!col) {
    col = headers.length + 1;
    sheet.getRange(1, col).setValue('card_url').setFontWeight('bold');
  }
  return col;
}

function cardResponsesById_(ss) {
  var sh = ss.getSheetByName('Responses');
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  cardRows_(sh).rows.forEach(function (x) { out[String(x.values.submission_id)] = x.values; });
  return out;
}

function isRealSubmission_(s) {
  var id = String(s.submission_id || '');
  return id && s.status !== 'тест' && id.indexOf('selftest') !== 0;
}

/** Меню: карточка для строки, в которой стоит курсор на листе Scores. */
function makeCard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getActiveSheet();
  if (sh.getName() !== 'Scores') {
    ui.alert('Откройте лист Scores и выделите ячейку в строке ученика.');
    return;
  }
  var rowNum = ss.getActiveRange().getRow();
  if (rowNum < 2) {
    ui.alert('Выделите ячейку в строке ученика, а не в заголовке.');
    return;
  }
  var data = cardRows_(sh);
  var item = data.rows[rowNum - 2];
  if (!item || !isRealSubmission_(item.values)) {
    ui.alert('В этой строке нет анкеты ученика.');
    return;
  }
  if (item.values.card_url) {
    var ans = ui.alert('Карточка уже есть', 'Создать новую? Старый документ останется в Диске.', ui.ButtonSet.YES_NO);
    if (ans !== ui.Button.YES) return;
  }
  var url = renderCardDoc_(buildCard_(item.values, cardResponsesById_(ss)[String(item.values.submission_id)]));
  sh.getRange(rowNum, cardUrlColumn_(sh, data.headers)).setValue(url);
  ui.showModalDialog(
    HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Карточка готова.</p><p style="font-family:sans-serif"><a href="' + url + '" target="_blank">Открыть карточку</a></p>').setWidth(320).setHeight(120),
    'Карточка ученика'
  );
}

/** Меню: карточки всем ученикам, у которых их ещё нет. */
function makeCardsForAll() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Scores');
  if (!sh) return;
  var data = cardRows_(sh);
  var col = cardUrlColumn_(sh, data.headers);
  var responses = cardResponsesById_(ss);
  var started = Date.now();
  var made = 0;
  var left = 0;
  data.rows.forEach(function (x) {
    if (!isRealSubmission_(x.values) || x.values.card_url || String(x.values.cohort) === 'test') return;
    if (Date.now() - started > 4.5 * 60 * 1000) {
      left++;
      return;
    }
    var url = renderCardDoc_(buildCard_(x.values, responses[String(x.values.submission_id)]));
    sh.getRange(x.row, col).setValue(url);
    made++;
  });
  ss.toast('Создано карточек: ' + made + (left ? '. Осталось ' + left + ' — запустите ещё раз.' : '.'), 'Карточки', 8);
}

// для проверки в Node (tests/cards.test.js); в Apps Script module не определён
if (typeof module !== 'undefined') module.exports = { buildCard_: buildCard_ };
