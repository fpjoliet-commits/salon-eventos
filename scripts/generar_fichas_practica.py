# -*- coding: utf-8 -*-
"""
Genera un PDF con 20 fichas ficticias de "personas" que piden un evento,
pensado para practicar la carga desde el creador de propuestas del CRM.

Cada ficha trae todo lo que hay que elegir en el creador segun el tipo de
evento y el estilo (Formal / Americano). Algunas fichas tienen los datos en
el mismo orden del creador y otras mezclados, para practicar buscarlos.
Tipografia grande (usuario +60), una ficha nunca se corta entre paginas.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, PageBreak, HRFlowable
)

OUT_PATH = r"C:\Users\WINDOWS 10\Desktop\Fichas de practica - Casos ficticios.pdf"

# ---------------------------------------------------------------------------
# Orden en que se muestran los datos dentro de cada ficha
# ---------------------------------------------------------------------------
ORDEN_CREADOR = [
    "contacto", "telefono", "correo", "tipo_evento", "agasajado", "anios",
    "espacio", "estilo", "fecha", "turno", "invitados", "menu_infantil",
    "fin_fiesta", "estaciones", "pastas", "salsas", "plato_central",
    "mesa_dulces", "islas", "postre",
]
MEZCLA_1 = [
    "tipo_evento", "agasajado", "anios", "fecha", "turno", "invitados",
    "menu_infantil", "islas", "postre", "estaciones", "pastas", "salsas",
    "plato_central", "mesa_dulces", "espacio", "estilo", "fin_fiesta",
    "contacto", "telefono", "correo",
]
MEZCLA_2 = [
    "fin_fiesta", "invitados", "menu_infantil", "estaciones", "pastas",
    "salsas", "plato_central", "mesa_dulces", "islas", "postre",
    "tipo_evento", "agasajado", "anios", "turno", "fecha", "estilo",
    "espacio", "telefono", "correo", "contacto",
]

ETIQUETAS = {
    "contacto": "Contacto",
    "telefono": "Teléfono",
    "correo": "Correo",
    "tipo_evento": "Tipo de evento",
    "anios": "Cumple",
    "espacio": "Espacio",
    "estilo": "Estilo",
    "fecha": "Fecha",
    "turno": "Turno",
    "invitados": "Invitados",
    "menu_infantil": "Menú infantil",
    "estaciones": "Estaciones de bienvenida",
    "pastas": "Primer plato — pastas",
    "salsas": "Salsas",
    "plato_central": "Plato central",
    "mesa_dulces": "Mesa de dulces",
    "islas": "Islas (plato central)",
    "postre": "Postre de la mesa dulce",
    "fin_fiesta": "Fin de fiesta / adicionales",
}

# ---------------------------------------------------------------------------
# Los 20 casos ficticios
# "agasajado" se guarda como (etiqueta, valor) porque cambia el genero.
# ---------------------------------------------------------------------------
CASOS = [
    dict(
        n=1, orden="creador",
        contacto="Gabriela Fontana (mamá de la agasajada)",
        telefono="11-4455-2201", correo="gabriela.fontana@gmail.com",
        tipo_evento="XV años", agasajado=("Agasajada", "Marisa Fontana"),
        espacio="Combinado — recepción en el jardín y fiesta adentro",
        estilo="Formal", fecha="14 de marzo de 2027", turno="Noche",
        invitados="120 personas", menu_infantil="Sí, para 15 chicos",
        estaciones="Alma Mexicana y Estación de Crêpes",
        pastas="Tagliatelle (la incluida), Sorrentinos de jamón y queso y Ñoquis de papa",
        salsas="Filetto (la incluida), Rosé y Cuatro quesos",
        plato_central="Bife del bosque",
        mesa_dulces="Pastelería Joliet, y pregunta por las Mini Cakes Premium",
        fin_fiesta="Robot de Luces, Cabina de Fotos y Cotillón Premium Personalizado",
        nota="La torta la quiere de tres pisos, de chocolate con frutos rojos, y que salga a la "
             "pista con las luces bajas después del vals. El papá pide que el humo de la máquina "
             "no sea muy fuerte.",
    ),
    dict(
        n=2, orden="mezcla1",
        contacto="Valeria Sosa y Nicolás Ferrer",
        telefono="11-2245-6690", correo="valeria.nico.boda@gmail.com",
        tipo_evento="Boda", agasajado=("Agasajados", "Valeria y Nicolás"),
        espacio="Jardín", estilo="Formal", fecha="12 de junio de 2027", turno="Noche",
        invitados="180 personas", menu_infantil="Sí, para 12 chicos",
        estaciones="Sándwiches gourmets y Sushi en vivo (premium, lo quieren consultar)",
        pastas="Tagliatelle (la incluida), Sorrentinos de salmón y philadelphia (gourmet) "
               "y Canelones de verdura y ricota",
        salsas="Filetto (la incluida), Portobellos y ciboulette (gourmet) y Bolognesa",
        plato_central="Lomo Reserva",
        mesa_dulces="Pastelería Joliet con el upgrade de Mini Cakes Premium",
        fin_fiesta="Candy Bar, Diversos Shows y Cabina de Instagram",
        nota="Quieren la torta de casamiento en dos pisos, de vainilla con dulce de leche, y una "
             "réplica chiquita para llevarse. Preguntan hasta qué hora se puede estirar la fiesta.",
    ),
    dict(
        n=3, orden="creador",
        contacto="Brisa Coronel (la agasajada, viene con la mamá)",
        telefono="11-3391-4482", correo="brisa.coronel15@gmail.com",
        tipo_evento="XV años", agasajado=("Agasajada", "Brisa Coronel"),
        espacio="Interior", estilo="Americano", fecha="5 de septiembre de 2027", turno="Noche",
        invitados="140 personas", menu_infantil="Sí, para 20 chicos",
        islas="Bovalino — Pasta Italiana (la incluida), Azteca — Tacos y Bianca — Pollo en Vino Blanco",
        postre="American Sweet",
        fin_fiesta="Cabina de Glitter, Música & Entretenimiento y Cotillón Premium Personalizado",
        nota="Pide que el vals sea a las 22 hs en punto y que la isla de tacos esté cerca de la "
             "pista. Quiere una torta blanca con flores naturales.",
    ),
    dict(
        n=4, orden="mezcla2",
        contacto="Familia Aráoz (papá: Matías Aráoz)",
        telefono="11-5563-9987", correo="familia.araoz@gmail.com",
        tipo_evento="Bautismo", agasajado=("Agasajado", "Benjamín (8 meses)"),
        espacio="Interior", estilo="Americano", fecha="14 de marzo de 2027", turno="Almuerzo",
        invitados="60 personas", menu_infantil="Sí, para 8 chicos",
        islas="Bovalino — Pasta Italiana (la incluida) y Dijon — Pollo a la Mostaza",
        postre="Pavlova de estación",
        fin_fiesta="Cabina de Fotos",
        nota="La ceremonia es en la capilla de la esquina y llegan al salón 13 hs. Piden un rincón "
             "tranquilo para cambiar y hacer dormir al bebé.",
    ),
    dict(
        n=5, orden="creador",
        contacto="Silvina Beltrán (organiza para el papá)",
        telefono="11-4478-2201", correo="silvina.beltran@gmail.com",
        tipo_evento="Cumpleaños", agasajado=("Agasajado", "Osvaldo Beltrán"), anios="50 años",
        espacio="Jardín", estilo="Formal", fecha="22 de octubre de 2027", turno="Tarde",
        invitados="90 personas", menu_infantil="No",
        estaciones="Clásicos en Laja y Mollejas & Verdeo (premium, a consultar)",
        pastas="Tagliatelle (la incluida) y Agnolotis de pollo",
        salsas="Filetto (la incluida), Cuatro quesos e Italiana",
        plato_central="Pechuga caprese",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Diversos Shows y Cotillón Premium",
        nota="Es sorpresa: piden que no lo llamen a él por teléfono. Quieren una torta con forma "
             "de cancha de fútbol y que la traigan cuando esté todo el mundo sentado.",
    ),
    dict(
        n=6, orden="mezcla1",
        contacto="Mariela Ledesma (mamá)",
        telefono="11-6612-4470", correo="familia.ledesma@gmail.com",
        tipo_evento="Comunión", agasajado=("Agasajada", "Camila Ledesma"),
        espacio="Jardín", estilo="Formal", fecha="8 de mayo de 2027", turno="Almuerzo",
        invitados="55 personas", menu_infantil="Sí, para 15 chicos",
        estaciones="Sándwiches gourmets",
        pastas="Tagliatelle (la incluida) y Sorrentinos de jamón y queso",
        salsas="Filetto (la incluida) y Rosé",
        plato_central="Pechuga tradición",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Cabina de Instagram y Robot de Luces",
        nota="Pide que los chicos puedan jugar afuera mientras los grandes almuerzan, y una torta "
             "sencilla con el nombre de Camila y una cruz de chocolate.",
    ),
    dict(
        n=7, orden="creador",
        contacto="Comisión de Egresados IPEM 45 (Lucas Vera)",
        telefono="11-7723-1145", correo="egresados.ipem45@gmail.com",
        tipo_evento="Egresados",
        espacio="Combinado", estilo="Americano", fecha="27 de noviembre de 2027", turno="Noche",
        invitados="160 personas", menu_infantil="No",
        islas="Bovalino — Pasta Italiana (la incluida), Azteca — Tacos y Del Bosque — Carne y Hongos",
        postre="Key Lime Pie",
        fin_fiesta="Música & Entretenimiento, Robot de Luces y Cabina de Glitter",
        nota="Quieren que la fiesta se estire hasta las 5 am y preguntan si al final se puede "
             "hacer un cierre con humo y luces para la foto grupal de toda la promoción.",
    ),
    dict(
        n=8, orden="mezcla2",
        contacto="Constructora Rioplatense SA (Marcela Paz, RRHH)",
        telefono="11-4400-2278", correo="eventos@rioplatense.com.ar",
        tipo_evento="Corporativo",
        espacio="Interior", estilo="Formal", fecha="19 de agosto de 2027", turno="Tarde",
        invitados="100 personas", menu_infantil="No",
        estaciones="Alma Mexicana y Delicias de Mar (premium, a consultar)",
        pastas="Tagliatelle (la incluida), Fetuccine Nero di sepia (gourmet) y Ravioloni de "
               "espinaca y parmesano",
        salsas="Filetto (la incluida), Queso azul y nuez (gourmet) y Salsa blanca",
        plato_central="Lomo Dijon",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Música & Entretenimiento",
        nota="Es el aniversario de la empresa. Piden un espacio para colgar el banner con el logo "
             "y que la torta lleve el isotipo impreso en papel de azúcar.",
    ),
    dict(
        n=9, orden="creador",
        contacto="Rosana Quiroga",
        telefono="11-2287-6634", correo="rosana.quiroga@gmail.com",
        tipo_evento="Otro",
        espacio="Jardín", estilo="Americano", fecha="3 de abril de 2027", turno="Tarde",
        invitados="70 personas", menu_infantil="No",
        islas="Bovalino — Pasta Italiana (la incluida) y Bianca — Pollo en Vino Blanco",
        postre="África de autor",
        fin_fiesta="Candy Bar y Cabina de Fotos",
        nota="Es el festejo de jubilación de su papá, después de 40 años en la misma fábrica. "
             "Quiere proyectar un video homenaje y que la torta diga “Gracias, viejo”.",
    ),
    dict(
        n=10, orden="mezcla1",
        contacto="Juan Pablo Rivas y Antonella Suárez",
        telefono="11-5541-9923", correo="jp.anto.boda@gmail.com",
        tipo_evento="Boda", agasajado=("Agasajados", "Juan Pablo y Antonella"),
        espacio="Jardín", estilo="Americano", fecha="30 de enero de 2027", turno="Noche",
        invitados="210 personas", menu_infantil="Sí, para 18 chicos",
        islas="Bovalino — Pasta Italiana (la incluida), Francesa — Lomo Demiglace y "
              "Paella Mediterránea (premium, a consultar)",
        postre="American Sweet",
        fin_fiesta="Cabina de Instagram, Cotillón Premium y Diversos Shows",
        nota="Ceremonia religiosa en la iglesia del centro, llegan al salón 21 hs. La torta la "
             "trae la tía, así que solo necesitan la mesa y que la corten en la cocina.",
    ),
    dict(
        n=11, orden="creador",
        contacto="Milagros Funes (viene con el papá)",
        telefono="11-3356-7712", correo="milagros.funes15@gmail.com",
        tipo_evento="XV años", agasajado=("Agasajada", "Milagros Funes"),
        espacio="Combinado", estilo="Formal", fecha="17 de julio de 2027", turno="Noche",
        invitados="150 personas", menu_infantil="Sí, para 25 chicos",
        estaciones="Estación de Crêpes y Clásicos en Laja",
        pastas="Tagliatelle (la incluida), Sorrentinos de jamón y queso, Ravioloni de espinaca y "
               "parmesano y Ñoquis de papa",
        salsas="Filetto (la incluida), Rosé y Cuatro quesos",
        plato_central="Pechuga doble puerro",
        mesa_dulces="Pastelería Joliet con el upgrade de Mini Cakes Premium",
        fin_fiesta="Cabina de Glitter, Robot de Luces y Cotillón Premium Personalizado",
        nota="Entra en auto antiguo y quiere que el fin de fiesta arranque justo a las 2 am. "
             "Torta de dos pisos, rosa viejo, con perlas comestibles.",
    ),
    dict(
        n=12, orden="mezcla2",
        contacto="Carolina Aguilar (mamá de Tomás)",
        telefono="11-6690-4423", correo="familia.aguilar@gmail.com",
        tipo_evento="Cumpleaños", agasajado=("Agasajado", "Tomás Aguilar"), anios="6 años",
        espacio="Interior", estilo="Americano", fecha="25 de abril de 2027", turno="Tarde",
        invitados="40 personas", menu_infantil="Sí, para 22 chicos",
        islas="Bovalino — Pasta Italiana (la incluida) y Azteca — Tacos",
        postre="Pavlova de estación (los chicos van con el menú infantil aparte)",
        fin_fiesta="Diversos Shows y Cabina de Fotos",
        nota="Temática de superhéroes. Pregunta si puede llevar animador propio y una piñata, y "
             "quiere la torta con forma de escudo, sin frutas ni crema.",
    ),
    dict(
        n=13, orden="creador",
        contacto="Elena Domínguez",
        telefono="11-2298-1156", correo="elena.dominguez60@gmail.com",
        tipo_evento="Cumpleaños", agasajado=("Agasajada", "Elena Domínguez"), anios="60 años",
        espacio="Interior", estilo="Formal", fecha="11 de septiembre de 2027", turno="Almuerzo",
        invitados="80 personas", menu_infantil="No",
        estaciones="Sándwiches gourmets y Alma Mexicana",
        pastas="Las cinco que se pueden elegir: Tagliatelle (la incluida), Sorrentinos de jamón y "
               "queso, Canelones de verdura y ricota, Ravioloni de espinaca y parmesano, "
               "Agnolotis de pollo y Ñoquis de papa",
        salsas="Filetto (la incluida), Bolognesa, Cuatro quesos, Italiana y Crema de espinaca",
        plato_central="Bife del bosque",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Cotillón Premium",
        nota="Pide el brindis con champagne apenas se sienten, antes del primer plato. Dos "
             "invitados son celíacos y pregunta si hay opción sin TACC.",
    ),
    dict(
        n=14, orden="mezcla1",
        contacto="Familia Ibarra (mamá: Daniela Ibarra)",
        telefono="11-4467-8823", correo="familia.ibarra@gmail.com",
        tipo_evento="Bautismo", agasajado=("Agasajadas", "Sol y Luna (mellizas)"),
        espacio="Combinado", estilo="Formal", fecha="6 de junio de 2027", turno="Almuerzo",
        invitados="65 personas", menu_infantil="Sí, para 10 chicos",
        estaciones="Clásicos en Laja",
        pastas="Tagliatelle (la incluida) y Ravioloni de espinaca y parmesano",
        salsas="Filetto (la incluida) y Crema de espinaca",
        plato_central="Pechuga tradición",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Cabina de Instagram",
        nota="Quieren dos tortas iguales, una para cada nena, y que se corten al mismo tiempo. "
             "Una en rosa y la otra en celeste.",
    ),
    dict(
        n=15, orden="creador",
        contacto="Gustavo Reyes (papá de Bautista)",
        telefono="11-3378-2290", correo="familia.reyes@gmail.com",
        tipo_evento="Comunión", agasajado=("Agasajado", "Bautista Reyes"),
        espacio="Jardín", estilo="Americano", fecha="2 de mayo de 2027", turno="Almuerzo",
        invitados="50 personas", menu_infantil="Sí, para 14 chicos",
        islas="Bovalino — Pasta Italiana (la incluida) y Dijon — Pollo a la Mostaza",
        postre="Key Lime Pie",
        fin_fiesta="Robot de Luces",
        nota="La misa es en la parroquia de dos cuadras, a las 11 hs. Pide una torta simple con "
             "el cáliz de chocolate arriba y que no haya música fuerte hasta después del postre.",
    ),
    dict(
        n=16, orden="mezcla2",
        contacto="Egresados Colegio San Martín (Sofía Muñoz)",
        telefono="11-5512-6689", correo="egresados.sanmartin@gmail.com",
        tipo_evento="Egresados",
        espacio="Interior", estilo="Formal", fecha="10 de octubre de 2027", turno="Noche",
        invitados="130 personas", menu_infantil="No",
        estaciones="Alma Mexicana y Estación de Crêpes",
        pastas="Tagliatelle (la incluida), Sorrentinos de jamón y queso y Ravioloni de espinaca y parmesano",
        salsas="Filetto (la incluida), Rosé y Bolognesa",
        plato_central="Lomo Reserva",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Música & Entretenimiento, Cotillón Premium y Cabina de Glitter",
        nota="Juntan la plata entre todos los egresados, así que preguntan si se puede pagar en "
             "cuotas. Quieren una torta con el escudo del colegio.",
    ),
    dict(
        n=17, orden="creador",
        contacto="Grupo Logística del Sur (Damián Ferreyra, RRHH)",
        telefono="11-6634-7789", correo="rrhh@logisticadelsur.com.ar",
        tipo_evento="Corporativo",
        espacio="Combinado", estilo="Americano", fecha="15 de diciembre de 2027", turno="Tarde",
        invitados="120 personas", menu_infantil="No",
        islas="Bovalino — Pasta Italiana (la incluida), Bianca — Pollo en Vino Blanco y "
              "Delicias de Mar (premium, a consultar)",
        postre="American Sweet",
        fin_fiesta="Diversos Shows",
        nota="Es la fiesta de fin de año de la empresa. Necesitan pantalla para el sorteo de "
             "regalos y un micrófono para el discurso del dueño antes del postre.",
    ),
    dict(
        n=18, orden="mezcla1",
        contacto="Héctor y Marta Villagra",
        telefono="11-2245-9981", correo="hector.marta.villagra@gmail.com",
        tipo_evento="Otro",
        espacio="Jardín", estilo="Formal", fecha="24 de junio de 2027", turno="Noche",
        invitados="75 personas", menu_infantil="Sí, para 6 chicos",
        estaciones="Sándwiches gourmets y Clásicos en Laja",
        pastas="Tagliatelle (la incluida), Fagotinnis de cordero y romero (gourmet) y "
               "Sorrentinos de jamón y queso",
        salsas="Filetto (la incluida), Bolognesa y Cuatro quesos",
        plato_central="Lomo Dijon",
        mesa_dulces="Pastelería Joliet con el upgrade de Mini Cakes Premium",
        fin_fiesta="Diversos Shows y Robot de Luces",
        nota="Festejan las bodas de plata (25 años). Quieren repetir el vals con la misma canción "
             "de su casamiento y una torta igual a la de aquella vez, en blanco y plateado.",
    ),
    dict(
        n=19, orden="creador",
        contacto="Nadia Ochoa y Braian Sosa",
        telefono="11-4423-6690", correo="nadia.braian.boda@gmail.com",
        tipo_evento="Boda", agasajado=("Agasajados", "Nadia y Braian"),
        espacio="Interior", estilo="Formal", fecha="13 de noviembre de 2027", turno="Tarde",
        invitados="190 personas", menu_infantil="Sí, para 16 chicos",
        estaciones="Alma Mexicana, Estación de Crêpes y Paella Mediterránea (premium, a consultar)",
        pastas="Tagliatelle (la incluida), Sorrentinos de trucha y almendras (gourmet), "
               "Agnolotis de pollo y Ñoquis de papa",
        salsas="Las cuatro permitidas: Filetto (la incluida), Bolognesa, Rosé e Italiana",
        plato_central="Bife del bosque",
        mesa_dulces="Pastelería Joliet",
        fin_fiesta="Candy Bar, Cabina de Fotos y Cotillón Premium Personalizado",
        nota="La ceremonia civil es en el jardín del salón a las 17 hs, antes de la fiesta: piden "
             "sillas blancas para esa parte. La torta va con flores naturales del mismo ramo.",
    ),
    dict(
        n=20, orden="mezcla2",
        contacto="Maximiliano Godoy",
        telefono="11-6678-3345", correo="maxi.godoy40@gmail.com",
        tipo_evento="Cumpleaños", agasajado=("Agasajado", "Maximiliano Godoy"), anios="40 años",
        espacio="Combinado", estilo="Americano", fecha="7 de noviembre de 2027", turno="Noche",
        invitados="110 personas", menu_infantil="No",
        islas="Bovalino — Pasta Italiana (la incluida), Del Bosque — Carne y Hongos y "
              "Delicias de Mar (premium, a consultar)",
        postre="Key Lime Pie",
        fin_fiesta="Robot de Luces, Música & Entretenimiento y Cotillón Premium",
        nota="Quiere que el fin de fiesta sea con banda en vivo de rock nacional y una torta de "
             "chocolate amargo, sin velas: prefiere bengalas.",
    ),
]

ORDENES = {"creador": ORDEN_CREADOR, "mezcla1": MEZCLA_1, "mezcla2": MEZCLA_2}
CHIP_TEXTO = {"creador": "Orden del creador", "mezcla1": "Datos mezclados",
              "mezcla2": "Datos mezclados"}
CHIP_COLOR = {"creador": colors.HexColor("#7A6A52"), "mezcla1": colors.HexColor("#4A5A70"),
              "mezcla2": colors.HexColor("#4A5A70")}

# ---------------------------------------------------------------------------
# Estilos - tipografia grande, alto contraste
# ---------------------------------------------------------------------------
styles = getSampleStyleSheet()

titulo_portada = ParagraphStyle(
    "TituloPortada", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=30, leading=36, alignment=TA_CENTER, textColor=colors.HexColor("#1A1A1A"),
    spaceAfter=14,
)
subtitulo_portada = ParagraphStyle(
    "SubtituloPortada", parent=styles["Normal"], fontName="Helvetica",
    fontSize=17, leading=24, alignment=TA_CENTER, textColor=colors.HexColor("#3A3A3A"),
    spaceAfter=8,
)
instrucciones = ParagraphStyle(
    "Instrucciones", parent=styles["Normal"], fontName="Helvetica",
    fontSize=15, leading=22, alignment=TA_LEFT, textColor=colors.HexColor("#2A2A2A"),
    spaceAfter=6,
)

ficha_numero = ParagraphStyle(
    "FichaNumero", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=15, leading=18, textColor=colors.white,
)
ficha_chip = ParagraphStyle(
    "FichaChip", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=13, leading=17, textColor=colors.white, alignment=TA_CENTER,
)
ficha_label = ParagraphStyle(
    "FichaLabel", parent=styles["Normal"], fontName="Helvetica-Bold",
    fontSize=12.5, leading=15.5, textColor=colors.HexColor("#555555"),
)
ficha_valor = ParagraphStyle(
    "FichaValor", parent=styles["Normal"], fontName="Helvetica",
    fontSize=14, leading=17.5, textColor=colors.HexColor("#1A1A1A"),
)
ficha_notas = ParagraphStyle(
    "FichaNotas", parent=styles["Normal"], fontName="Helvetica-Oblique",
    fontSize=13, leading=17, textColor=colors.HexColor("#333333"),
)


def filas_de(caso):
    """Devuelve [(etiqueta, valor)] en el orden que le toca a la ficha."""
    filas = []
    for clave in ORDENES[caso["orden"]]:
        if clave == "agasajado":
            if caso.get("agasajado"):
                filas.append(caso["agasajado"])
            continue
        valor = caso.get(clave)
        if valor:
            filas.append((ETIQUETAS[clave], valor))
    return filas


def make_card(caso):
    header_tbl = Table(
        [[
            Paragraph(f'Caso Nº {caso["n"]:02d}', ficha_numero),
            Paragraph(CHIP_TEXTO[caso["orden"]], ficha_chip),
        ]],
        colWidths=[8.7 * cm, 5.1 * cm],
    )
    header_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#2B2B2B")),
        ("BACKGROUND", (1, 0), (1, 0), CHIP_COLOR[caso["orden"]]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))

    filas = [[Paragraph(f"{et}:", ficha_label), Paragraph(val, ficha_valor)]
             for et, val in filas_de(caso)]
    datos_tbl = Table(filas, colWidths=[4.7 * cm, 9.1 * cm])
    datos_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#EBE7DE")),
    ]))

    notas_tbl = Table(
        [[Paragraph(f'Nota del pedido: “{caso["nota"]}”', ficha_notas)]],
        colWidths=[13.8 * cm],
    )
    notas_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F4F1EA")),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))

    outer = Table(
        [[header_tbl], [Spacer(1, 10)], [datos_tbl], [Spacer(1, 10)], [notas_tbl]],
        colWidths=[15 * cm],
    )
    outer.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1.3, colors.HexColor("#CFCAC0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))

    return KeepTogether(outer)


def build_pdf():
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=A4,
        leftMargin=1.6 * cm, rightMargin=1.6 * cm,
        topMargin=1.6 * cm, bottomMargin=1.6 * cm,
        title="Fichas de práctica - Casos ficticios",
        author="Salón de Eventos CRM",
    )

    story = []
    story.append(Spacer(1, 2 * cm))
    story.append(Paragraph("Fichas de práctica", titulo_portada))
    story.append(Paragraph("20 casos ficticios para cargar en el creador de propuestas",
                           subtitulo_portada))
    story.append(Spacer(1, 1 * cm))
    story.append(HRFlowable(width="100%", thickness=1.2, color=colors.HexColor("#CFCAC0")))
    story.append(Spacer(1, 0.8 * cm))
    story.append(Paragraph("Cómo usar estas fichas:", ParagraphStyle(
        "ComoUsarTitulo", parent=instrucciones, fontName="Helvetica-Bold",
        fontSize=17, spaceAfter=10)))
    pasos = [
        "1. Elegí una ficha (una por hoja) y abrí el creador de propuestas.",
        "2. Cargá el evento tal como lo pide la persona: tipo de evento, agasajado, espacio, "
        "estilo, fecha, turno, invitados y menú infantil.",
        "3. Seguí con los adicionales del fin de fiesta y con el menú según el estilo: "
        "si es Formal van estaciones, pastas, salsas, plato central y mesa de dulces; "
        "si es Americano van las islas y el postre.",
        "4. La nota del pedido va al final, en “Pedidos especiales”.",
        "5. Guardá el contacto en el sistema y listo.",
    ]
    for p in pasos:
        story.append(Paragraph(p, instrucciones))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(
        "Las fichas marcadas “Orden del creador” traen los datos en el mismo orden que los pide "
        "el sistema. Las marcadas “Datos mezclados” los traen desordenados, como cuando el "
        "cliente cuenta todo junto por teléfono.",
        instrucciones))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "Nota: todos los nombres, teléfonos y datos son inventados, solo para practicar. "
        "Algunas fichas piden opciones premium o gourmet (las que van “a consultar”).",
        ParagraphStyle("Aviso", parent=instrucciones, fontName="Helvetica-Oblique",
                       fontSize=13, textColor=colors.HexColor("#666666"))))
    story.append(PageBreak())

    for i, caso in enumerate(CASOS):
        story.append(make_card(caso))
        if i != len(CASOS) - 1:
            story.append(PageBreak())

    doc.build(story)
    print(f"PDF generado: {OUT_PATH}")


if __name__ == "__main__":
    build_pdf()
