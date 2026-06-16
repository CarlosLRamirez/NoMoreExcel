/// <reference path="../pb_data/types.d.ts" />

// POST /api/reconcile  (conciliación estilo YNAB, operación atómica)
// Body: { cuenta: "<id>", saldo_real: <entero centavos, en la moneda de la cuenta>, fecha?: "YYYY-MM-DD" }
//
// 1. Calcula el saldo CONFIRMADO actual = saldo_inicial + SUMA(monto de movimientos
//    no eliminados con conciliado=true).
// 2. diferencia = saldo_real - saldo_confirmado.
// 3. Si hay diferencia, crea un movimiento de AJUSTE (confirmado + reconciliado) por
//    la diferencia, con la categoría "Ajuste de conciliación" del tipo correspondiente
//    (la crea si no existe).
// 4. Marca como reconciliado=true todos los movimientos confirmados aún no bloqueados.
// 5. Guarda cuentas.ultima_conciliacion.
// Los movimientos NO confirmados (flotantes) quedan intactos.

routerAdd(
  "POST",
  "/api/reconcile",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;
    const cuentaId = body.cuenta;
    const saldoReal = body.saldo_real;
    const fecha = body.fecha || new Date().toISOString().slice(0, 10);

    if (!cuentaId) throw new BadRequestError("cuenta es requerida");
    if (typeof saldoReal !== "number" || !Number.isInteger(saldoReal)) {
      throw new BadRequestError("saldo_real debe ser un entero (centavos)");
    }

    let cuenta;
    try {
      cuenta = e.app.findRecordById("cuentas", cuentaId);
    } catch (_) {
      throw new BadRequestError("cuenta no encontrada");
    }
    if (cuenta.getString("usuario") !== userId) {
      throw new BadRequestError("la cuenta no pertenece al usuario");
    }

    // Saldo confirmado actual.
    const confirmados = e.app.findRecordsByFilter(
      "movimientos",
      "cuenta = {:c} && eliminado = false && conciliado = true",
      "",
      0,
      0,
      { c: cuentaId }
    );
    let sum = 0;
    for (const m of confirmados) sum += m.getInt("monto");
    const saldoConfirmado = cuenta.getInt("saldo_inicial") + sum;
    const diferencia = saldoReal - saldoConfirmado;

    let ajusteId = null;
    let marcados = 0;

    e.app.runInTransaction((txApp) => {
      if (diferencia !== 0) {
        const tipo = diferencia > 0 ? "ingreso" : "gasto";
        const nombreCat = "Ajuste de conciliación";
        let cat;
        try {
          cat = txApp.findFirstRecordByFilter(
            "categorias",
            "usuario = {:u} && nombre = {:n} && tipo = {:t}",
            { u: userId, n: nombreCat, t: tipo }
          );
        } catch (_) {
          const catCol = txApp.findCollectionByNameOrId("categorias");
          cat = new Record(catCol);
          cat.set("usuario", userId);
          cat.set("nombre", nombreCat);
          cat.set("tipo", tipo);
          cat.set("activa", true);
          txApp.save(cat);
        }

        const movCol = txApp.findCollectionByNameOrId("movimientos");
        const adj = new Record(movCol);
        adj.set("usuario", userId);
        adj.set("fecha", fecha);
        adj.set("cuenta", cuentaId);
        adj.set("categoria", cat.id);
        adj.set("tipo", tipo);
        adj.set("monto", diferencia);
        adj.set("descripcion", "Ajuste de conciliación");
        adj.set("conciliado", true);
        adj.set("reconciliado", true);
        txApp.save(adj);
        ajusteId = adj.id;
      }

      // Bloquear (reconciliar) todos los confirmados que aún no lo estén.
      const porReconciliar = txApp.findRecordsByFilter(
        "movimientos",
        "cuenta = {:c} && eliminado = false && conciliado = true && reconciliado = false",
        "",
        0,
        0,
        { c: cuentaId }
      );
      for (const m of porReconciliar) {
        m.set("reconciliado", true);
        txApp.save(m);
        marcados++;
      }

      cuenta.set("ultima_conciliacion", fecha);
      txApp.save(cuenta);
    });

    return e.json(200, {
      ok: true,
      diferencia,
      ajuste: ajusteId,
      reconciliados: marcados,
      saldo_confirmado_previo: saldoConfirmado,
    });
  },
  $apis.requireAuth()
);
