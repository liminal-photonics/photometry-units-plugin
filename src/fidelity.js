// CIE 224:2017 colour fidelity index Rf (identical to IES TM-30-18/-20 Rf) and TM-30 gamut index Rg,
// computed from public CIE data: the 99 CES (CIE_srf_cfi.csv), CIE 1964 10 degree CMFs and CIE daylight components.
import { CES, OBS, resample, planck, daylight, cctDuv, xyFromXYZ, tristimulus } from "./cie.js";

const WL = CES.wl; // 380..780 step 5
const at = (map) => WL.map((w) => map.get(w) || 0);

function referenceSpd(T) {
  const norm = (arr) => { const Y = arr.reduce((s, v, i) => s + v * (OBS["10"].y.get(WL[i]) || 0), 0); return arr.map((v) => (v * 100) / Y); };
  const P = norm(WL.map((w) => planck(w, T)));
  if (T < 4000) return P;
  const d = daylight(Math.min(T, 25000));
  const D = norm(at(resample(d.wl, d.val, 380, 780, 5)));
  if (T >= 5000) return D;
  const m = (T - 4000) / 1000;
  return P.map((p, i) => (1 - m) * p + m * D[i]);
}

const M02 = [[0.7328, 0.4296, -0.1624], [-0.7036, 1.6975, 0.0061], [0.003, 0.0136, 0.9834]];
const MH = [[0.38971, 0.68898, -0.07868], [-0.22981, 1.1834, 0.04641], [0, 0, 1]];
const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function inv3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}
const M02i = inv3(M02);

// CIECAM02 -> CAM02-UCS, La = 100 cd/m2, Yb = 20, average surround, D = 1 (as in CIE 224).
function camUcs(XYZ, W) {
  const La = 100, Yb = 20, F = 1, c = 0.69, Nc = 1, Yw = W[1];
  const k = 1 / (5 * La + 1), FL = 0.2 * k ** 4 * 5 * La + 0.1 * (1 - k ** 4) ** 2 * Math.cbrt(5 * La);
  const n = Yb / Yw, Nbb = 0.725 * n ** -0.2, z = 1.48 + Math.sqrt(n);
  const RGBw = mul(M02, W);
  const adapt = (v) => { const rgb = mul(M02, v).map((x, i) => (Yw / RGBw[i]) * x); return mul(MH, mul(M02i, rgb)); };
  const comp = (x) => { const t = (FL * Math.abs(x) / 100) ** 0.42; return (Math.sign(x) * 400 * t) / (27.13 + t) + 0.1; };
  const [Rw, Gw, Bw] = adapt(W).map(comp);
  const Aw = (2 * Rw + Gw + Bw / 20 - 0.305) * Nbb;
  const [R, G, B] = adapt(XYZ).map(comp);
  const a = R - (12 * G) / 11 + B / 11, b = (R + G - 2 * B) / 9;
  const h = Math.atan2(b, a);
  const A = (2 * R + G + B / 20 - 0.305) * Nbb;
  const J = 100 * (A / Aw) ** (c * z);
  const et = (Math.cos(h + 2) + 3.8) / 4;
  const t = ((50000 / 13) * Nc * Nbb * et * Math.hypot(a, b)) / (R + G + (21 * B) / 20);
  const C = t ** 0.9 * Math.sqrt(J / 100) * (1.64 - 0.29 ** n) ** 0.73;
  const M = C * FL ** 0.25;
  const Jp = (1.7 * J) / (1 + 0.007 * J), Mp = Math.log(1 + 0.0228 * M) / 0.0228;
  return [Jp, Mp * Math.cos(h), Mp * Math.sin(h)];
}

export function fidelity(spdMap) {
  const s = at(spdMap);
  const ok = WL.filter((w) => w >= 380 && w <= 780);
  if (s.every((v) => v === 0)) throw new Error("Spectrum has no power from 380 to 780 nm.");
  const { cct, duv } = cctDuv(xyFromXYZ(tristimulus(spdMap, "2")));
  if (Math.abs(duv) > 0.05) throw new Error(`Rf/Rg are not defined here: |Duv| = ${Math.abs(duv).toFixed(4)} is above 0.05 (the source is not white light).`);
  if (cct < 1000 || cct > 100000) throw new Error("Rf/Rg need a CCT between 1000 K and 100000 K.");
  const ref = referenceSpd(cct);
  const xyz = (S, R) => { let X = 0, Y = 0, Z = 0; for (let i = 0; i < WL.length; i++) { const w = WL[i], p = S[i] * (R ? R[i] : 1); X += p * OBS["10"].x.get(w); Y += p * OBS["10"].y.get(w); Z += p * OBS["10"].z.get(w); } return [X, Y, Z]; };
  const scale = (S) => { const Y = xyz(S)[1]; return S.map((v) => (v * 100) / Y); };
  const St = scale(s), Sr = scale(ref);
  const Wt = xyz(St), Wr = xyz(Sr);
  const T = [], Rr = [];
  for (let j = 0; j < CES.cols.length; j++) { T.push(camUcs(xyz(St, CES.cols[j]), Wt)); Rr.push(camUcs(xyz(Sr, CES.cols[j]), Wr)); }
  const dE = T.map((t, j) => Math.hypot(t[0] - Rr[j][0], t[1] - Rr[j][1], t[2] - Rr[j][2]));
  const toR = (de) => 10 * Math.log(Math.exp((100 - 6.73 * de) / 10) + 1);
  const Rf = toR(dE.reduce((a, b) => a + b, 0) / dE.length);
  // TM-30 gamut index: 16 hue bins by reference hue angle, polygon of mean a', b' per bin.
  const bins = Array.from({ length: 16 }, () => ({ ta: 0, tb: 0, ra: 0, rb: 0, n: 0, de: 0 }));
  for (let j = 0; j < T.length; j++) {
    let h = Math.atan2(Rr[j][2], Rr[j][1]); if (h < 0) h += 2 * Math.PI;
    const b = bins[Math.min(15, Math.floor(h / (Math.PI / 8)))];
    b.ta += T[j][1]; b.tb += T[j][2]; b.ra += Rr[j][1]; b.rb += Rr[j][2]; b.n++; b.de += dE[j];
  }
  const area = (pts) => { let A = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; A += x1 * y2 - x2 * y1; } return Math.abs(A) / 2; };
  const used = bins.filter((b) => b.n);
  const Rg = (100 * area(used.map((b) => [b.ta / b.n, b.tb / b.n]))) / area(used.map((b) => [b.ra / b.n, b.rb / b.n]));
  return {
    Rf: +Rf.toFixed(1), Rg: +Rg.toFixed(1), cct: Math.round(cct), duv: +duv.toFixed(4),
    referenceIlluminant: cct < 4000 ? "Planckian" : cct >= 5000 ? "CIE daylight" : "Planckian/daylight blend",
    hueBinRf: bins.map((b) => (b.n ? +toR(b.de / b.n).toFixed(1) : null)),
    method: "CIE 224:2017 Rf (same as IES TM-30-18/-20 Rf) and TM-30 Rg, from public CIE data at 5 nm, 380-780 nm",
    coverageNote: ok.length ? undefined : undefined,
  };
}
