# Photometry & Color Units

An MCP server and skill for lighting math done correctly, using only public CIE data. Runs offline, no keys.

## Tools

| Tool | What it does |
|---|---|
| `photometric_convert` | lx ↔ fc, cd/m² (nit) ↔ fL, candela at a distance and incidence angle → lux (inverse square law), lux → candela, lumens ↔ candela (isotropic or a uniform cone with a given full beam angle), lumens over an area → lux, lux ↔ luminance for a Lambertian surface. Returns the formula and assumptions. |
| `spectrum_analyze` | From a spectral power distribution: radiometric total and matching photometric value (lux, cd/m², lm or cd), luminous efficacy of radiation, CIE 1931 xy, u′v′, CCT, Duv, Rf and Rg. `scaleTo` scales the spectrum to a measured total (lux or W/m²), which is how you convert irradiance ↔ illuminance. |
| `chromaticity` | xy ↔ u′v′ ↔ CIE 1960 uv (from xy, u′v′ or XYZ), CCT and Duv. **CCT is refused when \|Duv\| > 0.05.** |
| `color_rendition` | CIE 224:2017 colour fidelity index Rf (identical to ANSI/IES TM-30-18/-20 Rf), TM-30 gamut index Rg and 16 hue-bin Rf values. |
| `format_si` | SI style output: `5.5e-7 m` → `550 nm`, `1234 lm` → `1.23 klm`, a space before the unit (none before °). |
| `photometry_status` | Plugin version, git commit and the CIE data tables in use. |

Spectrum input is CSV text (`wavelength,value` per line; header, BOM, `#` comments, tab, semicolon and decimal-comma files accepted; wavelengths in nm, or µm when the header says so or all values are below 10) or `{ wavelengths, values }`. Data is linearly interpolated to 1 nm; anything outside the given range counts as zero, with a note.

## Methods

- Photometry: Km = 683.002 lm/W with CIE V(λ) at 1 nm, 360-830 nm.
- Chromaticity: CIE 1931 2° colour-matching functions; u′v′ per CIE 1976; CCT and Duv by minimizing the distance to the Planckian locus in CIE 1960 uv (c2 = 1.4388 × 10⁻² m·K), equivalent to Ohno (2014) to well under 1 K.
- Rf / Rg: CIE 224:2017 procedure: CIE 1964 10° observer, 99 colour evaluation samples, reference illuminant Planckian below 4000 K, CIE daylight above 5000 K, blended between; CIECAM02 → CAM02-UCS with La = 100 cd/m², Yb = 20, D = 1; scale factor 6.73. Rg from the 16 hue-bin polygon (TM-30). Computed at 5 nm, 380-780 nm. Undefined (refused) for |Duv| > 0.05.
- CRI (Ra) is not provided.

## Verified against reference values

Offline tests check: D65 and illuminant A chromaticity against CIE 015:2018 (within 2 × 10⁻⁵), F2/F7/F11 chromaticity and CCT, Rf = Rg = 100 for a Planckian source, F1 Rf 81 / Rg 90 and F2 Rf 70 / Rg 86 (published TM-30 values), 683 lm/W at 555 nm, and exact fc and fL definitions. See `test/unit.test.mjs`.

## Data and license

Code: MIT © Liminal Photonics. CIE data in `data/` is CC BY-SA 4.0 from the CIE; see `data/README.md` for sources and citations.

## Reliability fields (v0.2.0)

- Every tool result carries `retrievedAt` (UTC, ISO 8601) and `plugin: { name, version, gitSha }`, so a saved result can be dated and traced to the exact build. Array results are wrapped as `{ result: [...] }`.
- `photometry_status` (new tool) reports `pluginName`, `version`, `gitSha` and `gitShaSource` (the npm lockfile that installed the plugin, `PLUGIN_GIT_SHA`, or the git checkout).
- Pin installs to a release tag (`#v0.2.0`) or a commit SHA, not the default branch, so an update can't change answers without notice. The tag is created on the merge commit; until it exists, pin the merge commit SHA.

## Development

```
npm install
npm test       # offline reference-value tests
npm run live   # stdio smoke test (SPEC=github:liminal-photonics/photometry-units-plugin#<sha> for a fresh npx install)
```
