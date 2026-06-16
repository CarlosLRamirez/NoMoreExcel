/// <reference path="../pb_data/types.d.ts" />

// Costo histórico para cuentas en moneda extranjera:
//   movimientos.tc_base       = unidades de moneda_base por unidad de la moneda de la cuenta,
//                               al momento del movimiento (GTQ por USD). Base => 1.
//   cuentas.tc_base_inicial   = igual, para el saldo_inicial.
// El patrimonio se valúa con estas tasas (suma de equivalentes), no con una sola tasa global.
// Backfill: transferencias cross-currency usan su tasa real (monto_base / monto_extranjero,
// residuo 0); los demás movimientos/saldos en USD se congelan a la tasa global actual.

migrate(
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (!mov.fields.getByName("tc_base")) {
      mov.fields.add(new NumberField({ name: "tc_base" }));
      app.save(mov);
    }
    const cue = app.findCollectionByNameOrId("cuentas");
    if (!cue.fields.getByName("tc_base_inicial")) {
      cue.fields.add(new NumberField({ name: "tc_base_inicial" }));
      app.save(cue);
    }

    // settings por usuario
    const tcByUser = {};
    const baseByUser = {};
    app.findRecordsByFilter("settings", "id != ''", "", 0, 0, {}).forEach((s) => {
      tcByUser[s.getString("usuario")] = s.getFloat("tipo_cambio_usd");
      baseByUser[s.getString("usuario")] = s.getString("moneda_base") || "GTQ";
    });
    const baseOf = (u) => baseByUser[u] || "GTQ";

    // cuentas en moneda extranjera -> tc_base_inicial = tasa global actual
    app.findRecordsByFilter("cuentas", "moneda = 'USD'", "", 0, 0, {}).forEach((c) => {
      if (c.getString("moneda") !== baseOf(c.getString("usuario")) && !c.getFloat("tc_base_inicial")) {
        c.set("tc_base_inicial", tcByUser[c.getString("usuario")] || 0);
        app.save(c);
      }
    });

    // transferencias cross-currency: tasa real = monto_base / monto_extranjero
    const groups = {};
    app.findRecordsByFilter("movimientos", "tipo = 'transferencia'", "", 0, 0, {}).forEach((m) => {
      const t = m.getString("transfer_id");
      if (!t) return;
      (groups[t] = groups[t] || []).push(m);
    });
    Object.keys(groups).forEach((t) => {
      const legs = groups[t];
      if (legs.length !== 2) return;
      const base = baseOf(legs[0].getString("usuario"));
      if (legs[0].getString("moneda") === legs[1].getString("moneda")) return; // misma moneda
      const baseLeg = legs.find((l) => l.getString("moneda") === base);
      const forLeg = legs.find((l) => l.getString("moneda") !== base);
      if (!baseLeg || !forLeg) return;
      const baseAmt = Math.abs(baseLeg.getInt("monto"));
      const forAmt = Math.abs(forLeg.getInt("monto"));
      if (forAmt > 0 && !forLeg.getFloat("tc_base")) {
        forLeg.set("tc_base", baseAmt / forAmt);
        app.save(forLeg);
      }
      if (!baseLeg.getFloat("tc_base")) {
        baseLeg.set("tc_base", 1);
        app.save(baseLeg);
      }
    });

    // demás movimientos en USD (compras/ingresos): congelar a la tasa global actual
    app.findRecordsByFilter("movimientos", "moneda = 'USD'", "", 0, 0, {}).forEach((m) => {
      if (m.getString("moneda") !== baseOf(m.getString("usuario")) && !m.getFloat("tc_base")) {
        m.set("tc_base", tcByUser[m.getString("usuario")] || 0);
        app.save(m);
      }
    });
  },
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (mov.fields.getByName("tc_base")) {
      mov.fields.removeByName("tc_base");
      app.save(mov);
    }
    const cue = app.findCollectionByNameOrId("cuentas");
    if (cue.fields.getByName("tc_base_inicial")) {
      cue.fields.removeByName("tc_base_inicial");
      app.save(cue);
    }
  }
);
