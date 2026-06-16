import type { Cuenta, Movimiento, Settings, Moneda, Grupo, Categoria, Presupuesto } from "./types";

// =============================================================================
// Lógica de negocio en el cliente. TODA la aritmética de dinero en enteros (centavos).
// No se guardan saldos: se computan a partir de saldo_inicial + SUMA(montos).
// =============================================================================

export interface SaldoCuenta {
  cuenta: Cuenta;
  saldo: number; // saldo de trabajo (todos los movimientos no eliminados)
  saldoCleared: number; // saldo confirmado: solo movimientos con conciliado=true
  disponible: number | null; // solo tarjeta_credito: limite_credito + saldo
}

/** saldo = saldo_inicial + SUMA(monto de movimientos no eliminados de esa cuenta). */
export function saldosPorCuenta(cuentas: Cuenta[], movimientos: Movimiento[]): SaldoCuenta[] {
  const sum = new Map<string, number>();
  const sumCleared = new Map<string, number>();
  for (const m of movimientos) {
    if (m.eliminado) continue;
    sum.set(m.cuenta, (sum.get(m.cuenta) ?? 0) + m.monto);
    if (m.conciliado) sumCleared.set(m.cuenta, (sumCleared.get(m.cuenta) ?? 0) + m.monto);
  }
  return cuentas.map((c) => {
    const base = c.saldo_inicial ?? 0;
    const saldo = base + (sum.get(c.id) ?? 0);
    const saldoCleared = base + (sumCleared.get(c.id) ?? 0);
    const disponible = c.tipo === "tarjeta_credito" ? (c.limite_credito ?? 0) + saldo : null;
    return { cuenta: c, saldo, saldoCleared, disponible };
  });
}

/** Convierte un monto en centavos de `from` a `base` usando tipo_cambio (USD->GTQ). Redondea a centavos. */
export function convertCents(cents: number, from: Moneda, base: Moneda, tipoCambioUsd: number): number {
  if (from === base) return cents;
  if (from === "USD" && base === "GTQ") return Math.round(cents * tipoCambioUsd);
  if (from === "GTQ" && base === "USD") return tipoCambioUsd > 0 ? Math.round(cents / tipoCambioUsd) : 0;
  return cents;
}

export interface Patrimonio {
  porMoneda: Record<string, number>; // moneda -> centavos
  consolidado: number; // centavos, en moneda_base
  monedaBase: Moneda;
  tipoCambioUsd: number;
}

/**
 * Patrimonio neto: subtotal por moneda + consolidado en moneda_base.
 * El consolidado usa COSTO HISTÓRICO: cada movimiento/saldo en moneda extranjera se valúa
 * con su propia tasa `tc_base` (la del momento), no con una sola tasa global. Las
 * transferencias cross-currency quedan en residuo 0. Si un movimiento no tiene `tc_base`
 * (datos viejos), cae a la tasa global.
 */
export function patrimonio(
  saldos: SaldoCuenta[],
  settings: Settings | null,
  movimientos: Movimiento[]
): Patrimonio {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tipoCambioUsd = settings?.tipo_cambio_usd ?? 0;

  const porMoneda: Record<string, number> = {};
  for (const s of saldos) {
    const m = s.cuenta.moneda;
    porMoneda[m] = (porMoneda[m] ?? 0) + s.saldo;
  }

  const baseEquiv = (amount: number, mon: Moneda, r?: number) => {
    if (mon === monedaBase) return amount;
    if (r && r > 0) return Math.round(amount * r);
    return convertCents(amount, mon, monedaBase, tipoCambioUsd);
  };

  let consolidado = 0;
  for (const s of saldos) {
    consolidado += baseEquiv(s.cuenta.saldo_inicial ?? 0, s.cuenta.moneda, s.cuenta.tc_base_inicial);
  }
  for (const m of movimientos) {
    if (m.eliminado) continue;
    consolidado += baseEquiv(m.monto, m.moneda, m.tc_base);
  }

  return { porMoneda, consolidado, monedaBase, tipoCambioUsd };
}

// --------------------------- Dinero disponible para asignar ---------------------------

export interface Disponible {
  arrastrado: number; // disponible que viene de meses anteriores (rollover)
  ingresosMes: number; // ingresos recibidos en este mes (en moneda_base)
  asignadoMes: number; // presupuestado en este mes
  disponible: number; // arrastrado + ingresosMes - asignadoMes
}

/**
 * Dinero disponible para asignar en `mes` ("YYYY-MM"), modelo YNAB:
 * el ingreso queda disponible el mes en que se recibe y lo NO asignado se acumula
 * a los meses siguientes. Equivale a (ingresos hasta fin de mes) − (asignado hasta mes).
 * Negativo = asignaste más de lo que tienes. Ingresos en otra moneda se convierten a moneda_base.
 */
export function disponibleParaAsignar(
  movimientos: Movimiento[],
  presupuestos: Presupuesto[],
  mes: string,
  settings: Settings | null,
  excluidas: Set<string> = new Set()
): Disponible {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tc = settings?.tipo_cambio_usd ?? 0;

  const addMonth = (ym: string, n: number) => {
    const [y, mm] = ym.split("-").map(Number);
    const d = new Date(y, mm - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  let arrastradoIngresos = 0;
  let ingresosMes = 0;
  for (const m of movimientos) {
    if (m.eliminado || m.tipo !== "ingreso") continue;
    if (excluidas.has(m.categoria)) continue; // ingresos de categorías excluidas (ajustes)
    const f = (m.fecha || "").slice(0, 10);
    if (!f) continue;
    // mes en que el ingreso queda disponible (su mes, o el siguiente si está marcado)
    const recon = m.ingreso_proximo_mes ? addMonth(f.slice(0, 7), 1) : f.slice(0, 7);
    const conv = convertCents(m.monto, m.moneda, monedaBase, tc);
    if (recon < mes) arrastradoIngresos += conv;
    else if (recon === mes) ingresosMes += conv;
  }

  let arrastradoAsignado = 0;
  let asignadoMes = 0;
  for (const p of presupuestos) {
    if (p.mes < mes) arrastradoAsignado += p.monto;
    else if (p.mes === mes) asignadoMes += p.monto;
  }

  const arrastrado = arrastradoIngresos - arrastradoAsignado;
  return { arrastrado, ingresosMes, asignadoMes, disponible: arrastrado + ingresosMes - asignadoMes };
}

// --------------------------- Balance acumulado por categoría (sinking funds) ---------------------------

export interface BalanceCategoria {
  asignadoMes: number; // presupuesto asignado en el mes
  gastadoMes: number; // gasto del mes (moneda_base)
  disponible: number; // saldo acumulado = Σ asignado(≤mes) − Σ gastado(≤mes)
}

/**
 * Saldo acumulado por categoría hasta `mes` (estilo YNAB): cada categoría arrastra su
 * saldo no gastado, así que `disponible = Σ asignado − Σ gastado` de todos los meses ≤ mes.
 * Devuelve un mapa categoriaId -> {asignadoMes, gastadoMes, disponible}.
 */
export function balancesCategoria(
  movimientos: Movimiento[],
  presupuestos: Presupuesto[],
  mes: string,
  settings: Settings | null
): Map<string, BalanceCategoria> {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tc = settings?.tipo_cambio_usd ?? 0;

  const cumAsignado = new Map<string, number>();
  const asignadoMes = new Map<string, number>();
  for (const p of presupuestos) {
    if (p.mes <= mes) cumAsignado.set(p.categoria, (cumAsignado.get(p.categoria) ?? 0) + p.monto);
    if (p.mes === mes) asignadoMes.set(p.categoria, (asignadoMes.get(p.categoria) ?? 0) + p.monto);
  }

  const cumGastado = new Map<string, number>();
  const gastadoMes = new Map<string, number>();
  for (const m of movimientos) {
    if (m.eliminado || m.tipo !== "gasto") continue;
    const mm = (m.fecha || "").slice(0, 7);
    if (!mm || mm > mes) continue;
    const conv = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    cumGastado.set(m.categoria, (cumGastado.get(m.categoria) ?? 0) + conv);
    if (mm === mes) gastadoMes.set(m.categoria, (gastadoMes.get(m.categoria) ?? 0) + conv);
  }

  const out = new Map<string, BalanceCategoria>();
  const ids = new Set<string>([...cumAsignado.keys(), ...cumGastado.keys()]);
  for (const id of ids) {
    out.set(id, {
      asignadoMes: asignadoMes.get(id) ?? 0,
      gastadoMes: gastadoMes.get(id) ?? 0,
      disponible: (cumAsignado.get(id) ?? 0) - (cumGastado.get(id) ?? 0),
    });
  }
  return out;
}

// --------------------------- Reportes ---------------------------

export interface ReporteCategoria {
  categoriaId: string;
  nombre: string;
  total: number; // centavos en moneda_base
}
export interface ReporteGrupo {
  grupoId: string;
  grupoNombre: string;
  total: number;
  categorias: ReporteCategoria[];
}

/**
 * (a) Gasto por categoría en un rango de fechas, consolidado en moneda_base y
 * AGRUPADO respetando el orden de grupos y de categorías dentro de cada grupo.
 */
export function gastoPorGrupo(
  movimientos: Movimiento[],
  desde: string,
  hasta: string,
  settings: Settings | null,
  grupos: Grupo[],
  categorias: Categoria[],
  incluirOcultas = false
): ReporteGrupo[] {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tc = settings?.tipo_cambio_usd ?? 0;

  // total de gasto por categoría (en moneda_base) dentro del rango
  const acc = new Map<string, number>();
  for (const m of movimientos) {
    if (m.eliminado || m.tipo !== "gasto") continue;
    const f = (m.fecha || "").slice(0, 10);
    if (f < desde || f > hasta) continue;
    const base = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    acc.set(m.categoria, (acc.get(m.categoria) ?? 0) + base);
  }

  const oculta = (c: Categoria) => c.excluir_presupuesto && !incluirOcultas;
  const hiddenIds = new Set(categorias.filter(oculta).map((c) => c.id));

  const ordenGrupos = [...grupos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const catsDe = (gid: string) =>
    categorias
      .filter((c) => (c.grupo || "") === gid && !oculta(c))
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

  const used = new Set<string>();
  const out: ReporteGrupo[] = [];

  const buildItems = (cs: Categoria[]) => {
    const items: ReporteCategoria[] = [];
    for (const c of cs) {
      used.add(c.id);
      const total = acc.get(c.id) ?? 0;
      if (total > 0) items.push({ categoriaId: c.id, nombre: c.nombre, total });
    }
    return items;
  };

  for (const g of ordenGrupos) {
    const items = buildItems(catsDe(g.id));
    if (items.length)
      out.push({
        grupoId: g.id,
        grupoNombre: g.nombre,
        total: items.reduce((a, b) => a + b.total, 0),
        categorias: items,
      });
  }

  // Sin grupo + categorías/montos sueltos (p. ej. categorías borradas)
  const sinItems = buildItems(catsDe(""));
  for (const [id, total] of acc) {
    if (!used.has(id) && total > 0 && !hiddenIds.has(id))
      sinItems.push({ categoriaId: id, nombre: "(sin categoría)", total });
  }
  if (sinItems.length)
    out.push({
      grupoId: "",
      grupoNombre: "Sin grupo",
      total: sinItems.reduce((a, b) => a + b.total, 0),
      categorias: sinItems,
    });

  return out;
}

/** Gasto por categoría en un mes ("YYYY-MM"), consolidado en moneda_base. */
export function gastoEnMesPorCategoria(
  movimientos: Movimiento[],
  mes: string,
  settings: Settings | null
): Map<string, number> {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tc = settings?.tipo_cambio_usd ?? 0;
  const acc = new Map<string, number>();
  for (const m of movimientos) {
    if (m.eliminado || m.tipo !== "gasto") continue;
    if (!(m.fecha || "").startsWith(mes)) continue;
    const base = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    acc.set(m.categoria, (acc.get(m.categoria) ?? 0) + base);
  }
  return acc;
}

export interface MesIngresoGasto {
  mes: string; // YYYY-MM
  ingreso: number; // centavos en moneda_base
  gasto: number; // centavos en moneda_base (positivo)
}

/** (b) Ingreso vs gasto por mes, consolidado en moneda_base. */
export function ingresoVsGastoPorMes(
  movimientos: Movimiento[],
  settings: Settings | null,
  excluidas: Set<string> = new Set()
): MesIngresoGasto[] {
  const monedaBase: Moneda = settings?.moneda_base ?? "GTQ";
  const tc = settings?.tipo_cambio_usd ?? 0;
  const acc = new Map<string, { ingreso: number; gasto: number }>();
  for (const m of movimientos) {
    if (m.eliminado || m.tipo === "transferencia") continue;
    if (excluidas.has(m.categoria)) continue; // categorías excluidas (ajustes)
    const mes = (m.fecha || "").slice(0, 7);
    if (!mes) continue;
    const base = convertCents(Math.abs(m.monto), m.moneda, monedaBase, tc);
    const cur = acc.get(mes) ?? { ingreso: 0, gasto: 0 };
    if (m.tipo === "ingreso") cur.ingreso += base;
    else cur.gasto += base;
    acc.set(mes, cur);
  }
  return [...acc.entries()]
    .map(([mes, v]) => ({ mes, ...v }))
    .sort((a, b) => a.mes.localeCompare(b.mes));
}
