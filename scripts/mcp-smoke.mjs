#!/usr/bin/env node
// Verificación del servidor MCP de la app (pb/pb_hooks/mcp.pb.js). NUNCA escribe datos:
// solo lee y pide una vista previa. Se puede correr contra producción.
//
//   MCP_TOKEN=<token> node scripts/mcp-smoke.mjs [URL]
//   URL por defecto: http://127.0.0.1:8090/api/mcp   (o MCP_URL)
// Sin dependencias: usa fetch global (Node >= 18).

const URL_MCP = process.argv[2] || process.env.MCP_URL || "http://127.0.0.1:8090/api/mcp";
const TOKEN = process.env.MCP_TOKEN || "";
if (!TOKEN) {
  console.error("Falta MCP_TOKEN en el entorno.");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const check = (label, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label} ${extra}`);
  }
};

async function post(body, { token = TOKEN, raw = false } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(URL_MCP, { method: "POST", headers, body: raw ? body : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* sin cuerpo (202) o no JSON */
  }
  return { status: res.status, json, text };
}
const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, params });
const llamar = async (name, args) => {
  const r = await post(rpc(100, "tools/call", { name, arguments: args }));
  const texto = r.json && r.json.result && r.json.result.content[0].text;
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch {
    /* mensaje de error en texto plano */
  }
  return { r, isError: r.json && r.json.result && r.json.result.isError, texto, datos };
};

console.log(`MCP: ${URL_MCP}`);

console.log("Acceso");
check("sin token → 401", (await post(rpc(1, "ping"), { token: "" })).status === 401);
check("token incorrecto → 401", (await post(rpc(1, "ping"), { token: "x".repeat(48) })).status === 401);
const get = await fetch(URL_MCP, { method: "GET", headers: { Authorization: `Bearer ${TOKEN}` } });
check("GET → 405", get.status === 405);

console.log("Protocolo");
check("JSON inválido → 400", (await post("{no es json", { raw: true })).status === 400);
const init = await post(rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } }));
check("initialize", init.json && init.json.result && init.json.result.serverInfo.name === "nomoreexcel", init.text.slice(0, 200));
check("notificación → 202 sin cuerpo", (await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202);
check("ping", (await post(rpc(2, "ping"))).json.result !== undefined);
check("método desconocido → -32601", (await post(rpc(3, "foo/bar"))).json.error.code === -32601);
check("herramienta desconocida → -32602", (await post(rpc(4, "tools/call", { name: "nope", arguments: {} }))).json.error.code === -32602);
const lote = await post([rpc(5, "ping"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc(6, "ping")]);
check("lote JSON-RPC → 2 respuestas", Array.isArray(lote.json) && lote.json.length === 2);

console.log("Herramientas");
const lista = (await post(rpc(7, "tools/list"))).json.result.tools;
const nombres = lista.map((t) => t.name);
check("catálogo esperado", ["listar_cuentas", "listar_categorias", "buscar_movimientos", "gasto_por_categoria", "registrar_movimientos"].every((n) => nombres.includes(n)), nombres.join());
check("sin herramientas destructivas", !nombres.some((n) => /borrar|eliminar|reset|backup|import/i.test(n)));
const cuentas = await llamar("listar_cuentas", {});
check("listar_cuentas", cuentas.datos && Array.isArray(cuentas.datos.cuentas), cuentas.texto);
const cats = await llamar("listar_categorias", { tipo: "gasto" });
check("listar_categorias", cats.datos && cats.datos.categorias.length > 0, cats.texto);
const gasto = await llamar("gasto_por_categoria", {});
check("gasto_por_categoria", gasto.datos && typeof gasto.datos.total === "string", gasto.texto);
const mov = await llamar("buscar_movimientos", { limite: 3 });
check("buscar_movimientos", mov.datos && Array.isArray(mov.datos.movimientos), mov.texto);

const cuenta = cuentas.datos && cuentas.datos.cuentas.find((c) => c.activa && c.tipo !== "prestamo");
const cat = cats.datos && cats.datos.categorias[0];
if (cuenta && cat) {
  const prev = await llamar("registrar_movimientos", { movimientos: [{ monto: "1.00", cuenta: cuenta.nombre, categoria: cat.nombre, descripcion: "prueba de humo" }] });
  check("registrar_movimientos sin confirmar = solo vista previa", prev.datos && prev.datos.modo === "vista_previa" && prev.datos.guardado === false, prev.texto);
} else {
  console.log("  (se omite la vista previa: no hay cuenta activa o categoría de gasto)");
}

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
