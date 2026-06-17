#!/usr/bin/env node
// Script de verificación de los criterios de aceptación (v1).
// Requiere PocketBase corriendo (por defecto en http://127.0.0.1:8090).
// Uso:  node scripts/verify.mjs   [PB_URL]
// No requiere dependencias: usa fetch global (Node >= 18).

const BASE = process.argv[2] || process.env.PB_URL || "http://127.0.0.1:8090";

let token = "";
async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ---- helpers ----
let pass = 0,
  fail = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  ✅ ${label}`);
    pass++;
  } else {
    console.log(`  ❌ ${label} ${extra}`);
    fail++;
  }
}

const centsToInput = (c) => {
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? "-" : "") + Math.trunc(a / 100) + "." + String(a % 100).padStart(2, "0");
};
const parseCents = (s) => {
  s = String(s).trim();
  let neg = false;
  if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  }
  const [i, f = ""] = s.split(".");
  const cents = parseInt(i, 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
  return neg ? -cents : cents;
};

// El registro público está cerrado; los usuarios de prueba se crean con un superusuario.
// Provee PB_SU_EMAIL y PB_SU_PASSWORD en el entorno.
let suToken = "";
async function authSuperuser() {
  if (!process.env.PB_SU_EMAIL || !process.env.PB_SU_PASSWORD) {
    throw new Error(
      "El registro está cerrado: define PB_SU_EMAIL y PB_SU_PASSWORD (superusuario) para correr verify."
    );
  }
  const auth = await api("POST", "/api/collections/_superusers/auth-with-password", {
    identity: process.env.PB_SU_EMAIL,
    password: process.env.PB_SU_PASSWORD,
  });
  suToken = auth.token;
}

const createdUsers = []; // para limpieza al final
async function signupLogin(nombre) {
  const email = `verify_${nombre}_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.com`;
  const pwd = "password123";
  token = suToken; // crear el usuario con el superusuario
  await api("POST", "/api/collections/users/records", {
    email,
    password: pwd,
    passwordConfirm: pwd,
    nombre,
  });
  const auth = await api("POST", "/api/collections/users/auth-with-password", {
    identity: email,
    password: pwd,
  });
  token = auth.token;
  createdUsers.push({ email, pwd, id: auth.record.id });
  return auth.record.id;
}

async function cleanup() {
  for (const u of createdUsers) {
    try {
      const auth = await api("POST", "/api/collections/users/auth-with-password", {
        identity: u.email,
        password: u.pwd,
      });
      token = auth.token;
      await api("DELETE", `/api/collections/users/records/${u.id}`);
    } catch (_) {
      /* ignore */
    }
  }
}

async function getCuentas(uid) {
  const r = await api("GET", `/api/collections/cuentas/records?perPage=200&filter=(usuario='${uid}')`);
  return r.items;
}
async function getMovimientos(uid) {
  const r = await api(
    "GET",
    `/api/collections/movimientos/records?perPage=500&filter=(usuario='${uid}'%26%26eliminado=false)`
  );
  return r.items;
}
async function saldos(uid) {
  const cuentas = await getCuentas(uid);
  const movs = await getMovimientos(uid);
  const sum = {};
  for (const m of movs) sum[m.cuenta] = (sum[m.cuenta] || 0) + m.monto;
  const byName = {};
  const byId = {};
  for (const c of cuentas) {
    const s = (c.saldo_inicial || 0) + (sum[c.id] || 0);
    byName[c.nombre] = { saldo: s, moneda: c.moneda, tipo: c.tipo, limite: c.limite_credito || 0 };
    byId[c.id] = c;
  }
  return { byName, byId, cuentas, movs };
}

async function main() {
  console.log(`\nVerificando contra ${BASE}\n`);
  await api("GET", "/api/health");
  await authSuperuser();

  const uid = await signupLogin("u1");

  // cuentas
  const bancoGTQ = await api("POST", "/api/collections/cuentas/records", {
    usuario: uid, nombre: "Banco GTQ", tipo: "monetaria", moneda: "GTQ", saldo_inicial: 0, activa: true,
  });
  const efectivo = await api("POST", "/api/collections/cuentas/records", {
    usuario: uid, nombre: "Efectivo", tipo: "efectivo", moneda: "GTQ", saldo_inicial: 0, activa: true,
  });
  const tcGTQ = await api("POST", "/api/collections/cuentas/records", {
    usuario: uid, nombre: "TC GTQ", tipo: "tarjeta_credito", moneda: "GTQ", saldo_inicial: 0, limite_credito: 500000, activa: true,
  });
  const tcUSD = await api("POST", "/api/collections/cuentas/records", {
    usuario: uid, nombre: "TC USD", tipo: "tarjeta_credito", moneda: "USD", saldo_inicial: 0, limite_credito: 300000, activa: true,
  });
  const catComida = await api("POST", "/api/collections/categorias/records", {
    usuario: uid, nombre: "Comida", tipo: "gasto", activa: true,
  });

  // ---------------------------------------------------------------
  console.log("Criterio 1: gasto de Q100 reduce el saldo en Q100");
  await api("POST", "/api/collections/movimientos/records", {
    usuario: uid, fecha: "2026-06-01", cuenta: bancoGTQ.id, categoria: catComida.id,
    tipo: "gasto", monto: -10000, descripcion: "Almuerzo",
  });
  let s = await saldos(uid);
  check("Banco GTQ = -Q100.00 (−10000 centavos)", s.byName["Banco GTQ"].saldo === -10000, `got ${s.byName["Banco GTQ"].saldo}`);

  // ---------------------------------------------------------------
  console.log("Criterio 2: transferencia misma moneda NO cambia el patrimonio neto");
  const netBefore = s.byName["Banco GTQ"].saldo + s.byName["Efectivo"].saldo + s.byName["TC GTQ"].saldo;
  await api("POST", "/api/transfers", {
    fecha: "2026-06-02", cuenta_origen: bancoGTQ.id, cuenta_destino: efectivo.id, monto: 20000,
  });
  s = await saldos(uid);
  const netAfter = s.byName["Banco GTQ"].saldo + s.byName["Efectivo"].saldo + s.byName["TC GTQ"].saldo;
  check("Patrimonio neto GTQ inalterado", netBefore === netAfter, `before ${netBefore} after ${netAfter}`);
  check("Banco GTQ bajó 20000", s.byName["Banco GTQ"].saldo === -30000, `got ${s.byName["Banco GTQ"].saldo}`);
  check("Efectivo subió 20000", s.byName["Efectivo"].saldo === 20000, `got ${s.byName["Efectivo"].saldo}`);

  // ---------------------------------------------------------------
  console.log("Criterio 3: compra Q500 con TC aumenta deuda Q500; pago por transferencia no es gasto");
  await api("POST", "/api/collections/movimientos/records", {
    usuario: uid, fecha: "2026-06-03", cuenta: tcGTQ.id, categoria: catComida.id,
    tipo: "gasto", monto: -50000, descripcion: "Compra con TC",
  });
  s = await saldos(uid);
  check("TC GTQ deuda = -Q500.00", s.byName["TC GTQ"].saldo === -50000, `got ${s.byName["TC GTQ"].saldo}`);
  const gastosAntesPago = s.movs.filter((m) => m.tipo === "gasto").length;
  // pago de la tarjeta = transferencia (NO gasto)
  await api("POST", "/api/transfers", {
    fecha: "2026-06-04", cuenta_origen: bancoGTQ.id, cuenta_destino: tcGTQ.id, monto: 50000,
    descripcion: "Pago TC",
  });
  s = await saldos(uid);
  const gastosDespuesPago = s.movs.filter((m) => m.tipo === "gasto").length;
  check("TC GTQ saldo vuelve a 0 tras el pago", s.byName["TC GTQ"].saldo === 0, `got ${s.byName["TC GTQ"].saldo}`);
  check("El pago NO agregó ningún gasto", gastosDespuesPago === gastosAntesPago, `antes ${gastosAntesPago} después ${gastosDespuesPago}`);
  check("El pago se registró como 2 patas de transferencia", s.movs.filter((m) => m.descripcion === "Pago TC" && m.tipo === "transferencia").length === 2);

  // ---------------------------------------------------------------
  console.log("Criterio 4: transferencia GTQ→TC-USD redondea a centavos según tipo_cambio");
  // dejar la TC USD con deuda primero (compra USD 130.00)
  await api("POST", "/api/collections/movimientos/records", {
    usuario: uid, fecha: "2026-06-05", cuenta: tcUSD.id, categoria: catComida.id,
    tipo: "gasto", monto: -13000, descripcion: "Compra USD",
  });
  s = await saldos(uid);
  const bancoAntes = s.byName["Banco GTQ"].saldo;
  // tipo_cambio origen(GTQ)->destino(USD) = 0.13 ; monto origen Q1000.00
  const tr = await api("POST", "/api/transfers", {
    fecha: "2026-06-06", cuenta_origen: bancoGTQ.id, cuenta_destino: tcUSD.id, monto: 100000, tipo_cambio: 0.13,
  });
  s = await saldos(uid);
  check("Banco GTQ bajó Q1000.00 (100000)", s.byName["Banco GTQ"].saldo === bancoAntes - 100000, `got ${s.byName["Banco GTQ"].saldo}`);
  check("Destino USD = round(100000*0.13) = 13000", tr.destino.monto === 13000, `got ${tr.destino.monto}`);
  check("Deuda TC USD bajó a 0 (−13000 + 13000)", s.byName["TC USD"].saldo === 0, `got ${s.byName["TC USD"].saldo}`);

  // ---------------------------------------------------------------
  console.log("Criterio 5: export seguido de import reproduce los mismos saldos");
  // Export: construir CSV (mismo formato) desde los movimientos de u1
  s = await saldos(uid);
  const cols = ["fecha", "cuenta", "categoria", "tipo", "monto", "descripcion", "transfer_id", "conciliado", "notas"];
  const lines = [cols.join(",")];
  for (const m of s.movs) {
    const cuentaNombre = s.byId[m.cuenta].nombre;
    const catNombre = m.categoria ? "Comida" : "";
    lines.push(
      [
        m.fecha.slice(0, 10), cuentaNombre, catNombre, m.tipo, centsToInput(m.monto),
        (m.descripcion || "").replace(/,/g, " "), m.transfer_id || "", m.conciliado ? "true" : "false", "",
      ].join(",")
    );
  }
  const csv = lines.join("\n");

  // Re-parsear el CSV a filas-objeto
  const matrix = csv.split("\n").map((l) => l.split(","));
  const header = matrix[0];
  const rows = matrix.slice(1).map((cells) => {
    const o = {};
    header.forEach((h, i) => (o[h] = cells[i] ?? ""));
    return o;
  });

  // Crear u2 con las MISMAS cuentas/categorías por nombre, e importar
  const saldosU1 = JSON.parse(JSON.stringify(s.byName));
  const uid2 = await signupLogin("u2");
  for (const c of ["Banco GTQ:monetaria:GTQ", "Efectivo:efectivo:GTQ", "TC GTQ:tarjeta_credito:GTQ", "TC USD:tarjeta_credito:USD"]) {
    const [nombre, tipo, moneda] = c.split(":");
    await api("POST", "/api/collections/cuentas/records", {
      usuario: uid2, nombre, tipo, moneda, saldo_inicial: 0,
      limite_credito: tipo === "tarjeta_credito" ? 500000 : null, activa: true,
    });
  }
  await api("POST", "/api/collections/categorias/records", { usuario: uid2, nombre: "Comida", tipo: "gasto", activa: true });

  const imp = await api("POST", "/api/import", { rows });
  check(`Import OK (${imp.importados} filas)`, imp.ok === true, JSON.stringify(imp.errores));

  const s2 = await saldos(uid2);
  let igual = true;
  const detalles = [];
  for (const nombre of Object.keys(saldosU1)) {
    const a = saldosU1[nombre].saldo;
    const b = s2.byName[nombre]?.saldo;
    if (a !== b) {
      igual = false;
      detalles.push(`${nombre}: u1=${a} u2=${b}`);
    }
  }
  check("Saldos por cuenta idénticos tras export→import", igual, detalles.join(" | "));

  // ---------------------------------------------------------------
  await cleanup();
  console.log(`\nResultado: ${pass} OK, ${fail} fallos\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("\nError fatal:", e.message);
  await cleanup();
  process.exit(1);
});
