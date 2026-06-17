/// <reference path="../pb_data/types.d.ts" />

// Cerrar el registro público: ya no se permite crear usuarios desde la API pública.
// Solo un superusuario puede crear usuarios (desde el panel admin). El login sigue igual.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = null; // null = solo superusuarios
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.createRule = ""; // restaurar registro público
    app.save(users);
  }
);
