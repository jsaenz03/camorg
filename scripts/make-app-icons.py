#!/usr/bin/env python3
"""Assemble src-tauri/icons/icon.ico and icon.icns from the rounded-tile
master rendered by scripts/make-store-assets.mjs (guide/store-assets/build/
appicon-1024.png).

Run:  python3 scripts/make-app-icons.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "guide/store-assets/build/appicon-1024.png"
ICONS = ROOT / "src-tauri/icons"

img = Image.open(SRC)
img.save(ICONS / "icon.ico",
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                (128, 128), (256, 256)])
img.save(ICONS / "icon.icns")
print("wrote icon.ico and icon.icns")
