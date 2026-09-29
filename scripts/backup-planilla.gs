/**
 * Backup diario de la planilla del CRM.
 *
 * Es un proyecto de Apps Script (script.google.com) y lo corre Google: no
 * depende de Render, que se duerme, ni de que una PC esté prendida.
 *
 * Todas las noches guarda una copia completa en la carpeta de Drive
 * "Backups CRM Joliet" y deja solo las últimas 30. Las copias quedan en el
 * Drive de la cuenta que lo instala.
 *
 * Instalación (una sola vez): pegar este archivo, elegir la función `instalar`
 * y tocar Ejecutar. Hace la primera copia en el momento. Guía completa:
 * docs/backup-planilla.md
 *
 * Avisos a Lautaro por Telegram (opcional): en Configuración del proyecto →
 * Propiedades de la secuencia de comandos, cargar CRM_URL
 * (https://salon-eventos.onrender.com) y RESUMEN_SECRET (el mismo de Render).
 * Con eso: si falla el backup avisa en el momento, y los lunes a las 8 pide al
 * CRM el resumen semanal (con cuántos backups se hicieron en la semana).
 *
 * Vigilancia del CRM: cada 30 minutos, en el horario en que se usa (martes a
 * sábado de 17:00 a 20:30), revisa que el CRM responda.
 * Si no responde, avisa DIRECTO por Telegram (no puede pasar por el CRM, que es
 * justamente lo que está caído). Necesita TELEGRAM_TOKEN y TELEGRAM_CHAT en las
 * mismas propiedades (los mismos valores que TELEGRAM_BOT_TOKEN y
 * TELEGRAM_CHAT_ALERTAS de Render). Cuando vuelve, avisa que volvió.
 */

// La planilla se busca por su id (el mismo SPREADSHEET_ID del CRM), así el script
// anda tanto dentro de la planilla como como proyecto suelto en script.google.com.
const PLANILLA_ID = '1ijCN27RaLLYUG0a6hEYwwC9rQJKrYV_KdsBEGAHULgY';
const CARPETA = 'Backups CRM Joliet';
const PREFIJO = 'CRM backup ';
const CONSERVAR = 30;
const HORA = 3; // 3 de la mañana, cuando nadie usa el CRM
const ZONA = 'America/Argentina/Buenos_Aires';

function instalar() {
  // Si se instala dos veces no se duplican los disparadores
  ScriptApp.getProjectTriggers()
    .filter(t => ['hacerBackup', 'resumenSemanal'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'vigilarCRM')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('vigilarCRM').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('hacerBackup')
    .timeBased().everyDays(1).atHour(HORA).inTimezone(ZONA)
    .create();
  ScriptApp.newTrigger('resumenSemanal')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(ZONA)
    .create();
  hacerBackup();
}

function hacerBackup() {
  try {
    const original = DriveApp.getFileById(PLANILLA_ID);
    const carpeta = carpetaDeBackups();
    const nombre = PREFIJO + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH-mm');
    original.makeCopy(nombre, carpeta);
    borrarViejos(carpeta);
    console.log('Backup hecho: ' + nombre);
  } catch (e) {
    avisarAlCRM('/api/avisos/externo', { clave: 'backup', texto: 'Falló el backup nocturno de la planilla: ' + e.message });
    throw e;   // que también quede como fallo en el registro de ejecuciones
  }
}

// Lunes 8 h: el CRM arma el resumen de la semana y se lo manda a Lautaro
function resumenSemanal() {
  const haceUnaSemana = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  let backups = 0;
  const archivos = carpetaDeBackups().getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    if (f.getName().indexOf(PREFIJO) === 0 && f.getDateCreated() >= haceUnaSemana) backups++;
  }
  avisarAlCRM('/api/avisos/resumen-semanal', { backups: backups });
}

function avisarAlCRM(ruta, cuerpo) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('CRM_URL');
  const secreto = props.getProperty('RESUMEN_SECRET');
  if (!url || !secreto) { console.log('Sin CRM_URL / RESUMEN_SECRET: no se avisa.'); return; }
  // Render gratis tarda ~50 s en despertar: UrlFetch espera hasta 60 s
  // La clave va en un encabezado, no en la URL (así no queda en los registros)
  UrlFetchApp.fetch(url + ruta, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(cuerpo), muteHttpExceptions: true,
    headers: { 'X-Aviso-Secret': secreto },
  });
}

// Cada 30 min: ¿el CRM responde? Render gratis se duerme y tarda ~50 s en
// despertar: dormido NO es caído (se espera que despierte y se reintenta a los
// 30 s). Solo en el horario en que se usa: martes a sábado, 17:00 a 20:30
// (media hora antes de abrir, para enterarse antes que Mariana).
function vigilarCRM() {
  const ahora = new Date();
  const dia = Number(Utilities.formatDate(ahora, ZONA, 'u'));   // 1 = lunes … 7 = domingo
  const minutos = Number(Utilities.formatDate(ahora, ZONA, 'H')) * 60 + Number(Utilities.formatDate(ahora, ZONA, 'm'));
  if (dia < 2 || dia > 6 || minutos < 17 * 60 || minutos > 20 * 60 + 30) return;
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('CRM_URL');
  if (!url) return;
  const anda = () => {
    try { return UrlFetchApp.fetch(url + '/api/salud', { muteHttpExceptions: true }).getResponseCode() === 200; }
    catch (e) { return false; }
  };
  const ok = anda() || (Utilities.sleep(30000), anda());
  const estabaCaido = props.getProperty('CRM_CAIDO') === '1';
  if (!ok && !estabaCaido) {
    props.setProperty('CRM_CAIDO', '1');
    telegramDirecto('🚨 CRM Joliet: el CRM no responde (o no puede leer la planilla). Revisar en dashboard.render.com');
  } else if (ok && estabaCaido) {
    props.deleteProperty('CRM_CAIDO');
    telegramDirecto('✅ CRM Joliet: el CRM volvió a responder.');
  }
}

function telegramDirecto(texto) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('TELEGRAM_TOKEN');
  const chat = props.getProperty('TELEGRAM_CHAT');
  if (!token || !chat) { console.log('Sin TELEGRAM_TOKEN / TELEGRAM_CHAT: ' + texto); return; }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chat, text: texto }), muteHttpExceptions: true,
  });
}

function carpetaDeBackups() {
  const existentes = DriveApp.getFoldersByName(CARPETA);
  return existentes.hasNext() ? existentes.next() : DriveApp.createFolder(CARPETA);
}

// Solo toca archivos con el prefijo de backup: cualquier otra cosa que alguien
// guarde en la carpeta queda intacta. Van a la papelera de Drive (30 días más).
function borrarViejos(carpeta) {
  const backups = [];
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    if (f.getName().indexOf(PREFIJO) === 0) backups.push(f);
  }
  backups
    .sort((a, b) => b.getDateCreated() - a.getDateCreated())
    .slice(CONSERVAR)
    .forEach(f => f.setTrashed(true));
}
