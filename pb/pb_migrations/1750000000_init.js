/// <reference path="../pb_data/types.d.ts" />

// Esquema reproducible de la app de finanzas (v1).
// Dinero = enteros en centavos (campos number con onlyInt). Moneda base = GTQ.
// IDs = strings aleatorios de PocketBase. Soft delete en movimientos. Acceso por dueño.

migrate(
  (app) => {
    // ---------------------------------------------------------------------
    // users (colección auth incorporada): añadir `nombre` y reglas por dueño.
    // ---------------------------------------------------------------------
    const users = app.findCollectionByNameOrId("users");
    if (!users.fields.getByName("nombre")) {
      users.fields.add(new TextField({ name: "nombre", max: 255 }));
    }
    // Registro público (signup). Cada usuario solo se ve/edita a sí mismo.
    users.createRule = "";
    users.listRule = "id = @request.auth.id";
    users.viewRule = "id = @request.auth.id";
    users.updateRule = "id = @request.auth.id";
    users.deleteRule = "id = @request.auth.id";
    app.save(users);

    const ownerRule = "@request.auth.id = usuario";

    const autodates = [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];

    // ---------------------------------------------------------------------
    // cuentas
    // ---------------------------------------------------------------------
    const cuentas = new Collection({
      id: "cuentas_0000001",
      type: "base",
      name: "cuentas",
      listRule: ownerRule,
      viewRule: ownerRule,
      createRule: ownerRule,
      updateRule: ownerRule,
      deleteRule: ownerRule,
      fields: [
        {
          name: "usuario",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "_pb_users_auth_",
          cascadeDelete: true,
        },
        { name: "nombre", type: "text", required: true, max: 255 },
        {
          name: "tipo",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["monetaria", "ahorro", "tarjeta_credito", "efectivo"],
        },
        {
          name: "moneda",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["GTQ", "USD"],
        },
        // centavos enteros, en la moneda de la cuenta
        { name: "saldo_inicial", type: "number", required: false, onlyInt: true },
        // solo tarjeta_credito
        { name: "limite_credito", type: "number", required: false, onlyInt: true },
        { name: "dia_corte", type: "number", required: false, onlyInt: true, min: 1, max: 31 },
        { name: "dia_pago", type: "number", required: false, onlyInt: true, min: 1, max: 31 },
        { name: "activa", type: "bool" },
        ...autodates,
      ],
      indexes: ["CREATE INDEX idx_cuentas_usuario ON cuentas (usuario)"],
    });
    app.save(cuentas);

    // ---------------------------------------------------------------------
    // categorias
    // ---------------------------------------------------------------------
    const categorias = new Collection({
      id: "categorias_0001",
      type: "base",
      name: "categorias",
      listRule: ownerRule,
      viewRule: ownerRule,
      createRule: ownerRule,
      updateRule: ownerRule,
      deleteRule: ownerRule,
      fields: [
        {
          name: "usuario",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "_pb_users_auth_",
          cascadeDelete: true,
        },
        { name: "nombre", type: "text", required: true, max: 255 },
        {
          name: "tipo",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["ingreso", "gasto"],
        },
        { name: "activa", type: "bool" },
        ...autodates,
      ],
      indexes: ["CREATE INDEX idx_categorias_usuario ON categorias (usuario)"],
    });
    app.save(categorias);

    // El campo `padre` es una relación a sí misma; se agrega después de existir
    // la colección (PocketBase valida que el target de la relación exista).
    categorias.fields.add(
      new RelationField({
        name: "padre",
        required: false,
        maxSelect: 1,
        collectionId: "categorias_0001",
        cascadeDelete: false,
      })
    );
    app.save(categorias);

    // ---------------------------------------------------------------------
    // movimientos
    // ---------------------------------------------------------------------
    const movimientos = new Collection({
      id: "movimientos_001",
      type: "base",
      name: "movimientos",
      listRule: ownerRule,
      viewRule: ownerRule,
      createRule: ownerRule,
      updateRule: ownerRule,
      deleteRule: ownerRule,
      fields: [
        {
          name: "usuario",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "_pb_users_auth_",
          cascadeDelete: true,
        },
        { name: "fecha", type: "date", required: true },
        {
          name: "cuenta",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: "cuentas_0000001",
          cascadeDelete: false,
        },
        {
          name: "categoria",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: "categorias_0001",
          cascadeDelete: false,
        },
        {
          name: "tipo",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["ingreso", "gasto", "transferencia"],
        },
        // centavos enteros, con signo; en la moneda de la cuenta
        { name: "monto", type: "number", required: true, onlyInt: true },
        // SIEMPRE = cuenta.moneda (denormalizada, la fija el hook)
        {
          name: "moneda",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["GTQ", "USD"],
        },
        { name: "descripcion", type: "text", max: 500 },
        { name: "transfer_id", type: "text", max: 50 },
        // solo en transferencias entre monedas distintas (rate, no es dinero)
        { name: "tipo_cambio", type: "number", required: false },
        { name: "conciliado", type: "bool" },
        { name: "eliminado", type: "bool" },
        { name: "notas", type: "text", max: 1000 },
        ...autodates,
      ],
      indexes: [
        "CREATE INDEX idx_mov_usuario ON movimientos (usuario)",
        "CREATE INDEX idx_mov_fecha ON movimientos (fecha)",
        "CREATE INDEX idx_mov_cuenta ON movimientos (cuenta)",
        "CREATE INDEX idx_mov_categoria ON movimientos (categoria)",
        "CREATE INDEX idx_mov_transfer ON movimientos (transfer_id)",
        "CREATE INDEX idx_mov_tipo ON movimientos (tipo)",
      ],
    });
    app.save(movimientos);

    // ---------------------------------------------------------------------
    // settings (un registro por usuario)
    // ---------------------------------------------------------------------
    const settings = new Collection({
      id: "settings_000001",
      type: "base",
      name: "settings",
      listRule: ownerRule,
      viewRule: ownerRule,
      createRule: ownerRule,
      updateRule: ownerRule,
      deleteRule: ownerRule,
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
          name: "moneda_base",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["GTQ", "USD"],
        },
        // USD -> GTQ actual, editable a mano; solo para consolidar patrimonio
        { name: "tipo_cambio_usd", type: "number", required: false },
        ...autodates,
      ],
      indexes: ["CREATE UNIQUE INDEX idx_settings_usuario ON settings (usuario)"],
    });
    app.save(settings);
  },

  // ----------------------------- DOWN -----------------------------
  (app) => {
    for (const name of ["settings", "movimientos", "categorias", "cuentas"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {}
    }
    try {
      const users = app.findCollectionByNameOrId("users");
      const f = users.fields.getByName("nombre");
      if (f) {
        users.fields.removeByName("nombre");
        app.save(users);
      }
    } catch (_) {}
  }
);
