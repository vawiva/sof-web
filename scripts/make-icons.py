"""Draws the project's own, redistributable icon set (a red sight on black) into public/icons/.

The game's own icon is not part of this project: the LAN host serves it from the player's installed SoF.exe at run
time (server/exe-icon.mjs). Usage: python scripts/make-icons.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
RED = (200, 30, 30, 255)
BG = (13, 15, 12, 255)


def sight(size: int, inset: float = 0.0) -> Image.Image:
    """A ring with cross hairs and a centre dot, drawn at 8x and reduced (smooth edges, crisp at small sizes)."""
    s = size * 8
    im = Image.new('RGBA', (s, s), BG)
    d = ImageDraw.Draw(im)
    pad = s * (0.12 + inset)
    w = max(8, round(s * 0.075))
    d.ellipse([pad, pad, s - pad, s - pad], outline=RED, width=w)
    c = s / 2
    gap = s * 0.12
    for a, b in ((pad - s * 0.06, c - gap), (c + gap, s - pad + s * 0.06)):
        d.rectangle([a, c - w / 2, b, c + w / 2], fill=RED)
        d.rectangle([c - w / 2, a, c + w / 2, b], fill=RED)
    r = s * 0.045
    d.ellipse([c - r, c - r, c + r, c + r], fill=RED)
    return im.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, inset in (('favicon-16.png', 16, -0.06), ('favicon-32.png', 32, -0.04), ('apple-touch-icon.png', 180, 0),
                              ('icon-192.png', 192, 0), ('icon-512.png', 512, 0), ('icon-maskable-512.png', 512, 0.1)):
        sight(size, inset).convert('RGB').save(OUT / name, optimize=True)
    print('written to', OUT)


if __name__ == '__main__':
    main()
