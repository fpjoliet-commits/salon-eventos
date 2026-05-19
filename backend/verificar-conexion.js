require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

let credenciales = null;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  credenciales = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
} else {
  const KEY_PATH = path.resolve(__dirname, './credentials.json');
  if (fs.existsSync(KEY_PATH)) credenciales = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
}

console.log('\n🔍 Verificando conexión con Google Sheets...\n');
if (!credenciales) {
  console.error('❌ No hay credenciales. Poné credentials.json en esta carpeta o configurá GOOGLE_CREDENTIALS_JSON.\n');
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: credenciales,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

google.sheets({ version: 'v4', auth }).spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
  .then(res => {
    console.log('✅ Conexión exitosa! Planilla:', res.data.properties.title);
    res.data.sheets.forEach(s => console.log('   -', s.properties.title));
    console.log('\n🎉 Reiniciá el servidor con: node server.js\n');
  })
  .catch(e => {
    if (e.code === 403) console.error('❌ Sin permiso. Compartí la planilla con el email de la cuenta de servicio.');
    else if (e.code === 401) console.error('❌ Credenciales inválidas.');
    else console.error('❌ Error:', e.message);
    process.exit(1);
  });
