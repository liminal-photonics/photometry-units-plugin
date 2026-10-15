import { test } from "node:test";
import assert from "node:assert/strict";
import { D65, FL, resample, tristimulus, xyFromXYZ, cctDuv, planck } from "../src/cie.js";
import { fidelity } from "../src/fidelity.js";
import { convert, chroma, parseSpectrum, spectrumAnalysis, formatSI } from "../src/units.js";

const spd = (t, i = 0) => resample(t.wl, t.cols[i], 360, 830, 1);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`);

// Reference values: CIE 015:2018 Tables T.3 and T.8 (chromaticity, CCT of CIE illuminants).
test("CIE illuminant chromaticities and CCTs match CIE 015", () => {
  const d = xyFromXYZ(tristimulus(spd(D65)));
  near(d.x, 0.31272, 2e-5, "D65 x"); near(d.y, 0.32903, 2e-5, "D65 y");
  near(cctDuv(d).cct, 6504, 3, "D65 CCT");
  // CIE illuminant A as defined in CIE 015:2018 eq. 4.1 (c2 = 1.435e7 nm K, T = 2848 K).
  const A = new Map(); for (let w = 360; w <= 830; w++) A.set(w, 100 * (560 / w) ** 5 * (Math.exp(1.435e7 / (2848 * 560)) - 1) / (Math.exp(1.435e7 / (2848 * w)) - 1));
  const a = xyFromXYZ(tristimulus(A));
  near(a.x, 0.44757, 2e-5, "A x"); near(a.y, 0.40745, 2e-5, "A y");
  near(cctDuv(a).cct, 2856, 1, "A CCT");
  for (const [i, x, y, T] of [[1, 0.37208, 0.37529, 4230], [6, 0.31292, 0.32933, 6500], [10, 0.38052, 0.37713, 4000]]) {
    const c = xyFromXYZ(tristimulus(spd(FL, i)));
    near(c.x, x, 1e-4, `F${i + 1} x`); near(c.y, y, 1e-4, `F${i + 1} y`); near(cctDuv(c).cct, T, 15, `F${i + 1} CCT`); // CIE 015 lists nominal CCTs (F7 "6500 K"; McCamy gives 6491 K)
  }
});

test("Rf/Rg: reference sources score 100, F-series match published TM-30 values", () => {
  const A = new Map(); for (let w = 360; w <= 830; w++) A.set(w, planck(w, 2856));
  const a = fidelity(A); assert.equal(a.Rf, 100); assert.equal(a.Rg, 100);
  const f1 = fidelity(spd(FL, 0)); assert.equal(Math.round(f1.Rf), 81); assert.equal(Math.round(f1.Rg), 90);
  const f2 = fidelity(spd(FL, 1)); assert.equal(Math.round(f2.Rf), 70); assert.equal(Math.round(f2.Rg), 86);
  assert.ok(fidelity(spd(D65)).Rf > 99);
});

test("CCT refused when |Duv| > 0.05, and Rf refused for non-white light", () => {
  const g = chroma({ x: 0.2, y: 0.6 });
  assert.equal(g.cct, null); assert.match(g.cctNote, /0\.05/);
  const ok = chroma({ x: 0.3127, y: 0.329 }); assert.equal(ok.cct, 6504); near(ok.duv, 0.0032, 1e-4, "D65 Duv");
  assert.throws(() => chroma({ x: 0.7, y: 0.4 }), /outside/);
  const mono = new Map(); for (let w = 360; w <= 830; w++) mono.set(w, w === 555 ? 1 : 0);
  assert.throws(() => fidelity(mono), /Duv/);
});

test("xy <-> u'v' round trip and CIE 1960 relation", () => {
  const r = chroma({ u: 0.19783, v: 0.46832 });
  near(r.x, 0.3127, 1e-4, "x"); near(r.v1960, (0.46832 * 2) / 3, 1e-5, "v1960");
});

test("unit conversions use exact definitions", () => {
  near(convert({ quantity: "illuminance", value: 1, from: "fc", to: "lx" }).value, 10.7639104, 1e-6, "fc");
  near(convert({ quantity: "luminance", value: 1, from: "fL", to: "cd/m2" }).value, 3.4262591, 1e-6, "fL");
  near(convert({ quantity: "intensity_to_illuminance", value: 100, distanceM: 2 }).value, 25, 1e-12, "inverse square");
  near(convert({ quantity: "intensity_to_illuminance", value: 100, distanceM: 1, angleDeg: 60 }).value, 50, 1e-9, "cosine");
  near(convert({ quantity: "lumens_to_candela", value: 4 * Math.PI }).value, 1, 1e-12, "isotropic");
  near(convert({ quantity: "candela_to_lumens", value: 1, beamAngleDeg: 360 }).value, 4 * Math.PI, 1e-9, "full sphere cone");
  near(convert({ quantity: "illuminance_to_luminance", value: Math.PI * 100, reflectance: 0.5 }).value, 50, 1e-9, "Lambertian");
  assert.throws(() => convert({ quantity: "illuminance", value: -1, from: "lx", to: "fc" }), /0 or more/);
  assert.throws(() => convert({ quantity: "intensity_to_illuminance", value: 1, distanceM: 0 }), /above 0/);
  assert.throws(() => convert({ quantity: "nope", value: 1 }), /quantity must be/);
});

test("spectrum photometry: 555 nm line gives ~683 lm/W; scaling to a lux reading", () => {
  const r = spectrumAnalysis({ spectrum: { wavelengths: [554, 555, 556], values: [0, 1, 0] }, fidelityIndices: false });
  near(r.luminousEfficacyOfRadiation.value, 683, 0.5, "LER at 555");
  let csv = "nm,W/m2/nm\n"; for (let w = 380; w <= 780; w += 5) csv += `${w},${D65.cols[0][D65.wl.indexOf(w)]}\n`;
  const s = spectrumAnalysis({ spectrum: csv, scaleTo: { quantity: "photometric", value: 500 } });
  near(s.photometric.value, 500, 1e-9, "scaled lux");
  near(s.radiometric.value / 500, 1 / s.luminousEfficacyOfRadiation.value, 1e-9, "W/m2 per lux = 1/LER");
  assert.ok(s.colorRendition.Rf > 99);
});

test("spectrum CSV parsing: headers, BOM, semicolons with decimal commas, µm, sorting, errors", () => {
  assert.deepEqual(parseSpectrum("\uFEFFλ (nm);E\n500;0,5\n400;0,25\n600;1").val, [0.25, 0.5, 1]);
  assert.deepEqual(parseSpectrum("wl_um,val\n0.4,1\n0.5,2\n0.6,3").wl, [400, 500, 600]);
  assert.deepEqual(parseSpectrum("400\t1\n500\t2\n600\t3").wl, [400, 500, 600]);
  assert.match(parseSpectrum("400,1\n500,2\n600,3").notes.join(" "), /380-780/);
  assert.throws(() => parseSpectrum(""), /empty/);
  assert.throws(() => parseSpectrum("400,1\n400,2\n500,3"), /Duplicate/);
  assert.throws(() => parseSpectrum("400,1\n500,x\n600,3"), /Could not read/);
  assert.throws(() => parseSpectrum("400,1"), /at least 3/);
});

test("SI formatting", () => {
  assert.equal(formatSI({ value: 550e-9, unit: "m" }).text, "550 nm");
  assert.equal(formatSI({ value: 550, unit: "nm" }).text, "550 nm");
  assert.equal(formatSI({ value: 999.96, unit: "lm" }).text, "1 klm");
  assert.equal(formatSI({ value: 1234, unit: "lm" }).text, "1.23 klm");
  assert.equal(formatSI({ value: 0.000123, unit: "W" }).text, "123 µW");
  assert.equal(formatSI({ value: 90, unit: "°" }).text, "90°");
  assert.equal(formatSI({ value: 5, unit: "%" }).text, "5 %");
  assert.equal(formatSI({ value: 0, unit: "lx" }).text, "0 lx");
  assert.throws(() => formatSI({ value: "abc" }), /finite/);
});

test("edge cases: narrow lines, IR-only, big input, sig figs, bad rows", () => {
  // 0.3 nm wide line at 550.5 nm sampled at 0.1 nm: must not vanish between whole nanometers
  const w = [], v = []; for (let i = 0; i <= 200; i++) { const x = 540 + i / 10; w.push(+x.toFixed(1)); v.push(Math.abs(x - 550.5) < 0.15 ? 1 : 0); }
  const r = spectrumAnalysis({ spectrum: { wavelengths: w, values: v }, fidelityIndices: false });
  near(r.photometric.value / r.radiometric.value, 683.002 * 0.9950, 683 * 0.01, "550.5 nm line efficacy");
  // IR LED: radiometric total, 0 lx, no color point, no crash
  const ir = spectrumAnalysis({ spectrum: "900,0\n940,1\n980,0" });
  near(ir.radiometric.value, 40, 1e-9, "IR W/m2"); assert.equal(ir.photometric.value, 0); assert.ok(ir.chromaticity.error);
  assert.throws(() => spectrumAnalysis({ spectrum: "900,0\n940,1\n980,0", scaleTo: { quantity: "photometric", value: 10 } }), /no visible power/);
  // 190k points used to overflow the call stack
  const big = [...Array(190000)].map((_, i) => 380 + i / 475);
  assert.ok(parseSpectrum({ wavelengths: big, values: big.map(() => 1) }).points === 190000);
  assert.throws(() => parseSpectrum({ wavelengths: [...Array(200001)].map((_, i) => i), values: [] }), /too many points/);
  // a data row that cannot be read is an error, not a silently skipped header
  assert.throws(() => parseSpectrum("380;1.234,5\n400;1\n500;1\n780;1"), /Could not read line/);
  assert.match(parseSpectrum("380,5,1\n400,1\n780,1").notes.join(" "), /more than 2 columns/);
  assert.throws(() => chroma({ X: 1, Y: 1 }), /all three/);
});

test("round 3: more CIE illuminants, SI prefixes R/Q, clearer errors", async () => {
  const { daylight, FL } = await import("../src/cie.js");
  const near = (a, b, t) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);
  // CIE 015:2018 Table 10/11 chromaticities
  for (const [T, x, y] of [[5000, 0.34567, 0.3585], [5500, 0.33242, 0.34743], [7500, 0.29902, 0.31485]]) {
    const d = daylight((T * 1.4388) / 1.438);
    const c = spectrumAnalysis({ spectrum: { wavelengths: d.wl, values: d.val }, fidelityIndices: false }).chromaticity;
    near(c.x, x, 2e-5); near(c.y, y, 2e-5); assert.ok(c.duv > 0, "daylight sits above the Planckian locus");
  }
  const f12 = spectrumAnalysis({ spectrum: { wavelengths: FL.wl, values: FL.cols[11] } });
  near(f12.chromaticity.x, 0.43695, 2e-5); near(f12.chromaticity.cct, 3000, 10);
  near(f12.colorRendition.Rf, 77, 1.5); near(f12.colorRendition.Rg, 102, 1.5);
  assert.equal(formatSI({ value: 1e30, unit: "W" }).text, "1 QW");
  assert.equal(formatSI({ value: 2e-28, unit: "W" }).text, "200 qW");
  assert.match(formatSI({ value: 1e40, unit: "W" }).text, /e\+40 W$/);
  assert.equal(convert({ quantity: "intensity_to_illuminance", value: 1000, distanceM: 2, angleDeg: 60 }).value, 125);
  assert.throws(() => convert({ quantity: "illuminance", value: 1, from: "lm", to: "lx" }), /lumens_to_illuminance/);
  assert.throws(() => convert({ quantity: "illuminance_to_luminance", value: 500, reflectance: 80 }), /use 0.8/);
  assert.throws(() => convert({ quantity: "luminance", value: 1, from: "lx", to: "nit" }), /illuminance_to_luminance/);
});
