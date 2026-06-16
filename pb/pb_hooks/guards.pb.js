/// <reference path="../pb_data/types.d.ts" />

// Guards a nivel de REQUEST (solo API REST directa). Las operaciones internas
// (/api/transfers, /api/import) usan txApp.save(), que NO dispara estos hooks,
// por lo que ahí sí se pueden crear las patas de una transferencia.

// El usuario NUNCA crea patas de transferencia a mano por la API de colección.
onRecordCreateRequest((e) => {
  if (e.record.getString("tipo") === "transferencia") {
    throw new BadRequestError(
      "Las transferencias se crean vía POST /api/transfers, no como movimientos sueltos"
    );
  }
  e.next();
}, "movimientos");

// Proteger la integridad de las patas de transferencia: no se pueden editar sus
// campos núcleo por la API (cambiarían el balance). Sí se permite conciliar,
// describir, anotar, cambiar fecha o hacer soft delete.
onRecordUpdateRequest((e) => {
  const r = e.record;
  if (r.getString("tipo") === "transferencia") {
    const orig = e.app.findRecordById("movimientos", r.id);
    const locked = ["tipo", "monto", "cuenta", "moneda", "transfer_id", "tipo_cambio", "usuario"];
    for (const f of locked) {
      if (String(r.get(f)) !== String(orig.get(f))) {
        throw new BadRequestError(
          "No se puede editar el campo '" + f + "' de una transferencia"
        );
      }
    }
  }
  e.next();
}, "movimientos");

// Default `activa = true` para cuentas y categorias cuando el cliente no lo envía.
// (PocketBase no soporta default-true en campos bool, así que se fija aquí.)
onRecordCreateRequest((e) => {
  const body = e.requestInfo().body;
  if (body.activa === undefined) {
    e.record.set("activa", true);
  }
  e.next();
}, "cuentas", "categorias");

// No permitir borrar (por la API) una cuenta o categoría que tenga movimientos:
// el cascade pondría en null la relación y rompería las invariantes. Mensaje claro.
// (Sugerencia al usuario: desactívala con `activa=false` en vez de borrarla.)
onRecordDeleteRequest((e) => {
  const refs = e.app.findRecordsByFilter("movimientos", "cuenta = {:c}", "", 1, 0, { c: e.record.id });
  if (refs.length > 0) {
    throw new BadRequestError(
      "No se puede eliminar una cuenta con movimientos. Desactívala (activa=false) o elimina/reasigna sus movimientos primero."
    );
  }
  e.next();
}, "cuentas");

onRecordDeleteRequest((e) => {
  const refs = e.app.findRecordsByFilter("movimientos", "categoria = {:c}", "", 1, 0, { c: e.record.id });
  if (refs.length > 0) {
    throw new BadRequestError(
      "No se puede eliminar una categoría con movimientos. Desactívala (activa=false) o reasigna sus movimientos primero."
    );
  }
  e.next();
}, "categorias");
