/// <reference path="../pb_data/types.d.ts" />

// POST /api/budget/set  — fija (upsert) el presupuesto de una categoría para un mes.
// Body: { categoria: "<id>", mes: "YYYY-MM", monto: <entero centavos, en moneda_base> }
// Si monto = 0 y existe, se elimina el registro (limpieza). Único por (usuario,categoria,mes).

routerAdd(
  "POST",
  "/api/budget/set",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;
    const categoriaId = body.categoria;
    const mes = body.mes;
    const monto = body.monto;

    if (!categoriaId) throw new BadRequestError("categoria es requerida");
    if (typeof mes !== "string" || !/^\d{4}-\d{2}$/.test(mes)) {
      throw new BadRequestError("mes debe tener formato YYYY-MM");
    }
    if (typeof monto !== "number" || !Number.isInteger(monto) || monto < 0) {
      throw new BadRequestError("monto debe ser un entero >= 0 (centavos)");
    }

    let cat;
    try {
      cat = e.app.findRecordById("categorias", categoriaId);
    } catch (_) {
      throw new BadRequestError("categoria no encontrada");
    }
    if (cat.getString("usuario") !== userId) {
      throw new BadRequestError("la categoria no pertenece al usuario");
    }

    let existing = null;
    try {
      existing = e.app.findFirstRecordByFilter(
        "presupuestos",
        "usuario = {:u} && categoria = {:c} && mes = {:m}",
        { u: userId, c: categoriaId, m: mes }
      );
    } catch (_) {
      existing = null;
    }

    if (monto === 0) {
      if (existing) e.app.delete(existing);
      return e.json(200, { ok: true, monto: 0, eliminado: !!existing });
    }

    if (existing) {
      existing.set("monto", monto);
      e.app.save(existing);
      return e.json(200, { ok: true, id: existing.id, monto });
    }

    const col = e.app.findCollectionByNameOrId("presupuestos");
    const r = new Record(col);
    r.set("usuario", userId);
    r.set("categoria", categoriaId);
    r.set("mes", mes);
    r.set("monto", monto);
    e.app.save(r);
    return e.json(200, { ok: true, id: r.id, monto });
  },
  $apis.requireAuth()
);

// POST /api/budget/copy — copia los presupuestos del mes ANTERIOR al mes indicado
// (operación atómica). Sobrescribe los montos del mes destino para las categorías
// que tenían presupuesto el mes anterior; las demás no se tocan.
// Body: { mes: "YYYY-MM" } (destino)
routerAdd(
  "POST",
  "/api/budget/copy",
  (e) => {
    const userId = e.auth.id;
    const body = e.requestInfo().body;
    const mes = body.mes;
    if (typeof mes !== "string" || !/^\d{4}-\d{2}$/.test(mes)) {
      throw new BadRequestError("mes debe tener formato YYYY-MM");
    }

    const y = parseInt(mes.slice(0, 4), 10);
    const m = parseInt(mes.slice(5, 7), 10);
    const d = new Date(y, m - 2, 1); // mes anterior
    const prev = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const prevs = e.app.findRecordsByFilter(
      "presupuestos",
      "usuario = {:u} && mes = {:m}",
      "",
      0,
      0,
      { u: userId, m: prev }
    );
    if (prevs.length === 0) {
      return e.json(200, { ok: true, copiados: 0, desde: prev });
    }

    const col = e.app.findCollectionByNameOrId("presupuestos");
    let copiados = 0;
    e.app.runInTransaction((txApp) => {
      for (const p of prevs) {
        const catId = p.getString("categoria");
        const monto = p.getInt("monto");
        let existing = null;
        try {
          existing = txApp.findFirstRecordByFilter(
            "presupuestos",
            "usuario = {:u} && categoria = {:c} && mes = {:m}",
            { u: userId, c: catId, m: mes }
          );
        } catch (_) {
          existing = null;
        }
        if (existing) {
          existing.set("monto", monto);
          txApp.save(existing);
        } else {
          const r = new Record(col);
          r.set("usuario", userId);
          r.set("categoria", catId);
          r.set("mes", mes);
          r.set("monto", monto);
          txApp.save(r);
        }
        copiados++;
      }
    });

    return e.json(200, { ok: true, copiados, desde: prev });
  },
  $apis.requireAuth()
);
