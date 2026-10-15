---
name: photometry-calcs
description: Do photometry and colorimetry correctly - lux, foot-candles, lumens, candela, nits, irradiance to illuminance with a spectrum, CIE xy / u'v', CCT and Duv, CIE 224 / TM-30 Rf and Rg, and SI formatting. Use when someone asks to convert lighting units, analyze a spectrum CSV, compute CCT or color rendition, or check a lighting calculation.
---

# Photometry calculations

Use the tools for numbers; never do these from memory.

1. **Pick the right quantity.** Lux is illuminance (lm/m², light falling on a surface), cd/m² (nit) is luminance (brightness of a surface), cd is intensity (per steradian), lm is total flux. Converting between them always needs geometry: distance and incidence angle, beam angle, area, or reflectance. If the user didn't give it, ask, or state the assumption (isotropic source, uniform cone, Lambertian surface) in the answer. `photometric_convert` returns the formula and assumption; repeat them.
2. **Radiometric <-> photometric needs a spectrum.** W/m² to lux depends on the spectrum (683 lm/W only at 555 nm). Use `spectrum_analyze` with the spectrum and `scaleTo` the measured total. Never use a fixed factor such as 683 or 93 lm/W unless the user explicitly asks for that approximation, and label it.
3. **CCT only near the blackbody locus.** Report CCT together with Duv. If |Duv| > 0.05, the tools refuse CCT; explain that the light is too colored for CCT to apply and give xy / u'v' instead.
4. **Color rendition.** Rf and Rg come from CIE 224:2017 / ANSI/IES TM-30 (Rf identical in both). They need the spectrum from 380 to 780 nm; say so if the spectrum is shorter. Don't compute CRI (Ra) by guesswork; it isn't provided.
5. **Format results** with `format_si`: a space between number and unit (`550 nm`, `1.23 klm`), sensible significant figures (usually 3), and units on every number.
6. **Sanity checks to mention when relevant:** illuminance falls with 1/d²; luminous efficacy of radiation for white light is typically 250-370 lm/W (luminous efficacy of a lamp in lm per electrical W is much lower); Rf of a blackbody or CIE daylight reference is 100.

The CIE data used is listed in the plugin's `data/README.md` (CC BY-SA 4.0).
