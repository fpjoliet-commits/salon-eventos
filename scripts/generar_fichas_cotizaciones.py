# -*- coding: utf-8 -*-
"""
Genera un PDF con 5 fichas de eventos ficticios para practicar la carga en el
CRM, cubriendo las tres modalidades de cobro (contado / plan de cuotas / por
cubierto), pagos en USD con cotizacion y egresos imputados al evento.

Cada ficha esta escrita en el orden en que se cargan los datos en el sistema:
Persona -> Evento -> Presupuesto y modalidad -> Menu -> Cobros a registrar ->
Gastos del evento. Tipografia grande (usuario +60) y la ficha nunca se corta
entre paginas.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, HRFlowable
)

OUT_PATH = r"C:\Users\WINDOWS 10\Desktop\Fichas de eventos - Cotizaciones para practicar.pdf"

VERDE = colors.HexColor("#1f6f43")
GRIS = colors.HexColor("#f2f2f2")
GRIS_BORDE = colors.HexColor("#cccccc")

st_titulo = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=19,
                           leading=23, alignment=TA_CENTER, textColor=VERDE)
st_sub = ParagraphStyle("s", fontName="Helvetica", fontSize=11.5, leading=15,
                        alignment=TA_CENTER, textColor=colors.HexColor("#555555"))
st_ficha = ParagraphStyle("f", fontName="Helvetica-Bold", fontSize=15,
                          leading=19, textColor=VERDE)
st_bloque = ParagraphStyle("b", fontName="Helvetica-Bold", fontSize=11.5,
                           leading=15, textColor=colors.HexColor("#333333"))
st_lbl = ParagraphStyle("l", fontName="Helvetica-Bold", fontSize=11, leading=14.5)
st_val = ParagraphStyle("v", fontName="Helvetica", fontSize=11, leading=14.5)
st_nota = ParagraphStyle("n", fontName="Helvetica-Oblique", fontSize=10.2,
                         leading=13.5, textColor=colors.HexColor("#666666"))

FICHAS = [
    {
        "n": 1,
        "titulo": "Boda - paga de contado, en pesos",
        "practica": "Modalidad Contado / pagos sueltos + sena que pasa la fecha a Reservada.",
        "persona": [
            ("Estado", "Confirmado"),
            ("Apellido y nombre", "Ferreyra, Silvina"),
            ("Telefono", "11-4478-2093"),
            ("Gmail", "silvi.ferreyra@gmail.com"),
            ("Origen", "Instagram"),
            ("Tipo de cliente", "Nuevo"),
        ],
        "evento": [
            ("Tipo de evento", "Boda"),
            ("Nombre de los agasajados", "Silvina y Damian"),
            ("Formato", "Formal"),
            ("Fecha del evento", "14/11/2026"),
            ("Estado de la fecha", "Reservada (recien despues de cargar la sena)"),
            ("Cantidad de invitados", "180"),
            ("Turno", "Noche"),
        ],
        "presupuesto": [
            ("Presupuesto", "Si, tiene monto"),
            ("Monto presupuesto", "$ 14.400.000"),
            ("Como paga", "Contado / pagos sueltos"),
        ],
        "menu": [
            ("Estacion de bienvenida", "Clasicos en Laja"),
            ("Primer plato - pastas", "Sorrentinos de jamon y queso + Gnocchis de papa"),
            ("Salsas", "Rose + Cuatro quesos  (Filetto va siempre)"),
            ("Plato central", "Lomo Reserva  (medallones en reduccion de Malbec, milhojas de papa)"),
            ("Mesa de dulces", "Pasteleria Joliet + upgrade Mini Cakes Premium"),
            ("Menu infantil", "Si - 15 chicos"),
        ],
        "cobros": [
            ("Sena", "ARS", "$ 3.000.000", "10/03/2026", "Transferencia",
             "Reserva de fecha"),
            ("Otro", "ARS", "$ 5.000.000", "20/06/2026", "Transferencia",
             "Pago suelto a cuenta"),
            ("Saldo final", "ARS", "$ 6.400.000", "05/11/2026", "Transferencia",
             "Cierre antes del evento"),
        ],
        "egresos": [
            ("14/11/2026", "Personal", "Mozos (6) - rol Mozo", "$ 720.000", "ARS"),
            ("14/11/2026", "Bebidas", "Bebida sin alcohol + vinos", "$ 980.000", "ARS"),
            ("12/11/2026", "Evento", "Alquiler de manteleria", "$ 310.000", "ARS"),
        ],
        "notas": "Al cargar la sena el sistema ofrece pasar la fecha a Reservada: "
                 "aceptar. Los tres gastos van con Tipo de costo = Evento y "
                 "vinculados a este evento.",
    },
    {
        "n": 2,
        "titulo": "XV anos - plan de 6 cuotas en pesos",
        "practica": "Plan de cuotas + imputacion automatica de un pago que cubre mas de una cuota.",
        "persona": [
            ("Estado", "Confirmado"),
            ("Apellido y nombre", "Quiroga, Marcelo"),
            ("Telefono", "11-6612-5540"),
            ("Gmail", "marcequiroga74@gmail.com"),
            ("Origen", "Referido"),
            ("Tipo de cliente", "Referido"),
            ("Referido por", "Ferreyra, Silvina"),
        ],
        "evento": [
            ("Tipo de evento", "XV anos"),
            ("Nombre de la agasajada", "Julieta Quiroga"),
            ("Formato", "Americano"),
            ("Fecha del evento", "27/02/2027"),
            ("Estado de la fecha", "Reservada"),
            ("Cantidad de invitados", "130"),
            ("Turno", "Noche"),
        ],
        "presupuesto": [
            ("Presupuesto", "Si, tiene monto"),
            ("Monto presupuesto", "$ 9.100.000 (precio de contado)"),
            ("Como paga", "Plan de cuotas"),
            ("Plan a cargar", "Total $ 10.200.000 - 6 cuotas de $ 1.700.000 - ARS"),
            ("Primer vencimiento", "10/09/2026"),
        ],
        "menu": [
            ("Islas en vivo", "Bovalino (incluida) + Azteca + Del Bosque"),
            ("Postre", "Africa de autor"),
            ("Torta Homenaje", "Siempre incluida"),
            ("Menu infantil", "No"),
        ],
        "cobros": [
            ("Sena", "ARS", "$ 900.000", "25/08/2026", "Efectivo",
             "Fuera del plan, reserva la fecha"),
            ("Cuota", "ARS", "$ 1.700.000", "10/09/2026", "Transferencia",
             "Cubre la cuota 1"),
            ("Cuota", "ARS", "$ 3.400.000", "12/11/2026", "Transferencia",
             "Un solo pago que cubre las cuotas 2 y 3"),
            ("Cuota", "ARS", "$ 1.000.000", "10/12/2026", "Mercado Pago",
             "Pago parcial de la cuota 4"),
        ],
        "egresos": [
            ("27/02/2027", "Personal", "Maitre - rol Maitre", "$ 180.000", "ARS"),
            ("27/02/2027", "Evento", "DJ y pantalla LED", "$ 640.000", "ARS"),
        ],
        "notas": "El pago del 12/11 hay que dejarlo en imputacion automatica para ver "
                 "como tilda las dos cuotas solo. El de $ 1.000.000 deja la cuota 4 "
                 "pagada a medias.",
    },
    {
        "n": 3,
        "titulo": "Cumpleanos de 50 - por cubierto, en pesos",
        "practica": "Modalidad Por cubierto: cada cobro compra cubiertos y les congela el precio.",
        "persona": [
            ("Estado", "Confirmado"),
            ("Apellido y nombre", "Basualdo, Norma"),
            ("Telefono", "11-3390-7712"),
            ("Gmail", "normabasualdo@gmail.com"),
            ("Origen", "Paso por la puerta"),
            ("Tipo de cliente", "Excliente"),
            ("Nota", "Hizo el bautismo del nieto en 2024"),
        ],
        "evento": [
            ("Tipo de evento", "Cumpleanos - 50"),
            ("Nombre del agasajado", "Ruben Basualdo"),
            ("Formato", "Americano"),
            ("Fecha del evento", "18/04/2027"),
            ("Estado de la fecha", "Reservada"),
            ("Cantidad de invitados", "90"),
            ("Turno", "Noche"),
        ],
        "presupuesto": [
            ("Presupuesto", "Si, tiene monto"),
            ("Monto presupuesto", "$ 5.400.000"),
            ("Como paga", "Por cubierto"),
            ("Precio del cubierto", "$ 60.000"),
        ],
        "menu": [
            ("Islas en vivo", "Bovalino (incluida) + Francesa"),
            ("Postre", "Key Lime Pie"),
            ("Torta Homenaje", "Siempre incluida"),
            ("Menu infantil", "Si - 8 chicos"),
        ],
        "cobros": [
            ("Sena", "ARS", "$ 600.000", "05/10/2026", "Efectivo",
             "10 cubiertos congelados a $ 60.000"),
            ("Otro", "ARS", "$ 1.200.000", "15/12/2026", "Transferencia",
             "20 cubiertos mas, al mismo precio"),
            ("Otro", "ARS", "$ 2.100.000", "20/02/2027", "Transferencia",
             "Ya con el cubierto a $ 70.000 = 30 cubiertos"),
        ],
        "egresos": [
            ("18/04/2027", "Personal", "Mozos (3) - rol Mozo", "$ 360.000", "ARS"),
            ("18/04/2027", "Bebidas", "Cerveza y gaseosas", "$ 420.000", "ARS"),
        ],
        "notas": "Antes del tercer cobro hay que EDITAR el evento y subir el precio del "
                 "cubierto a $ 70.000. Los 30 cubiertos ya comprados tienen que seguir "
                 "valiendo $ 60.000: eso es justamente lo que se esta probando.",
    },
    {
        "n": 4,
        "titulo": "Corporativo - por cubierto, pagos en dolares",
        "practica": "Pago en USD con cotizacion del dolar traida del blue y convertida a cubiertos.",
        "persona": [
            ("Estado", "Confirmado"),
            ("Apellido y nombre", "Molinari, Esteban (Grupo Andes SA)"),
            ("Telefono", "11-5502-8834"),
            ("Gmail", "emolinari@grupoandes.com.ar"),
            ("Origen", "Google"),
            ("Tipo de cliente", "Nuevo"),
        ],
        "evento": [
            ("Tipo de evento", "Corporativo"),
            ("Nombre del agasajado", "Cena anual Grupo Andes"),
            ("Formato", "Formal"),
            ("Fecha del evento", "11/12/2026"),
            ("Estado de la fecha", "Reservada"),
            ("Cantidad de invitados", "140"),
            ("Turno", "Noche"),
        ],
        "presupuesto": [
            ("Presupuesto", "Si, tiene monto"),
            ("Monto presupuesto", "$ 11.200.000"),
            ("Como paga", "Por cubierto"),
            ("Precio del cubierto", "$ 80.000"),
        ],
        "menu": [
            ("Estacion de bienvenida", "Sushi en vivo  (premium, a consultar)"),
            ("Primer plato - pastas", "Ravioloni de espinaca y parmesano"),
            ("Salsas", "Portobellos y ciboulette  (gourmet)"),
            ("Plato central", "Pechuga caprese  (rellena de mozzarella, tomate y albahaca, papas a la suiza)"),
            ("Mesa de dulces", "Pasteleria Joliet"),
            ("Menu infantil", "No"),
        ],
        "cobros": [
            ("Sena", "USD", "U$S 2.000", "18/08/2026", "Transferencia",
             "Cotizacion 1.350 = $ 2.700.000 = 33 cubiertos"),
            ("Otro", "USD", "U$S 3.000", "10/10/2026", "Transferencia",
             "Cotizacion 1.480 (traerla con el boton de refrescar)"),
            ("Saldo final", "ARS", "$ 3.600.000", "01/12/2026", "Cheque",
             "Cierra en pesos, en la misma ficha"),
        ],
        "egresos": [
            ("11/12/2026", "Personal", "Mozos (5) + Barman", "$ 810.000", "ARS"),
            ("11/12/2026", "Evento", "Alquiler de vajilla premium", "$ 540.000", "ARS"),
            ("09/12/2026", "Bebidas", "Vinos y espumantes", "U$S 600", "USD"),
        ],
        "notas": "En los cobros en USD aparece el campo Cotizacion del dolar. Probar el "
                 "boton de refrescar (trae el blue de hoy) y tambien escribir un valor a "
                 "mano. El ultimo gasto va en USD para ver la ficha con las dos monedas.",
    },
    {
        "n": 5,
        "titulo": "Comunion - consulta todavia sin cerrar",
        "practica": "Ficha incompleta: fecha Tentativa, sin cobros, con seguimiento pendiente.",
        "persona": [
            ("Estado", "Por cerrar"),
            ("Apellido y nombre", "Ledesma, Carolina"),
            ("Telefono", "11-2287-6601"),
            ("Gmail", "caroledesma88@gmail.com"),
            ("Origen", "WhatsApp"),
            ("Tipo de cliente", "Nuevo"),
        ],
        "evento": [
            ("Tipo de evento", "Comunion"),
            ("Nombre del agasajado", "Tomas Ledesma"),
            ("Formato", "Americano"),
            ("Fecha del evento", "16/05/2027"),
            ("Estado de la fecha", "Tentativa"),
            ("Cantidad de invitados", "70"),
            ("Turno", "Almuerzo"),
        ],
        "presupuesto": [
            ("Presupuesto", "No sabe"),
            ("Como paga", "Contado / pagos sueltos (a definir)"),
            ("Proximo seguimiento", "29/09/2026"),
        ],
        "menu": [
            ("Islas en vivo", "Bovalino (incluida) + Dijon"),
            ("Postre", "Pavlova de estacion"),
            ("Torta Homenaje", "Siempre incluida"),
            ("Menu infantil", "Si - 25 chicos"),
        ],
        "cobros": [],
        "egresos": [],
        "notas": "No cargar ningun cobro. Probar que el sistema NO deje poner la fecha en "
                 "Reservada sin sena, y que el evento aparezca en Seguimientos pendientes "
                 "con la fecha del 29/09. Cargar tambien la nota interna \"Duda por el "
                 "precio, la llama el jefe el lunes\" y revisar que no se vea en Vista cliente.",
    },
]


def kv_table(pares, ancho):
    data = [[Paragraph(k, st_lbl), Paragraph(v, st_val)] for k, v in pares]
    t = Table(data, colWidths=[ancho * 0.36, ancho * 0.64])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, GRIS_BORDE),
    ]))
    return t


def grid_table(headers, filas, ancho, pesos):
    data = [[Paragraph("<b>%s</b>" % h, st_val) for h in headers]]
    for f in filas:
        data.append([Paragraph(c, st_val) for c in f])
    t = Table(data, colWidths=[ancho * p for p in pesos], repeatRows=1)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, 0), GRIS),
        ("GRID", (0, 0), (-1, -1), 0.4, GRIS_BORDE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def build():
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=A4,
        leftMargin=1.6 * cm, rightMargin=1.6 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        title="Fichas de eventos - Cotizaciones para practicar",
    )
    ancho = doc.width
    story = []

    story.append(Paragraph("Fichas de eventos para practicar la carga", st_titulo))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "5 casos ficticios con cotizaciones distintas. Cubren las tres formas de cobro "
        "(contado, plan de cuotas y por cubierto), pagos en dolares con cotizacion y "
        "gastos imputados al evento.", st_sub))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1, color=VERDE))
    story.append(Spacer(1, 14))

    for f in FICHAS:
        bloque = []
        bloque.append(Paragraph("Ficha %d - %s" % (f["n"], f["titulo"]), st_ficha))
        bloque.append(Paragraph("Que se practica: %s" % f["practica"], st_nota))
        bloque.append(Spacer(1, 8))

        for rotulo, clave in [("Datos de la persona", "persona"),
                              ("Evento", "evento"),
                              ("Presupuesto y modalidad de cobro", "presupuesto"),
                              ("Menu", "menu")]:
            bloque.append(Paragraph(rotulo, st_bloque))
            bloque.append(Spacer(1, 3))
            bloque.append(kv_table(f[clave], ancho))
            bloque.append(Spacer(1, 9))

        if f["cobros"]:
            bloque.append(Paragraph("Cobros a registrar (tab Plan de pago)", st_bloque))
            bloque.append(Spacer(1, 3))
            bloque.append(grid_table(
                ["Tipo", "Mon.", "Monto", "Fecha", "Forma de pago", "Notas"],
                f["cobros"], ancho, [0.11, 0.07, 0.15, 0.13, 0.17, 0.37]))
            bloque.append(Spacer(1, 9))

        if f["egresos"]:
            bloque.append(Paragraph("Gastos del evento (vista Egresos)", st_bloque))
            bloque.append(Spacer(1, 3))
            bloque.append(grid_table(
                ["Fecha", "Categoria", "Concepto", "Monto", "Mon."],
                f["egresos"], ancho, [0.15, 0.18, 0.39, 0.19, 0.09]))
            bloque.append(Spacer(1, 9))

        bloque.append(Paragraph("Ojo: %s" % f["notas"], st_nota))
        bloque.append(Spacer(1, 12))
        bloque.append(HRFlowable(width="100%", thickness=0.8, color=GRIS_BORDE))
        bloque.append(Spacer(1, 14))

        story.append(KeepTogether(bloque))

    doc.build(story)
    print("PDF generado en:", OUT_PATH)


if __name__ == "__main__":
    build()
