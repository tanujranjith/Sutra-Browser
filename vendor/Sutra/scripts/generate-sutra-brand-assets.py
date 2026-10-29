#!/usr/bin/env python3
"""
generate-sutra-brand-assets.py
──────────────────────────────
Reads the two canonical Sutra master PNGs and produces all required
derivative icons + favicon.ico for the Sutra app.

Usage:
    python scripts/generate-sutra-brand-assets.py

Prerequisites:
    pip install Pillow

Master inputs (must exist before running):
    assets/brand/sutra/sutra-app-icon-master.png
    assets/brand/sutra/sutra-assistant-icon-master.png

All derivatives are written to:
    assets/brand/sutra/generated/

The script is safe to rerun; it overwrites existing derivatives.
"""

import sys
import os
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("ERROR: Pillow is not installed.  Run: pip install Pillow")

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT        = Path(__file__).resolve().parent.parent
BRAND_DIR   = ROOT / "assets" / "brand" / "sutra"
GEN_DIR     = BRAND_DIR / "generated"
MASTER_APP  = BRAND_DIR / "sutra-app-icon-master.png"
MASTER_ASST = BRAND_DIR / "sutra-assistant-icon-master.png"

# ── Derivative specs ─────────────────────────────────────────────────────────

APP_SIZES = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]
ASST_SIZES = [32, 44, 64, 96, 128, 192, 256, 512]
ICO_SIZES  = [16, 32, 48, 64]   # embedded in favicon.ico

# ── Helpers ──────────────────────────────────────────────────────────────────

def high_quality_resize(img: Image.Image, size: int) -> Image.Image:
    """
    Resize to size×size preserving aspect ratio (should be 1:1 for icons).
    Uses LANCZOS (highest quality) resampling.
    Preserves RGBA so the rounded-corner transparency and glow remain intact.
    """
    img = img.convert("RGBA")
    return img.resize((size, size), Image.LANCZOS)


def write_png(img: Image.Image, path: Path) -> None:
    img.save(path, format="PNG", optimize=True)
    print(f"  wrote  {path.relative_to(ROOT)}")


def write_ico(master: Image.Image, path: Path, sizes: list[int]) -> None:
    frames = [high_quality_resize(master, s) for s in sizes]
    frames[0].save(
        path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=frames[1:],
    )
    print(f"  wrote  {path.relative_to(ROOT)}  [{', '.join(str(s) for s in sizes)}]")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    # Guard: masters must exist
    for p in (MASTER_APP, MASTER_ASST):
        if not p.exists():
            sys.exit(f"ERROR: Master asset missing: {p.relative_to(ROOT)}\n"
                     "  Place the approved PNG at that path and rerun.")

    GEN_DIR.mkdir(parents=True, exist_ok=True)

    # ── Main Sutra app icon derivatives ──────────────────────────────────────
    print(f"\nLoading master:  {MASTER_APP.relative_to(ROOT)}")
    app_master = Image.open(MASTER_APP).convert("RGBA")
    w, h = app_master.size
    print(f"  original size: {w}×{h}")

    print("\nGenerating main Sutra icon derivatives …")
    for size in APP_SIZES:
        resized = high_quality_resize(app_master, size)
        write_png(resized, GEN_DIR / f"sutra-icon-{size}.png")

    # favicon.ico  (multi-resolution: 16, 32, 48, 64)
    write_ico(app_master, GEN_DIR / "favicon.ico", ICO_SIZES)

    # ── Sutra Assistant icon derivatives ─────────────────────────────────────
    print(f"\nLoading master:  {MASTER_ASST.relative_to(ROOT)}")
    asst_master = Image.open(MASTER_ASST).convert("RGBA")
    w, h = asst_master.size
    print(f"  original size: {w}×{h}")

    print("\nGenerating Sutra Assistant icon derivatives …")
    for size in ASST_SIZES:
        resized = high_quality_resize(asst_master, size)
        write_png(resized, GEN_DIR / f"sutra-assistant-icon-{size}.png")

    # ── Summary ───────────────────────────────────────────────────────────────
    all_files = sorted(GEN_DIR.glob("*"))
    print(f"\nOK  {len(all_files)} file(s) in {GEN_DIR.relative_to(ROOT)}/")
    total_bytes = sum(f.stat().st_size for f in all_files)
    print(f"   Total size: {total_bytes / 1024:.1f} KB")
    print("\nDone.")


if __name__ == "__main__":
    main()
