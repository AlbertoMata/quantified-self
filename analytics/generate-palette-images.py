#!/usr/bin/env python3
"""Render the Monokai dashboard palette as PNGs.

Two outputs, both written next to this script:

  monokai-palette-extract.png   fed to Looker Studio's "extract theme from
                                image" — area is weighted so the extractor
                                lands on the surfaces and the four accents
  monokai-palette-swatches.png  the full token reference

No third-party deps: writes PNG bytes directly (see _png below).
Hexes come from monokai-dashboard-palette.md — change them there first.
"""
import os
import struct
import zlib

P = {
    "page": "#272822", "card": "#1e1f1c", "border": "#3e3d32",
    "grid": "#34332e", "axis": "#595852",
    "ink": "#f8f8f2", "ink2": "#bfbeb5", "ink3": "#8b8980",
    "done": "#bae493", "missed": "#fea0b1", "pending": "#cf9e4c",
    "not_due": "#7b7a75",
    "done_fill": "#253317", "missed_fill": "#543238", "pending_fill": "#544225",
    "cat1": "#2db2c0", "cat2": "#dd8e68", "cat3": "#b7aafe", "cat4": "#a1c580",
    "seq": ["#425c27", "#5d7c3e", "#7a9e58", "#9ac075", "#bae493"],
    "div": ["#fea0b1", "#b98c93", "#757471", "#97ab87", "#bae493"],
}


def _hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.px = bytearray(bytes(_hexrgb(bg)) * (w * h))

    def _blend(self, x, y, rgb, a):
        if a <= 0 or not (0 <= x < self.w and 0 <= y < self.h):
            return
        i = (y * self.w + x) * 3
        if a >= 1:
            self.px[i:i + 3] = bytes(rgb)
            return
        for k in range(3):
            self.px[i + k] = round(self.px[i + k] * (1 - a) + rgb[k] * a)

    def round_rect(self, x, y, w, h, radius, color):
        """Rounded rect, corners anti-aliased by 4x4 supersampling."""
        rgb = _hexrgb(color)
        r = min(radius, w / 2, h / 2)
        x1, y1 = x + w, y + h
        for py in range(int(y) - 1, int(y1) + 2):
            for px in range(int(x) - 1, int(x1) + 2):
                straight = (x + r <= px and px + 1 <= x1 - r and y <= py and py + 1 <= y1) or \
                           (x <= px and px + 1 <= x1 and y + r <= py and py + 1 <= y1 - r)
                if straight:
                    self._blend(px, py, rgb, 1.0)
                    continue
                hits = 0
                for sy in range(4):
                    for sx in range(4):
                        cx, cy = px + (sx + 0.5) / 4, py + (sy + 0.5) / 4
                        if not (x <= cx <= x1 and y <= cy <= y1):
                            continue
                        qx = x + r if cx < x + r else (x1 - r if cx > x1 - r else cx)
                        qy = y + r if cy < y + r else (y1 - r if cy > y1 - r else cy)
                        if (cx - qx) ** 2 + (cy - qy) ** 2 <= r * r + 1e-9:
                            hits += 1
                if hits:
                    self._blend(px, py, rgb, hits / 16)

    def save(self, path):
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)
            raw += self.px[y * self.w * 3:(y + 1) * self.w * 3]

        def chunk(tag, data):
            body = tag + data
            return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)

        out = b"\x89PNG\r\n\x1a\n"
        out += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 2, 0, 0, 0))
        out += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        out += chunk(b"IEND", b"")
        with open(path, "wb") as f:
            f.write(out)
        print(f"wrote {path} ({os.path.getsize(path)} bytes)")


def extract_image(path):
    """Area is the signal: the extractor reads dominant colours, so the page
    is the field, the card is the single largest block, and each accent gets
    an equal, smaller share."""
    c = Canvas(900, 520, P["page"])
    top = [P["done"], P["missed"], P["cat1"], P["cat2"], P["cat3"]]
    x, w, gap = 40, 143, 26
    for i, col in enumerate(top):
        c.round_rect(x + i * (w + gap), 40, w, 230, 16, col)
    # bottom: the card gets the biggest single area, then ink steps
    c.round_rect(40, 300, 470, 180, 16, P["card"])
    c.round_rect(540, 300, 148, 180, 16, P["pending"])
    c.round_rect(718, 300, 70, 180, 16, P["ink3"])
    c.round_rect(806, 300, 54, 180, 16, P["ink"])
    c.save(path)


def swatch_image(path):
    """Every token, one row per role. Each swatch sits on a `border` plate so
    the two surfaces stay visible against the page they are drawn on."""
    rows = [
        ("surfaces + ink", [P["page"], P["card"], P["border"], P["grid"],
                            P["axis"], P["ink3"], P["ink2"], P["ink"]]),
        ("status mids", [P["done"], P["missed"], P["pending"], P["not_due"]]),
        ("status fills", [P["done_fill"], P["missed_fill"], P["pending_fill"]]),
        ("categorical", [P["cat1"], P["cat2"], P["cat3"], P["cat4"]]),
        ("sequential", P["seq"]),
        ("diverging", P["div"]),
    ]
    cell, gap, pad, plate = 84, 14, 24, 3
    cols = max(len(r[1]) for r in rows)
    w = pad * 2 + cols * cell + (cols - 1) * gap
    h = pad * 2 + len(rows) * cell + (len(rows) - 1) * gap
    c = Canvas(w, h, P["page"])
    for ri, (_, row) in enumerate(rows):
        for ci, col in enumerate(row):
            x = pad + ci * (cell + gap)
            y = pad + ri * (cell + gap)
            c.round_rect(x - plate, y - plate, cell + plate * 2, cell + plate * 2, 16, P["border"])
            c.round_rect(x, y, cell, cell, 14, col)
    c.save(path)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    extract_image(os.path.join(here, "monokai-palette-extract.png"))
    swatch_image(os.path.join(here, "monokai-palette-swatches.png"))
