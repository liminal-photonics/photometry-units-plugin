// End-to-end tests through the MCP tool path (spawn the stdio server, call tools with the MCP client).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));
async function call(name, args) {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER] }));
  try { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, text: r.content[0].text }; } finally { await c.close(); }
}
const sparse = "380,0.01\n430,0.2\n450,1.0\n470,0.3\n500,0.2\n550,0.6\n600,0.7\n650,0.5\n700,0.25\n780,0.05";

test("MCP: a 50 nm-spaced spectrum carries a coarse-sampling warning (spectrum_analyze and color_rendition)", async () => {
  for (const tool of ["spectrum_analyze", "color_rendition"]) {
    const r = JSON.parse((await call(tool, { spectrum: sparse })).text);
    assert.ok(r.notes.some((n) => /Coarse sampling: some points are 80 nm apart/.test(n)), tool);
  }
});

test("MCP: 5 nm data has no coarse-sampling warning", async () => {
  const wl = [], v = [];
  for (let w = 380; w <= 780; w += 5) { wl.push(w); v.push(1); }
  const r = JSON.parse((await call("spectrum_analyze", { spectrum: { wavelengths: wl, values: v } })).text);
  assert.ok(!r.notes.some((n) => /Coarse/.test(n)));
});

test("MCP: klx is refused with a next step", async () => {
  const r = await call("photometric_convert", { quantity: "illuminance", value: 1.2, from: "klx", to: "lx" });
  assert.equal(r.isError, true);
  assert.match(r.text, /1 klx = 1000 lx/);
});

test("MCP: CSV with more than 2 columns is refused unless valueColumn picks one", async () => {
  const three = "nm,a,b\n380,1,5\n500,2,6\n780,3,7";
  for (const tool of ["spectrum_analyze", "color_rendition"]) {
    const r = await call(tool, { spectrum: three });
    assert.equal(r.isError, true, tool);
    assert.match(r.text, /valueColumn/);
  }
  const a = JSON.parse((await call("spectrum_analyze", { spectrum: three, valueColumn: 3, fidelityIndices: false })).text);
  const b = JSON.parse((await call("spectrum_analyze", { spectrum: "380,5\n500,6\n780,7", fidelityIndices: false })).text);
  assert.equal(a.radiometric.value, b.radiometric.value);
  const bad = await call("spectrum_analyze", { spectrum: three, valueColumn: 9 });
  assert.equal(bad.isError, true);
});

test("MCP format_si: a non-text unit or fractional sigFigs is refused, never '[object Object]'", async () => {
  let r = await call("format_si", { value: 7, unit: [{ nested: 1 }] });
  assert.equal(r.isError, true); assert.doesNotMatch(r.text, /object Object/);
  r = await call("format_si", { value: 7, unit: "lm", sigFigs: 0.0001 });
  assert.equal(r.isError, true);
  r = JSON.parse((await call("format_si", { value: 1234, unit: "lm" })).text);
  assert.equal(r.text, "1.23 klm");
});
