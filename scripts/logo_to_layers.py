#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "opencv-python-headless", "pillow", "scipy", "potracer"]
# ///
"""Split the Sirius logo PNG into a layered, animatable SVG.

Layers: #ring (crescent), #wolf > #head, #ear-back, #eye, and #star, all filled by one
userSpaceOnUse gradient fitted to the source pixels.

Pipeline:
  1. Alpha mask -> connected components. Largest = ring+wolf (fused at the chest),
     the rest by area: star, ear-back, eye.
  2. Fit the crescent's outer circle (iterative least squares on the outer contour).
  3. Sample the crescent's inner edge r_in(theta) along rays where the ring is clearly
     separate from the wolf; bridge the fused section with monotone (PCHIP)
     interpolation, so the cut never overshoots into the neck.
  4. ring = fused & (r >= r_in(theta)); head = the rest, plus an `--underlap` band that
     continues the neck under the ring so nothing gaps when the ring moves.
  5. Trace each mask with potrace on a 4x-upsampled alpha (sub-pixel edges).
  6. Fit a linear RGB gradient to the opaque pixels and emit it as userSpaceOnUse.

Usage: uv run logo_to_layers.py in.png out.svg [--scale 4] [--underlap 12]
                                     [--max-thick 45] [--smooth 0.6] [--tolerance 0.5]
Deps:  declared inline (PEP 723); `uv run` builds a throwaway env, nothing is installed
       into the repo or any existing venv. potracer is imported as `potrace`.
"""
import argparse

import cv2
import numpy as np
import potrace
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.signal import savgol_filter


def fit_circle(p):
    A = np.c_[2 * p[:, 0], 2 * p[:, 1], np.ones(len(p))]
    x, y, c = np.linalg.lstsq(A, (p ** 2).sum(1), rcond=None)[0]
    return np.array([x, y, np.sqrt(c + x * x + y * y)])


def fit_outer_circle(mask, iters=12, tol=4.0):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    p = max(cs, key=len)[:, 0, :].astype(float)
    x, y, bw, bh = cv2.boundingRect(mask)  # start from the bounding circle
    c = np.array([x + bw / 2, y + bh / 2, max(bw, bh) / 2])
    for _ in range(iters):  # keep only points near the current circle, refit
        r = np.hypot(p[:, 0] - c[0], p[:, 1] - c[1])
        c = fit_circle(p[np.abs(r - c[2]) < tol])
    return c


def ray_runs(mask, cx, cy, ang_deg, rmax, step=0.1):
    t = np.deg2rad(ang_deg)
    rs = np.arange(0, rmax, step)
    xs = np.round(cx + rs * np.cos(t)).astype(int)
    ys = np.round(cy + rs * np.sin(t)).astype(int)
    ok = (xs >= 0) & (xs < mask.shape[1]) & (ys >= 0) & (ys < mask.shape[0])
    v = np.zeros(len(rs), int)
    v[ok] = mask[ys[ok], xs[ok]]
    d = np.diff(np.r_[0, v, 0])
    s, e = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
    return [(rs[a], rs[min(b, len(rs) - 1)]) for a, b in zip(s, e)]


def inner_edge_profile(mask, cx, cy, R, max_thick):
    """r_in(theta) for theta in degrees [0, 360). inf where there is no ring.

    An angle is 'clean' (ring separate from the wolf) only if the outermost run is
    preceded by a gap AND is no thicker than max_thick: the white fur cut-outs also
    create gaps, but the run after them is far too thick to be ring alone.
    """
    present = np.zeros(360, bool)
    r_in = np.full(360, np.nan)
    clean = np.zeros(360, bool)
    for a in range(360):
        runs = ray_runs(mask, cx, cy, a, R + 12)
        if not runs or runs[-1][1] < R - 10:  # outermost run must reach the rim
            continue
        present[a] = True
        r_in[a] = runs[-1][0]
        clean[a] = len(runs) > 1 and runs[-1][1] - runs[-1][0] <= max_thick
    # The ring is one contiguous arc; start just after the largest absent gap.
    absent = ~present
    best_len, best_end, cur = 0, 0, 0
    for i in range(720):  # doubled to handle wrap-around
        cur = cur + 1 if absent[i % 360] else 0
        if cur > best_len:
            best_len, best_end = cur, i % 360
    start = (best_end + 1) % 360
    arc = np.array([(start + k) % 360 for k in range(360 - best_len)])
    known = arc[clean[arc]]
    unwrapped = (known - start) % 360
    vals = savgol_filter(r_in[known], 9, 2) if len(known) > 9 else r_in[known]
    f = PchipInterpolator(unwrapped, vals, extrapolate=False)
    prof = np.full(360, np.inf)  # inf = no ring at this angle
    est = f((arc - start) % 360)
    good = ~np.isnan(est)
    prof[arc[good]] = est[good]
    fused = arc[~clean[arc]]
    return prof, fused


def split_ring(fused_mask, cx, cy, prof, fused_angles, scale, underlap):
    h, w = fused_mask.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float) / scale
    r = np.hypot(xx - cx, yy - cy)
    th = (np.degrees(np.arctan2(yy - cy, xx - cx)) % 360)
    # linear interpolation of the profile between integer degrees
    i0 = np.floor(th).astype(int) % 360
    i1 = (i0 + 1) % 360
    fr = th - np.floor(th)
    p0, p1 = prof[i0], prof[i1]
    rin = np.where(np.isinf(p0) | np.isinf(p1), np.maximum(p0, p1), p0 * (1 - fr) + p1 * fr)
    ring = fused_mask & (r >= rin)
    head = fused_mask & ~ring
    if underlap > 0:
        in_fused = np.isin(i0, fused_angles)
        head |= fused_mask & in_fused & (r < rin + underlap)
    return ring, head


def trace_d(mask_bool, scale, tol, turd=8):
    bm = potrace.Bitmap(~mask_bool)  # potracer traces False pixels as foreground
    path = bm.trace(turdsize=turd * scale * scale, alphamax=1.0, opticurve=True,
                    opttolerance=tol * scale)
    f = lambda p: f"{p.x / scale:.1f},{p.y / scale:.1f}"
    out = []
    for curve in path:
        parts = [f"M{f(curve.start_point)}"]
        for seg in curve.segments:
            if seg.is_corner:
                parts.append(f"L{f(seg.c)}L{f(seg.end_point)}")
            else:
                parts.append(f"C{f(seg.c1)} {f(seg.c2)} {f(seg.end_point)}")
        out.append("".join(parts) + "Z")
    return "".join(out)


def fit_gradient(rgba):
    """Least-squares linear RGB field; returns two endpoints spanning the art."""
    a = rgba[..., 3] == 255
    ys, xs = np.nonzero(a)
    rgb = rgba[ys, xs, :3].astype(float)
    A = np.c_[np.ones(len(xs)), xs, ys]
    coef, *_ = np.linalg.lstsq(A, rgb, rcond=None)  # 3x3: [c0; gx; gy] per channel
    g = coef[1:].T  # per-channel gradient vectors (3x2)
    u, s, vt = np.linalg.svd(g)
    d = vt[0]  # dominant colour-change direction in image space
    proj = xs * d[0] + ys * d[1]
    pmin, pmax = proj.min(), proj.max()
    cx, cy = xs.mean(), ys.mean()
    c0 = cx * d[0] + cy * d[1]
    p1 = np.array([cx, cy]) + (pmin - c0) * d
    p2 = np.array([cx, cy]) + (pmax - c0) * d
    col = lambda p: np.clip(coef[0] + coef[1] * p[0] + coef[2] * p[1], 0, 255)
    resid = rgb - A @ coef
    return p1, p2, col(p1), col(p2), float(np.sqrt((resid ** 2).mean()))


def hexc(c):
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in c)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("out")
    ap.add_argument("--scale", type=int, default=4)
    ap.add_argument("--underlap", type=float, default=12.0)
    ap.add_argument("--max-thick", type=float, default=45.0,
                    help="max plausible crescent thickness in px")
    ap.add_argument("--smooth", type=float, default=0.6,
                    help="edge smoothing sigma (px) for ring and head before tracing")
    ap.add_argument("--tolerance", type=float, default=0.5,
                    help="potrace curve tolerance in output px (higher = smaller file)")
    args = ap.parse_args()
    S = args.scale

    rgba = np.array(Image.open(args.inp).convert("RGBA"))
    h, w = rgba.shape[:2]
    alpha = rgba[..., 3]
    m = (alpha > 128).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    ids = sorted(range(1, n), key=lambda i: -st[i, cv2.CC_STAT_AREA])
    names = ["fused", "star", "ear-back", "eye"]
    if len(ids) < len(names):
        raise SystemExit(f"expected >= {len(names)} components, found {len(ids)}")
    comp = {name: (lab == i).astype(np.uint8) for name, i in zip(names, ids)}

    cx, cy, R = fit_outer_circle(comp["fused"])
    prof, fused_angles = inner_edge_profile(comp["fused"], cx, cy, R, args.max_thick)

    # Upsampled alpha per component for sub-pixel tracing.
    up = cv2.resize(alpha, (w * S, h * S), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    # Blur before threshold removes pixel stair-steps (far fewer curves), but erodes thin
    # sharp tips, so it is applied only to the large shapes (ring, head).
    up_smooth = cv2.GaussianBlur(up, (0, 0), args.smooth * S) if args.smooth > 0 else up
    def upmask(cm, smooth=False):
        region = cv2.resize(cv2.dilate(cm, np.ones((3, 3), np.uint8)), (w * S, h * S),
                            interpolation=cv2.INTER_NEAREST).astype(bool)
        return ((up_smooth if smooth else up) > 128) & region

    fused_up = upmask(comp["fused"], smooth=True)
    ring, head = split_ring(fused_up, cx, cy, prof, fused_angles, S, args.underlap)

    p1, p2, c1, c2, rms = fit_gradient(rgba)
    d = {k: trace_d(v, S, args.tolerance) for k, v in {
        "ring": ring, "head": head, "ear-back": upmask(comp["ear-back"]),
        "eye": upmask(comp["eye"]), "star": upmask(comp["star"])}.items()}

    cs, _ = cv2.findContours(comp["star"], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    mo = cv2.moments(comp["star"])
    scx, scy = mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
  <!-- generated by logo_to_layers.py; ring centre ({cx:.1f}, {cy:.1f}) r={R:.1f};
       star centre ({scx:.1f}, {scy:.1f}); gradient fit rms {rms:.1f}/255 -->
  <defs>
    <linearGradient id="sirius-grad" gradientUnits="userSpaceOnUse"
      x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}">
      <stop offset="0" stop-color="{hexc(c1)}"/>
      <stop offset="1" stop-color="{hexc(c2)}"/>
    </linearGradient>
  </defs>
  <g id="sirius" fill="url(#sirius-grad)" fill-rule="evenodd">
    <g id="wolf" data-pivot="{cx:.1f} {cy + 0.6 * R:.1f}">
      <path id="head" d="{d['head']}"/>
      <path id="ear-back" d="{d['ear-back']}"/>
      <path id="eye" d="{d['eye']}"/>
    </g>
    <path id="ring" data-center="{cx:.1f} {cy:.1f}" d="{d['ring']}"/>
    <path id="star" data-center="{scx:.1f} {scy:.1f}" d="{d['star']}"/>
  </g>
</svg>
'''
    with open(args.out, "w") as fh:
        fh.write(svg)
    print(f"ring centre=({cx:.1f},{cy:.1f}) R={R:.1f}; fused arc degrees={len(fused_angles)}; "
          f"gradient {hexc(c1)}->{hexc(c2)} rms={rms:.1f}; wrote {args.out}")


if __name__ == "__main__":
    main()
