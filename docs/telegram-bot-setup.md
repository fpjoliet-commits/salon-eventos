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

1. Cada padre le escribe algo al bot (ej. "hola").
2. Abrí en el navegador: `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Buscá `"chat":{"id": 123456789 ...}`. Ese número es el chat de esa persona.

Armá el mapa `chat_id:usuario` con los usuarios del CRM (`fabio`, `mariana`):

```
TELEGRAM_CHAT_MAP=123456789:fabio,987654321:mariana
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

- **Sí:** cobros sueltos (Seña / Saldo / Otro) y gastos (de evento o generales), por audio o texto.
- **No:** cuotas de un plan (eso queda en la ficha del cliente, es más delicado).
- **Nunca** confirma solo: siempre queda en la bandeja para revisión humana.
