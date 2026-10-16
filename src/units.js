// Photometric conversions, spectrum parsing and SI formatting.
import { resample, tristimulus, xyFromXYZ, uvPrime, xyFromUvPrime, uv1960, cctDuv, V, KM } from "./cie.js";
import { fidelity } from "./fidelity.js";

export const LUX_PER_FC = 10.763910416709722; // 1 fc = 1 lm/ft^2 = 1/0.3048^2 lx (exact by definition of the foot)
export const NIT_PER_FL = 10.763910416709722 / Math.PI; // 1 fL = (1/pi) cd/ft^2 = 3.4262591 cd/m^2

const pos = (v, f) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${f} must be a number of 0 or more.`); return n; };
const req = (v, f) => { if (v == null || v === "") throw new Error(`${f} is required.`); return pos(v, f); };

// Solid angle of a cone with full apex angle theta (degrees).
export const coneSr = (fullAngleDeg) => { const a = req(fullAngleDeg, "beamAngleDeg"); if (a <= 0 || a > 360) throw new Error("beamAngleDeg must be above 0 and at most 360."); return 2 * Math.PI * (1 - Math.cos(((a / 2) * Math.PI) / 180)); };

export function convert(args = {}) { const r = convertRaw(args); if (typeof r.value === "number") r.value = Number(r.value.toPrecision(12)); return r; }
function convertRaw({ quantity, value, from, to, distanceM, beamAngleDeg, areaM2, reflectance, angleDeg = 0 } = {}) {
  const v = req(value, "value");
  const k = String(quantity || "").toLowerCase();
  const u = (s) => String(s || "").toLowerCase().replace(/[^a-z²2/]/g, "");
  if (k === "illuminance") {
    const f = { lx: 1, lux: 1, fc: LUX_PER_FC, footcandle: LUX_PER_FC, footcandles: LUX_PER_FC };
    if (!f[u(from)] || !f[u(to)]) throw new Error(/^(lm|lumens?)$/.test(u(from)) || /^(lm|lumens?)$/.test(u(to)) ? "Lumens measure total flux, not illuminance. Use quantity lumens_to_illuminance with areaM2 (lux = lm/m²)." : `illuminance units: lx (lux) or fc (foot-candles)${/^k/i.test(String(from || ""))+/^k/i.test(String(to || "")) ? ". Prefixed units like klx are not accepted: convert to lx first (1 klx = 1000 lx), and use format_si to show a result as klx" : ""}.`);
    return { value: (v * f[u(from)]) / f[u(to)], unit: u(to) === "fc" || u(to).startsWith("foot") ? "fc" : "lx" };
  }
  if (k === "luminance") {
    const f = { nit: 1, nits: 1, cdm2: 1, "cd/m2": 1, "cd/m²": 1, fl: NIT_PER_FL, footlambert: NIT_PER_FL, footlamberts: NIT_PER_FL };
    if (!f[u(from)] || !f[u(to)]) throw new Error(/^(lx|lux|fc|cd)$/.test(u(from)) || /^(lx|lux|fc|cd)$/.test(u(to)) ? "luminance units: cd/m2 (nit) or fL. Lux is illuminance and cd is intensity; for lux to cd/m2 use quantity illuminance_to_luminance with a reflectance." : "luminance units: cd/m2 (nit) or fL.");
    return { value: (v * f[u(from)]) / f[u(to)], unit: f[u(to)] === 1 ? "cd/m²" : "fL" };
  }
  if (k === "intensity_to_illuminance") {
    const d = req(distanceM, "distanceM"); if (d === 0) throw new Error("distanceM must be above 0.");
    const a = pos(angleDeg, "angleDeg"); if (a >= 90) throw new Error("angleDeg (incidence from the normal) must be below 90.");
    return { value: (v * Math.cos((a * Math.PI) / 180)) / d ** 2, unit: "lx", formula: "E = I·cos(θ)/d² (point source, inverse-square law)" };
  }
  if (k === "illuminance_to_intensity") {
    const d = req(distanceM, "distanceM"); if (d === 0) throw new Error("distanceM must be above 0.");
    return { value: v * d ** 2, unit: "cd", formula: "I = E·d² (on axis)" };
  }
  if (k === "lumens_to_candela" || k === "candela_to_lumens") {
    const sr = beamAngleDeg == null ? 4 * Math.PI : coneSr(beamAngleDeg);
    const note = beamAngleDeg == null ? "isotropic source (4π sr)" : `uniform intensity within a ${beamAngleDeg}° full-angle cone (${sr.toFixed(4)} sr)`;
    return k === "lumens_to_candela" ? { value: v / sr, unit: "cd", assumption: note, formula: "I = Φ/Ω" } : { value: v * sr, unit: "lm", assumption: note, formula: "Φ = I·Ω" };
  }
  if (k === "lumens_to_illuminance") {
    const A = req(areaM2, "areaM2"); if (A === 0) throw new Error("areaM2 must be above 0.");
    return { value: v / A, unit: "lx", formula: "E = Φ/A (flux spread evenly)" };
  }
  if (k === "illuminance_to_luminance" || k === "luminance_to_illuminance") {
    const r = req(reflectance, "reflectance"); if (r <= 0 || r > 1) throw new Error(r > 1 && r <= 100 ? `reflectance is a fraction from 0 to 1; if you meant ${r}%, use ${r / 100}.` : "reflectance must be above 0 and at most 1.");
    return k === "illuminance_to_luminance" ? { value: (r * v) / Math.PI, unit: "cd/m²", formula: "L = ρ·E/π (Lambertian surface)" } : { value: (Math.PI * v) / r, unit: "lx", formula: "E = π·L/ρ (Lambertian surface)" };
  }
  throw new Error("quantity must be one of: illuminance, luminance, intensity_to_illuminance, illuminance_to_intensity, lumens_to_candela, candela_to_lumens, lumens_to_illuminance, illuminance_to_luminance, luminance_to_illuminance.");
}

// Spectrum CSV: two columns (wavelength, value). Accepts headers, comma/semicolon/tab/space, decimal commas with
// semicolon separators, and wavelengths in nm or µm (from the header, or when every wavelength is below 10).
const MAX_POINTS = 200_000;
export function parseSpectrum(input, valueColumn) {
  if (valueColumn != null && (!Number.isInteger(valueColumn) || valueColumn < 2)) throw new Error("valueColumn must be a whole number of 2 or more (column 1 is the wavelength).");
  const vc = (valueColumn ?? 2) - 1;
  if (input && typeof input === "object" && Array.isArray(input.wavelengths)) {
    if (input.wavelengths.length > MAX_POINTS) throw new Error(`spectrum has too many points (${MAX_POINTS} max).`);
    return cleanSpectrum(input.wavelengths.map(Number), (input.values || []).map(Number), "nm");
  }
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("spectrum is empty. Give CSV text with wavelength and value columns.");
  if (text.length > 2_000_000) throw new Error("spectrum is too large (2 MB max).");
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let unit = "nm";
  const wl = [], val = [];
  let extraCols = false;
  for (const l of lines) {
    const semi = l.includes(";") || l.includes("\t");
    let parts = semi ? l.split(/[;\t]/) : l.split(/[,\s]+/);
    if (semi) parts = parts.map((p) => p.replace(",", "."));
    parts = parts.map((p) => p.trim()).filter(Boolean);
    const a = Number(parts[0]), b = Number(parts[vc]);
    if (Number.isFinite(a) && parts.length > vc && parts.length > 2 && valueColumn == null) throw new Error(`Line "${l.slice(0, 60)}" has ${parts.length} columns. Say which column holds the spectral values with valueColumn (column 1 is the wavelength, e.g. valueColumn: 2). If the file uses decimal commas, separate columns with semicolons or tabs.`);
    if (Number.isFinite(a) && parts.length <= vc) throw new Error(`Line "${l.slice(0, 60)}" has no column ${vc + 1} (valueColumn).`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      // header: only a line with letters before any data. A number we cannot read is an error, not a header.
      if (!wl.length && /[a-zµ]/i.test(l) && !Number.isFinite(a)) { if (/µm|um|micro/i.test(l)) unit = "um"; continue; }
      throw new Error(`Could not read line "${l.slice(0, 60)}" as wavelength,value.`);
    }
    if (parts.length > 2) extraCols = true;
    wl.push(a); val.push(b);
  }
  if (wl.length > MAX_POINTS) throw new Error(`spectrum has too many points (${MAX_POINTS} max).`);
  const sp = cleanSpectrum(wl, val, unit);
  if (extraCols) sp.notes.push(`Values taken from column ${vc + 1} (valueColumn).`);
  return sp;
}

function cleanSpectrum(wl, val, unit) {
  if (wl.length < 3 || wl.length !== val.length) throw new Error("A spectrum needs at least 3 wavelength,value pairs of equal length.");
  if (wl.some((x) => !Number.isFinite(x)) || val.some((x) => !Number.isFinite(x))) throw new Error("Spectrum contains non-numeric values.");
  if (unit === "um" || wl.reduce((m, x) => (x > m ? x : m), -Infinity) < 10) wl = wl.map((w) => w * 1000);
  const idx = wl.map((_, i) => i).sort((a, b) => wl[a] - wl[b]);
  const W = idx.map((i) => wl[i]), S = idx.map((i) => val[i]);
  for (let i = 1; i < W.length; i++) if (W[i] === W[i - 1]) throw new Error(`Duplicate wavelength ${W[i]} nm.`);
  const notes = [];
  if (S.some((v) => v < 0)) notes.push("Negative values (detector noise?) were kept as given.");
  let maxStep = 0; for (let i = 1; i < W.length; i++) maxStep = Math.max(maxStep, W[i] - W[i - 1]);
  if (maxStep > 5 + 1e-9) notes.push(`Coarse sampling: some points are ${+maxStep.toFixed(3)} nm apart. CIE 015 and CIE 224 call for 5 nm or finer; values between points are linearly interpolated, so xy, CCT and especially Rf/Rg are approximate. Use 1-5 nm data for reportable results.`);
  if (W[0] > 380 || W[W.length - 1] < 780) notes.push(`Spectrum covers ${W[0]}-${W[W.length - 1]} nm; anything outside is treated as zero. Rf/Rg need 380-780 nm.`);
  return { wl: W, val: S, notes, range: [W[0], W[W.length - 1]], points: W.length };
}

const ABS = { irradiance: { unit: "W/m²/nm", out: "illuminance", outUnit: "lx" }, radiance: { unit: "W/(m²·sr·nm)", out: "luminance", outUnit: "cd/m²" }, flux: { unit: "W/nm", out: "luminous flux", outUnit: "lm" }, intensity: { unit: "W/(sr·nm)", out: "luminous intensity", outUnit: "cd" } };

export function spectrumAnalysis({ spectrum, kind = "irradiance", scaleTo, fidelityIndices = true, valueColumn } = {}) {
  const sp = parseSpectrum(spectrum, valueColumn);
  const kd = ABS[kind]; if (!kd) throw new Error("kind must be irradiance, radiance, flux or intensity.");
  const spd = toGrid(sp);
  let rad = 0; for (let i = 1; i < sp.wl.length; i++) rad += ((sp.val[i] + sp.val[i - 1]) / 2) * (sp.wl[i] - sp.wl[i - 1]); // trapezoid over the given range
  let vint = 0; for (const [w, s] of spd) vint += s * (V.get(w) || 0);
  let phot = KM * vint;
  if (!(rad > 0)) throw new Error("The spectrum has no positive power.");
  let factor = 1;
  if (scaleTo) {
    const t = Number(scaleTo.value);
    if (!(t > 0)) throw new Error("scaleTo.value must be above 0.");
    if (scaleTo.quantity === "radiometric") factor = t / rad; else if (scaleTo.quantity === "photometric") factor = t / phot; else throw new Error("scaleTo.quantity must be radiometric or photometric.");
  }
  const xyz = tristimulus(spd, "2");
  let chromaticity;
  if (!(phot > 0) || !(xyz.X + xyz.Y + xyz.Z > 0)) chromaticity = { error: "No visible power (360-830 nm), so there is no color point." };
  else { try { chromaticity = chroma(xyFromXYZ(xyz)); } catch (e) { chromaticity = { error: e.message }; } }
  if (scaleTo?.quantity === "photometric" && !(phot > 0)) throw new Error("Cannot scale to a photometric total: the spectrum has no visible power (360-830 nm). Use scaleTo.quantity radiometric.");
  const out = {
    points: sp.points, rangeNm: sp.range,
    radiometric: { value: rad * factor, unit: kd.unit.replace("/nm", "").replace("·nm", "") },
    photometric: { quantity: kd.out, value: phot * factor, unit: kd.outUnit },
    luminousEfficacyOfRadiation: { value: phot / rad, unit: "lm/W" },
    chromaticity,
    notes: [...sp.notes, scaleTo ? `Spectrum scaled by ${factor.toPrecision(6)} to match the given ${scaleTo.quantity} total.` : "Values use the spectrum's own absolute scale; give scaleTo to match a measured total."],
    method: `Km = ${KM} lm/W with CIE 1924 V(λ) at 1 nm; chromaticity with CIE 1931 2° CMFs.`,
  };
  if (fidelityIndices && phot > 0) {
    try { out.colorRendition = fidelity(spd); } catch (e) { out.colorRendition = { error: e.message }; }
  }
  return out;
}

// Spectrum onto the 1 nm grid used by the CIE tables. Data at 1 nm or coarser: linear interpolation (as CIE 015).
// Finer data: average over each 1 nm bin, so narrow lines between whole nanometers are not lost.
export function toGrid(sp) {
  let minStep = Infinity; for (let i = 1; i < sp.wl.length; i++) minStep = Math.min(minStep, sp.wl[i] - sp.wl[i - 1]);
  if (minStep >= 1) return resample(sp.wl, sp.val, 360, 830, 1);
  const { wl, val } = sp, out = new Map();
  const at = (x, j) => val[j] + ((x - wl[j]) / (wl[j + 1] - wl[j])) * (val[j + 1] - val[j]);
  for (let w = 360; w <= 830; w++) out.set(w, 0);
  for (let j = 0; j < wl.length - 1; j++) {
    const a = wl[j], b = wl[j + 1];
    for (let w = Math.max(360, Math.round(a)); w <= Math.min(830, Math.round(b)); w++) {
      const lo = Math.max(a, w - 0.5), hi = Math.min(b, w + 0.5);
      if (hi > lo) out.set(w, out.get(w) + ((at(lo, j) + at(hi, j)) / 2) * (hi - lo));
    }
  }
  return out;
}

export function chroma(input = {}) {
  let xy;
  if (input.X != null && ![input.X, input.Y, input.Z].every((q) => q !== "" && q != null && Number.isFinite(Number(q)))) throw new Error("Give all three of X, Y and Z as numbers.");
  if (input.X != null) xy = xyFromXYZ({ X: Number(input.X), Y: Number(input.Y), Z: Number(input.Z) });
  else if (input.x != null) xy = { x: Number(input.x), y: Number(input.y) };
  else if (input.u != null) xy = xyFromUvPrime({ u: Number(input.u), v: Number(input.v) });
  else throw new Error("Give x and y, u' and v' (as u, v), or X, Y and Z.");
  if (![xy.x, xy.y].every(Number.isFinite) || xy.x <= 0 || xy.y <= 0 || xy.x + xy.y >= 1) throw new Error("Chromaticity is outside the valid range (x, y > 0 and x + y < 1).");
  const p = uvPrime(xy), o = uv1960(xy);
  const r = { x: +xy.x.toFixed(5), y: +xy.y.toFixed(5), uPrime: +p.u.toFixed(5), vPrime: +p.v.toFixed(5), u1960: +o.u.toFixed(5), v1960: +o.v.toFixed(5) };
  const c = cctDuv(xy);
  r.duv = +c.duv.toFixed(4);
  if (Math.abs(c.duv) > 0.05) { r.cct = null; r.cctNote = `CCT not reported: |Duv| = ${Math.abs(c.duv).toFixed(4)} is above 0.05, so this color is too far from the blackbody locus for CCT to mean anything.`; }
  else if (c.atLimit) { r.cct = null; r.cctNote = "CCT is outside 1000-100000 K."; }
  else r.cct = Math.round(c.cct);
  return r;
}

const PREFIX = [[1e30, "Q"], [1e27, "R"], [1e24, "Y"], [1e21, "Z"], [1e18, "E"], [1e15, "P"], [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"], [1e-18, "a"], [1e-21, "z"], [1e-24, "y"], [1e-27, "r"], [1e-30, "q"]];
const BASE = new Set(["m", "W", "lm", "lx", "cd", "Hz", "s", "J", "V", "A", "Ω", "g", "W/m²", "W/sr", "cd/m²", "lm/W", "W/(m²·sr)"]);
const NO_SPACE = new Set(["°", "′", "″"]); // SI Brochure 5.4.3: plane-angle degree, minute, second take no space

// SI style: number, a space, the unit (no space only for the angle symbols ° ′ ″). Prefixes in steps of 1000.
// A unit that already carries a prefix (nm, mW, klx) is kept as given.
export function formatSI({ value, unit = "", sigFigs = 3, prefix = true } = {}) {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error("value must be a finite number.");
  if (sigFigs != null && !(Number.isInteger(Number(sigFigs)) && Number(sigFigs) >= 1 && Number(sigFigs) <= 15)) throw new Error("sigFigs must be a whole number from 1 to 15.");
  const s = sigFigs == null ? 3 : Number(sigFigs);
  if (unit != null && typeof unit !== "string") throw new Error('unit must be text, e.g. "lm" or "W/m²".');
  if (String(unit ?? "").length > 40) throw new Error("unit is too long (40 characters max).");
  unit = String(unit || "").trim();
  const base = PREFIX.findIndex(([f]) => f === 1);
  let idx = base;
  if (prefix && BASE.has(unit) && v !== 0) {
    idx = PREFIX.findIndex(([f]) => Math.abs(v) >= f);
    if (idx < 0) idx = PREFIX.length - 1;
    // rounding can push 999.96 up to 1000: move to the next prefix
    if (idx > 0 && Math.abs(Number((v / PREFIX[idx][0]).toPrecision(s))) >= 1000) idx--;
    if (idx === 0 && Math.abs(Number((v / PREFIX[0][0]).toPrecision(s))) >= 1000) idx = base; // above quetta: plain exponent
  }
  if (idx === PREFIX.length - 1 && Math.abs(v / PREFIX[idx][0]) < 1) idx = base; // below yocto: plain exponent
  const num = Number((v / PREFIX[idx][0]).toPrecision(s));
  const str = Math.abs(num) >= 1e6 || (Math.abs(num) < 1e-6 && num !== 0) ? num.toExponential(s - 1) : String(num);
  const u = `${PREFIX[idx][1]}${unit}`;
  return { text: !unit ? str : NO_SPACE.has(unit) ? `${str}${u}` : `${str} ${u}`, value: num, unit: u };
}
