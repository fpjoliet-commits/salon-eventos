/* =============================================================================
   CONFIGURACIÓN DEL BOT DE WHATSAPP  —  editá SOLO este archivo
   =============================================================================
   Acá está todo lo que Fabio/Mariana pueden querer cambiar sin tocar código:
   horarios de atención, textos, respuestas de preguntas frecuentes y links.

   Reglas:
   - Los textos usan \n para saltos de línea. WhatsApp entiende *negrita* con
     asteriscos y _cursiva_ con guiones bajos.
   - No borres las claves (lo que está antes de los dos puntos). Cambiá solo
     lo que está entre comillas.
   ========================================================================== */

module.exports = {

  // ── Nombre del salón (aparece en los saludos) ──────────────────────────────
  nombreSalon: 'Joliet Eventos',

  // ── HORARIOS EN QUE EL BOT DERIVA A UNA PERSONA (Mariana) ──────────────────
  // Fuera de estos horarios el bot atiende igual (responde dudas y agenda
  // visitas), pero NO deriva a Mariana: le avisa a la persona que la contactan
  // en el próximo horario laboral y guarda el pedido en el CRM.
  //
  // Días: 0=Domingo, 1=Lunes, 2=Martes, 3=Miércoles, 4=Jueves, 5=Viernes, 6=Sábado
  // Cada día es una lista de rangos [desde, hasta] en formato 24h "HH:MM".
  // Un día sin rangos (lista vacía []) = no se deriva ese día.
  horarioDerivacion: {
    timezone: 'America/Argentina/Buenos_Aires',
    dias: {
      0: [],                        // Domingo: no se deriva
      1: [['09:00', '18:00']],      // Lunes
      2: [['09:00', '18:00']],      // Martes
      3: [['09:00', '18:00']],      // Miércoles
      4: [['09:00', '18:00']],      // Jueves
      5: [['09:00', '18:00']],      // Viernes
      6: [['10:00', '13:00']],      // Sábado (media jornada)
    },
  },

  // ── LINK PARA AGENDAR VISITA AL SALÓN ──────────────────────────────────────
  // Es tu link de Cal.com (el mismo que ya alimenta el CRM por el webhook).
  // Cuando la persona lo usa, la visita entra sola como "Visita agendada".
  linkAgendaVisita: 'https://cal.com/fabio-pino-3oro7p/visita-al-salon',

  // ── TEXTOS DEL BOT ──────────────────────────────────────────────────────────
  textos: {
    // Menú principal. Se muestra al saludar y cuando la persona escribe "menu".
    menu:
      '¡Hola! 👋 Soy el asistente de *Joliet Eventos*.\n\n' +
      '¿Con qué te puedo ayudar? Respondé con el *número*:\n\n' +
      '*1*  Precios y formas de pago\n' +
      '*2*  Capacidad del salón\n' +
      '*3*  Ubicación y cómo llegar\n' +
      '*4*  Qué incluye el servicio\n' +
      '*5*  Consultar disponibilidad de una fecha\n' +
      '*6*  Agendar una visita al salón\n' +
      '*7*  Hablar con una persona del equipo\n\n' +
      '_Escribí *menu* en cualquier momento para volver a ver estas opciones._',

    // Cuando no entiende lo que escribieron.
    noEntendido:
      'Disculpá, no te entendí. 🙈\n' +
      'Respondé con un *número* del menú, o escribí *menu* para verlo de nuevo.',

    // Pie que se agrega al confirmar el pedido de contacto DENTRO de horario.
    derivacionEnHorario:
      '¡Perfecto! 🙌 Ya le avisé al equipo. En un rato te escribe una persona por acá.\n' +
      'Mientras tanto, si querés podés ir agendando una visita: escribí *6*.',

    // Cuando piden hablar con alguien FUERA de horario.
    // {proximo} se reemplaza por el próximo horario de atención.
    derivacionFueraHorario:
      'En este momento no hay nadie del equipo en línea. 🌙\n' +
      'Te van a estar contactando {proximo}.\n\n' +
      'Ya dejé tu pedido registrado. Si querés adelantar, podés agendar una visita ahora mismo escribiendo *6*.',
  },

  // ── PREGUNTAS FRECUENTES (respuestas automáticas del menú) ──────────────────
  // Editá libremente los textos. Al final de cada respuesta el bot agrega solo
  // "Escribí menu para volver".
  faq: {
    '1':   // Precios
      '*Precios y formas de pago* 💵\n\n' +
      '⚠️ COMPLETAR: rango de precios, qué incluye, seña, formas de pago (efectivo, ' +
      'transferencia, cuotas), y en qué moneda.\n\n' +
      'Para un presupuesto exacto conviene coordinar una visita (opción *6*), ' +
      'donde vemos fecha, cantidad de invitados y tipo de evento.',

    '2':   // Capacidad
      '*Capacidad del salón* 👥\n\n' +
      'El salón trabaja desde *80 invitados* como mínimo.\n' +
      '⚠️ COMPLETAR: capacidad máxima y distintos formatos (sentados, cóctel, etc.).',

    '3':   // Ubicación  (dirección tomada de fuentes públicas — CONFIRMAR con Fabio)
      '*Dónde estamos* 📍\n\n' +
      'Juana Azurduy 531, Villa Tesei, Hurlingham (Prov. de Buenos Aires).\n' +
      'Cómo llegar: https://maps.app.goo.gl/5TCmbjojY8nwKJ7F6\n\n' +
      '⚠️ CONFIRMAR dirección y agregar referencias / estacionamiento.',

    '4':   // Servicios
      '*Qué incluye el servicio* ✨\n\n' +
      '⚠️ COMPLETAR: catering, ambientación, DJ/música, mozos, barra, etc.\n' +
      'Contame qué tipo de evento tenés en mente y te doy más detalle.',
  },
};
