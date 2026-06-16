/// <reference path="../pb_data/types.d.ts" />

// Invariantes de `movimientos` a nivel de modelo: corren SIEMPRE que se guarda
// un registro (API REST, /api/transfers, /api/import). No solo en el cliente.
//
//  1. monto debe ser entero (centavos).
//  2. movimientos.moneda = cuenta.moneda (se fija automáticamente).
//  3. tipo=transferencia => categoria vacía y transfer_id presente.
//  4. tipo in (ingreso,gasto) => categoria requerida, transfer_id vacío,
//     y coherencia de signo: ingreso>0, gasto<0.
//  + la cuenta y la categoría deben pertenecer al mismo usuario.

function normalizeMovimiento(e) {
  const r = e.record;

  const tipo = r.getString("tipo");
  const monto = r.get("monto");
  const usuario = r.getString("usuario");

  // (1) monto entero
  if (typeof monto !== "number" || !Number.isInteger(monto)) {
    throw new BadRequestError("monto debe ser un entero (centavos)");
  }

  // cuenta requerida + pertenencia + (2) fijar moneda
  const cuentaId = r.getString("cuenta");
  if (!cuentaId) throw new BadRequestError("cuenta es requerida");
  let cuenta;
  try {
    cuenta = e.app.findRecordById("cuentas", cuentaId);
  } catch (_) {
    throw new BadRequestError("cuenta no encontrada");
  }
  if (cuenta.getString("usuario") !== usuario) {
    throw new BadRequestError("la cuenta no pertenece al usuario");
  }
  r.set("moneda", cuenta.getString("moneda"));

  if (tipo === "transferencia") {
    // (3)
    r.set("categoria", "");
    if (!r.getString("transfer_id")) {
      throw new BadRequestError("una transferencia requiere transfer_id");
    }
  } else if (tipo === "ingreso" || tipo === "gasto") {
    // (4)
    const categoriaId = r.getString("categoria");
    if (!categoriaId) throw new BadRequestError(tipo + " requiere categoria");
    if (r.getString("transfer_id")) {
      throw new BadRequestError(tipo + " no debe tener transfer_id");
    }
    if (tipo === "ingreso" && monto <= 0) {
      throw new BadRequestError("un ingreso debe tener monto > 0");
    }
    if (tipo === "gasto" && monto >= 0) {
      throw new BadRequestError("un gasto debe tener monto < 0");
    }
    // tipo_cambio solo aplica a transferencias cross-currency
    r.set("tipo_cambio", null);

    let categoria;
    try {
      categoria = e.app.findRecordById("categorias", categoriaId);
    } catch (_) {
      throw new BadRequestError("categoria no encontrada");
    }
    if (categoria.getString("usuario") !== usuario) {
      throw new BadRequestError("la categoria no pertenece al usuario");
    }
  } else {
    throw new BadRequestError("tipo inválido: " + tipo);
  }

  // reconciled ⇒ cleared: un movimiento bloqueado siempre está confirmado.
  if (r.getBool("reconciliado")) {
    r.set("conciliado", true);
  }

  // El flag "para el próximo mes" solo aplica a ingresos.
  if (tipo !== "ingreso") {
    r.set("ingreso_proximo_mes", false);
  }

  e.next();
}

onRecordCreate(normalizeMovimiento, "movimientos");
onRecordUpdate(normalizeMovimiento, "movimientos");
