/// <reference path="../pb_data/types.d.ts" />

// Conciliación estilo YNAB.
//   movimientos.conciliado   (ya existía) = CONFIRMADO / "cleared" (apareció en el banco).
//   movimientos.reconciliado (nuevo)      = BLOQUEADO tras un "Reconcile" (reconciled ⇒ cleared).
//   cuentas.ultima_conciliacion (nuevo)   = fecha del último reconcile.

migrate(
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (!mov.fields.getByName("reconciliado")) {
      mov.fields.add(new BoolField({ name: "reconciliado" }));
      mov.addIndex("idx_mov_reconciliado", false, "reconciliado", "");
      app.save(mov);
    }

    const cue = app.findCollectionByNameOrId("cuentas");
    if (!cue.fields.getByName("ultima_conciliacion")) {
      cue.fields.add(new DateField({ name: "ultima_conciliacion" }));
      app.save(cue);
    }
  },
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (mov.fields.getByName("reconciliado")) {
      mov.fields.removeByName("reconciliado");
      app.save(mov);
    }
    const cue = app.findCollectionByNameOrId("cuentas");
    if (cue.fields.getByName("ultima_conciliacion")) {
      cue.fields.removeByName("ultima_conciliacion");
      app.save(cue);
    }
  }
);
