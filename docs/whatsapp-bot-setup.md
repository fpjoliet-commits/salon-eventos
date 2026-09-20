# Bot de WhatsApp — Guía de puesta en marcha

Bot **reactivo y sin IA** para la línea comercial del salón. La gente escribe
primero; el bot responde con un menú numerado, contesta preguntas frecuentes,
agenda visitas (vía Cal.com, que ya alimenta el CRM) y **deriva a una persona
solo en el horario que vos definís**.

Corre dentro del backend que ya está en Render. No hay servidor nuevo ni costo
de infraestructura. Los mensajes que la gente te manda son **gratis** (WhatsApp
solo cobra conversaciones que *vos* iniciás con plantillas, que acá no usamos).

---

## Estado actual (ya hecho, sin el número)

- ✅ Motor del bot: `backend/whatsapp-bot.js`
- ✅ Config editable (horarios, textos, FAQ, link): `backend/bot-config.js`
- ✅ Webhook montado en `/api/webhook/whatsapp` (dormido hasta cargar variables)
- ✅ Integración con el CRM: cada consulta entra como lead en estado *Consulta*, origen *WhatsApp*
- ✅ Simulador para probar sin número: `node scripts/simular_bot_whatsapp.js`

**Falta solo la parte de Meta (abajo), que necesita el número en tu poder.**

---

## Lo que tenés que completar en `bot-config.js` (podés hacerlo YA)

Abrí `backend/bot-config.js` y reemplazá todo lo que dice `⚠️ COMPLETAR`:

- **Precios** y formas de pago (opción 1)
- **Capacidad** máxima y formatos (opción 2)
- **Dirección** exacta + link de Google Maps + estacionamiento (opción 3)
- **Qué incluye** el servicio (opción 4)
- `nombreSalon` si "Joliet Eventos" no es el nombre exacto
- `linkAgendaVisita`: tu link real de Cal.com
- `horarioDerivacion`: ajustá los días/horas en que querés que derive a Mariana

---

## Alta en Meta (el día que tengas el número)

> El número **no puede estar activo** en una app normal de WhatsApp o WhatsApp
> Business. Si ya lo usaste ahí, primero borrá esa cuenta desde la app del
> celular, o usá un número nuevo sin registrar.

### 1. Business Manager
1. Entrá a **business.facebook.com** con tu cuenta de Facebook.
2. Creá un **portafolio comercial** (Business Portfolio) para el salón si no tenés.

### 2. App de desarrollador + WhatsApp
1. Entrá a **developers.facebook.com** → *Mis Apps* → *Crear app*.
2. Tipo de app: **Empresa (Business)**.
3. Dentro de la app, *Agregar producto* → **WhatsApp** → *Configurar*.
4. Asociá la app a tu portafolio comercial del paso 1.

### 3. Registrar el número
1. En **WhatsApp → Configuración de la API** (*API Setup*).
2. *Agregar número de teléfono* → cargá el número comercial → verificalo por SMS o llamada.
3. Definí el **nombre para mostrar** (queda sujeto a aprobación de Meta).

### 4. Anotar los 2 IDs
En la misma pantalla *API Setup* copiá:
- **Identificador del número de teléfono** (Phone number ID) → va en `WHATSAPP_PHONE_NUMBER_ID`
  *(⚠️ es un número largo, NO es el número de teléfono en sí)*
- (Anotá también el *WhatsApp Business Account ID* por las dudas.)

### 5. Token permanente (System User)
El token que Meta muestra al principio dura 24 h. Para uno que no venza:
1. **business.facebook.com** → *Configuración del negocio* → *Usuarios* → **Usuarios del sistema**.
2. Creá un usuario del sistema con rol *Administrador*.
3. *Agregar activos* → asigná la **app** de WhatsApp.
4. *Generar token* → elegí la app → permisos:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Copiá el token (empieza con algo tipo `EAAG...`) → va en `WHATSAPP_TOKEN`.
   **Guardalo bien: no se vuelve a mostrar.**

### 6. App Secret (para verificar la firma)
1. En la app de developers: *Configuración → Básica*.
2. Mostrá y copiá el **Secreto de la app** → va en `WHATSAPP_APP_SECRET`.

### 7. Inventar el verify token
Elegí un texto cualquiera, tipo `joliet-webhook-2026-xyz`. Es un secreto que solo
conocen tu servidor y Meta. → va en `WHATSAPP_VERIFY_TOKEN`.

### 8. Cargar variables en Render
En **dashboard.render.com** → tu servicio → *Environment* → agregá:

```
WHATSAPP_TOKEN=            (paso 5)
WHATSAPP_PHONE_NUMBER_ID=  (paso 4)
WHATSAPP_VERIFY_TOKEN=     (paso 7)
WHATSAPP_APP_SECRET=       (paso 6)
```

Guardá y esperá el redeploy (~1-2 min). En los logs de Render tiene que aparecer:
`🤖 Bot de WhatsApp ACTIVO`.

### 9. Configurar el webhook en Meta
1. **WhatsApp → Configuración** (*Configuration*) → sección *Webhook* → *Editar*.
2. **URL de devolución (Callback URL):**
   `https://salon-eventos.onrender.com/api/webhook/whatsapp`
3. **Token de verificación:** el mismo texto del paso 7.
4. *Verificar y guardar* → si las variables están bien cargadas, da el visto bueno.
5. En *Campos del webhook* (*Webhook fields*), suscribite a **messages**.

### 10. Salir a producción
- Al principio la app está en modo *Desarrollo*: solo podés chatear con hasta
  **5 números** que agregues como testers. **Usá esto para probar todo primero.**
- Para atender a cualquier cliente: **verificación del negocio** en Business
  Manager (te piden datos/documentación del salón) y pasar la app a **modo Live**.

---

## Probar sin número (ahora mismo)

```
node scripts/simular_bot_whatsapp.js        # corre un guión de prueba
node scripts/simular_bot_whatsapp.js chat   # chateás vos con el bot en la terminal
```

## Cómo cambiar textos/horarios más adelante

Todo está en `backend/bot-config.js`. Se edita, se commitea y Render redeploya.
No hace falta tocar el motor (`whatsapp-bot.js`).

## Si algún día querés sumarle IA

El motor está preparado: la función `processMessage` es el único punto de
decisión. Se le puede agregar una rama que, cuando no cae en el menú, consulte a
un modelo (por ejemplo Claude) con la lista de FAQ como contexto. No hay que
reescribir nada del webhook ni de la integración con el CRM.
