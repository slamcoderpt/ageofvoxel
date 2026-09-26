#!/usr/bin/env python3
"""Measure the tonal range of a frame so lighting can be tuned to numbers, not adjectives.

Usage: python3 scripts/lumstats.py shots/town.png [reference/retold_ss_02.jpg ...]

Prints, per image: overall luminance percentiles (p1 p5 p25 p50 p75 p95 p99),
mean saturation, the share of the frame that is foliage, and the foliage
luminance percentiles (p5 p25 p50 p75 p95) and saturation.

Targets measured from Age of Mythology: Retold (reference/retold_ss_02.jpg):
  overall   p5 0.20  p25 0.31  p50 0.43  p75 0.57  p95 0.78
  foliage   p5 0.19  p25 0.26  p50 0.35  p75 0.43  p95 0.52   saturation ~0.43
  foliage covers ~26% of the frame
"""
import sys

import numpy as np
from PIL import Image


def stats(path):
    im = Image.open(path).convert("RGB").resize((960, 540))
    a = np.asarray(im).astype(float) / 255
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    hsv = np.asarray(im.convert("HSV")).astype(float) / 255
    foliage = (hsv[..., 0] > 0.17) & (hsv[..., 0] < 0.45) & (hsv[..., 1] > 0.25)
    out = {
        "lum p1..p99": np.round(np.percentile(lum, [1, 5, 25, 50, 75, 95, 99]), 3).tolist(),
        "mean sat": round(float(hsv[..., 1].mean()), 3),
        "foliage share": round(float(foliage.mean()), 3),
    }
    if foliage.sum() > 100:
        out["foliage lum p5..p95"] = np.round(np.percentile(lum[foliage], [5, 25, 50, 75, 95]), 3).tolist()
        out["foliage sat"] = round(float(hsv[..., 1][foliage].mean()), 3)
    return out


if __name__ == "__main__":
    for p in sys.argv[1:] or ["reference/retold_ss_02.jpg"]:
        print(p, stats(p))
