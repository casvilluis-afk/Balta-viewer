"""Dibuja los diagramas del manual (img/dg_*.svg) con el mismo estilo del documento.
Uso: python3 diagramas.py"""
import os
AZ, TINTA, GRIS, LINEA, AMB = '#0b4f96', '#1d2329', '#6b7480', '#c9d1d9', '#a8650a'
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img')


class Dg:
    def __init__(s, w, h):
        s.w, s.h, s.o = w, h, []

    def txt(s, x, y, lines, size=10.5, fill=TINTA, weight=400, anchor='middle', lh=1.25):
        y0 = y - (len(lines) - 1) * size * lh / 2 + size * .35
        for i, l in enumerate(lines):
            s.o.append(f'<text x="{x}" y="{y0 + i * size * lh:.1f}" font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}">{l}</text>')

    def caja(s, x, y, w, h, lines, tipo='n', sub=None):
        if tipo == 'p':
            s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{AZ}"/>')
            s.txt(x + w / 2, y + h / 2, lines, fill='#fff', weight=600)
        elif tipo == 'fin':
            s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="#fff" stroke="{TINTA}" stroke-width="1"/>')
            s.txt(x + w / 2, y + h / 2, lines, weight=600)
        elif tipo == 'aviso':
            s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#fdf3e3" stroke="{AMB}" stroke-width="1"/>')
            s.txt(x + w / 2, y + h / 2, lines, fill='#6b4306')
        else:
            s.o.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="#fff" stroke="{AZ}" stroke-width="1"/>')
            s.txt(x + w / 2, y + h / 2, lines)
        if sub:
            s.txt(x + w / 2, y + h + 11, [sub], size=8.5, fill=GRIS)

    def rombo(s, cx, cy, w, h, lines):
        s.o.append(f'<polygon points="{cx},{cy-h/2} {cx+w/2},{cy} {cx},{cy+h/2} {cx-w/2},{cy}" fill="#eef4fb" stroke="{AZ}" stroke-width="1"/>')
        s.txt(cx, cy, lines, size=9.5, weight=600)

    def flecha(s, pts, lbl=None, lpos=None, dash=False, anchor='middle'):
        d = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
        da = ' stroke-dasharray="4 3"' if dash else ''
        s.o.append(f'<path d="{d}" fill="none" stroke="{GRIS}" stroke-width="1"{da} marker-end="url(#f)"/>')
        if lbl:
            x, y = lpos
            s.txt(x, y, [lbl], size=8.5, fill=GRIS, weight=600, anchor=anchor)

    def etiqueta(s, x, y, t):
        s.o.append(f'<text x="{x}" y="{y}" font-size="8" fill="{GRIS}" letter-spacing="1.2" font-weight="600">{t}</text>')

    def linea(s, x1, y1, x2, y2):
        s.o.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{LINEA}" stroke-width="1"/>')

    def guardar(s, nombre):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.w} {s.h}" width="{s.w}" height="{s.h}" '
                f'font-family="\'Source Sans 3\', \'Segoe UI\', Arial, sans-serif">'
                f'<defs><marker id="f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0,1 L9,5 L0,9 z" fill="{GRIS}"/></marker></defs>')
        open(os.path.join(D, nombre), 'w', encoding='utf-8').write(head + ''.join(s.o) + '</svg>')


# 1 · Ciclo de trabajo con la plataforma (capítulo 2)
g = Dg(600, 262)
g.etiqueta(14, 16, 'UNA SOLA VEZ, AL REGISTRAR EL PUENTE')
g.caja(14, 28, 160, 46, ['Escanear el puente', '(láser o dron)'], sub='en campo')
g.caja(220, 28, 160, 46, ['Registrar el puente', 'pasos 1 a 4'], 'p', sub='Gemelo digital')
g.caja(426, 28, 160, 46, ['Entrenar la IA', 'pasos 5 a 7'], 'p', sub='Gemelo digital')
g.flecha([(174, 51), (218, 51)]); g.flecha([(380, 51), (424, 51)])
g.linea(14, 112, 586, 112)
g.etiqueta(150, 130, 'EN CADA CAMPAÑA DE MONITOREO')
g.caja(14, 140, 128, 50, ['Medir la', 'vibración'], sub='en campo')
g.caja(162, 140, 128, 50, ['Diagnóstico', 'con IA'], 'p', sub='Monitoreo con IA')
g.caja(310, 140, 128, 50, ['Inspección', 'dirigida (MTC)'], 'p', sub='Inspección y gestión')
g.caja(458, 140, 128, 50, ['Estado del puente', 'y mantenimiento'], 'p', sub='Inicio')
g.flecha([(142, 165), (160, 165)]); g.flecha([(290, 165), (308, 165)]); g.flecha([(438, 165), (456, 165)])
g.flecha([(560, 76), (560, 100), (110, 100), (110, 138)])
g.flecha([(560, 192), (560, 238), (40, 238), (40, 192)], 'siguiente campaña', (300, 252))
g.guardar('dg_ciclo.svg')

# 2 · Qué se obtiene de la nube en el paso 2 (sección 4.4)
g = Dg(600, 238)
g.caja(6, 92, 92, 44, ['Nube de', 'puntos'], 'fin')
g.caja(122, 92, 100, 44, ['Tablero', 'y apoyos'])
g.caja(246, 92, 100, 44, ['Elementos', 'del puente'], sub='2.2 · modelo IFC')
g.caja(372, 14, 100, 44, ['Completitud', 'por cara'], sub='2.3')
g.caja(372, 170, 100, 44, ['Desviaciones', 'de forma'], sub='2.4')
g.caja(494, 14, 100, 44, ['Nube', 'completada'], sub='2.3 · autovalidada')
g.caja(494, 92, 100, 44, ['Evidencia por', 'elemento'], 'p', sub='2.5')
g.caja(494, 170, 100, 44, ['Ficha de', 'inspección MTC'], 'fin', sub='capítulo 6')
g.flecha([(98, 114), (120, 114)]); g.flecha([(222, 114), (244, 114)])
g.flecha([(346, 104), (358, 104), (358, 36), (370, 36)]); g.flecha([(346, 124), (358, 124), (358, 192), (370, 192)])
g.flecha([(472, 36), (492, 36)]); g.flecha([(472, 46), (482, 46), (482, 106), (492, 106)])
g.flecha([(472, 182), (482, 182), (482, 124), (492, 124)]); g.flecha([(580, 136), (580, 168)])
g.guardar('dg_paso2.svg')

# 3 · Autovalidación de las reglas de completado (sección 4.4)
g = Dg(600, 176)
g.caja(6, 64, 108, 48, ['Ocultar parches', 'de 1,5 m vistos'])
g.caja(134, 64, 108, 48, ['Completarlos con', 'cada regla'])
g.caja(262, 64, 108, 48, ['Contar puntos', 'acertados'])
g.rombo(452, 88, 132, 84, ['¿≥ 50 puntos', 'y ≥ 80 %?'])
g.caja(500, 6, 94, 44, ['Regla activa', 'en este puente'], 'p')
g.caja(500, 126, 94, 44, ['Regla', 'desactivada'], 'aviso')
g.flecha([(114, 88), (132, 88)]); g.flecha([(242, 88), (260, 88)]); g.flecha([(370, 88), (384, 88)])
g.flecha([(452, 46), (452, 28), (498, 28)], 'sí', (462, 40), anchor='start')
g.flecha([(452, 130), (452, 148), (498, 148)], 'no', (462, 142), anchor='start')
g.guardar('dg_autoval.svg')

# 4 · Verificación con Ansys (sección 4.6)
g = Dg(600, 232)
g.etiqueta(6, 14, 'PUENTEGEMELO'); g.etiqueta(206, 14, 'ANSYS MECHANICAL APDL'); g.etiqueta(406, 14, 'PUENTEGEMELO')
g.caja(6, 24, 150, 44, ['Exportar a Ansys', '(.mac)'], 'p')
g.caja(206, 24, 150, 44, ['File › Read Input from', 'y resolver'])
g.caja(406, 24, 188, 44, ['Cargar frecuencias_…txt', 'y modos_…txt'], 'p')
g.flecha([(156, 46), (204, 46)]); g.flecha([(356, 46), (404, 46)])
g.rombo(500, 128, 150, 78, ['¿Mismo modelo?', '(firma y nodos)'])
g.flecha([(500, 68), (500, 87)])
g.caja(196, 106, 170, 44, ['Aviso en rojo:', 'volver a exportar'], 'aviso')
g.flecha([(425, 128), (368, 128)], 'no', (396, 121))
g.flecha([(196, 128), (81, 128), (81, 70)], dash=True)
g.rombo(500, 204, 170, 52, ['Por modo: |Δf| ≤ 1 %', 'y MAC ≥ 0,95'])
g.flecha([(500, 167), (500, 176)], 'sí', (508, 174), anchor='start')
g.caja(260, 186, 110, 36, ['Modo verificado'], 'fin')
g.flecha([(415, 204), (372, 204)], 'sí', (394, 197))
g.guardar('dg_ansys.svg')

# 5 · Diagnóstico con una medición de vibración (capítulo 5)
g = Dg(600, 180)
g.caja(6, 68, 100, 44, ['Medición', '(CSV)'], 'fin')
g.caja(126, 68, 108, 44, ['Analizar', 'la medición'], 'p')
g.rombo(318, 90, 128, 84, ['¿Hay medición', 'del puente sano?'])
g.caja(400, 8, 110, 44, ['Comparar con', 'la medición sana'])
g.caja(400, 128, 110, 44, ['Comparar con', 'el modelo'])
g.caja(528, 68, 66, 44, ['IA'], 'p', sub='tabla 5.1')
g.flecha([(106, 90), (124, 90)]); g.flecha([(234, 90), (252, 90)])
g.flecha([(318, 48), (318, 30), (398, 30)], 'sí', (328, 42), anchor='start')
g.flecha([(318, 132), (318, 150), (398, 150)], 'no', (328, 144), anchor='start')
g.flecha([(510, 30), (518, 30), (518, 82), (526, 82)]); g.flecha([(510, 150), (518, 150), (518, 98), (526, 98)])
g.guardar('dg_diag.svg')
print('ok')
