/**
 * Сайттан келген жауаптарды Google Sheets-ке жазатын қабылдағыш.
 *
 * Орнату: Google Sheets → Extensions → Apps Script → осы кодты қою → Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone). Толық нұсқау — README.md, 2-қадам.
 *
 * Листы (создаются сами при первой отправке):
 *   Responses — сырые ответы, одна строка на ученика
 *   Scores    — посчитанные сайтом показатели
 *   Raw       — исходный JSON каждой отправки (страховка: по нему можно пересчитать всё заново)
 */

const SHEET_RESPONSES = 'Responses';
const SHEET_SCORES = 'Scores';
const SHEET_RAW = 'Raw';
const MAX_BODY = 200000; // байт; обычная отправка занимает около 6–8 тысяч

function doGet() {
  return json_({ ok: true, service: 'proforientation', time: new Date().toISOString() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = e && e.postData ? e.postData.contents : '';
    if (!body || body.length > MAX_BODY) return json_({ ok: false, error: 'bad_size' });

    const data = JSON.parse(body);
    const responses = data.responses;
    const scores = data.scores;
    if (!responses || !scores || !responses.submission_id) return json_({ ok: false, error: 'bad_payload' });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = String(responses.submission_id);

    // повторная отправка той же анкеты (ученик нажал «қайта жіберу») не создаёт вторую строку
    if (alreadySaved_(ss, id)) return json_({ ok: true, duplicate: true });

    const received = new Date();
    appendByHeaders_(ss, SHEET_RAW, { submission_id: id, received_at: received, json: body });
    appendByHeaders_(ss, SHEET_RESPONSES, Object.assign({ received_at: received }, responses));
    appendByHeaders_(ss, SHEET_SCORES, Object.assign({ received_at: received }, scores));

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function alreadySaved_(ss, id) {
  const sheet = ss.getSheetByName(SHEET_RAW);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return true;
  }
  return false;
}

/** Пишет объект строкой; недостающие столбцы добавляет в конец заголовка. */
function appendByHeaders_(ss, name, obj) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  const lastCol = sheet.getLastColumn();
  let headers = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const keys = Object.keys(obj);
  const missing = keys.filter(function (k) { return headers.indexOf(k) === -1; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    headers = headers.concat(missing);
  }
  const row = headers.map(function (h) { return clean_(obj[h]); });
  sheet.appendRow(row);
}

/** Текст, начинающийся с = + - @, таблица приняла бы за формулу — экранируем. */
function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Запустите вручную из редактора, чтобы проверить права и создание листов. */
function selfTest() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        responses: { submission_id: 'selftest-' + Date.now(), name: 'Тест', grade: '10' },
        scores: { submission_id: 'selftest', status: 'тест' },
      }),
    },
  };
  Logger.log(doPost(fake).getContent());
}
