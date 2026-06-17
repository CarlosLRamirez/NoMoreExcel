#!/usr/bin/env python3
# Genera los íconos PNG del PWA (sin dependencias externas). Salida en frontend/public/.
import zlib, struct, math, os

OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "public")
os.makedirs(OUT, exist_ok=True)

BG = (37, 99, 235)      # azul
RING = (22, 163, 74)    # verde
COIN = (255, 255, 255)  # blanco

def make(size):
    px = bytearray(size * size * 4)
    c = (size - 1) / 2
    rim_outer = size * 0.36
    rim_inner = size * 0.28
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c)
            if d <= rim_inner:
                r, g, b = COIN
            elif d <= rim_outer:
                r, g, b = RING
            else:
                r, g, b = BG
            i = (y * size + x) * 4
            px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255
    return px

def write_png(path, size, px):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        raw.extend(px[y*stride:(y+1)*stride])
    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    out += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(out)

for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)]:
    write_png(os.path.join(OUT, name), size, make(size))
    print("escrito", name)
