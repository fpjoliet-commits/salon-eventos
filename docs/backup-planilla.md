# Backup diario de la planilla

Todas las noches a las 3 se guarda una copia completa de la planilla del CRM en la
carpeta de Drive **"Backups CRM Joliet"**. Se conservan las últimas 30 (un mes);
las más viejas van a la papelera de Drive.

El código está en `scripts/backup-planilla.gs`. Corre en Google, así que
no depende de Render ni de ninguna PC.

## Instalar (una sola vez, 5 minutos)

Conviene hacerlo con la cuenta **dueña** de la planilla (fp.joliet@gmail.com):
las copias quedan en el Drive de quien lo instala.

1. Entrar a **script.google.com** → **Nuevo proyecto** (o, desde la planilla,
   **Extensiones → Apps Script**; da igual, el script busca la planilla por su id).
2. Ponerle de nombre "Backup CRM Joliet" (arriba, donde dice "Proyecto sin título").
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

## Avisos a Lautaro (desde 28/09/2026)

El mismo script avisa por Telegram si **falla el backup**, y los **lunes a las 8**
pide al CRM el resumen semanal (datos con problemas, borradores olvidados,
cargas y backups de la semana). Para activarlo:

1. En Render, cargar `TELEGRAM_CHAT_ALERTAS` (chat id de Lautaro) y `RESUMEN_SECRET`
   (cualquier texto largo al azar).
2. En script.google.com → el proyecto → ⚙ Configuración del proyecto →
   Propiedades de la secuencia de comandos: `CRM_URL` = `https://salon-eventos.onrender.com`
   y `RESUMEN_SECRET` = el mismo texto de Render.
3. Pegar la versión nueva de `scripts/backup-planilla.gs` y volver a ejecutar `instalar`
   (crea el disparador de los lunes; no duplica el diario).

Para probarlo sin esperar al lunes: elegir la función `resumenSemanal` y tocar Ejecutar.

## Vigilancia del CRM (desde 28/09/2026)

`vigilarCRM` corre cada 30 minutos en el horario en que se usa el CRM (martes a
sábado de 17:00 a 20:30) y pide `/api/salud`. Dormido no es caído: espera que Render despierte. Si el CRM no
responde dos veces seguidas (con 30 s entre una y otra, por si Render estaba
dormido), avisa por Telegram directo, sin pasar por el CRM. Avisa una sola vez
mientras siga caído, y otra cuando vuelve. Propiedades necesarias, además de
`CRM_URL`: `TELEGRAM_TOKEN` (= `TELEGRAM_BOT_TOKEN` de Render) y `TELEGRAM_CHAT`
(= `TELEGRAM_CHAT_ALERTAS`). Se activa al volver a ejecutar `instalar`.

Reemplaza a un monitor externo (UptimeRobot): no hace falta otra cuenta.
