/**
 * Perceptual colour distance, shared by the tests that make claims about it.
 *
 * Lives here rather than in `src/` because nothing the application does needs
 * it: the viewer picks colours, and only the tests measure whether the picks
 * are far enough apart. It is shared because two test files now make that kind
 * of claim — the beam dim, over the shipped palette, and the derived hues, over
 * the structures a pack groups as siblings — and two copies of forty lines of
 * dE2000 would eventually disagree.
 */
export type Rgb = [number, number, number];

export function rgbOf(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** sRGB (0-255) -> CIE Lab, D65. */
export function lab([r, g, b]: Rgb): [number, number, number] {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * CIE dE2000, the standard perceptual difference.
 *
 * Written out rather than pulled in: it is forty lines that never change, and
 * the alternative is a runtime dependency for two colours' worth of arithmetic
 * in a repository whose whole shipped dependency list is four packages long.
 */
export function separation(first: Rgb, second: Rgb): number {
  const [l1, a1, b1] = lab(first);
  const [l2, a2, b2] = lab(second);

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  // The a* axis is stretched for low-chroma colours, which is what fixes Lab's
  // over-estimate of the difference between two near-greys.
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  const hueOf = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const degrees = (Math.atan2(b, a) * 180) / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  };
  const h1 = hueOf(a1p, b1);
  const h2 = hueOf(a2p, b2);

  const dL = l2 - l1;
  const dC = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin((dh * Math.PI) / 360);

  const meanL = (l1 + l2) / 2;
  const meanCp = (c1p + c2p) / 2;
  let meanH = h1 + h2;
  if (c1p * c2p !== 0) {
    meanH = Math.abs(h1 - h2) > 180
      ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2
      : (h1 + h2) / 2;
  }

  const t = 1
    - 0.17 * Math.cos(((meanH - 30) * Math.PI) / 180)
    + 0.24 * Math.cos((2 * meanH * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * meanH + 6) * Math.PI) / 180)
    - 0.2 * Math.cos(((4 * meanH - 63) * Math.PI) / 180);

  const sL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanCp;
  const sH = 1 + 0.015 * meanCp * t;
  // The blue-violet rotation term — the reason plain Lab distance is wrong for
  // the aortic wall and its ring.
  const rotation = -Math.sin((2 * 30 * Math.exp(-(((meanH - 275) / 25) ** 2)) * Math.PI) / 180)
    * 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));

  return Math.sqrt(
    (dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rotation * (dC / sC) * (dH / sH),
  );
}

