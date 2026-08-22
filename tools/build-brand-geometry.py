#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Rasterize the locked Onyx mark and favicon from exact geometry."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

INK = (0x05, 0x07, 0x0A, 255)
STONE = (0x2A, 0x31, 0x38, 255)
STONE_INNER = (0x12, 0x16, 0x1C, 255)
LAPIS = (0x5B, 0xA3, 0xC9, 255)
LAPIS_CORE = (0xC8, 0xE6, 0xF2, 255)
PAPER = (0xE6, 0xE8, 0xEC, 255)
TRANSPARENT = (0, 0, 0, 0)


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if value < lo else hi if value > hi else value


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    t = clamp(t)
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
        int(a[3] + (b[3] - a[3]) * t),
    )


def sdf_circle(x: float, y: float, cx: float, cy: float, r: float) -> float:
    return math.hypot(x - cx, y - cy) - r


def sdf_squircle(x: float, y: float, cx: float, cy: float, half: float, radius: float) -> float:
    px, py = abs(x - cx) - (half - radius), abs(y - cy) - (half - radius)
    outside = math.hypot(max(px, 0.0), max(py, 0.0))
    inside = min(max(px, py), 0.0)
    return outside + inside - radius


def cover(distance: float, aa: float = 1.15) -> float:
    return clamp(0.5 - distance / aa)


def write_png(path: Path, width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixels[y * width + x])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    path.write_bytes(
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b''),
    )


def write_ico(path: Path, png_bytes: bytes, size: int) -> None:
    # PNG-compressed ICO (Windows Vista+ / all current browsers).
    header = struct.pack('<HHH', 0, 1, 1)
    entry = struct.pack('<BBBBHHII', size if size < 256 else 0, size if size < 256 else 0, 0, 0, 1, 32, len(png_bytes), 22)
    path.write_bytes(header + entry + png_bytes)


def paint_mark(size: int, background: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    pixels: list[tuple[int, int, int, int]] = []
    cx = cy = (size - 1) / 2
    squircle_half = size * 0.36
    squircle_radius = size * 0.22
    inner_r = size * 0.215
    gleam_r = size * 0.042
    gleam_cx = cx + inner_r * 0.62
    gleam_cy = cy - inner_r * 0.52
    for y in range(size):
        for x in range(size):
            color = background
            room = cover(sdf_squircle(x, y, cx, cy, squircle_half, squircle_radius))
            if room:
                color = mix(color, STONE, room)
            person = cover(sdf_circle(x, y, cx, cy, inner_r))
            if person:
                color = mix(color, STONE_INNER, person)
            gleam = cover(sdf_circle(x, y, gleam_cx, gleam_cy, gleam_r))
            if gleam:
                core = cover(sdf_circle(x, y, gleam_cx - gleam_r * 0.18, gleam_cy - gleam_r * 0.18, gleam_r * 0.38))
                color = mix(color, LAPIS, gleam)
                color = mix(color, LAPIS_CORE, gleam * core * 0.65)
            pixels.append(color)
    return pixels


def paint_favicon(size: int, background: tuple[int, int, int, int]) -> list[tuple[int, int, int, int]]:
    pixels: list[tuple[int, int, int, int]] = []
    cx = cy = (size - 1) / 2
    stone_r = size * 0.38
    gleam_r = size * 0.11
    gleam_cx = cx + stone_r * 0.38
    gleam_cy = cy - stone_r * 0.38
    for y in range(size):
        for x in range(size):
            color = background
            stone = cover(sdf_circle(x, y, cx, cy, stone_r))
            if stone:
                color = mix(color, STONE_INNER, stone)
            gleam = cover(sdf_circle(x, y, gleam_cx, gleam_cy, gleam_r))
            if gleam:
                core = cover(sdf_circle(x, y, gleam_cx - gleam_r * 0.15, gleam_cy - gleam_r * 0.15, gleam_r * 0.35))
                color = mix(color, LAPIS, gleam)
                color = mix(color, LAPIS_CORE, gleam * core * 0.7)
            pixels.append(color)
    return pixels


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    brand = root / 'public' / 'brand'
    brand.mkdir(parents=True, exist_ok=True)

    mark = paint_mark(512, INK)
    write_png(brand / 'mark.png', 512, 512, mark)
    write_png(root / 'public' / 'favicon-32.png', 32, 32, paint_favicon(32, INK))
    write_png(root / 'public' / 'apple-touch-icon.png', 180, 180, paint_favicon(180, INK))
    write_png(brand / 'favicon.png', 256, 256, paint_favicon(256, INK))

    fav32 = root / 'public' / 'favicon-32.png'
    write_ico(root / 'public' / 'favicon.ico', fav32.read_bytes(), 32)

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="Onyx">
  <rect width="32" height="32" fill="#05070a"/>
  <circle cx="16" cy="16" r="11" fill="#12161c"/>
  <circle cx="21.2" cy="10.8" r="3.1" fill="#5ba3c9"/>
</svg>
"""
    (root / 'public' / 'favicon.svg').write_text(svg, encoding='utf-8')
    print('wrote geometric brand rasters')


if __name__ == '__main__':
    main()
