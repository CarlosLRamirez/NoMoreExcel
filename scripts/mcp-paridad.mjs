#!/usr/bin/env node
// Comprueba que los cálculos del servidor MCP (pb/pb_hooks/mcp_calculos.js) dan EXACTAMENTE los
// mismos números que la app (frontend/src/lib/finance.ts), con miles de casos aleatorios.
//
//   cd frontend && npm ci && cd .. && node scripts/mcp-paridad.mjs [iteraciones]
// Corre sin PocketBase. Si cambias finance.ts o mcp_calculos.js, vuelve a correrlo.

import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireFront = createRequire(join(raiz, "frontend", "package.json"));
const { build } = requireFront("esbuild");

// finance.ts -> CommonJS temporal (solo importa tipos de ./types, que esbuild descarta)
const tmp = mkdtempSync(join(tmpdir(), "paridad-"));
const salida = join(tmp, "finance.cjs");
await build({ entryPoints: [join(raiz, "frontend/src/lib/finance.ts")], bundle: true, platform: "node", format: "cjs", outfile: salida, logLevel: "error" });
const app = createRequire(import.meta.url)(salida);
const mcp = createRequire(import.meta.url)(join(raiz, "pb/pb_hooks/mcp_calculos.js"));

// PRNG con semilla (reproducible)
let semilla = 20261128;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ent = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const elige = (arr) => arr[ent(0, arr.length - 1)];

const MESES = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const TAGS = ["cafe", "viaje", "2026", "cumple", "negocio", "x"];

function generar() {
  const cats = Array.from({ length: 10 }, (_, i) => ({ id: "c" + i, tipo: i < 7 ? "gasto" : "ingreso", excluir_presupuesto: rnd() < 0.2 }));
  const cuentas = Array.from({ length: ent(2, 6) }, (_, i) => {
    const tipo = elige(["monetaria", "ahorro", "efectivo", "tarjeta_credito", "prestamo"]);
    return {
      id: "a" + i,
      tipo,
      moneda: rnd() < 0.3 ? "USD" : "GTQ",
      saldo_inicial: (tipo === "tarjeta_credito" || tipo === "prestamo" ? -1 : 1) * ent(0, 5000000),
      tc_base_inicial: rnd() < 0.5 ? 0 : 7 + rnd() * 1.5,
      limite_credito: ent(0, 2000000),
      categoria_pago: tipo === "prestamo" && rnd() < 0.8 ? "c" + ent(0, 6) : "",
    };
  });
  const movimientos = [];
  const n = ent(0, 160);
  for (let i = 0; i < n; i++) {
    const cuenta = elige(cuentas);
    const tipo = elige(["gasto", "gasto", "ingreso", "transferencia"]);
    const mag = ent(1, 800000);
    const monto = tipo === "ingreso" ? mag : tipo === "gasto" ? -mag : rnd() < 0.5 ? mag : -mag;
    movimientos.push({
      id: "m" + i,
      fecha: elige(MESES) + "-" + String(ent(1, 28)).padStart(2, "0") + " 00:00:00.000Z",
      cuenta: cuenta.id,
      categoria: tipo === "transferencia" ? "" : "c" + (tipo === "gasto" ? ent(0, 6) : ent(7, 9)),
      tipo,
      monto,
      moneda: cuenta.moneda,
      tc_base: rnd() < 0.4 ? 0 : 7 + rnd() * 1.5,
      conciliado: rnd() < 0.5,
      ingreso_proximo_mes: tipo === "ingreso" && rnd() < 0.25,
      tags: Array.from({ length: ent(0, 2) }, () => elige(TAGS)).join(" "),
      eliminado: rnd() < 0.1,
    });
  }
  const presupuestos = [];
  for (const mes of MESES) for (const c of cats.filter((x) => x.tipo === "gasto")) if (rnd() < 0.5) presupuestos.push({ categoria: c.id, mes, monto: ent(1, 900000) });
  const settings = rnd() < 0.1 ? null : { moneda_base: rnd() < 0.8 ? "GTQ" : "USD", tipo_cambio_usd: rnd() < 0.2 ? 0 : 7 + rnd() * 1.5 };
  return { cats, cuentas, movimientos, presupuestos, settings };
}

const mapAObjeto = (m) => Object.fromEntries([...m.entries()].sort());
const ordenar = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)));

const iteraciones = parseInt(process.argv[2] || "400", 10);
let comparaciones = 0;
for (let it = 0; it < iteraciones; it++) {
  const { cats, cuentas, movimientos, presupuestos, settings } = generar();
  const excluidas = new Set(cats.filter((c) => c.excluir_presupuesto).map((c) => c.id));
  const ctx = `iteración ${it}`;

  // saldos y patrimonio
  const sa = app.saldosPorCuenta(cuentas, movimientos);
  const sm = mcp.saldosPorCuenta(cuentas, movimientos);
  assert.deepEqual(ordenar(sm), ordenar(sa), "saldosPorCuenta " + ctx);
  assert.deepEqual(ordenar(mcp.patrimonio(sm, settings, movimientos)), ordenar(app.patrimonio(sa, settings, movimientos)), "patrimonio " + ctx);

  for (const mes of [elige(MESES), elige(MESES), "2026-11"]) {
    assert.deepEqual(
      ordenar(mcp.disponibleParaAsignar(movimientos, presupuestos, mes, settings, excluidas)),
      ordenar(app.disponibleParaAsignar(movimientos, presupuestos, mes, settings, excluidas)),
      "disponibleParaAsignar " + mes + " " + ctx
    );
    assert.deepEqual(
      ordenar(mcp.balancesCategoria(movimientos, presupuestos, mes, settings, cuentas)),
      ordenar(mapAObjeto(app.balancesCategoria(movimientos, presupuestos, mes, settings, cuentas))),
      "balancesCategoria " + mes + " " + ctx
    );
    comparaciones += 2;
  }
  assert.deepEqual(ordenar(mcp.ingresoVsGastoPorMes(movimientos, settings, excluidas)), ordenar(app.ingresoVsGastoPorMes(movimientos, settings, excluidas)), "ingresoVsGastoPorMes " + ctx);
  const d = elige(MESES) + "-01";
  const h = elige(MESES) + "-28";
  assert.deepEqual(app.totalesPorTag(movimientos, d, h, settings), mcp.totalesPorTag(movimientos, d, h, settings), "totalesPorTag " + ctx);
  comparaciones += 4;
}
console.log(`✅ ${iteraciones} escenarios aleatorios, ${comparaciones} comparaciones: mcp_calculos.js coincide con finance.ts`);
