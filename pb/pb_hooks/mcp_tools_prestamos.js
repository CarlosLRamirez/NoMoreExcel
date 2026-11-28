/// <reference path="../pb_data/types.d.ts" />

// Herramienta MCP de PRÉSTAMOS: pagar la cuota. Replica POST /api/prestamos/pagar (prestamos.pb.js):
//  - capital = monto - interés  → transferencia cuenta de origen → préstamo (baja la deuda);
//  - interés                    → gasto en la categoría de pago del préstamo.
// Dos pasos: vista previa (por defecto) y confirmar=true.

const {
  fallo,
  centsToStr,
  decimalToCents,
  hoy,
  fechaValida,
  cargarContexto,
  movimientosEnRango,
  resolver,
} = require(`${__hooks}/mcp_util.js`);

const pagar_cuota_prestamo = (args, userId) => {
  const ctx = cargarContexto(userId);
  const prestamo = resolver(ctx.cuentas, args.prestamo, (c) => c.activa && c.tipo === "prestamo", "préstamo");
  if (!prestamo.ok) throw fallo(prestamo.error + (prestamo.candidatos ? ". Opciones: " + prestamo.candidatos.join(", ") : ""));
  const p = prestamo.ok;
  const origen = resolver(ctx.cuentas, args.cuenta_origen, (c) => c.activa && c.tipo !== "prestamo" && c.moneda === p.moneda, "cuenta de origen (en " + p.moneda + ", la moneda del préstamo)");
  if (!origen.ok) throw fallo(origen.error + (origen.candidatos ? ". Opciones: " + origen.candidatos.join(", ") : ""));
  const o = origen.ok;

  const fecha = args.fecha || hoy();
  if (!fechaValida(fecha)) throw fallo("fecha inválida (usa YYYY-MM-DD): " + args.fecha);
  let total;
  let interes = 0;
  try {
    total = decimalToCents(args.monto);
    if (args.interes !== undefined && args.interes !== null && args.interes !== "") interes = decimalToCents(args.interes);
  } catch (m) {
    throw fallo(String(m));
  }
  if (total <= 0) throw fallo("el monto pagado debe ser mayor que 0");
  if (interes < 0) throw fallo("el interés no puede ser negativo");
  if (interes > total) throw fallo("el interés no puede ser mayor que el monto pagado");
  const capital = total - interes;
  const descripcion = String(args.descripcion || "").trim() || "Cuota " + p.nombre;
  if (descripcion.length > 500) throw fallo("la descripción excede 500 caracteres");

  // Deuda pendiente = -(saldo_inicial + Σ movimientos no eliminados), como la app.
  let saldo = p.saldoInicial;
  $app.findRecordsByFilter("movimientos", "cuenta = {:c} && eliminado = false", "", 0, 0, { c: p.id }).forEach((m) => (saldo += m.getInt("monto")));
  const deuda = saldo < 0 ? -saldo : 0;
  if (capital > deuda) throw fallo("el abono a capital (" + centsToStr(capital) + ") excede la deuda pendiente (" + centsToStr(deuda) + ")");

  const categoriaId = $app.findRecordById("cuentas", p.id).getString("categoria_pago");
  if (interes > 0 && !categoriaId) throw fallo("el préstamo no tiene categoría de pago para registrar el interés; configúrala en la app");
  const categoria = ctx.categoriaPorId[categoriaId];

  // ¿Ya está registrado un abono igual ese día desde esa cuenta?
  let duplicado = null;
  if (capital > 0) {
    movimientosEnRango(userId, fecha, fecha, "tipo = 'transferencia'").forEach((m) => {
      if (m.getString("cuenta") === o.id && m.getInt("monto") === -capital) duplicado = m.id;
    });
  }

  const base = {
    prestamo: p.nombre,
    cuenta_origen: o.nombre,
    fecha,
    moneda: p.moneda,
    total_pagado: centsToStr(total),
    abono_a_capital: centsToStr(capital),
    interes: centsToStr(interes),
    categoria_de_pago: categoria ? categoria.nombre : null,
    deuda_antes: centsToStr(deuda),
    deuda_despues: centsToStr(deuda - capital),
    saldado: deuda - capital === 0,
  };
  if (duplicado) base.posible_duplicado = { id: duplicado, detalle: "ya hay un abono igual ese día desde esa cuenta" };
  if (args.confirmar !== true) {
    return Object.assign(
      { modo: "vista_previa", guardado: false, siguiente_paso: "Muestra el desglose al usuario. Si lo aprueba, llama de nuevo con los mismos datos y confirmar=true." + (duplicado ? " Hay un posible duplicado: solo sigue si el usuario dice que es otro pago (permitir_duplicados=true)." : "") },
      base
    );
  }
  if (duplicado && args.permitir_duplicados !== true) throw fallo("No se guardó: parece un pago duplicado (" + duplicado + "). Si es otro pago, repite con permitir_duplicados=true.");

  const tcBase = p.moneda === ctx.monedaBase ? 1 : ctx.tc;
  const col = $app.findCollectionByNameOrId("movimientos");
  const ids = [];
  $app.runInTransaction((tx) => {
    if (capital > 0) {
      const transferId = $security.randomString(15);
      [
        [o.id, -capital],
        [p.id, capital],
      ].forEach((par) => {
        const r = new Record(col);
        r.set("usuario", userId);
        r.set("fecha", fecha);
        r.set("cuenta", par[0]);
        r.set("tipo", "transferencia");
        r.set("monto", par[1]);
        r.set("descripcion", descripcion);
        r.set("transfer_id", transferId);
        r.set("tc_base", tcBase);
        tx.save(r);
        ids.push(r.id);
      });
    }
    if (interes > 0) {
      const r = new Record(col);
      r.set("usuario", userId);
      r.set("fecha", fecha);
      r.set("cuenta", o.id);
      r.set("categoria", categoriaId);
      r.set("tipo", "gasto");
      r.set("monto", -interes);
      r.set("descripcion", "Interés " + p.nombre);
      r.set("tc_base", tcBase);
      tx.save(r);
      ids.push(r.id);
    }
  });
  return Object.assign({ modo: "guardado", guardado: true, ids }, base);
};

const TOOLS = [
  {
    name: "pagar_cuota_prestamo",
    description:
      "Registra el pago de una cuota de un préstamo. Separa el monto en abono a capital (transferencia desde la cuenta de origen al préstamo: baja la deuda) e interés (un gasto en la categoría de pago del préstamo). Si no dan el interés, pregúntalo: no lo supongas. No permite abonar más que la deuda. En dos pasos: vista previa con la deuda antes/después y luego confirmar=true.",
    inputSchema: {
      type: "object",
      properties: {
        prestamo: { type: "string", description: "Cuenta de tipo préstamo (nombre o id)." },
        cuenta_origen: { type: "string", description: "Cuenta desde la que se paga; en la misma moneda que el préstamo." },
        monto: { type: "string", description: 'Total pagado (capital + interés), p. ej. "1800.00".' },
        interes: { type: "string", description: "Parte del monto que es interés (opcional, por defecto 0)." },
        fecha: { type: "string", description: "YYYY-MM-DD. Si se omite, hoy." },
        descripcion: { type: "string" },
        confirmar: { type: "boolean", description: "false o ausente = vista previa; true = guarda." },
        permitir_duplicados: { type: "boolean", description: "Con confirmar=true, guarda aunque parezca un pago repetido." },
      },
      required: ["prestamo", "cuenta_origen", "monto"],
      additionalProperties: false,
    },
    annotations: { title: "Pagar cuota de préstamo", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: pagar_cuota_prestamo,
  },
];

module.exports = { TOOLS };
