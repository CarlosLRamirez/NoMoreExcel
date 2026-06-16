/// <reference path="../pb_data/types.d.ts" />

// Presupuesto mensual por categoría (estilo YNAB).
//   presupuestos: usuario, categoria, mes ("YYYY-MM"), monto (centavos enteros, en moneda_base).
//   Único por (usuario, categoria, mes).

migrate(
  (app) => {
    const owner = "@request.auth.id = usuario";
    const presupuestos = new Collection({
      id: "presupuestos001",
      type: "base",
      name: "presupuestos",
      listRule: owner,
      viewRule: owner,
      createRule: owner,
      updateRule: owner,
      deleteRule: owner,
      fields: [
        {
          name: "usuario",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "_pb_users_auth_",
          cascadeDelete: true,
        },
        {
          name: "categoria",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "categorias_0001",
          cascadeDelete: true,
        },
        { name: "mes", type: "text", required: true, pattern: "^\\d{4}-\\d{2}$" },
        { name: "monto", type: "number", required: true, onlyInt: true },
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_pres_uniq ON presupuestos (usuario, categoria, mes)",
        "CREATE INDEX idx_pres_mes ON presupuestos (usuario, mes)",
      ],
    });
    app.save(presupuestos);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId("presupuestos"));
    } catch (_) {}
  }
);
