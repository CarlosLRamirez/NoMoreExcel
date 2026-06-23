/// <reference path="../pb_data/types.d.ts" />

// POST /api/import
// Importación de movimientos todo-o-nada (transacción). El cliente parsea el CSV
// y envía las filas crudas (strings). El servidor resuelve cuenta/categoria por
// nombre, convierte monto decimal -> centavos enteros (sin float), valida e inserta.
//
// Body JSON: { rows: [ { fecha, cuenta, categoria, tipo, monto, descripcion,
//                        transfer_id, conciliado, notas }, ... ] }
//
// Si alguna fila es inválida, NO se inserta nada y se devuelve 400 con el reporte
// de errores por fila. Las cuentas/categorías que no existan => error (no se crean).

routerAdd(
  "POST",
  "/api/import",
  (e) => {
    // NOTA: en PocketBase los handlers corren en un runtime aislado y NO ven
    // funciones del scope del módulo; por eso los helpers van DENTRO del handler.

    // Convierte un monto decimal -> centavos enteros usando SOLO aritmética entera.
    // Tolera símbolos de moneda (Q, $), separadores de miles, espacios y negativos
    // en paréntesis estilo contable, ej: "Q2,000.00", "-$1,234.56", "(Q500.00)".
    const decimalToCents = (raw) => {
      if (raw === undefined || raw === null) throw "monto vacío";
      let s = String(raw).trim();
      if (s === "") throw "monto vacío";
      let neg = false;
      // negativos en paréntesis: (Q500.00)
      if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
        neg = true;
        s = s.slice(1, -1);
      }
      // quitar todo lo que no sea dígito, punto o signo (Q, $, comas, espacios, etc.)
      s = s.replace(/[^0-9.+-]/g, "");
      if (s.charAt(0) === "-") {
        neg = !neg;
        s = s.slice(1);
      } else if (s.charAt(0) === "+") {
        s = s.slice(1);
      }
      if (!/^\d+(\.\d+)?$/.test(s)) throw "monto inválido: " + raw;
      const parts = s.split(".");
      const intPart = parts[0];
      let fracPart = parts[1] || "";
      if (fracPart.length > 2) throw "monto con más de 2 decimales: " + raw;
      fracPart = (fracPart + "00").slice(0, 2);
      const cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
      return neg ? -cents : cents;
    };

    const parseBool = (v) => String(v).trim().toLowerCase() === "true";

    const userId = e.auth.id;
    const body = e.requestInfo().body;
    const rows = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestError("se requiere un arreglo 'rows' no vacío");
    }

    // Mapas de resolución por nombre.
    const cuentasByName = {};
    e.app.findRecordsByFilter("cuentas", "usuario = {:u}", "", 0, 0, { u: userId }).forEach((c) => {
      cuentasByName[c.getString("nombre")] = c;
    });
    const categoriasByName = {};
    e.app.findRecordsByFilter("categorias", "usuario = {:u}", "", 0, 0, { u: userId }).forEach((c) => {
      categoriasByName[c.getString("nombre")] = c;
    });

    const errors = [];
    const prepared = []; // { row, cuenta, categoriaId, tipo, montoCents, ... }
    const transferGroups = {}; // transfer_id -> [ {moneda, cents} ]

    rows.forEach((row, i) => {
      const n = i + 1; // número de fila (1-based)
      const rowErrors = [];

      const fecha = (row.fecha || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        rowErrors.push("fecha inválida (use YYYY-MM-DD)");
      }

      const tipo = (row.tipo || "").trim();
      if (["ingreso", "gasto", "transferencia"].indexOf(tipo) === -1) {
        rowErrors.push("tipo inválido: " + tipo);
      }

      const cuenta = cuentasByName[(row.cuenta || "").trim()];
      if (!cuenta) rowErrors.push("cuenta no encontrada: " + row.cuenta);

      let montoCents = 0;
      try {
        montoCents = decimalToCents(row.monto);
      } catch (err) {
        rowErrors.push(String(err));
      }

      let categoriaId = "";
      const transferId = (row.transfer_id || "").trim();

      if (tipo === "transferencia") {
        if (transferId === "") rowErrors.push("transferencia requiere transfer_id");
        if ((row.categoria || "").trim() !== "") {
          rowErrors.push("una transferencia no debe tener categoria");
        }
      } else if (tipo === "ingreso" || tipo === "gasto") {
        if (transferId !== "") rowErrors.push(tipo + " no debe tener transfer_id");
        const catName = (row.categoria || "").trim();
        if (catName === "") {
          rowErrors.push(tipo + " requiere categoria");
        } else {
          const cat = categoriasByName[catName];
          if (!cat) rowErrors.push("categoria no encontrada: " + catName);
          else categoriaId = cat.id;
        }
        if (tipo === "ingreso" && montoCents <= 0) rowErrors.push("ingreso debe tener monto > 0");
        if (tipo === "gasto" && montoCents >= 0) rowErrors.push("gasto debe tener monto < 0");
      }

      if (rowErrors.length > 0) {
        errors.push({ fila: n, errores: rowErrors });
        return;
      }

      if (tipo === "transferencia") {
        (transferGroups[transferId] = transferGroups[transferId] || []).push({
          moneda: cuenta.getString("moneda"),
          cents: montoCents,
        });
      }

      prepared.push({
        fila: n,
        usuario: userId,
        fecha,
        cuentaId: cuenta ? cuenta.id : "",
        categoriaId,
        tipo,
        montoCents,
        descripcion: row.descripcion || "",
        transfer_id: transferId,
        conciliado: parseBool(row.conciliado),
        reconciliado: parseBool(row.reconciliado),
        ingreso_proximo_mes: tipo === "ingreso" && parseBool(row.ingreso_proximo_mes),
        tags: row.tags || "",
        notas: row.notas || "",
      });
    });

    // Validar grupos de transferencia balanceados.
    for (const tid in transferGroups) {
      const legs = transferGroups[tid];
      const monedas = {};
      legs.forEach((l) => (monedas[l.moneda] = true));
      const distintas = Object.keys(monedas).length;
      if (distintas === 1) {
        // misma moneda: deben sumar 0
        const sum = legs.reduce((a, l) => a + l.cents, 0);
        if (sum !== 0) {
          errors.push({ fila: 0, errores: ["transfer_id '" + tid + "': las patas no balancean (suma != 0)"] });
        }
      } else {
        // monedas distintas: exactamente 2 patas con signos opuestos
        if (legs.length !== 2) {
          errors.push({ fila: 0, errores: ["transfer_id '" + tid + "': cross-currency requiere exactamente 2 patas"] });
        } else if (Math.sign(legs[0].cents) === Math.sign(legs[1].cents)) {
          errors.push({ fila: 0, errores: ["transfer_id '" + tid + "': las patas deben tener signos opuestos"] });
        }
      }
    }

    if (errors.length > 0) {
      return e.json(400, { ok: false, importados: 0, errores: errors });
    }

    // Inserción atómica: todo o nada.
    const col = e.app.findCollectionByNameOrId("movimientos");
    let count = 0;
    try {
      e.app.runInTransaction((txApp) => {
        prepared.forEach((p) => {
          const r = new Record(col);
          r.set("usuario", p.usuario);
          r.set("fecha", p.fecha);
          r.set("cuenta", p.cuentaId);
          if (p.categoriaId) r.set("categoria", p.categoriaId);
          r.set("tipo", p.tipo);
          r.set("monto", p.montoCents);
          r.set("descripcion", p.descripcion);
          if (p.transfer_id) r.set("transfer_id", p.transfer_id);
          r.set("conciliado", p.conciliado);
          r.set("reconciliado", p.reconciliado);
          r.set("ingreso_proximo_mes", p.ingreso_proximo_mes);
          r.set("tags", p.tags);
          r.set("notas", p.notas);
          txApp.save(r); // dispara las invariantes de movimientos.pb.js
          count++;
        });
      });
    } catch (err) {
      return e.json(400, {
        ok: false,
        importados: 0,
        errores: [{ fila: 0, errores: ["fallo al insertar (rollback): " + String(err)] }],
      });
    }

    return e.json(200, { ok: true, importados: count, errores: [] });
  },
  $apis.requireAuth()
);
