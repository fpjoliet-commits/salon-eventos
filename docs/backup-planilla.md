# Backup diario de la planilla

Todas las noches a las 3 se guarda una copia completa de la planilla del CRM en la
carpeta de Drive **"Backups CRM Joliet"**. Se conservan las últimas 30 (un mes);
las más viejas van a la papelera de Drive.

El código está en `scripts/backup-planilla.gs`. Corre dentro de Google, así que
no depende de Render ni de ninguna PC.

## Instalar (una sola vez, 5 minutos)

Conviene hacerlo con la cuenta **dueña** de la planilla (fp.joliet@gmail.com):
las copias quedan en el Drive de quien lo instala.

1. Abrir la planilla "CRM Salón de Eventos - PLANILLA BASE".
2. Menú **Extensiones → Apps Script**. Se abre una pestaña nueva.
3. Borrar lo que haya en el editor y pegar todo el contenido de `scripts/backup-planilla.gs`.
4. Tocar el ícono de guardar (💾).
5. Arriba, en la lista de funciones, elegir **`instalar`** y tocar **Ejecutar**.
6. Google pide permiso: **Revisar permisos** → elegir la cuenta → si aparece
   "Google no verificó esta app", tocar **Configuración avanzada → Ir a (proyecto)**
   → **Permitir**. Es normal: la "app" es este script, hecho para esta planilla.
7. Abajo tiene que aparecer `Backup hecho: CRM backup 2026-...`.

## Chequear que anda

- **Ya:** en Drive existe la carpeta "Backups CRM Joliet" con una copia de hoy.
- **Mañana:** hay una segunda copia con hora 03-xx.
- En Apps Script, el reloj de la izquierda (**Activadores**) muestra `hacerBackup`, diario.

Si un backup falla, Google manda un mail a la cuenta que lo instaló.

## Restaurar

Abrir la copia de la fecha que se quiere recuperar y copiar de ahí lo que haga
falta a la planilla real. No reemplazar la planilla entera: el CRM la busca por su
id (`SPREADSHEET_ID`), y una copia tiene otro id.
