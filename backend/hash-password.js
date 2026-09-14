// Genera el hash bcrypt de una contraseña, para pegar en las variables de
// entorno PASSWORD_SUPERADMIN / PASSWORD_ADMIN / PASSWORD_EMPLEADO.
//
// Uso:
//   node backend/hash-password.js "miContraseñaNueva"
//
// El resultado (empieza con $2b$...) es lo que va en la variable de entorno,
// nunca la contraseña en texto plano.

const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Uso: node backend/hash-password.js "tuContraseña"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
console.log(hash);
