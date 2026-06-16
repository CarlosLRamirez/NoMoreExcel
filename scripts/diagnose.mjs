#!/usr/bin/env node
// Diagnóstico de patrimonio: reconcilia el patrimonio neto (saldos de cuentas) contra
// el flujo "inicial + ingresos − gastos", e itemiza la diferencia (transferencias con
// efecto de tipo de cambio, categorías excluidas, etc.).
//
// Uso (con TU usuario de la app; corre local, las credenciales NO se guardan):
//   PB_EMAIL=tu@correo PB_PASSWORD=tuclave node scripts/diagnose.mjs [PB_URL]
//
// No requiere dependencias (Node >= 18).

const BASE = process.argv[2] || process.env.PB_URL || "http://127.0.0.1:8090";
const EMAIL = process.env.PB_EMAIL;
const PASSWORD = process.env.PB_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Falta PB_EMAIL y/o PB_PASSWORD. Ej: PB_EMAIL=tu@correo PB_PASSWORD=clave node scripts/diagnose.mjs");
  process.exit(1);
}

let token = "";
async function api(path) {
  const res = await fetch(BASE + path, { headers: token ? { Authorization: token } : {} });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}
async function login() {
  const res = await fetch(BASE + "/api/collections/users/auth-with-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error("Login falló: " + (await res.text()));
  const d = await res.json();
  token = d.token;
}
async function getAll(coll, filter = "") {
  const out = [];
  let page = 1;
  for (;;) {
    const qs = `perPage=500&page=${page}` + (filter ? `&filter=${encodeURIComponent(filter)}` : "");
    const r = await api(`/api/collections/${coll}/records?${qs}`);
    out.push(...r.items);
    if (page >= r.totalPages) break;
    page++;
  }
  return out;
}

const Q = (c) => {
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? "-" : "") + "Q" + (Math.trunc(a / 100)).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0");
};

async function main() {
  await login();
  const settings = (await getAll("settings"))[0] || { moneda_base: "GTQ", tipo_cambio_usd: 0 };
  const base = settings.moneda_base;
  const tc = settings.tipo_cambio_usd || 0;
  const conv = (cents, mon) => {
    if (mon === base) return cents;
    if (mon === "USD" && base === "GTQ") return Math.round(cents * tc);
    if (mon === "GTQ" && base === "USD") return tc > 0 ? Math.round(cents / tc) : 0;
    return cents;
  };

  const cuentas = await getAll("cuentas");
  const cats = await getAll("categorias");
  const movs = await getAll("movimientos", "eliminado=false");
  const catMon = new Map(cats.map((c) => [c.id, c]));
  const ctaById = new Map(cuentas.map((c) => [c.id, c]));

  console.log(`\nDiagnóstico (${EMAIL}) — moneda base ${base}, tipo de cambio USD = ${tc}\n`);

  // --- Patrimonio por cuenta ---
  const sum = new Map();
  for (const m of movs) sum.set(m.cuenta, (sum.get(m.cuenta) || 0) + m.monto);
  let inicialConsol = 0;
  let patrimonio = 0;
  console.log("Cuentas:");
  for (const c of cuentas) {
    const saldo = (c.saldo_inicial || 0) + (sum.get(c.id) || 0);
    inicialConsol += conv(c.saldo_inicial || 0, c.moneda);
    patrimonio += conv(saldo, c.moneda);
    console.log(`  ${c.nombre.padEnd(22)} ${c.moneda}  inicial ${Q(c.saldo_inicial || 0).padStart(14)}  saldo ${Q(saldo).padStart(14)}`);
  }
  console.log(`\n  Inicial consolidado (${base}): ${Q(inicialConsol)}`);
  console.log(`  Patrimonio a tasa global (modelo viejo, sólo comparación): ${Q(patrimonio)}`);

  // --- Flujo: ingresos, gastos, transferencias (efecto FX), excluidas ---
  let ingTodo = 0, gasTodo = 0, transferFX = 0;
  let ingExcl = 0, gasExcl = 0;
  const porMes = {};
  for (const m of movs) {
    const convm = conv(m.monto, m.moneda);
    const mes = (m.fecha || "").slice(0, 7);
    porMes[mes] = porMes[mes] || { ing: 0, gas: 0 };
    const excl = m.categoria && catMon.get(m.categoria)?.excluir_presupuesto;
    if (m.tipo === "ingreso") {
      ingTodo += convm;
      porMes[mes].ing += convm;
      if (excl) ingExcl += convm;
    } else if (m.tipo === "gasto") {
      gasTodo += convm; // negativo
      porMes[mes].gas += convm;
      if (excl) gasExcl += convm;
    } else if (m.tipo === "transferencia") {
      transferFX += convm; // suma de patas convertidas: 0 si misma moneda, residuo FX si cross
    }
  }

  console.log("\nPor mes (consolidado, TODAS las categorías):");
  for (const mes of Object.keys(porMes).sort()) {
    console.log(`  ${mes}  ingresos ${Q(porMes[mes].ing).padStart(14)}   gastos ${Q(porMes[mes].gas).padStart(14)}`);
  }

  console.log("\nTotales (consolidado):");
  console.log(`  Σ ingresos:                 ${Q(ingTodo)}`);
  console.log(`  Σ gastos:                   ${Q(gasTodo)}`);
  console.log(`  Σ transferencias (FX):      ${Q(transferFX)}   <- ≠ 0 sólo si hay transferencias cross-currency`);
  console.log(`  Ingresos en cat. EXCLUIDAS: ${Q(ingExcl)}`);
  console.log(`  Gastos en cat. EXCLUIDAS:   ${Q(gasExcl)}`);

  // --- Reconciliación ---
  const recon = inicialConsol + ingTodo + gasTodo + transferFX; // gasTodo ya es negativo
  console.log("\nReconciliación:");
  console.log(`  inicial + ingresos + gastos + transferFX = ${Q(recon)}`);
  console.log(`  patrimonio neto                          = ${Q(patrimonio)}`);
  console.log(`  (deben ser iguales; diferencia = ${Q(recon - patrimonio)})`);

  const flujoUsuario = inicialConsol + ingTodo + gasTodo; // sin transferencias
  console.log("\nVs. tu cálculo (inicial + ingresos − gastos, SIN transferencias ni excluidas):");
  console.log(`  flujo sin transferencias:  ${Q(flujoUsuario)}`);
  console.log(`  ingresos sin excluidas:    ${Q(ingTodo - ingExcl)}`);
  console.log(`  gastos sin excluidas:      ${Q(gasTodo - gasExcl)}`);

  // --- Costo histórico (modelo actual del patrimonio) ---
  const beq = (amount, mon, r) => (mon === base ? amount : r && r > 0 ? Math.round(amount * r) : conv(amount, mon));
  let patHist = 0;
  let transResid = 0;
  for (const c of cuentas) patHist += beq(c.saldo_inicial || 0, c.moneda, c.tc_base_inicial);
  for (const m of movs) {
    if (m.eliminado) continue;
    const v = beq(m.monto, m.moneda, m.tc_base);
    patHist += v;
    if (m.tipo === "transferencia") transResid += v;
  }
  console.log("\nCosto histórico (lo que AHORA muestra la app):");
  console.log(`  PATRIMONIO (histórico):        ${Q(patHist)}`);
  console.log(`  Residuo de transferencias:     ${Q(transResid)}   (debería ser ~0)`);
  console.log(`  Vs. tu cálculo de flujo:       ${Q(flujoUsuario)}   (diferencia ${Q(patHist - flujoUsuario)})`);
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
