# Bot de Telegram — carga de cobros y gastos por audio

Cada padre le manda un **audio** (o texto) a su chat de Telegram contando un cobro
o un gasto. El bot lo interpreta con IA y crea un **borrador** que cae en la bandeja
**"Por confirmar"** del CRM. Nadie carga nada definitivo: un admin revisa, corrige y confirma.

El bot queda **dormido** hasta que estén las variables de entorno. Sin ellas, no afecta
al resto de la app (arranca y avisa `🤖 Bot de Telegram inactivo`).

## 1. Crear el bot (una vez)

1. En Telegram, abrí **@BotFather**.
2. Enviá `/newbot`, elegí un nombre y un usuario (termina en `bot`).
3. BotFather te da el **token** (algo tipo `123456:ABC-DEF...`). Ese es `TELEGRAM_BOT_TOKEN`.

## 2. Conseguir la API key de IA (gratis)

1. Entrá a **https://aistudio.google.com/apikey** con tu cuenta de Google.
2. "Create API key" → copiala. Esa es `GEMINI_API_KEY` (capa gratuita, alcanza y sobra).

## 3. Saber el chat de cada padre (para autorizarlos)

Solo los chats habilitados pueden cargar (seguridad). Para saber el `chat_id`:

**Forma fácil (recomendada):** la persona le escribe al bot (buscando `@joliet_mov_bot`
o el link `https://t.me/<usuario_del_bot>`). Como todavía no está habilitada, el bot
le responde con **su propio número de chat**. Te lo pasa y lo cargás. Sin webhook ni getUpdates.

**Forma manual (con webhook activo, getUpdates viene vacío):** apagá el webhook con
`https://api.telegram.org/bot<TOKEN>/deleteWebhook`, que la persona mande "hola",
abrí `https://api.telegram.org/bot<TOKEN>/getUpdates`, buscá `"chat":{"id": 123456789 ...}`,
y **volvé a registrar el webhook** con setWebhook (ver paso 5).

Armá el mapa `chat_id:usuario` con los **usuarios del login del CRM**
(`superadmin` = Fabio, `admin` = Mariana, `empleado` = Anita). ⚠️ Tiene que ser
ese usuario exacto, NO el nombre de pila: así el movimiento queda a nombre del
que lo cargó y cada uno ve lo suyo (Mariana solo ve sus movimientos; Fabio ve todo).

```
TELEGRAM_CHAT_MAP=123456789:superadmin,987654321:admin
```

## 4. Variables de entorno (en Render)

```
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
GEMINI_API_KEY=AIza...
TELEGRAM_CHAT_MAP=123456789:fabio,987654321:mariana
TELEGRAM_WEBHOOK_SECRET=algo-secreto-que-inventes   # opcional pero recomendado
# GEMINI_MODEL=gemini-flash-latest                      # opcional
```

## 5. Registrar el webhook (una vez, después de desplegar)

Telegram tiene que saber a qué URL mandar los mensajes. Abrí en el navegador
(reemplazando `<TOKEN>` y el secreto):

```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://salon-eventos.onrender.com/api/webhook/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Debe responder `{"ok":true,...}`. Listo: mandá un audio de prueba y fijate que aparezca
en **Por confirmar** del CRM.

## Probar la lógica sin Telegram

```
node scripts/simular_bot_telegram.js
```

Simula mensajes y verifica que se creen los borradores correctos, sin usar la red.

## Qué hace y qué NO hace

- **Entrada:** audio, texto, o **foto de una factura** (lee el total y el concepto).
- **Confirmación en Telegram:** primero muestra lo que entendió y pregunta *¿lo cargo? sí/no*.
  Recién con **"sí"** crea el borrador; con **"no"** (o cualquier otra cosa) no manda nada al sistema.
- **Sí:** cobros sueltos (Seña / Saldo / Otro) y gastos (de evento o generales).
- **No (por ahora):** cuotas de un plan (van en la ficha), y **cargar varios gastos en un solo mensaje**
  (interpreta un movimiento por mensaje; para varios, mandalos de a uno).
- **Nunca** carga en firme: el borrador queda en la bandeja *Por confirmar* para la confirmación final del admin.
