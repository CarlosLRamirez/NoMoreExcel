#!/usr/bin/env node
// Verificación del servidor MCP de la app (pb/pb_hooks/mcp.pb.js). NUNCA escribe datos:
// solo lee y pide la vista previa de las herramientas de escritura (sin confirmar=true).
// Se puede correr contra producción.
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

console.log("Catálogo");
const lista = (await post(rpc(7, "tools/list"))).json.result.tools;
const nombres = lista.map((t) => t.name);
const ESPERADAS = [
  "listar_cuentas", "listar_categorias", "buscar_movimientos", "gasto_por_categoria", "resumen_mes", "resumen_presupuesto", "ingreso_vs_gasto", "totales_por_etiqueta",
  "registrar_movimientos", "registrar_transferencia", "editar_movimiento", "eliminar_movimientos", "restaurar_movimientos", "marcar_movimientos_confirmados",
  "asignar_presupuesto", "cubrir_sobregastos", "copiar_presupuesto", "pagar_cuota_prestamo", "crear_cuenta", "crear_categoria",
];
check("catálogo esperado (20 herramientas)", ESPERADAS.every((n) => nombres.includes(n)) && nombres.length === ESPERADAS.length, nombres.join());
check("sin reset, backup, importar, borrado definitivo ni conciliar", !nombres.some((n) => /borrar|reset|backup|import|conciliar/i.test(n)));

console.log("Lectura");
const cuentas = await llamar("listar_cuentas", {});
check("listar_cuentas", cuentas.datos && Array.isArray(cuentas.datos.cuentas), cuentas.texto);
const cats = await llamar("listar_categorias", { tipo: "gasto" });
check("listar_categorias", cats.datos && cats.datos.categorias.length > 0, cats.texto);
const mov = await llamar("buscar_movimientos", { limite: 50 });
check("buscar_movimientos", mov.datos && Array.isArray(mov.datos.movimientos), mov.texto);
check("gasto_por_categoria", (await llamar("gasto_por_categoria", {})).datos.total !== undefined);
const resumen = await llamar("resumen_mes", {});
check("resumen_mes", resumen.datos && typeof resumen.datos.patrimonio_neto === "string" && resumen.datos.disponible_para_asignar, resumen.texto);
check("resumen_presupuesto", Array.isArray((await llamar("resumen_presupuesto", {})).datos.grupos));
check("ingreso_vs_gasto", (await llamar("ingreso_vs_gasto", { meses: 3 })).datos.meses.length === 3);
check("totales_por_etiqueta", Array.isArray((await llamar("totales_por_etiqueta", {})).datos.etiquetas));

console.log("Escritura: solo vista previa (nada se guarda)");
const cuenta = cuentas.datos && cuentas.datos.cuentas.find((c) => c.activa && c.tipo !== "prestamo");
const cuenta2 = cuentas.datos && cuentas.datos.cuentas.find((c) => c.activa && c.tipo !== "prestamo" && c.moneda === (cuenta && cuenta.moneda) && c.id !== (cuenta && cuenta.id));
const cat = cats.datos && cats.datos.categorias[0];
const noGuarda = (x, nombre) => check(`${nombre}: vista previa, guardado=false`, x.datos && x.datos.guardado === false, x.texto);
if (cuenta && cat) {
  noGuarda(await llamar("registrar_movimientos", { movimientos: [{ monto: "1.00", cuenta: cuenta.nombre, categoria: cat.nombre, descripcion: "prueba de humo" }] }), "registrar_movimientos");
  noGuarda(await llamar("asignar_presupuesto", { asignaciones: [{ categoria: cat.nombre, monto: "1.00", modo: "sumar" }] }), "asignar_presupuesto");
}
if (cuenta && cuenta2) noGuarda(await llamar("registrar_transferencia", { transferencias: [{ origen: cuenta.nombre, destino: cuenta2.nombre, monto: "1.00" }] }), "registrar_transferencia");
// un gasto/ingreso vigente y no bloqueado (las transferencias y los conciliados no se editan)
const uno = mov.datos && mov.datos.movimientos.find((m) => m.tipo !== "transferencia" && !m.bloqueado);
if (uno) {
  noGuarda(await llamar("editar_movimiento", { id: uno.id, cambios: { descripcion: "prueba de humo" } }), "editar_movimiento");
  noGuarda(await llamar("eliminar_movimientos", { ids: [uno.id] }), "eliminar_movimientos");
}
const cubrir = await llamar("cubrir_sobregastos", {});
check("cubrir_sobregastos: vista previa o 'nada que cubrir'", cubrir.datos && cubrir.datos.guardado === false, cubrir.texto);
const copiar = await llamar("copiar_presupuesto", { mes: "2999-12" });
check("copiar_presupuesto: vista previa o 'nada que copiar'", copiar.datos && copiar.datos.guardado === false, copiar.texto);
noGuarda(await llamar("crear_cuenta", { nombre: "Cuenta de prueba de humo", tipo: "ahorro" }), "crear_cuenta");
noGuarda(await llamar("crear_categoria", { nombre: "Categoría de prueba de humo", tipo: "gasto" }), "crear_categoria");
const prestamo = cuentas.datos && cuentas.datos.cuentas.find((c) => c.activa && c.tipo === "prestamo");
if (prestamo && cuenta) {
  const p = await llamar("pagar_cuota_prestamo", { prestamo: prestamo.nombre, cuenta_origen: cuenta.nombre, monto: "1.00" });
  check("pagar_cuota_prestamo: vista previa (o error de validación, nunca guarda)", p.datos ? p.datos.guardado === false : p.isError === true, p.texto);
}
check("marcar_movimientos_confirmados / restaurar_movimientos: sin ids = error (no tocan nada)", (await llamar("marcar_movimientos_confirmados", { ids: [] })).isError === true && (await llamar("restaurar_movimientos", { ids: [] })).isError === true);

console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
