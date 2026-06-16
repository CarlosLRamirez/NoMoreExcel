/// <reference path="../pb_data/types.d.ts" />

// Flag para ingresos que se reciben en un mes pero corresponden al presupuesto del
// mes SIGUIENTE (caso típico: salario pagado a fin de mes). Mantiene la fecha real;
// solo cambia en qué mes queda "disponible para asignar".

migrate(
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (!mov.fields.getByName("ingreso_proximo_mes")) {
      mov.fields.add(new BoolField({ name: "ingreso_proximo_mes" }));
      app.save(mov);
    }
  },
  (app) => {
    const mov = app.findCollectionByNameOrId("movimientos");
    if (mov.fields.getByName("ingreso_proximo_mes")) {
      mov.fields.removeByName("ingreso_proximo_mes");
      app.save(mov);
    }
  }
);
