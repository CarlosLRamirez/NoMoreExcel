/// <reference path="../pb_data/types.d.ts" />

// Préstamos (cuentas tipo `prestamo`). Ver migración 1750001000.

// La categoría de pago de un préstamo debe ser una categoría de GASTO del mismo usuario.
// (La función se pasa directo como handler: los handlers no ven el scope del módulo.)
function validarCategoriaPago(e) {
  const r = e.record;
  const catId = r.getString("categoria_pago");
  if (!catId) return e.next();
  if (r.getString("tipo") !== "prestamo") {
    r.set("categoria_pago", "");
    return e.next();
  }
  let cat;
  try {
    cat = e.app.findRecordById("categorias", catId);
  } catch (_) {
    throw new BadRequestError("categoria_pago no encontrada");
  }
  if (cat.getString("usuario") !== r.getString("usuario")) {
    throw new BadRequestError("categoria_pago no pertenece al usuario");
  }
  if (cat.getString("tipo") !== "gasto") {
    throw new BadRequestError("categoria_pago debe ser una categoría de gasto");
  }
  e.next();
}

onRecordCreateRequest(validarCategoriaPago, "cuentas");
onRecordUpdateRequest(validarCategoriaPago, "cuentas");

// POST /api/prestamos/pagar  (operación atómica)
// Body: { prestamo: "<id>", cuenta_origen: "<id>", fecha: "YYYY-MM-DD",
//         monto: <entero centavos, cuota total pagada>, interes?: <entero centavos, parte de interés>,
//         descripcion?: "" }
// - capital = monto - interes: transferencia cuenta_origen -> préstamo (baja la deuda; el
//   presupuesto la cuenta como gasto de la categoria_pago).
// - interes: gasto en cuenta_origen con la categoria_pago (gasto real: baja el patrimonio).
// Misma moneda entre origen y préstamo. El capital no puede exceder la deuda pendiente.
routerAdd(
  "POST",
  "/api/prestamos/pagar",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;
    const fecha = body.fecha;
    const monto = body.monto;
    const interes = body.interes === undefined || body.interes === null ? 0 : body.interes;
    const descripcion = body.descripcion || "";

    if (!fecha) throw new BadRequestError("fecha es requerida");
    const esEntero = (v) => typeof v === "number" && Number.isInteger(v);
    if (!esEntero(monto) || monto <= 0) throw new BadRequestError("monto debe ser un entero positivo (centavos)");
    if (!esEntero(interes) || interes < 0) throw new BadRequestError("interes debe ser un entero >= 0 (centavos)");
    if (interes > monto) throw new BadRequestError("el interés no puede ser mayor que el monto pagado");
    const capital = monto - interes;

    let prestamo, origen;
    try {
      prestamo = e.app.findRecordById("cuentas", body.prestamo || "");
      origen = e.app.findRecordById("cuentas", body.cuenta_origen || "");
    } catch (_) {
      throw new BadRequestError("cuenta no encontrada");
    }
    if (prestamo.getString("usuario") !== userId || origen.getString("usuario") !== userId) {
      throw new BadRequestError("las cuentas deben pertenecer al usuario");
    }
    if (prestamo.getString("tipo") !== "prestamo") throw new BadRequestError("la cuenta destino no es un préstamo");
    if (origen.getString("tipo") === "prestamo") throw new BadRequestError("la cuenta de origen no puede ser un préstamo");
    const moneda = prestamo.getString("moneda");
    if (origen.getString("moneda") !== moneda) {
      throw new BadRequestError("la cuenta de origen debe estar en la misma moneda que el préstamo (" + moneda + ")");
    }
    const categoriaId = prestamo.getString("categoria_pago");
    if (interes > 0 && !categoriaId) {
      throw new BadRequestError("el préstamo no tiene categoría de pago para registrar el interés");
    }

    // Deuda pendiente = -(saldo_inicial + SUMA(movimientos no eliminados)).
    let saldo = prestamo.getInt("saldo_inicial");
    e.app
      .findRecordsByFilter("movimientos", "cuenta = {:c} && eliminado = false", "", 0, 0, { c: prestamo.id })
      .forEach((m) => (saldo += m.getInt("monto")));
    const deuda = saldo < 0 ? -saldo : 0;
    if (capital > deuda) {
      throw new BadRequestError("el abono a capital excede la deuda pendiente (" + (deuda / 100).toFixed(2) + ")");
    }

    let monedaBase = "GTQ";
    let tc = 0;
    try {
      const st = e.app.findFirstRecordByFilter("settings", "usuario = {:u}", { u: userId });
      monedaBase = st.getString("moneda_base") || "GTQ";
      tc = st.getFloat("tipo_cambio_usd");
    } catch (_) {}
    const tcBase = moneda === monedaBase ? 1 : tc;

    const desc = descripcion || "Cuota " + prestamo.getString("nombre");
    const col = e.app.findCollectionByNameOrId("movimientos");
    const out = { transfer_id: null, interes: null };

    e.app.runInTransaction((txApp) => {
      if (capital > 0) {
        const transferId = $security.randomString(15);
        [
          [origen.id, -capital],
          [prestamo.id, capital],
        ].forEach(([cuenta, m]) => {
          const r = new Record(col);
          r.set("usuario", userId);
          r.set("fecha", fecha);
          r.set("cuenta", cuenta);
          r.set("tipo", "transferencia");
          r.set("monto", m);
          r.set("descripcion", desc);
          r.set("transfer_id", transferId);
          r.set("tc_base", tcBase);
          txApp.save(r);
        });
        out.transfer_id = transferId;
      }
      if (interes > 0) {
        const r = new Record(col);
        r.set("usuario", userId);
        r.set("fecha", fecha);
        r.set("cuenta", origen.id);
        r.set("categoria", categoriaId);
        r.set("tipo", "gasto");
        r.set("monto", -interes);
        r.set("descripcion", "Interés " + prestamo.getString("nombre"));
        r.set("tc_base", tcBase);
        txApp.save(r);
        out.interes = r.id;
      }
    });

    return e.json(200, { ok: true, capital, interes, deuda_restante: deuda - capital, ...out });
  },
  $apis.requireAuth()
);
