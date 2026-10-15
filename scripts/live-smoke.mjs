// Runs the server over stdio (SPEC=github:...#sha for a fresh npx install) and checks CIE reference values.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
const spec = process.env.SPEC;
const c = new Client({ name: "smoke", version: "0" });
await c.connect(new StdioClientTransport({ command: spec ? "npx" : "node", args: spec ? ["-y", spec] : ["src/index.js"] }));
const call = async (name, a) => { const r = await c.callTool({ name, arguments: a }); return r.isError ? { ERROR: r.content[0].text } : JSON.parse(r.content[0].text); };
console.log("TOOLS", (await c.listTools()).tools.map((t) => t.name).join(", "));
const rows = readFileSync(new URL("../data/CIE_illum_FLs.csv", import.meta.url), "utf8").trim().split("\n").map((l) => l.split(",").map(Number));
const f = (i) => rows.map((r) => `${r[0]},${r[i]}`).join("\n");
for (const [i, exp] of [[1, "x .31310 y .33727, Rf 81 Rg 90"], [2, "x .37208 y .37529 CCT 4230, Rf 70 Rg 86"]]) {
  const r = await call("spectrum_analyze", { spectrum: f(i), scaleTo: { quantity: "photometric", value: 500 } });
  console.log(`F${i}`, r.chromaticity.x, r.chromaticity.y, "CCT", r.chromaticity.cct, "Duv", r.chromaticity.duv, "Rf", r.colorRendition.Rf, "Rg", r.colorRendition.Rg, "| W/m2 for 500 lx", r.radiometric.value.toFixed(3), "| expect", exp);
}
console.log("D65 point", JSON.stringify(await call("chromaticity", { x: 0.31272, y: 0.32903 })));
console.log("GREEN", JSON.stringify(await call("chromaticity", { x: 0.2, y: 0.6 })));
console.log("FC", JSON.stringify(await call("photometric_convert", { quantity: "illuminance", value: 50, from: "fc", to: "lx" })));
console.log("CONE", JSON.stringify(await call("photometric_convert", { quantity: "lumens_to_candela", value: 800, beamAngleDeg: 36 })));
console.log("SI", (await call("format_si", { value: 5.5e-7, unit: "m" })).text);
console.log("EMPTY", JSON.stringify(await call("spectrum_analyze", { spectrum: "" })));
console.log("BAD", JSON.stringify(await call("photometric_convert", { quantity: "intensity_to_illuminance", value: 10 })));
let big = ""; for (let w = 300; w <= 1100; w += 0.1) big += `${w.toFixed(1)},1\n`;
const t0 = Date.now(); const b = await call("spectrum_analyze", { spectrum: big, kind: "irradiance" });
console.log("BIG 8001 points", b.photometric?.value?.toFixed(1), "lx in", Date.now() - t0, "ms", b.colorRendition?.Rf ?? b.colorRendition?.error);
await c.close();
