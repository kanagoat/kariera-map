/**
 * Одноразовые коды доступа к диагностике. Лист «Codes» — одна строка на ученика.
 *
 * Как выдать коды:
 *   1. В листе Codes впишите имена учеников в столбец student (и поток в cohort, если нужно).
 *   2. Меню «Профориентация → Выдать коды». Скрипт заполнит code, link и issued_at.
 *   3. Отправьте каждому ученику его личную ссылку из столбца link (код в ней уже есть).
 *
 * Как работает код:
 *   - при первой проверке на сайте код привязывается к устройству ученика (столбец device);
 *     на этом устройстве можно прерваться и продолжить, на другом — нельзя;
 *   - после отправки анкеты заполняются used_at и submission_id: повторно код не примут;
 *   - чтобы разрешить ученику начать заново или на другом устройстве, очистите device
 *     (и used_at с submission_id, если анкета уже была отправлена).
 */

var SHEET_CODES = 'Codes';
var SITE_URL = 'https://kanagoat.github.io/kariera-map/';
var CODE_HEADERS = ['code', 'student', 'cohort', 'link', 'issued_at', 'started_at', 'device', 'used_at', 'submission_id', 'note'];
// без похожих символов: нет 0/O, 1/I/L
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 6;

function normCode_(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function codesSheet_(ss) {
  var sh = ss.getSheetByName(SHEET_CODES);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CODES);
    sh.getRange(1, 1, 1, CODE_HEADERS.length).setValues([CODE_HEADERS]).setFontWeight('bold').setBackground('#dff1f8');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@'); // код всегда текст, иначе «23E456» станет числом
    sh.setColumnWidth(2, 220);
    sh.setColumnWidth(4, 360);
  }
  return sh;
}

/** Строки листа Codes: { row (номер строки), values {заголовок: значение} }. */
function readCodes_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var data = sh.getRange(1, 1, last, CODE_HEADERS.length).getValues();
  var headers = data[0].map(String);
  return data.slice(1).map(function (r, i) {
    var o = {};
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return { row: i + 2, values: o };
  });
}

function setCells_(sh, row, obj) {
  Object.keys(obj).forEach(function (k) {
    var col = CODE_HEADERS.indexOf(k) + 1;
    if (col > 0) sh.getRange(row, col).setValue(obj[k]);
  });
}

function findCode_(sh, code) {
  var c = normCode_(code);
  if (!c) return null;
  var rows = readCodes_(sh);
  for (var i = 0; i < rows.length; i++) {
    if (normCode_(rows[i].values.code) === c) return rows[i];
  }
  return null;
}

function newCode_(taken) {
  for (;;) {
    var s = '';
    for (var i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    if (!taken[s]) {
      taken[s] = true;
      return s;
    }
  }
}

function linkFor_(code, cohort) {
  return SITE_URL + '?' + (cohort ? 'c=' + encodeURIComponent(cohort) + '&' : '') + 'k=' + code;
}

/** Меню: выдать коды всем строкам, где есть student, но нет code. */
function issueCodes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = codesSheet_(ss);
  var rows = readCodes_(sh);
  var taken = {};
  rows.forEach(function (r) { if (r.values.code) taken[normCode_(r.values.code)] = true; });
  var n = 0;
  rows.forEach(function (r) {
    if (String(r.values.student).trim() && !String(r.values.code).trim()) {
      var code = newCode_(taken);
      setCells_(sh, r.row, { code: code, link: linkFor_(code, String(r.values.cohort || '').trim()), issued_at: new Date() });
      n++;
    }
  });
  ss.setActiveSheet(sh);
  ss.toast(n ? 'Выдано кодов: ' + n : 'Новых строк нет: впишите имена в столбец student, где code пустой.');
}

/**
 * Проверка кода с сайта (doGet ?action=check). Привязывает код к устройству при первой проверке.
 * Возвращает { ok: true, valid: true|false, reason?, cohort? }.
 */
function checkCode_(code, device) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var dev = String(device || '').slice(0, 64);
    if (!dev) return { ok: true, valid: false, reason: 'no_device' };
    var sh = codesSheet_(SpreadsheetApp.getActiveSpreadsheet());
    var r = findCode_(sh, code);
    if (!r) return { ok: true, valid: false, reason: 'not_found' };
    var v = r.values;
    if (v.used_at) return { ok: true, valid: false, reason: 'used' };
    if (v.device && String(v.device) !== dev) return { ok: true, valid: false, reason: 'other_device' };
    if (!v.device) setCells_(sh, r.row, { device: dev, started_at: new Date() });
    return { ok: true, valid: true, cohort: String(v.cohort || '') };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Проверка кода при отправке анкеты (вызывается из doPost под общей блокировкой).
 * Возвращает { error } или { row, student }.
 */
function claimCodeForSubmission_(ss, code, device, submissionId) {
  var sh = codesSheet_(ss);
  var r = findCode_(sh, code);
  if (!r) return { error: 'code_invalid' };
  var v = r.values;
  if (v.used_at && String(v.submission_id) !== submissionId) return { error: 'code_used' };
  if (v.device && String(v.device) !== String(device || '')) return { error: 'code_other_device' };
  return { sheet: sh, row: r.row, student: String(v.student || '') };
}

function markCodeUsed_(claim, submissionId) {
  setCells_(claim.sheet, claim.row, { used_at: new Date(), submission_id: submissionId });
}
