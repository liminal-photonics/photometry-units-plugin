#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { convert, spectrumAnalysis, chroma, formatSI, parseSpectrum, toGrid } from "./units.js";
import { resample } from "./cie.js";
import { fidelity } from "./fidelity.js";
import { pluginVersion, stamp, versionInfo } from "./version.js";

const spectrumProp = { description: "Spectrum as CSV text (wavelength,value per line; header optional; nm or µm) or { wavelengths: [...], values: [...] }.", anyOf: [{ type: "string" }, { type: "object", properties: { wavelengths: { type: "array", items: { type: "number" } }, values: { type: "array", items: { type: "number" } } } }] };

const TOOLS = [
  { name: "photometric_convert", description: "Convert or calculate photometric quantities: lx<->fc, cd/m2 (nit)<->fL, candela at distance to lux (inverse square, with incidence angle), lux to candela, lumens<->candela for an isotropic source or a uniform cone of a given full beam angle, lumens over an area to lux, and lux<->luminance for a Lambertian surface of given reflectance. Returns the formula and assumptions used.",
    inputSchema: { type: "object", properties: { quantity: { type: "string", enum: ["illuminance", "luminance", "intensity_to_illuminance", "illuminance_to_intensity", "lumens_to_candela", "candela_to_lumens", "lumens_to_illuminance", "illuminance_to_luminance", "luminance_to_illuminance"] }, value: { type: "number", minimum: 0 }, from: { type: "string" }, to: { type: "string" }, distanceM: { type: "number" }, angleDeg: { type: "number" }, beamAngleDeg: { type: "number" }, areaM2: { type: "number" }, reflectance: { type: "number" } }, required: ["quantity", "value"] } },
  { name: "spectrum_analyze", description: "Analyze a spectral power distribution: radiometric total (W/m2, W/(m2 sr), W or W/sr) and the matching photometric value (lux, cd/m2, lm or cd) using CIE V(lambda) and Km = 683.002 lm/W, luminous efficacy of radiation, CIE 1931 xy, u'v', CCT and Duv, plus CIE 224 / TM-30 Rf and Rg. Optionally scale the spectrum to a measured total, e.g. a lux reading or W/m2, to convert irradiance to illuminance or back.",
    inputSchema: { type: "object", properties: { spectrum: spectrumProp, kind: { type: "string", enum: ["irradiance", "radiance", "flux", "intensity"], default: "irradiance" }, scaleTo: { type: "object", properties: { quantity: { type: "string", enum: ["radiometric", "photometric"] }, value: { type: "number" } }, required: ["quantity", "value"] }, fidelityIndices: { type: "boolean", default: true }, valueColumn: { type: "integer", minimum: 2, description: "CSV only: which column holds the values when there are more than 2 (column 1 is the wavelength)." } }, required: ["spectrum"] } },
  { name: "chromaticity", description: "Convert a color point between CIE 1931 xy, CIE 1976 u'v' and CIE 1960 uv (from xy, u'v' or XYZ) and compute CCT and Duv. CCT is refused when |Duv| > 0.05.",
    inputSchema: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, u: { type: "number", description: "u' (CIE 1976)" }, v: { type: "number", description: "v' (CIE 1976)" }, X: { type: "number" }, Y: { type: "number" }, Z: { type: "number" } } } },
  { name: "color_rendition", description: "CIE 224:2017 colour fidelity Rf (identical to ANSI/IES TM-30-18/-20 Rf), TM-30 gamut index Rg and the 16 hue-bin fidelity values for a spectrum covering 380-780 nm.",
    inputSchema: { type: "object", properties: { spectrum: spectrumProp, valueColumn: { type: "integer", minimum: 2, description: "CSV only: which column holds the values when there are more than 2 (column 1 is the wavelength)." } }, required: ["spectrum"] } },
  { name: "format_si", description: "Format a value in SI style with a space before the unit and an SI prefix, e.g. 5.5e-7 m -> '550 nm', 1234 lm -> '1.23 klm'.",
    inputSchema: { type: "object", properties: { value: { type: "number" }, unit: { type: "string" }, sigFigs: { type: "integer", minimum: 1, maximum: 15, default: 3 }, prefix: { type: "boolean", default: true } }, required: ["value"] } },
  { name: "photometry_status", description: "Show the plugin version, the git commit that is running, and the CIE data tables it uses.",
    inputSchema: { type: "object", properties: {} } },
];

const H = {
  photometric_convert: convert,
  spectrum_analyze: spectrumAnalysis,
  chromaticity: chroma,
  color_rendition: (a) => { const s = parseSpectrum(a.spectrum, a.valueColumn); return { ...fidelity(toGrid(s)), notes: s.notes }; },
  format_si: formatSI,
  photometry_status: () => ({ ...versionInfo(), data: "CIE tables bundled in data/ (sources and versions in data/README.md); no network access needed" }),
};

const server = new Server({ name: "photometry-units", version: pluginVersion().version || "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    if (!H[name]) throw new Error(`Unknown tool ${name}`);
    return { content: [{ type: "text", text: JSON.stringify(stamp(await H[name](a || {})), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: e.message }] };
  }
});
await server.connect(new StdioServerTransport());
