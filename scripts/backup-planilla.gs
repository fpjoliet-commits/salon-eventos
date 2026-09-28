/**
 * Backup diario de la planilla del CRM.
 *
 * Vive DENTRO de la planilla (Extensiones → Apps Script) y lo corre Google: no
 * depende de Render, que se duerme, ni de que una PC esté prendida.
 *
 * Todas las noches guarda una copia completa en la carpeta de Drive
 * "Backups CRM Joliet" y deja solo las últimas 30. Las copias quedan en el
 * Drive de la cuenta que lo instala.
 *
 * Instalación (una sola vez): pegar este archivo, elegir la función `instalar`
 * y tocar Ejecutar. Hace la primera copia en el momento. Guía completa:
 * docs/backup-planilla.md
 */

const CARPETA = 'Backups CRM Joliet';
const PREFIJO = 'CRM backup ';
const CONSERVAR = 30;
const HORA = 3; // 3 de la mañana, cuando nadie usa el CRM
const ZONA = 'America/Argentina/Buenos_Aires';

function instalar() {
  // Si se instala dos veces no se duplica el disparador
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'hacerBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('hacerBackup')
    .timeBased().everyDays(1).atHour(HORA).inTimezone(ZONA)
    .create();
  hacerBackup();
}

function hacerBackup() {
  const original = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  const carpeta = carpetaDeBackups();
  const nombre = PREFIJO + Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd HH-mm');
  original.makeCopy(nombre, carpeta);
  borrarViejos(carpeta);
  console.log('Backup hecho: ' + nombre);
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
