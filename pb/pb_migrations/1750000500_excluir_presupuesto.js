/// <reference path="../pb_data/types.d.ts" />

// Categorías excluidas del presupuesto/reportes: bool `excluir_presupuesto` (default false).
// Las marcadas no entran en las sumas ni se muestran por defecto en Presupuesto y en
// el reporte de gasto por categoría (hay un toggle para incluirlas).

migrate(
  (app) => {
    const cat = app.findCollectionByNameOrId("categorias");
    if (!cat.fields.getByName("excluir_presupuesto")) {
      cat.fields.add(new BoolField({ name: "excluir_presupuesto" }));
      app.save(cat);
    }
  },
  (app) => {
    const cat = app.findCollectionByNameOrId("categorias");
    if (cat.fields.getByName("excluir_presupuesto")) {
      cat.fields.removeByName("excluir_presupuesto");
      app.save(cat);
    }
  }
);
