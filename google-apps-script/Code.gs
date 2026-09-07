/**
 * FULL BLOOM · Receptor de eventos (Google Apps Script)
 *
 * Crea/usa tres pestañas:
 *   - "Eventos": una fila por respuesta, incluidos los errores previos.
 *   - "Sesiones": una fila actualizable por equipo.
 *   - "Gaps": cinco análisis QUERY que se actualizan automáticamente.
 *
 * Los eventos son idempotentes: un mismo id nunca se escribe dos veces.
 */

var EVENTS_SHEET = 'Eventos';
var SESSIONS_SHEET = 'Sesiones';
var GAPS_SHEET = 'Gaps';

var EVENT_HEADERS = [
  'id', 'fecha_hora', 'sesion', 'equipo', 'idioma',
  'fase', 'item_id', 'item', 'intento', 'elegido',
  'correcto', 'resultado', 'es_error'
];
var SESSION_HEADERS = [
  'sesion', 'equipo', 'idioma', 'inicio', 'fin',
  'candidato', 'n_eventos', 'n_errores', 'ultima_actualizacion'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('POST body is required');
    var data = JSON.parse(e.postData.contents);
    if (!data.sessionId) throw new Error('sessionId is required');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    writeEvents_(ss, data);
    upsertSession_(ss, data);
    ensureGaps_(ss);
    SpreadsheetApp.flush();
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Prueba rápida: abre la URL terminada en /exec en el navegador.
function doGet() {
  return json_({ ok: true, service: 'FullBloom sink' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function writeEvents_(ss, data) {
  var events = Array.isArray(data.events) ? data.events : [];
  var sh = sheet_(ss, EVENTS_SHEET, EVENT_HEADERS);
  if (!events.length) return;

  var seen = {};
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) seen[ids[i][0]] = true;
  }

  var rows = [];
  for (var j = 0; j < events.length; j++) {
    var ev = events[j];
    if (!ev || !ev.id || seen[ev.id]) continue;
    seen[ev.id] = true;
    rows.push([
      ev.id, ev.ts || '', ev.sessionId || data.sessionId, ev.equipo || data.alias || '', ev.idioma || data.lang || '',
      ev.fase || '', ev.itemId || '', ev.item || '', ev.intento || '', ev.elegido || '',
      ev.correcto || '', ev.resultado || 'n/a', ev.esError === true ? 1 : 0
    ]);
  }
  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, EVENT_HEADERS.length).setValues(rows);
  }
}

function upsertSession_(ss, data) {
  var sh = sheet_(ss, SESSIONS_SHEET, SESSION_HEADERS);
  var events = Array.isArray(data.events) ? data.events : [];
  var nErr = 0;
  for (var i = 0; i < events.length; i++) {
    if (events[i] && events[i].esError === true) nErr++;
  }

  var row = [
    data.sessionId, data.alias || '', data.lang || '', data.startedAt || '', data.finishedAt || '',
    (data.seleccion && data.seleccion.candidato) || '', events.length, nErr, new Date().toISOString()
  ];

  var target = 0;
  var last = sh.getLastRow();
  if (last > 1) {
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var k = 0; k < ids.length; k++) {
      if (ids[k][0] === data.sessionId) {
        target = k + 2;
        break;
      }
    }
  }
  if (target) sh.getRange(target, 1, 1, SESSION_HEADERS.length).setValues([row]);
  else sh.appendRow(row);
}

function ensureGaps_(ss) {
  var sh = ss.getSheetByName(GAPS_SHEET) || ss.insertSheet(GAPS_SHEET);
  if (sh.getMaxColumns() < 17) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 17 - sh.getMaxColumns());
  }

  var locale = String(ss.getSpreadsheetLocale() || '').toLowerCase();
  var separator = /^(es|pt)(?:[_-]|$)/.test(locale) ? ';' : ',';
  var formulas = [
    '=QUERY(Eventos!A2:M' + separator + '"select H, count(A), avg(M) where F = \'deteccion\' group by H order by avg(M) desc label H \'Competencia\', count(A) \'Intentos\', avg(M) \'Tasa error\'")',
    '=QUERY(Eventos!A2:M' + separator + '"select H, count(A) where F = \'deteccion\' and I = 1 and M = 1 group by H order by count(A) desc label H \'Competencia\', count(A) \'Fallos 1er intento\'")',
    '=QUERY(Eventos!A2:M' + separator + '"select H, J, count(A) where F = \'deteccion\' and M = 1 group by H, J order by count(A) desc label H \'Competencia\', J \'Respuesta incorrecta elegida\', count(A) \'Veces\'")',
    '=QUERY(Eventos!A2:M' + separator + '"select H, count(A), avg(M) where F = \'reto\' group by H order by avg(M) desc label H \'Reto\', count(A) \'Equipos\', avg(M) \'Tasa no óptima\'")',
    '=QUERY(Eventos!A2:M' + separator + '"select H, count(A) where F = \'ob_enfoque\' and M = 1 group by H order by count(A) desc label H \'Dimensión\', count(A) \'Equipos que omitieron acciones\'")'
  ];
  var titles = [
    'Detección · tasa de error',
    'Detección · fallos en primer intento',
    'Detección · respuestas equivocadas',
    'Retos · decisiones no óptimas',
    'Onboarding · acciones omitidas'
  ];
  var columns = [1, 5, 8, 12, 16];
  for (var i = 0; i < columns.length; i++) {
    sh.getRange(1, columns[i]).setValue(titles[i]).setFontWeight('bold');
    sh.getRange(2, columns[i]).setFormula(formulas[i]);
  }
  sh.getRange(3, 3, Math.max(1, sh.getMaxRows() - 2), 1).setNumberFormat('0.0%');
  sh.getRange(3, 14, Math.max(1, sh.getMaxRows() - 2), 1).setNumberFormat('0.0%');
  sh.setFrozenRows(1);
}
