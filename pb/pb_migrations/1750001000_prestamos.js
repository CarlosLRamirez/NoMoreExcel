/// <reference path="../pb_data/types.d.ts" />

// Préstamos (créditos): nuevo tipo de cuenta `prestamo`. Su saldo es la deuda (negativo).
//   monto_original  = monto prestado (centavos, positivo), para el avance de pago.
//   cuota           = cuota mensual (centavos, positivo).
//   tasa_anual      = tasa de interés anual en % (opcional), para estimar interés y cuotas restantes.
//   categoria_pago  = categoría de gasto con la que se presupuesta la cuota: las
//                     transferencias HACIA el préstamo (abono a capital) cuentan como gasto de
//                     esa categoría en el presupuesto, y el interés se registra como gasto en ella.

migrate(
  (app) => {
    const cue = app.findCollectionByNameOrId("cuentas");
    const tipo = cue.fields.getByName("tipo");
    if (tipo.values.indexOf("prestamo") === -1) {
      tipo.values = [...tipo.values, "prestamo"];
    }
    if (!cue.fields.getByName("monto_original")) {
      cue.fields.add(new NumberField({ name: "monto_original", onlyInt: true }));
    }
    if (!cue.fields.getByName("cuota")) {
      cue.fields.add(new NumberField({ name: "cuota", onlyInt: true }));
    }
    if (!cue.fields.getByName("tasa_anual")) {
      cue.fields.add(new NumberField({ name: "tasa_anual", min: 0 }));
    }
    if (!cue.fields.getByName("categoria_pago")) {
      cue.fields.add(
        new RelationField({
          name: "categoria_pago",
          maxSelect: 1,
          collectionId: "categorias_0001",
          cascadeDelete: false,
        })
      );
    }
    app.save(cue);
  },
  (app) => {
    const cue = app.findCollectionByNameOrId("cuentas");
    ["monto_original", "cuota", "tasa_anual", "categoria_pago"].forEach((f) => {
      if (cue.fields.getByName(f)) cue.fields.removeByName(f);
    });
    const tipo = cue.fields.getByName("tipo");
    tipo.values = tipo.values.filter((v) => v !== "prestamo");
    app.save(cue);
  }
);
