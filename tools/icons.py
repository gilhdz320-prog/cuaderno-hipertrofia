"""Genera los iconos de la PWA a partir de la marca del cuaderno:
cuadrado oscuro con la H de hipertrofia en crema.

    python3 tools/icons.py
"""
from PIL import Image, ImageDraw

INK = (27, 23, 19, 255)        # #1b1713
CREAM = (243, 239, 230, 255)   # #f3efe6
SIZE = 1024
OUT = "icons"


def rounded(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=fill)
    return img


def draw_h(img, size, scale=1.0):
    """Dibuja una H geométrica centrada, con trazos gruesos."""
    d = ImageDraw.Draw(img)
    w = size * 0.62 * scale          # ancho total de la H
    h = size * 0.58 * scale          # altura
    x0 = (size - w) / 2
    y0 = (size - h) / 2
    stem = w * 0.34                  # grosor del trazo vertical
    bar = h * 0.20                   # grosor del travesaño
    r = stem * 0.22
    # trazos verticales
    d.rounded_rectangle((x0, y0, x0 + stem, y0 + h), radius=r, fill=CREAM)
    d.rounded_rectangle((x0 + w - stem, y0, x0 + w, y0 + h), radius=r, fill=CREAM)
    # travesaño
    d.rounded_rectangle((x0, y0 + (h - bar) / 2, x0 + w, y0 + (h + bar) / 2), radius=r, fill=CREAM)


def make(size, path, maskable=False, radius=0.22):
    if maskable:
        img = Image.new("RGBA", (size, size), INK)
        draw_h(img, size, scale=0.78)
    else:
        img = rounded(size, int(size * radius), INK)
        draw_h(img, size)
    img.save(path, "PNG")
    print(path, img.size)


if __name__ == "__main__":
    import os
    os.makedirs(OUT, exist_ok=True)
    make(192, f"{OUT}/icon-192.png")
    make(512, f"{OUT}/icon-512.png")
    make(512, f"{OUT}/icon-maskable-512.png", maskable=True)
    make(180, f"{OUT}/apple-touch-icon.png", radius=0.0)
