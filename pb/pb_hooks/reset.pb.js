/// <reference path="../pb_data/types.d.ts" />

// Respaldo y "empezar de cero" (fresh start), SIEMPRE limitados al usuario autenticado.
//
// GET /api/backup
//   Devuelve un JSON con TODOS los datos del usuario (cuentas, grupos, categorias,
//   movimientos —incluidos los soft-deleted—, presupuestos y settings). Es un respaldo
//   por usuario; no reemplaza el backup completo de PocketBase (Settings → Backups).
//
// POST /api/reset   (operación atómica)
// Body: { confirmacion: "BORRAR", saldos?: { "<cuentaId>": <entero centavos> } }
//   1. Borra FÍSICAMENTE todos los movimientos del usuario (también los eliminados,
//      para que no bloqueen después el borrado de cuentas/categorías).
//   2. Borra todos sus presupuestos (si no, el arrastre de "Disponible (acum.)" quedaría
//      inflado con asignaciones sin gasto).
//   3. Por cada cuenta: saldo_inicial = saldos[id] (o 0 si no viene), limpia
//      ultima_conciliacion y, si es moneda extranjera, congela tc_base_inicial a la
//      tasa global actual (mismo criterio que la migración de costo histórico).
//   Conserva cuentas, grupos, categorías y settings. El saldo_inicial se puede editar
//   después desde Cuentas.

routerAdd(
  "GET",
  "/api/backup",
  (e) => {
    const userId = e.auth.id;
    const dump = (col) =>
      e.app.findRecordsByFilter(col, "usuario = {:u}", "", 0, 0, { u: userId }).map((r) => r.publicExport());

    return e.json(200, {
      app: "NoMoreExcel",
      tipo: "backup_usuario",
      generado: new Date().toISOString(),
      usuario: { id: userId, email: e.auth.getString("email") },
      cuentas: dump("cuentas"),
      grupos: dump("grupos"),
      categorias: dump("categorias"),
      movimientos: dump("movimientos"),
      presupuestos: dump("presupuestos"),
      settings: dump("settings"),
    });
  },
  $apis.requireAuth()
);

routerAdd(
  "POST",
  "/api/reset",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;

    if (body.confirmacion !== "BORRAR") {
      throw new BadRequestError("confirmación inválida: envía confirmacion = \"BORRAR\"");
    }
    const saldos = body.saldos || {};
    if (typeof saldos !== "object" || Array.isArray(saldos)) {
      throw new BadRequestError("saldos debe ser un objeto { cuentaId: centavos }");
    }

    const cuentas = e.app.findRecordsByFilter("cuentas", "usuario = {:u}", "", 0, 0, { u: userId });
    const propias = {};
    cuentas.forEach((c) => (propias[c.id] = true));
    for (const id in saldos) {
      if (!propias[id]) throw new BadRequestError("cuenta no encontrada: " + id);
      const v = saldos[id];
      if (typeof v !== "number" || !Number.isInteger(v)) {
        throw new BadRequestError("el saldo de la cuenta " + id + " debe ser un entero (centavos)");
      }
    }

    let monedaBase = "GTQ";
    let tc = 0;
    try {
      const s = e.app.findFirstRecordByFilter("settings", "usuario = {:u}", { u: userId });
      monedaBase = s.getString("moneda_base") || "GTQ";
      tc = s.getFloat("tipo_cambio_usd");
    } catch (_) {}

    let movimientos = 0;
    let presupuestos = 0;

    e.app.runInTransaction((txApp) => {
      txApp.findRecordsByFilter("movimientos", "usuario = {:u}", "", 0, 0, { u: userId }).forEach((m) => {
        txApp.delete(m);
        movimientos++;
      });
      txApp.findRecordsByFilter("presupuestos", "usuario = {:u}", "", 0, 0, { u: userId }).forEach((p) => {
        txApp.delete(p);
        presupuestos++;
      });
      cuentas.forEach((c) => {
        c.set("saldo_inicial", saldos[c.id] !== undefined ? saldos[c.id] : 0);
        c.set("ultima_conciliacion", "");
        if (c.getString("moneda") !== monedaBase) c.set("tc_base_inicial", tc);
        txApp.save(c);
      });
    });

    return e.json(200, { ok: true, movimientos, presupuestos, cuentas: cuentas.length });
  },
  $apis.requireAuth()
);
