/// <reference path="../pb_data/types.d.ts" />

// Etiquetas (tags) por movimiento. Campo de texto que guarda los tags normalizados
// (minúsculas, sin '#', separados por espacio). Transparente: no afecta ningún cálculo;
// solo habilita búsqueda y reportes por etiqueta.

migrate(
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (!mov.fields.getByName("tags")) {
      mov.fields.add(new TextField({ name: "tags", max: 500 }));
      mov.addIndex("idx_mov_tags", false, "tags", "");
      app.save(mov);
    }
  },
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (mov.fields.getByName("tags")) {
      mov.fields.removeByName("tags");
      app.save(mov);
    }
  }
);
