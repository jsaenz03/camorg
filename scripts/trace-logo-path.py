#!/usr/bin/env python3
"""Trace the Camog logo mark from the original bitmap into a clean SVG path.

Reads the original 256px master from git (the file in the tree may already
have been regenerated) and produces guide/store-assets/build/glyph-path.json:
{"d": "<svg path d in the 256 viewBox>", "bbox": [x, y, w, h]}.

Pipeline: binary mask at 4x upscale -> Moore-neighbour contour of each
component -> Ramer-Douglas-Peucker simplify -> two Chaikin corner-cut passes
for smooth curves -> light re-simplify. The traced path stays faithful to the
original mark by construction (no hand-fitted geometry).

Run:  python3 scripts/trace-logo-path.py
"""

import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "guide/store-assets/build/glyph-path.json"
S = 4  # trace in a 1024x1024 upscale of the 256 master


def load_mask() -> np.ndarray:
    blob = subprocess.run(
        ["git", "-C", str(ROOT), "show", "HEAD:src-tauri/assets/logo.png"],
        check=True, capture_output=True,
    ).stdout
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        f.write(blob)
        f.flush()
        alpha = np.asarray(Image.open(f.name).convert("RGBA"))[:, :, 3]
    big = np.asarray(
        Image.fromarray(alpha).resize((256 * S, 256 * S), Image.BICUBIC)
    ).astype(float) / 255.0
    return big > 0.5


def contours(mask: np.ndarray):
    """Closed boundary rings of each 8-connected component, by crack
    following: walk the unit edges between foreground and background cells.
    Deterministic — no diagonal-touch ambiguity like Moore tracing."""
    rings = []
    lab, n = ndimage.label(mask)
    # directed edge directions: 0=E, 1=W, 2=N, 3=S (fg kept on the right)
    # arriving-direction -> outgoing preference (right turn first)
    cw_order = {0: [3, 0, 2, 1], 1: [2, 1, 3, 0], 2: [0, 2, 1, 3], 3: [1, 3, 0, 2]}
    for comp in range(1, n + 1):
        m = np.pad(lab == comp, 1)
        if m.sum() < 64:
            continue
        edges = {}

        def add(a, b, d):
            edges.setdefault(a, []).append([b, d])

        rs, cs = np.nonzero(m)
        for r, c in zip(rs, cs):
            if not m[r - 1, c]: add((c, r), (c + 1, r), 0)
            if not m[r + 1, c]: add((c + 1, r + 1), (c, r + 1), 1)
            if not m[r, c - 1]: add((c, r + 1), (c, r), 2)
            if not m[r, c + 1]: add((c + 1, r), (c + 1, r + 1), 3)

        while edges:
            start_v = next(iter(edges))
            start_e = edges[start_v][0]
            ring = [start_v]
            cur, cd = start_v, start_e[1]
            while True:
                outs = edges.get(cur)
                if not outs:
                    break
                nxt_i = None
                for pd in cw_order[cd]:
                    for i, (_, dd) in enumerate(outs):
                        if dd == pd:
                            nxt_i = i
                            break
                    if nxt_i is not None:
                        break
                if nxt_i is None:
                    break
                nxt_v, nxt_d = outs.pop(nxt_i)
                if not outs:
                    del edges[cur]
                ring.append(nxt_v)
                cur, cd = nxt_v, nxt_d
                if cur == start_v:
                    break
            if len(ring) > 8:
                rings.append(np.array([(float(x), float(y)) for x, y in ring]))
    rings.sort(key=len, reverse=True)
    return rings


def rdp_ring(points: np.ndarray, eps: float) -> np.ndarray:
    """Ramer-Douglas-Peucker on a closed ring."""

    def rdp_open(p):
        if len(p) <= 2:
            return p
        a, b = p[0], p[-1]
        ab = b - a
        ap = p - a
        ab_len = np.hypot(*ab)
        if ab_len == 0:
            dist = np.hypot(ap[:, 0], ap[:, 1])
        else:
            dist = np.abs(ab[0] * ap[:, 1] - ab[1] * ap[:, 0]) / ab_len
        i = int(np.argmax(dist))
        if dist[i] > eps:
            left = rdp_open(p[: i + 1])
            right = rdp_open(p[i:])
            return np.vstack([left[:-1], right])
        return np.array([a, b])

    pts = np.vstack([points, points[:1]])
    b_idx = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    halves = [pts[: b_idx + 1], np.vstack([pts[b_idx:], pts[:1]])]
    out = [rdp_open(h) for h in halves]
    return np.vstack([out[0][:-1], out[1][:-1]])


def chaikin(points: np.ndarray, passes: int = 2) -> np.ndarray:
    """Closed-ring Chaikin corner cutting (75/25 rule)."""
    for _ in range(passes):
        nxt = np.roll(points, -1, axis=0)
        pts = np.empty((points.shape[0] * 2, 2))
        pts[0::2] = 0.75 * points + 0.25 * nxt
        pts[1::2] = 0.25 * points + 0.75 * nxt
        points = pts
    return points


def path_d(ring: np.ndarray) -> str:
    """Ring (1024-space) -> compact SVG path in the 256 viewBox."""
    q = np.round(ring / S, 1)
    kept = [q[0]]
    for p in q[1:]:
        if abs(p[0] - kept[-1][0]) >= 0.4 or abs(p[1] - kept[-1][1]) >= 0.4:
            kept.append(p)
    d = f"M {kept[0][0]:.1f} {kept[0][1]:.1f} "
    d += " ".join(f"L {p[0]:.1f} {p[1]:.1f}" for p in kept[1:])
    return d + " Z"


def main():
    mask = load_mask()
    comps = contours(mask)
    body, lens = comps[0], comps[1]

    def clean(ring):
        r = rdp_ring(ring, 1.4)
        r = chaikin(r, 2)
        return rdp_ring(r, 0.35)

    body_c, lens_c = clean(body), clean(lens)
    all_pts = np.vstack([body_c, lens_c]) / S
    bbox = [all_pts[:, 0].min(), all_pts[:, 1].min(),
            np.ptp(all_pts[:, 0]), np.ptp(all_pts[:, 1])]
    d = path_d(body_c) + " " + path_d(lens_c)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"d": d, "bbox": [round(float(v), 2) for v in bbox]}))
    print(f"wrote {OUT} ({len(body_c)} body pts, {len(lens_c)} lens pts, "
          f"bbox={[round(float(v), 1) for v in bbox]})")


if __name__ == "__main__":
    main()
