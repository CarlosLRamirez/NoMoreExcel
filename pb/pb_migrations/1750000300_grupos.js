/// <reference path="../pb_data/types.d.ts" />

// Grupos de categorías (estilo YNAB: Category Groups) + orden de aparición.
//   grupos: colección nueva (usuario, nombre, orden, activa).
//   categorias: + grupo (relation→grupos, nullable) + orden (number, dentro del grupo).

migrate(
  (app) => {
    const owner = "@request.auth.id = usuario";
    const autodates = [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];

    const grupos = new Collection({
      id: "grupos_00000001",
      type: "base",
      name: "grupos",
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
        { name: "nombre", type: "text", required: true, max: 255 },
        { name: "orden", type: "number", required: false, onlyInt: true },
        { name: "activa", type: "bool" },
        ...autodates,
      ],
      indexes: ["CREATE INDEX idx_grupos_usuario ON grupos (usuario)"],
    });
    app.save(grupos);

    const cat = app.findCollectionByNameOrId("categorias");
    if (!cat.fields.getByName("grupo")) {
      cat.fields.add(
        new RelationField({
          name: "grupo",
          required: false,
          maxSelect: 1,
          collectionId: "grupos_00000001",
          cascadeDelete: false,
        })
      );
    }
    if (!cat.fields.getByName("orden")) {
      cat.fields.add(new NumberField({ name: "orden", onlyInt: true }));
    }
    app.save(cat);
  },
  (app) => {
    const cat = app.findCollectionByNameOrId("categorias");
    if (cat.fields.getByName("grupo")) cat.fields.removeByName("grupo");
    if (cat.fields.getByName("orden")) cat.fields.removeByName("orden");
    app.save(cat);
    try {
      app.delete(app.findCollectionByNameOrId("grupos"));
    } catch (_) {}
  }
);
