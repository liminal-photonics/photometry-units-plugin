// CIE reference data (public CIE datasets, CC BY-SA 4.0, see data/README.md) and core colorimetry.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
function table(name) {
  const rows = readFileSync(join(DIR, name), "utf8").trim().split(/\r?\n/).map((l) => l.split(",").map((v) => (v.trim() === "NaN" ? 0 : Number(v))));
  return { wl: rows.map((r) => r[0]), cols: rows[0].slice(1).map((_, i) => rows.map((r) => r[i + 1])) };
}
const asMap = (t, i) => new Map(t.wl.map((w, k) => [w, t.cols[i][k]]));

export const KM = 683.002; // lm/W, CIE maximum luminous efficacy for photopic vision (with 1 nm V(lambda))
const cmf2 = table("CIE_xyz_1931_2deg.csv");
const cmf10 = table("CIE_xyz_1964_10deg.csv");
const vl = table("CIE_sle_photopic.csv");
const dcomp = table("CIE_illum_Dxx_comp.csv");
export const CES = table("CIE_srf_cfi.csv"); // 99 samples, 380-780 nm at 5 nm
export const D65 = table("CIE_std_illum_D65.csv");
export const FL = table("CIE_illum_FLs.csv");

export const OBS = {
  "2": { x: asMap(cmf2, 0), y: asMap(cmf2, 1), z: asMap(cmf2, 2) },
  "10": { x: asMap(cmf10, 0), y: asMap(cmf10, 1), z: asMap(cmf10, 2) },
};
export const V = asMap(vl, 0);

// Linear interpolation of a (sorted) spectrum onto integer wavelengths with a given step. Outside the data: 0.
export function resample(wl, val, from = 360, to = 830, step = 1) {
  const out = new Map();
  let j = 0;
  for (let w = from; w <= to; w += step) {
    if (w < wl[0] || w > wl[wl.length - 1]) { out.set(w, 0); continue; }
    while (j < wl.length - 2 && wl[j + 1] < w) j++;
    const w0 = wl[j], w1 = wl[j + 1] ?? w0;
    const t = w1 === w0 ? 0 : (w - w0) / (w1 - w0);
    out.set(w, val[j] + t * ((val[j + 1] ?? val[j]) - val[j]));
  }
  return out;
}

export function tristimulus(spd, observer = "2", step = 1) {
  const o = OBS[observer];
  let X = 0, Y = 0, Z = 0;
  for (const [w, s] of spd) { X += s * (o.x.get(w) || 0); Y += s * (o.y.get(w) || 0); Z += s * (o.z.get(w) || 0); }
  return { X: X * step, Y: Y * step, Z: Z * step };
}

export function xyFromXYZ({ X, Y, Z }) {
  const s = X + Y + Z;
  if (!(s > 0)) throw new Error("Tristimulus values sum to zero; the spectrum has no visible power.");
  return { x: X / s, y: Y / s };
}
export const uvPrime = ({ x, y }) => { const d = -2 * x + 12 * y + 3; return { u: (4 * x) / d, v: (9 * y) / d }; };
export const xyFromUvPrime = ({ u, v }) => { const d = 6 * u - 16 * v + 12; return { x: (9 * u) / d, y: (4 * v) / d }; };
export const uv1960 = (xy) => { const p = uvPrime(xy); return { u: p.u, v: (p.v * 2) / 3 }; };

// Planck's law, relative spectral radiance. c2 per CIE 015:2018.
const C2 = 1.4388e-2;
export const planck = (wlNm, T) => { const l = wlNm * 1e-9; return 1 / (l ** 5 * (Math.exp(C2 / (l * T)) - 1)); };

const planckUvCache = new Map();
export function planckUv(T) {
  const k = Math.round(T * 100);
  if (planckUvCache.has(k)) return planckUvCache.get(k);
  const spd = new Map();
  for (const w of OBS["2"].x.keys()) spd.set(w, planck(w, T));
  const r = uv1960(xyFromXYZ(tristimulus(spd, "2")));
  planckUvCache.set(k, r);
  return r;
}

// CCT and Duv by direct minimization of the distance to the Planckian locus in CIE 1960 uv (2 degree observer).
// Equivalent to Ohno (2014) to well under 1 K. Duv is positive above the locus.
export function cctDuv(xy) {
  const { u, v } = uv1960(xy);
  const d = (T) => { const p = planckUv(T); return Math.hypot(u - p.u, v - p.v); };
  let best = 1000, bd = Infinity;
  for (let lt = Math.log(1000); lt <= Math.log(100000); lt += 0.005) { const T = Math.exp(lt); const dd = d(T); if (dd < bd) { bd = dd; best = T; } }
  let a = best * Math.exp(-0.006), b = best * Math.exp(0.006);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) { const c = b - g * (b - a), e = a + g * (b - a); if (d(c) < d(e)) b = e; else a = c; }
  const T = (a + b) / 2;
  const p = planckUv(T);
  const sign = v - p.v >= 0 ? 1 : -1;
  return { cct: T, duv: sign * Math.hypot(u - p.u, v - p.v), atLimit: T < 1001 || T > 99000 };
}

// CIE daylight illuminant for a correlated colour temperature (CIE 015:2018 eqs. 4.7-4.10), 5 nm components.
export function daylight(T) {
  if (T < 4000 || T > 25000) throw new Error("CIE daylight is defined from 4000 K to 25000 K.");
  const xd = T <= 7000 ? -4.607e9 / T ** 3 + 2.9678e6 / T ** 2 + 0.09911e3 / T + 0.244063 : -2.0064e9 / T ** 3 + 1.9018e6 / T ** 2 + 0.24748e3 / T + 0.23704;
  const yd = -3 * xd * xd + 2.87 * xd - 0.275;
  const M = 0.0241 + 0.2562 * xd - 0.7341 * yd;
  const M1 = (-1.3515 - 1.7703 * xd + 5.9114 * yd) / M, M2 = (0.03 - 31.4424 * xd + 30.0717 * yd) / M;
  return { wl: dcomp.wl, val: dcomp.wl.map((_, i) => dcomp.cols[0][i] + M1 * dcomp.cols[1][i] + M2 * dcomp.cols[2][i]) };
}
