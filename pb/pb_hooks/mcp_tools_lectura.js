/// <reference path="../pb_data/types.d.ts" />

// Herramientas MCP de LECTURA (resúmenes y reportes). Los números salen de mcp_calculos.js,
// que replica frontend/src/lib/finance.ts (verificado por scripts/mcp-paridad.mjs).

const {
  fallo,
  norm,
  centsToStr,
  fechaValida,
  cargarDatos,
  mesValido,
  mesActual,
  sumarMes,
} = require(`${__hooks}/mcp_util.js`);
const C = require(`${__hooks}/mcp_calculos.js`);

const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const mesDe = (args) => {
  const mes = args.mes === undefined ? mesActual() : args.mes;
  if (!mesValido(mes)) throw fallo("mes debe tener formato YYYY-MM");
  return mes;
};

// Ids de las categorías excluidas del presupuesto (ajustes de patrimonio, etc.).
const idsExcluidas = (categorias) => new Set(categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id));

// Categorías de grupos que el usuario quiere dejar fuera (por nombre de grupo).
const idsDeGrupos = (d, nombres) => {
  const fuera = (nombres || []).map(norm);
  if (fuera.length === 0) return new Set();
  const gruposFuera = {};
  d.grupos.forEach((g) => {
    if (fuera.indexOf(norm(g.nombre)) !== -1) gruposFuera[g.id] = true;
  });
  return new Set(d.categorias.filter((c) => gruposFuera[c.grupo]).map((c) => c.id));
};

const sinCategorias = (movimientos, ids) => (ids.size === 0 ? movimientos : movimientos.filter((m) => !ids.has(m.categoria)));

// ---------------------------------------------------------------- herramientas

const resumen_mes = (args, userId) => {
  const mes = mesDe(args);
  const d = cargarDatos(userId);
  const base = (d.settings && d.settings.moneda_base) || "GTQ";
  const excluidas = idsExcluidas(d.categorias);

  const saldos = C.saldosPorCuenta(d.cuentas, d.movimientos);
  const pat = C.patrimonio(saldos, d.settings, d.movimientos);
  const disp = C.disponibleParaAsignar(d.movimientos, d.presupuestos, mes, d.settings, excluidas);
  const bal = C.balancesCategoria(d.movimientos, d.presupuestos, mes, d.settings, d.cuentas);
  const delMes = C.ingresoVsGastoPorMes(d.movimientos, d.settings, excluidas).filter((m) => m.mes === mes)[0] || { ingreso: 0, gasto: 0 };

  let asignadoCategorias = 0;
  const sobregastadas = [];
  d.categorias
    .filter((c) => c.tipo === "gasto" && !c.excluir_presupuesto)
    .forEach((c) => {
      const b = bal[c.id];
      if (!b) return;
      asignadoCategorias += b.asignadoMes;
      if (b.disponible < 0) sobregastadas.push({ categoria: c.nombre, sobregasto: centsToStr(-b.disponible) });
    });

  const porMoneda = {};
  Object.keys(pat.porMoneda).forEach((m) => (porMoneda[m] = centsToStr(pat.porMoneda[m])));
  return {
    mes,
    moneda_base: base,
    patrimonio_neto: centsToStr(pat.consolidado),
    patrimonio_por_moneda: porMoneda,
    disponible_para_asignar: {
      disponible: centsToStr(disp.disponible),
      arrastrado_de_meses_anteriores: centsToStr(disp.arrastrado),
      ingresos_del_mes: centsToStr(disp.ingresosMes),
      asignado_en_el_mes: centsToStr(disp.asignadoMes),
    },
    movimiento_del_mes: {
      ingresos: centsToStr(delMes.ingreso),
      gastos: centsToStr(delMes.gasto),
      neto: centsToStr(delMes.ingreso - delMes.gasto),
    },
    presupuesto: {
      asignado_en_categorias_de_gasto: centsToStr(asignadoCategorias),
      categorias_sobregastadas: sobregastadas,
    },
  };
};

const resumen_presupuesto = (args, userId) => {
  const mes = mesDe(args);
  const d = cargarDatos(userId);
  const base = (d.settings && d.settings.moneda_base) || "GTQ";
  const excluidas = idsExcluidas(d.categorias);
  const bal = C.balancesCategoria(d.movimientos, d.presupuestos, mes, d.settings, d.cuentas);
  const disp = C.disponibleParaAsignar(d.movimientos, d.presupuestos, mes, d.settings, args.incluir_excluidas ? new Set() : excluidas);
  const nombreGrupo = {};
  d.grupos.forEach((g) => (nombreGrupo[g.id] = g.nombre));

  const porGrupo = {};
  const orden = [];
  let totAsig = 0;
  let totGast = 0;
  let totDisp = 0;
  d.categorias
    .filter((c) => c.tipo === "gasto" && (args.incluir_excluidas || !c.excluir_presupuesto))
    .forEach((c) => {
      const b = bal[c.id] || { asignadoMes: 0, gastadoMes: 0, disponible: 0 };
      const vacia = b.asignadoMes === 0 && b.gastadoMes === 0 && b.disponible === 0;
      if (vacia && (!args.incluir_vacias || !c.activa)) return;
      const g = nombreGrupo[c.grupo] || "Sin grupo";
      if (!porGrupo[g]) {
        porGrupo[g] = { grupo: g, asig: 0, gast: 0, disp: 0, categorias: [] };
        orden.push(g);
      }
      porGrupo[g].asig += b.asignadoMes;
      porGrupo[g].gast += b.gastadoMes;
      porGrupo[g].disp += b.disponible;
      porGrupo[g].categorias.push({
        categoria: c.nombre,
        asignado: centsToStr(b.asignadoMes),
        gastado: centsToStr(b.gastadoMes),
        disponible_acumulado: centsToStr(b.disponible),
      });
      totAsig += b.asignadoMes;
      totGast += b.gastadoMes;
      totDisp += b.disponible;
    });
  return {
    mes,
    moneda: base,
    disponible_para_asignar: centsToStr(disp.disponible),
    total_asignado: centsToStr(totAsig),
    total_gastado: centsToStr(totGast),
    total_disponible_acumulado: centsToStr(totDisp),
    nota: "'gastado' incluye los abonos a capital de préstamos con categoría de pago; 'disponible_acumulado' arrastra lo no gastado de meses anteriores.",
    grupos: orden.map((g) => ({
      grupo: g,
      asignado: centsToStr(porGrupo[g].asig),
      gastado: centsToStr(porGrupo[g].gast),
      disponible_acumulado: centsToStr(porGrupo[g].disp),
      categorias: porGrupo[g].categorias,
    })),
  };
};

const ingreso_vs_gasto = (args, userId) => {
  const n = Math.min(Math.max(parseInt(args.meses || 6, 10) || 6, 1), 36);
  const d = cargarDatos(userId);
  const base = (d.settings && d.settings.moneda_base) || "GTQ";
  const excluidas = idsExcluidas(d.categorias);
  const fuera = idsDeGrupos(d, args.excluir_grupos);
  const porMes = C.ingresoVsGastoPorMes(sinCategorias(d.movimientos, fuera), d.settings, excluidas);
  const fin = mesActual();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const mes = sumarMes(fin, -i);
    const f = porMes.filter((m) => m.mes === mes)[0] || { ingreso: 0, gasto: 0 };
    meses.push({ mes, ingreso: centsToStr(f.ingreso), gasto: centsToStr(f.gasto), neto: centsToStr(f.ingreso - f.gasto) });
  }
  return { moneda: base, meses };
};

const totales_por_etiqueta = (args, userId) => {
  const desde = args.desde || "2000-01-01";
  const hasta = args.hasta || "2999-12-31";
  if (!fechaValida(desde) || !fechaValida(hasta)) throw fallo("desde y hasta deben ser fechas YYYY-MM-DD válidas");
  if (desde > hasta) throw fallo("desde no puede ser posterior a hasta");
  const d = cargarDatos(userId);
  const base = (d.settings && d.settings.moneda_base) || "GTQ";
  const quiero = norm(args.etiqueta || "").replace(/^#+/, "");
  const filas = C.totalesPorTag(d.movimientos, desde, hasta, d.settings).filter((t) => !quiero || norm(t.tag) === quiero);
  return {
    desde: args.desde || null,
    hasta: args.hasta || null,
    moneda: base,
    etiquetas: filas.map((t) => ({
      etiqueta: t.tag,
      ingreso: centsToStr(t.ingreso),
      gasto: centsToStr(t.gasto),
      neto: centsToStr(t.ingreso - t.gasto),
      movimientos: t.conteo,
    })),
  };
};

// ---------------------------------------------------------------- catálogo

const MES = { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Mes YYYY-MM. Por defecto, el mes actual." };
const FECHA = { type: "string", description: "Fecha YYYY-MM-DD." };

const TOOLS = [
  {
    name: "resumen_mes",
    description:
      "Vistazo de las finanzas: patrimonio neto, dinero disponible para asignar (YNAB), ingresos y gastos del mes, y categorías sobregastadas. Úsala para '¿cómo voy?', '¿cuánto tengo para asignar?' o '¿cuál es mi patrimonio?'.",
    inputSchema: { type: "object", properties: { mes: MES }, additionalProperties: false },
    annotations: Object.assign({ title: "Resumen del mes" }, SOLO_LECTURA),
    run: resumen_mes,
  },
  {
    name: "resumen_presupuesto",
    description:
      "Presupuesto del mes por grupo y categoría: asignado, gastado y disponible acumulado (lo no gastado se arrastra). Úsala para ver cuánto queda en cada categoría o dónde estás en rojo.",
    inputSchema: {
      type: "object",
      properties: {
        mes: MES,
        incluir_vacias: { type: "boolean", description: "Incluye categorías activas sin movimiento ni asignación." },
        incluir_excluidas: { type: "boolean", description: "Incluye las categorías excluidas del presupuesto." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Presupuesto del mes" }, SOLO_LECTURA),
    run: resumen_presupuesto,
  },
  {
    name: "ingreso_vs_gasto",
    description:
      "Ingreso, gasto y neto de los últimos N meses (por defecto 6), sin transferencias ni categorías excluidas. 'excluir_grupos' deja fuera, por ejemplo, un negocio aparte para ver solo lo personal.",
    inputSchema: {
      type: "object",
      properties: {
        meses: { type: "integer", minimum: 1, maximum: 36, description: "Cuántos meses hacia atrás, incluido el actual." },
        excluir_grupos: { type: "array", items: { type: "string" }, description: "Nombres de grupos a dejar fuera." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Ingreso vs gasto por mes" }, SOLO_LECTURA),
    run: ingreso_vs_gasto,
  },
  {
    name: "totales_por_etiqueta",
    description:
      "Ingreso, gasto y neto por etiqueta (#). Sirve para ver cuánto deja un proyecto o negocio etiquetado, p. ej. la ganancia de #cafe. Sin fechas usa todo el historial.",
    inputSchema: {
      type: "object",
      properties: {
        desde: FECHA,
        hasta: FECHA,
        etiqueta: { type: "string", description: "Solo esta etiqueta (sin #)." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Totales por etiqueta" }, SOLO_LECTURA),
    run: totales_por_etiqueta,
  },
];

module.exports = { TOOLS };
