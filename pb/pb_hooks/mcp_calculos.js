/// <reference path="../pb_data/types.d.ts" />

// Cálculos de negocio para el servidor MCP: port JS de frontend/src/lib/finance.ts.
// Son funciones PURAS (no usan $app ni ningún global de PocketBase) sobre objetos con los
// mismos nombres de campo que la API (monto, moneda, tc_base, ingreso_proximo_mes...), para que
// scripts/mcp-paridad.mjs pueda comprobar en Node que dan los mismos resultados que la app.
//
// SI CAMBIAS finance.ts, cambia esto también y corre scripts/mcp-paridad.mjs.
// No usa ?. ni ?? (el JS de PocketBase es goja).

const convertCents = (cents, from, base, tipoCambioUsd) => {
  if (from === base) return cents;
  if (from === "USD" && base === "GTQ") return Math.round(cents * tipoCambioUsd);
  if (from === "GTQ" && base === "USD") return tipoCambioUsd > 0 ? Math.round(cents / tipoCambioUsd) : 0;
  return cents;
};

const baseDe = (settings) => (settings && settings.moneda_base) || "GTQ";
const tcDe = (settings) => (settings && settings.tipo_cambio_usd) || 0;

const addMonth = (ym, n) => {
  const d = new Date(Date.UTC(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 1 + n, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
};

const parseTags = (tags) => {
  if (!tags) return [];
  return String(tags).trim().split(/\s+/).filter(Boolean);
};

// --------------------------- Préstamos

const mapaPrestamos = (cuentas) => {
  const m = {};
  cuentas.forEach((c) => {
    if (c.tipo === "prestamo") m[c.id] = c;
  });
  return m;
};

// Pata POSITIVA de una transferencia hacia un préstamo con categoria_pago: cuenta como gasto de esa categoría.
const abonoPrestamo = (m, prestamos) => {
  if (m.tipo !== "transferencia" || m.monto <= 0) return null;
  const p = prestamos[m.cuenta];
  return p && p.categoria_pago ? [p.categoria_pago, m.monto] : null;
};

// --------------------------- Saldos y patrimonio

const saldosPorCuenta = (cuentas, movimientos) => {
  const sum = {};
  const sumCleared = {};
  movimientos.forEach((m) => {
    if (m.eliminado) return;
    sum[m.cuenta] = (sum[m.cuenta] || 0) + m.monto;
    if (m.conciliado) sumCleared[m.cuenta] = (sumCleared[m.cuenta] || 0) + m.monto;
  });
  return cuentas.map((c) => {
    const base = c.saldo_inicial || 0;
    const saldo = base + (sum[c.id] || 0);
    const saldoCleared = base + (sumCleared[c.id] || 0);
    const disponible = c.tipo === "tarjeta_credito" ? (c.limite_credito || 0) + saldo : null;
    return { cuenta: c, saldo, saldoCleared, disponible };
  });
};

// Patrimonio a costo histórico: cada movimiento/saldo en moneda extranjera usa su propia tasa tc_base.
const patrimonio = (saldos, settings, movimientos) => {
  const monedaBase = baseDe(settings);
  const tipoCambioUsd = tcDe(settings);

  const porMoneda = {};
  saldos.forEach((s) => {
    const m = s.cuenta.moneda;
    porMoneda[m] = (porMoneda[m] || 0) + s.saldo;
  });

  const baseEquiv = (amount, mon, r) => {
    if (mon === monedaBase) return amount;
    if (r && r > 0) return Math.round(amount * r);
    return convertCents(amount, mon, monedaBase, tipoCambioUsd);
  };

  let consolidado = 0;
  saldos.forEach((s) => {
    consolidado += baseEquiv(s.cuenta.saldo_inicial || 0, s.cuenta.moneda, s.cuenta.tc_base_inicial);
  });
  movimientos.forEach((m) => {
    if (m.eliminado) return;
    consolidado += baseEquiv(m.monto, m.moneda, m.tc_base);
  });

  return { porMoneda, consolidado, monedaBase, tipoCambioUsd };
};

// --------------------------- Disponible para asignar (modelo YNAB)

const disponibleParaAsignar = (movimientos, presupuestos, mes, settings, excluidas) => {
  const monedaBase = baseDe(settings);
  const tc = tcDe(settings);
  const excl = excluidas || new Set();

  let arrastradoIngresos = 0;
  let ingresosMes = 0;
  movimientos.forEach((m) => {
    if (m.eliminado || m.tipo !== "ingreso") return;
    if (excl.has(m.categoria)) return; // ingresos de categorías excluidas (ajustes)
    const f = (m.fecha || "").slice(0, 10);
    if (!f) return;
    // mes en que el ingreso queda disponible (su mes, o el siguiente si está marcado)
    const recon = m.ingreso_proximo_mes ? addMonth(f.slice(0, 7), 1) : f.slice(0, 7);
    const conv = convertCents(m.monto, m.moneda, monedaBase, tc);
    if (recon < mes) arrastradoIngresos += conv;
    else if (recon === mes) ingresosMes += conv;
  });

  let arrastradoAsignado = 0;
  let asignadoMes = 0;
  presupuestos.forEach((p) => {
    if (p.mes < mes) arrastradoAsignado += p.monto;
    else if (p.mes === mes) asignadoMes += p.monto;
  });

  const arrastrado = arrastradoIngresos - arrastradoAsignado;
  return { arrastrado, ingresosMes, asignadoMes, disponible: arrastrado + ingresosMes - asignadoMes };
};

// --------------------------- Saldo acumulado por categoría (sinking funds)

// Devuelve un objeto categoriaId -> { asignadoMes, gastadoMes, disponible }.
const balancesCategoria = (movimientos, presupuestos, mes, settings, cuentas) => {
  const monedaBase = baseDe(settings);
  const tc = tcDe(settings);

  const cumAsignado = {};
  const asignadoMes = {};
  presupuestos.forEach((p) => {
    if (p.mes <= mes) cumAsignado[p.categoria] = (cumAsignado[p.categoria] || 0) + p.monto;
    if (p.mes === mes) asignadoMes[p.categoria] = (asignadoMes[p.categoria] || 0) + p.monto;
  });

  const prestamos = mapaPrestamos(cuentas || []);
  const cumGastado = {};
  const gastadoMes = {};
  movimientos.forEach((m) => {
    if (m.eliminado) return;
    // gasto normal, o abono a capital de un préstamo (cuenta como gasto de su categoría)
    const abono = abonoPrestamo(m, prestamos);
    if (m.tipo !== "gasto" && !abono) return;
    const mm = (m.fecha || "").slice(0, 7);
    if (!mm || mm > mes) return;
    const cat = abono ? abono[0] : m.categoria;
    const conv = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    cumGastado[cat] = (cumGastado[cat] || 0) + conv;
    if (mm === mes) gastadoMes[cat] = (gastadoMes[cat] || 0) + conv;
  });

  const out = {};
  const ids = {};
  Object.keys(cumAsignado).forEach((k) => (ids[k] = true));
  Object.keys(cumGastado).forEach((k) => (ids[k] = true));
  Object.keys(ids).forEach((id) => {
    out[id] = {
      asignadoMes: asignadoMes[id] || 0,
      gastadoMes: gastadoMes[id] || 0,
      disponible: (cumAsignado[id] || 0) - (cumGastado[id] || 0),
    };
  });
  return out;
};

// --------------------------- Reportes

// Ingreso vs gasto por mes (sin transferencias ni categorías excluidas).
const ingresoVsGastoPorMes = (movimientos, settings, excluidas) => {
  const monedaBase = baseDe(settings);
  const tc = tcDe(settings);
  const excl = excluidas || new Set();
  const acc = {};
  movimientos.forEach((m) => {
    if (m.eliminado || m.tipo === "transferencia") return;
    if (excl.has(m.categoria)) return; // categorías excluidas (ajustes)
    const mes = (m.fecha || "").slice(0, 7);
    if (!mes) return;
    const base = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    const cur = acc[mes] || { ingreso: 0, gasto: 0 };
    if (m.tipo === "ingreso") cur.ingreso += base;
    else cur.gasto += base;
    acc[mes] = cur;
  });
  return Object.keys(acc)
    .map((mes) => ({ mes: mes, ingreso: acc[mes].ingreso, gasto: acc[mes].gasto }))
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
};

// Reporte por etiqueta en un rango [desde, hasta] (YYYY-MM-DD); un movimiento suma a cada una de sus etiquetas.
const totalesPorTag = (movimientos, desde, hasta, settings) => {
  const monedaBase = baseDe(settings);
  const tc = tcDe(settings);
  const acc = new Map(); // Map y no objeto: una etiqueta como "2026" reordenaría las claves y los empates
  movimientos.forEach((m) => {
    if (m.eliminado || m.tipo === "transferencia") return;
    const f = (m.fecha || "").slice(0, 10);
    if ((desde && f < desde) || (hasta && f > hasta)) return;
    const tags = parseTags(m.tags);
    if (tags.length === 0) return;
    const base = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    tags.forEach((tag) => {
      const cur = acc.get(tag) || { tag: tag, ingreso: 0, gasto: 0, conteo: 0 };
      if (m.tipo === "ingreso") cur.ingreso += base;
      else cur.gasto += base;
      cur.conteo += 1;
      acc.set(tag, cur);
    });
  });
  return Array.from(acc.values()).sort((a, b) => b.gasto - a.gasto || b.ingreso - a.ingreso);
};

module.exports = {
  convertCents,
  addMonth,
  parseTags,
  mapaPrestamos,
  abonoPrestamo,
  saldosPorCuenta,
  patrimonio,
  disponibleParaAsignar,
  balancesCategoria,
  ingresoVsGastoPorMes,
  totalesPorTag,
};
