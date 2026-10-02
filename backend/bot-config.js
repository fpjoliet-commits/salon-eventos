/* =============================================================================
   CONFIGURACIÓN DEL BOT DE WHATSAPP (Joy)  —  editá SOLO este archivo
   =============================================================================
   Todo lo que Fabio/Mariana pueden cambiar sin tocar código: horarios, textos,
   respuestas, fotos y links. El motor (whatsapp-bot.js) no se toca.

   Formato de WhatsApp en los textos: *negrita* _cursiva_ y \n para saltos.
   El bot NUNCA habla de precios: lo que se cotiza se deriva a la visita.
   ========================================================================== */

module.exports = {

  nombreSalon: 'Joliet Eventos',
  nombreAsistente: 'Joy',

  // Dominio público desde donde se sirven las fotos (las de frontend/img).
  publicBaseUrl: 'https://salon-eventos.onrender.com',

  // ── Horario en que el bot DERIVA a una persona (atención real del salón) ──
  // Fuera de esto, el bot atiende igual pero avisa que contactan en el próximo
  // horario y guarda el pedido en el CRM.
  // Días: 0=Dom 1=Lun 2=Mar 3=Mié 4=Jue 5=Vie 6=Sáb · rangos 24h "HH:MM".
  horarioDerivacion: {
    timezone: 'America/Argentina/Buenos_Aires',
    dias: {
      0: [],                        // Domingo cerrado
      1: [],                        // Lunes cerrado
      2: [['17:30', '20:00']],      // Martes
      3: [['17:30', '20:00']],      // Miércoles
      4: [['17:30', '20:00']],      // Jueves
      5: [['17:30', '20:00']],      // Viernes
      6: [['17:30', '20:00']],      // Sábado
    },
  },

  // Link de Cal.com para agendar la visita (ya alimenta el CRM por webhook).
  linkAgendaVisita: 'https://cal.com/fabio-pino-3oro7p/visita-al-salon',

  // Datos de contacto y ubicación.
  contacto: {
    direccion: 'Juana Azurduy 531, Ciudad Tesei, Hurlingham',
    maps: 'https://maps.app.goo.gl/5TCmbjojY8nwKJ7F6',
    instagram: '@jolieteventos',
    mail: 'labartam@gmail.com',
    telefono: '11 5424 0870',
  },

  // ── Saludo (cuerpo del menú). {asistente} y {salon} se reemplazan solos. ──
  saludo:
    '¡Hola! 😊 Soy *{asistente}*, del equipo de *{salon}*.\n' +
    'Estoy para ayudarte con tu evento y, si querés, coordinar una visita al salón.\n\n' +
    '¿Qué te gustaría saber? 👇',

  // ── Menú principal (lista desplegable de WhatsApp) ──
  // Cada fila: id (no tocar), title (máx 24 car.), description (máx 72 car.).
  menu: {
    header: 'Joliet Eventos',
    footer: 'Elegí una opción 💛',
    boton: 'Ver opciones',
    filas: [
      { id: 'lugar',    title: '📍 El lugar',          description: 'Ubicación, parque, estacionamiento' },
      { id: 'eventos',  title: '🎉 Tipos de evento',   description: 'Qué hacemos y para cuántos' },
      { id: 'comida',   title: '🍽️ Comida y bebida',   description: 'Catering, menús y bebidas' },
      { id: 'incluye',  title: '✨ Qué incluye',        description: 'Todo lo que ya viene con tu evento' },
      { id: 'funciona', title: '📋 Cómo funciona',      description: 'Clima, horarios, reservas y políticas' },
      { id: 'agendar',  title: '📅 Agendar visita',     description: 'Coordiná conocer el salón' },
      { id: 'hablar',   title: '💬 Hablar con alguien', description: 'Te contacta el equipo' },
    ],
  },

  // ── Respuestas por categoría ──
  // foto: ruta pública (o null). El texto va como epígrafe de la foto.
  respuestas: {
    lugar: {
      foto: '/img/propuesta/jardin.jpeg',
      texto:
        '*Dónde estamos* 📍\n\n' +
        'Juana Azurduy 531, Ciudad Tesei (Hurlingham). La entrada es bien reconocible 😉\n' +
        'Cómo llegar: https://maps.app.goo.gl/5TCmbjojY8nwKJ7F6\n\n' +
        '🌳 Tenemos jardín y pileta, parte del encanto para tus fotos.\n' +
        '🅿️ No hay playa de estacionamiento propia, pero contás con *valet parking*, ' +
        'seguridad y lugar de sobra sobre la avenida.\n' +
        '♿ Es accesible para sillas de ruedas, con baño adaptado.\n' +
        '❄️ Salón climatizado, con aire y calefacción.',
    },
    eventos: {
      foto: '/img/propuesta/fiesta.jpeg',
      texto:
        '*Tipos de evento* 🎉\n\n' +
        'Hacemos de todo: casamientos, 15, cumpleaños, corporativos, bautismos, ' +
        'eventos religiosos y más. ¡Eventos chicos también! Y de día, mediodía o noche.\n\n' +
        'Nos adaptamos a vos: hasta *200 personas* en formato formal (sentados) y ' +
        'hasta *300* en formato informal.\n\n' +
        'Contanos qué tenés en mente y lo pensamos juntos. 💛',
    },
    comida: {
      foto: '/img/propuesta/mesa-elegante.jpeg',
      texto:
        '*Comida y bebida* 🍽️\n\n' +
        'Nuestra cocina es 100% propia 👩‍🍳\n' +
        '• Menús sentados, y también opción *lunch* o *cóctel*.\n' +
        '• Menú infantil y todas las restricciones alimentarias (celíacos, veganos, alergias).\n' +
        '• Las *bebidas están incluidas*. Si querés traer tu propio vino, consultanos qué bodegas aceptamos.\n' +
        '• La torta la podés traer de afuera, aunque tenemos nuestra pastelera de confianza 💛\n' +
        '• Hacemos degustación del menú, coordinándola con tiempo.\n\n' +
        'Trabajamos solo con nuestra cocina y nuestro equipamiento propio, que son parte del ' +
        'sello Joliet. Por eso no sumamos catering externo ni comida de afuera: así cada detalle ' +
        'queda a la altura de tu evento. 💛',
    },
    incluye: {
      foto: '/img/propuesta/estilo-formal.jpg',
      texto:
        '*Qué incluye tu evento* ✨\n\n' +
        '🥂 Mesa completa: plato de sitio y cubertería.\n' +
        '🌸 Mantelería a elección y centro de mesa (se puede personalizar más).\n' +
        '🤵 Un equipo para vos: maître, mozos, chef, barman y coordinadora general.\n' +
        '🍷 Bebidas de la cena.\n' +
        '✦ Iluminación de diseño, cristalería y cada detalle pensado.\n\n' +
        'El *DJ* se contrata aparte: tenemos DJ propio del salón con quien coordinás todo a tu gusto. ' +
        'Podés sumar *banda* y proveedores externos (fotógrafo, decorador).\n' +
        'Y cualquier adicional que imagines —candy bar, shows, cabinas de fotos, robot de luces— te lo armamos. ✨',
    },
    funciona: {
      foto: null,
      texto:
        '*Cómo funciona* 📋\n\n' +
        '☔ *¿Llueve?* Sin drama: pasamos todo adentro. Y si querés aprovechar igual el jardín, se puede techar e incluso sumar carpas calefaccionadas para el frío — lo coordinamos a tu medida.\n' +
        '⏰ La *duración* la definimos juntos antes del evento (no se extiende una vez arrancado).\n' +
        '🔊 El salón está insonorizado: la música no es problema.\n' +
        '🎊 Papelitos, pirotecnia fría y humo: ¡permitidos!\n' +
        '🐶 Mascotas: bienvenidas.\n' +
        '🔒 Hay seguridad y guardarropa.\n' +
        '🎨 Podés traer tu decoración (lo único: no se pega nada en las paredes).\n' +
        '📅 Para *asegurar tu fecha* hace falta una seña; sin eso queda como tentativa. ' +
        'Cuanto antes reserves, mejor, así nadie te gana ese día.',
    },
  },

  // ── Agendar visita ──
  agendar: {
    foto: '/img/propuesta/salon.jpg.jpeg',
    texto:
      '¡Nos encantaría mostrarte el salón! 🏛️ La visita es sin compromiso.\n\n' +
      '💡 Tip: los *sábados* la visita es con el salón *armado*, para que lo veas en todo su esplendor.\n\n' +
      'Reservá el día y horario que mejor te quede acá:\n' +
      '{link}\n\n' +
      'Cuando lo confirmes, queda agendado automáticamente. ¡Te esperamos! 💛',
  },

  // ── Derivación a una persona ──
  derivacion: {
    enHorario:
      '¡Perfecto! 🙌 Ya le avisé al equipo. En un ratito te escribe una persona por acá.\n' +
      'Mientras tanto, si querés, podés ir agendando tu visita. 📅',
    // {proximo} = próximo horario de atención.
    fueraHorario:
      'En este momento no hay nadie del equipo en línea. 🌙\n' +
      'Te van a estar contactando *{proximo}*.\n\n' +
      'Ya dejé tu pedido registrado. Si querés adelantar, podés agendar tu visita ahora mismo. 📅\n\n' +
      'También nos encontrás en Instagram ({instagram}) o por mail ({mail}).',
  },

  // Textos de navegación / varios.
  textos: {
    navPregunta: '¿Querés ver algo más? 👇',
    btnAgendar: '📅 Agendar visita',
    btnHablar: '💬 Hablar',
    btnMenu: '↩️ Menú',
  },
};
