/// <reference path="../pb_data/types.d.ts" />

// POST /api/transfers
// Crea una transferencia como operación ATÓMICA que inserta las DOS patas.
// Body JSON:
//   {
//     fecha: "YYYY-MM-DD",
//     cuenta_origen: "<id>",
//     cuenta_destino: "<id>",
//     monto: <entero centavos, POSITIVO, en la moneda de ORIGEN>,
//     tipo_cambio?: <number, requerido si las monedas difieren (origen->destino)>,
//     descripcion?: "", notas?: ""
//   }
// Misma moneda: patas con mismo |monto| y signo opuesto.
// Distinta moneda: monto_destino = round(monto * tipo_cambio); ambas patas guardan tipo_cambio.

routerAdd(
  "POST",
  "/api/transfers",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;

    const fecha = body.fecha;
    const cuentaOrigenId = body.cuenta_origen;
    const cuentaDestinoId = body.cuenta_destino;
    const monto = body.monto;
    const descripcion = body.descripcion || "";
    const notas = body.notas || "";
    let tipoCambio = body.tipo_cambio;

    if (!fecha) throw new BadRequestError("fecha es requerida");
    if (!cuentaOrigenId || !cuentaDestinoId) {
      throw new BadRequestError("cuenta_origen y cuenta_destino son requeridas");
    }
    if (cuentaOrigenId === cuentaDestinoId) {
      throw new BadRequestError("las cuentas deben ser distintas");
    }
    if (typeof monto !== "number" || !Number.isInteger(monto) || monto <= 0) {
      throw new BadRequestError("monto debe ser un entero positivo (centavos) en la moneda de origen");
    }

    let origen, destino;
    try {
      origen = e.app.findRecordById("cuentas", cuentaOrigenId);
      destino = e.app.findRecordById("cuentas", cuentaDestinoId);
    } catch (_) {
      throw new BadRequestError("cuenta no encontrada");
    }
    if (origen.getString("usuario") !== userId || destino.getString("usuario") !== userId) {
      throw new BadRequestError("las cuentas deben pertenecer al usuario");
    }

    const monedaOrigen = origen.getString("moneda");
    const monedaDestino = destino.getString("moneda");

    const montoOrigen = -monto; // sale de la cuenta de origen
    let montoDestino;

    if (monedaOrigen === monedaDestino) {
      if (tipoCambio !== undefined && tipoCambio !== null) {
        throw new BadRequestError("misma moneda: no debe enviarse tipo_cambio");
      }
      montoDestino = monto; // entra a la cuenta de destino, mismo |monto|
      tipoCambio = null;
    } else {
      if (typeof tipoCambio !== "number" || tipoCambio <= 0) {
        throw new BadRequestError("transferencia entre monedas distintas requiere tipo_cambio > 0");
      }
      // monto_destino = round(-monto_origen * tipo_cambio) = round(monto * tipo_cambio)
      montoDestino = Math.round(monto * tipoCambio);
      if (montoDestino <= 0) throw new BadRequestError("monto_destino calculado inválido");
    }

    const transferId = $security.randomString(15);

    // Costo histórico: tasa real de la transferencia (moneda_base por unidad extranjera).
    let monedaBase = "GTQ";
    try {
      const st = e.app.findFirstRecordByFilter("settings", "usuario = {:u}", { u: userId });
      monedaBase = st.getString("moneda_base") || "GTQ";
    } catch (_) {}
    const absO = Math.abs(montoOrigen);
    const absD = Math.abs(montoDestino);
    let baseAmt = 0;
    let forAmt = 0;
    if (monedaOrigen === monedaBase) baseAmt = absO;
    else forAmt = absO;
    if (monedaDestino === monedaBase) baseAmt = absD;
    else forAmt = absD;
    const tcForeign = baseAmt > 0 && forAmt > 0 ? baseAmt / forAmt : 0;
    const tcOf = (mon) => (mon === monedaBase ? 1 : tcForeign);

    const col = e.app.findCollectionByNameOrId("movimientos");

    let out, inc;
    e.app.runInTransaction((txApp) => {
      out = new Record(col);
      out.set("usuario", userId);
      out.set("fecha", fecha);
      out.set("cuenta", cuentaOrigenId);
      out.set("tipo", "transferencia");
      out.set("monto", montoOrigen);
      out.set("descripcion", descripcion);
      out.set("notas", notas);
      out.set("transfer_id", transferId);
      out.set("tc_base", tcOf(monedaOrigen));
      if (tipoCambio) out.set("tipo_cambio", tipoCambio);
      txApp.save(out);

      inc = new Record(col);
      inc.set("usuario", userId);
      inc.set("fecha", fecha);
      inc.set("cuenta", cuentaDestinoId);
      inc.set("tipo", "transferencia");
      inc.set("monto", montoDestino);
      inc.set("descripcion", descripcion);
      inc.set("notas", notas);
      inc.set("transfer_id", transferId);
      inc.set("tc_base", tcOf(monedaDestino));
      if (tipoCambio) inc.set("tipo_cambio", tipoCambio);
      txApp.save(inc);
    });

    return e.json(200, {
      transfer_id: transferId,
      origen: { id: out.id, cuenta: cuentaOrigenId, monto: montoOrigen, moneda: monedaOrigen },
      destino: { id: inc.id, cuenta: cuentaDestinoId, monto: montoDestino, moneda: monedaDestino },
      tipo_cambio: tipoCambio,
    });
  },
  $apis.requireAuth()
);

// POST /api/transfers/update
// Corrige una transferencia existente actualizando AMBAS patas de forma atómica
// (p. ej. cambiaste la cuenta de origen/destino, el monto o el tipo de cambio).
// Body: { transfer_id, fecha, cuenta_origen, cuenta_destino, monto, tipo_cambio?, descripcion?, notas? }
// Al corregir, las patas se marcan como NO confirmadas (conciliado=false, reconciliado=false)
// porque cambia el dinero involucrado y debe re-confirmarse contra el banco.
routerAdd(
  "POST",
  "/api/transfers/update",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;

    const transferId = body.transfer_id;
    const fecha = body.fecha;
    const cuentaOrigenId = body.cuenta_origen;
    const cuentaDestinoId = body.cuenta_destino;
    const monto = body.monto;
    const descripcion = body.descripcion || "";
    const notas = body.notas || "";
    let tipoCambio = body.tipo_cambio;

    if (!transferId) throw new BadRequestError("transfer_id es requerido");
    if (!fecha) throw new BadRequestError("fecha es requerida");
    if (!cuentaOrigenId || !cuentaDestinoId) {
      throw new BadRequestError("cuenta_origen y cuenta_destino son requeridas");
    }
    if (cuentaOrigenId === cuentaDestinoId) {
      throw new BadRequestError("las cuentas deben ser distintas");
    }
    if (typeof monto !== "number" || !Number.isInteger(monto) || monto <= 0) {
      throw new BadRequestError("monto debe ser un entero positivo (centavos) en la moneda de origen");
    }

    const legs = e.app.findRecordsByFilter(
      "movimientos",
      "transfer_id = {:t} && usuario = {:u} && eliminado = false",
      "",
      0,
      0,
      { t: transferId, u: userId }
    );
    if (legs.length !== 2) {
      throw new BadRequestError("no se encontró una transferencia válida con 2 patas para ese transfer_id");
    }

    let origen, destino;
    try {
      origen = e.app.findRecordById("cuentas", cuentaOrigenId);
      destino = e.app.findRecordById("cuentas", cuentaDestinoId);
    } catch (_) {
      throw new BadRequestError("cuenta no encontrada");
    }
    if (origen.getString("usuario") !== userId || destino.getString("usuario") !== userId) {
      throw new BadRequestError("las cuentas deben pertenecer al usuario");
    }

    const monedaOrigen = origen.getString("moneda");
    const monedaDestino = destino.getString("moneda");
    const montoOrigen = -monto;
    let montoDestino;
    if (monedaOrigen === monedaDestino) {
      if (tipoCambio !== undefined && tipoCambio !== null) {
        throw new BadRequestError("misma moneda: no debe enviarse tipo_cambio");
      }
      montoDestino = monto;
      tipoCambio = null;
    } else {
      if (typeof tipoCambio !== "number" || tipoCambio <= 0) {
        throw new BadRequestError("transferencia entre monedas distintas requiere tipo_cambio > 0");
      }
      montoDestino = Math.round(monto * tipoCambio);
      if (montoDestino <= 0) throw new BadRequestError("monto_destino calculado inválido");
    }

    // Reutiliza las patas existentes: la de monto<0 es origen, la de monto>0 es destino.
    const legOrigen = legs[0].getInt("monto") < 0 ? legs[0] : legs[1];
    const legDestino = legOrigen.id === legs[0].id ? legs[1] : legs[0];

    // Costo histórico: tasa real de la transferencia (moneda_base por unidad extranjera).
    let monedaBase = "GTQ";
    try {
      const st = e.app.findFirstRecordByFilter("settings", "usuario = {:u}", { u: userId });
      monedaBase = st.getString("moneda_base") || "GTQ";
    } catch (_) {}
    const absO = Math.abs(montoOrigen);
    const absD = Math.abs(montoDestino);
    let baseAmt = 0;
    let forAmt = 0;
    if (monedaOrigen === monedaBase) baseAmt = absO;
    else forAmt = absO;
    if (monedaDestino === monedaBase) baseAmt = absD;
    else forAmt = absD;
    const tcForeign = baseAmt > 0 && forAmt > 0 ? baseAmt / forAmt : 0;
    const tcOf = (mon) => (mon === monedaBase ? 1 : tcForeign);

    e.app.runInTransaction((txApp) => {
      legOrigen.set("fecha", fecha);
      legOrigen.set("cuenta", cuentaOrigenId);
      legOrigen.set("monto", montoOrigen);
      legOrigen.set("descripcion", descripcion);
      legOrigen.set("notas", notas);
      legOrigen.set("tipo_cambio", tipoCambio);
      legOrigen.set("tc_base", tcOf(monedaOrigen));
      legOrigen.set("conciliado", false);
      legOrigen.set("reconciliado", false);
      txApp.save(legOrigen);

      legDestino.set("fecha", fecha);
      legDestino.set("cuenta", cuentaDestinoId);
      legDestino.set("monto", montoDestino);
      legDestino.set("descripcion", descripcion);
      legDestino.set("notas", notas);
      legDestino.set("tipo_cambio", tipoCambio);
      legDestino.set("tc_base", tcOf(monedaDestino));
      legDestino.set("conciliado", false);
      legDestino.set("reconciliado", false);
      txApp.save(legDestino);
    });

    return e.json(200, {
      transfer_id: transferId,
      origen: { id: legOrigen.id, cuenta: cuentaOrigenId, monto: montoOrigen, moneda: monedaOrigen },
      destino: { id: legDestino.id, cuenta: cuentaDestinoId, monto: montoDestino, moneda: monedaDestino },
      tipo_cambio: tipoCambio,
    });
  },
  $apis.requireAuth()
);
