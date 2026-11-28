/// <reference path="../pb_data/types.d.ts" />

// Herramientas MCP de ESCRITURA sobre movimientos: transferencias, editar, eliminar (lógico),
// restaurar y marcar como confirmado. Reglas comunes:
//  - Las que cambian datos trabajan en dos pasos: vista previa (por defecto) y confirmar=true.
//  - Un movimiento "bloqueado" (reconciliado con el banco) NO se toca desde aquí; se hace en la app.
//  - Eliminar es lógico (eliminado=true), igual que en la app, y se puede deshacer con restaurar_movimientos.
//  - Guardar pasa por los hooks de movimientos.pb.js (moneda, signo, tc_base, etiquetas).

const {
  fallo,
  centsToStr,
  decimalToCents,
  hoy,
  fechaValida,
  parseTags,
  normalizarEtiquetas,
  cargarContexto,
  movimientosEnRango,
  aFila,
  resolver,
  movimientoDelUsuario,
} = require(`${__hooks}/mcp_util.js`);

const MAX_TRANSFERENCIAS = 10;
const MAX_IDS = 10;
const MAX_IDS_CONFIRMAR = 50;

const mensajeDe = (e) => (e && typeof e === "object" && typeof e.toolError === "string" ? e.toolError : String(e));

const listaDeIds = (ids, max) => {
  if (!Array.isArray(ids) || ids.length === 0) throw fallo("ids debe ser una lista con al menos un id");
  if (ids.length > max) throw fallo("máximo " + max + " ids por llamada");
  const unicos = [];
  ids.forEach((id) => {
    if (typeof id !== "string" || !id.trim()) throw fallo("cada id debe ser un texto (el 'id' que devuelven las búsquedas)");
    if (unicos.indexOf(id.trim()) === -1) unicos.push(id.trim());
  });
  return unicos;
};

// Tasas de costo histórico de una transferencia (moneda_base por unidad extranjera), como /api/transfers.
const tasasDeTransferencia = (monedaO, monedaD, absO, absD, base) => {
  let baseAmt = 0;
  let forAmt = 0;
  if (monedaO === base) baseAmt = absO;
  else forAmt = absO;
  if (monedaD === base) baseAmt = absD;
  else forAmt = absD;
  const tcForeign = baseAmt > 0 && forAmt > 0 ? baseAmt / forAmt : 0;
  const tcOf = (mon) => (mon === base ? 1 : tcForeign);
  return { o: tcOf(monedaO), d: tcOf(monedaD) };
};

// ---------------------------------------------------------------- transferencias

const registrar_transferencia = (args, userId) => {
  const items = args.transferencias;
  if (!Array.isArray(items) || items.length === 0) throw fallo("transferencias debe ser una lista con al menos un elemento");
  if (items.length > MAX_TRANSFERENCIAS) throw fallo("máximo " + MAX_TRANSFERENCIAS + " transferencias por llamada");
  const confirmar = args.confirmar === true;
  const ctx = cargarContexto(userId);
  const hoyStr = hoy();
  const elegible = (c) => c.activa && c.tipo !== "prestamo";

  const filas = items.map((it, i) => {
    const fila = { n: i + 1, estado: "ok", errores: [] };
    const err = (m, candidatos) => {
      fila.estado = "error";
      fila.errores.push(candidatos ? m + ". Opciones: " + candidatos.join(", ") : m);
    };
    if (!it || typeof it !== "object" || Array.isArray(it)) {
      err("cada transferencia debe ser un objeto con monto, origen y destino");
      it = {};
    }
    const fecha = it.fecha || hoyStr;
    if (!fechaValida(fecha)) err("fecha inválida (usa YYYY-MM-DD): " + it.fecha);
    fila.fecha = fecha;
    let cents = 0;
    try {
      cents = decimalToCents(it.monto);
      if (cents <= 0) err("el monto debe ser mayor que 0 (en la moneda de la cuenta de origen)");
    } catch (m) {
      err(String(m));
    }
    fila.cents = cents;
    const o = resolver(ctx.cuentas, it.origen, elegible, "cuenta de origen");
    const d = resolver(ctx.cuentas, it.destino, elegible, "cuenta de destino");
    if (!o.ok) err(o.error, o.candidatos);
    if (!d.ok) err(d.error, d.candidatos);
    fila.descripcion = String(it.descripcion || "").trim();
    if (fila.descripcion.length > 500) err("la descripción excede 500 caracteres");
    if (o.ok && d.ok) {
      fila.origen = o.ok;
      fila.destino = d.ok;
      if (o.ok.id === d.ok.id) {
        err("origen y destino deben ser cuentas distintas");
      } else if (o.ok.moneda === d.ok.moneda) {
        if (it.tipo_cambio !== undefined && it.tipo_cambio !== null && it.tipo_cambio !== "") err("ambas cuentas están en " + o.ok.moneda + ": no envíes tipo_cambio");
        fila.centsDestino = cents;
        fila.tipoCambio = null;
      } else {
        const tc = Number(it.tipo_cambio);
        if (!(tc > 0)) {
          err("las cuentas están en monedas distintas: falta tipo_cambio (" + d.ok.moneda + " que se reciben por cada 1 " + o.ok.moneda + ")");
        } else {
          fila.tipoCambio = tc;
          fila.centsDestino = Math.round(cents * tc);
          if (fila.centsDestino <= 0) err("el monto calculado para la cuenta de destino es inválido");
        }
      }
    }
    return fila;
  });

  // Posibles duplicados: misma cuenta de origen, fecha y monto ya registrados como transferencia.
  const validas = filas.filter((f) => f.estado === "ok");
  if (validas.length > 0) {
    const fechas = validas.map((f) => f.fecha).sort();
    const existentes = {};
    movimientosEnRango(userId, fechas[0], fechas[fechas.length - 1], "tipo = 'transferencia'").forEach((m) => {
      existentes[[m.getString("cuenta"), m.getString("fecha").slice(0, 10), m.getInt("monto")].join("|")] = m;
    });
    const vistos = {};
    validas.forEach((f) => {
      const k = [f.origen.id, f.fecha, -f.cents].join("|");
      if (existentes[k]) {
        f.estado = "posible_duplicado";
        f.duplicado_de = { id: existentes[k].id, descripcion: existentes[k].getString("descripcion") };
      } else if (vistos[k]) {
        f.estado = "posible_duplicado";
        f.duplicado_de = { en_este_lote: vistos[k] };
      }
      vistos[k] = vistos[k] || f.n;
    });
  }

  const hayErrores = filas.some((f) => f.estado === "error");
  const vista = filas.map((f) => {
    const o = {
      n: f.n,
      estado: f.estado,
      fecha: f.fecha,
      origen: f.origen ? f.origen.nombre + " (" + f.origen.moneda + ")" : null,
      destino: f.destino ? f.destino.nombre + " (" + f.destino.moneda + ")" : null,
      sale: centsToStr(f.cents),
      entra: f.centsDestino !== undefined ? centsToStr(f.centsDestino) : null,
      descripcion: f.descripcion,
    };
    if (f.tipoCambio) o.tipo_cambio = f.tipoCambio;
    if (f.errores.length) o.errores = f.errores;
    if (f.duplicado_de) o.duplicado_de = f.duplicado_de;
    return o;
  });

  if (!confirmar) {
    return {
      modo: "vista_previa",
      guardado: false,
      transferencias: vista,
      siguiente_paso: hayErrores
        ? "Hay errores: corrígelos (pregunta lo que falte) y vuelve a llamar sin confirmar."
        : "Muestra esto al usuario. Si lo aprueba, llama de nuevo con las mismas transferencias y confirmar=true." +
          (filas.some((f) => f.estado === "posible_duplicado") ? " Las 'posible_duplicado' se omiten salvo permitir_duplicados=true." : ""),
    };
  }
  if (hayErrores) throw fallo("No se guardó nada: hay transferencias con errores. " + JSON.stringify(vista.filter((v) => v.estado === "error")));

  const aGuardar = filas.filter((f) => f.estado === "ok" || (f.estado === "posible_duplicado" && args.permitir_duplicados === true));
  const col = $app.findCollectionByNameOrId("movimientos");
  const hechas = {};
  $app.runInTransaction((tx) => {
    aGuardar.forEach((f) => {
      const tasas = tasasDeTransferencia(f.origen.moneda, f.destino.moneda, f.cents, f.centsDestino, ctx.monedaBase);
      const transferId = $security.randomString(15);
      const pata = (cuenta, monto, tc) => {
        const r = new Record(col);
        r.set("usuario", userId);
        r.set("fecha", f.fecha);
        r.set("cuenta", cuenta);
        r.set("tipo", "transferencia");
        r.set("monto", monto);
        r.set("descripcion", f.descripcion);
        r.set("transfer_id", transferId);
        r.set("tc_base", tc);
        if (f.tipoCambio) r.set("tipo_cambio", f.tipoCambio);
        r.set("conciliado", false);
        tx.save(r); // dispara las invariantes de movimientos.pb.js
        return r.id;
      };
      hechas[f.n] = [pata(f.origen.id, -f.cents, tasas.o), pata(f.destino.id, f.centsDestino, tasas.d)];
    });
  });
  return {
    modo: "guardado",
    guardado: true,
    guardadas: aGuardar.length,
    omitidas_por_duplicado: filas.length - aGuardar.length,
    transferencias: vista.map((v) => {
      if (hechas[v.n]) v.ids = hechas[v.n];
      else v.estado = "omitida_por_duplicado";
      return v;
    }),
  };
};

// ---------------------------------------------------------------- editar

const CAMPOS_EDITABLES = ["fecha", "monto", "cuenta", "categoria", "descripcion", "etiquetas", "notas"];

const editar_movimiento = (args, userId) => {
  const r = movimientoDelUsuario(userId, args.id);
  if (r.getBool("eliminado")) throw fallo("ese movimiento está eliminado; restáuralo primero con restaurar_movimientos");
  if (r.getBool("reconciliado")) throw fallo("ese movimiento está bloqueado (conciliado con el banco): edítalo en la app");
  const tipo = r.getString("tipo");
  if (tipo === "transferencia") throw fallo("las transferencias no se editan: elimínala y regístrala de nuevo");
  const cambios = args.cambios;
  if (!cambios || typeof cambios !== "object" || Array.isArray(cambios) || Object.keys(cambios).length === 0) {
    throw fallo("indica qué cambiar en 'cambios' (" + CAMPOS_EDITABLES.join(", ") + ")");
  }
  Object.keys(cambios).forEach((k) => {
    if (CAMPOS_EDITABLES.indexOf(k) === -1) throw fallo("no se puede cambiar '" + k + "'. Campos permitidos: " + CAMPOS_EDITABLES.join(", "));
  });

  const ctx = cargarContexto(userId);
  const cuentaActual = ctx.cuentaPorId[r.getString("cuenta")];
  const errores = [];
  const err = (m, candidatos) => errores.push(candidatos ? m + ". Opciones: " + candidatos.join(", ") : m);

  let fecha = r.getString("fecha").slice(0, 10);
  if (cambios.fecha !== undefined) {
    if (!fechaValida(cambios.fecha)) err("fecha inválida (usa YYYY-MM-DD): " + cambios.fecha);
    else fecha = cambios.fecha;
  }
  let cents = Math.abs(r.getInt("monto"));
  if (cambios.monto !== undefined) {
    try {
      const c = decimalToCents(cambios.monto);
      if (c <= 0) err("el monto debe ser mayor que 0 (el tipo del movimiento define el signo)");
      else cents = c;
    } catch (m) {
      err(String(m));
    }
  }
  let cuenta = cuentaActual;
  if (cambios.cuenta !== undefined) {
    const res = resolver(ctx.cuentas, cambios.cuenta, (c) => c.activa && c.tipo !== "prestamo", "cuenta");
    if (!res.ok) err(res.error, res.candidatos);
    else if (cuentaActual && res.ok.moneda !== cuentaActual.moneda) err("esa cuenta está en otra moneda (" + res.ok.moneda + "): elimina el movimiento y vuelve a registrarlo");
    else cuenta = res.ok;
  }
  let categoria = ctx.categoriaPorId[r.getString("categoria")] || null;
  if (cambios.categoria !== undefined) {
    const res = resolver(ctx.categorias, cambios.categoria, (c) => c.activa && c.tipo === tipo, "categoría");
    if (!res.ok) err(res.error, res.candidatos);
    else categoria = res.ok;
  }
  let descripcion = r.getString("descripcion");
  if (cambios.descripcion !== undefined) {
    descripcion = String(cambios.descripcion).trim();
    if (descripcion.length > 500) err("la descripción excede 500 caracteres");
  }
  let etiquetas = parseTags(r.getString("tags"));
  if (cambios.etiquetas !== undefined) {
    etiquetas = normalizarEtiquetas(cambios.etiquetas);
    if (etiquetas.join(" ").length > 500) err("las etiquetas exceden 500 caracteres");
  }
  let notas = r.getString("notas");
  if (cambios.notas !== undefined) {
    notas = String(cambios.notas).trim();
    if (notas.length > 1000) err("las notas exceden 1000 caracteres");
  }

  const antes = aFila(r, ctx);
  antes.notas = r.getString("notas");
  const despues = {
    id: r.id,
    fecha,
    tipo,
    monto: centsToStr(tipo === "gasto" ? -cents : cents),
    moneda: cuenta ? cuenta.moneda : antes.moneda,
    cuenta: cuenta ? cuenta.nombre : null,
    categoria: categoria ? categoria.nombre : null,
    descripcion,
    etiquetas,
    notas,
  };
  const cambioElDinero = cents !== Math.abs(r.getInt("monto")) || (cuenta && cuenta.id !== r.getString("cuenta"));
  const pierdeConfirmacion = cambioElDinero && r.getBool("conciliado");

  if (errores.length) throw fallo("No se puede editar: " + errores.join("; "));
  if (args.confirmar !== true) {
    return {
      modo: "vista_previa",
      guardado: false,
      antes,
      despues,
      aviso: pierdeConfirmacion ? "Cambia el dinero de un movimiento ya confirmado: quedará como sin confirmar para volver a verificarlo contra el banco." : undefined,
      siguiente_paso: "Muestra el antes y el después al usuario. Si lo aprueba, llama de nuevo con los mismos datos y confirmar=true.",
    };
  }

  r.set("fecha", fecha);
  r.set("monto", tipo === "gasto" ? -cents : cents);
  if (cuenta) r.set("cuenta", cuenta.id);
  if (categoria) r.set("categoria", categoria.id);
  r.set("descripcion", descripcion);
  r.set("tags", etiquetas.join(" "));
  r.set("notas", notas);
  if (pierdeConfirmacion) r.set("conciliado", false);
  $app.save(r); // dispara las invariantes de movimientos.pb.js
  return { modo: "guardado", guardado: true, antes, despues, sin_confirmar_de_nuevo: pierdeConfirmacion };
};

// ---------------------------------------------------------------- eliminar / restaurar

// Reúne los movimientos a procesar (con la pareja de cada transferencia). `quiereEliminado` = estado requerido.
const reunirMovimientos = (userId, ids, quiereEliminado) => {
  const lista = [];
  const errores = [];
  const vistos = {};
  const agregar = (r, comoPareja) => {
    if (vistos[r.id]) return;
    vistos[r.id] = true;
    lista.push({ r, comoPareja });
  };
  ids.forEach((id) => {
    let r;
    try {
      r = movimientoDelUsuario(userId, id);
    } catch (e) {
      errores.push(mensajeDe(e));
      return;
    }
    if (r.getBool("eliminado") !== quiereEliminado) {
      errores.push(id + (quiereEliminado ? ": no está eliminado" : ": ya está eliminado"));
      return;
    }
    if (r.getBool("reconciliado")) {
      errores.push(id + ": está bloqueado (conciliado con el banco); hazlo en la app");
      return;
    }
    agregar(r, false);
    if (r.getString("tipo") === "transferencia" && r.getString("transfer_id")) {
      $app
        .findRecordsByFilter("movimientos", "usuario = {:u} && transfer_id = {:t} && eliminado = {:e}", "", 0, 0, { u: userId, t: r.getString("transfer_id"), e: quiereEliminado })
        .forEach((p) => {
          if (p.getBool("reconciliado")) errores.push(p.id + ": la otra pata de la transferencia está bloqueada (conciliada)");
          else agregar(p, true);
        });
    }
  });
  return { lista, errores };
};

const eliminar_movimientos = (args, userId) => {
  const ids = listaDeIds(args.ids, MAX_IDS);
  const ctx = cargarContexto(userId);
  const { lista, errores } = reunirMovimientos(userId, ids, false);
  const vista = lista.map((x) => {
    const f = aFila(x.r, ctx);
    if (x.comoPareja) f.incluida_por_ser_pareja_de_transferencia = true;
    return f;
  });
  if (args.confirmar !== true) {
    return {
      modo: "vista_previa",
      guardado: false,
      se_eliminarian: vista,
      errores,
      siguiente_paso: errores.length
        ? "Hay errores: corrígelos y vuelve a llamar."
        : "Muestra al usuario lo que se eliminará. Si lo aprueba, llama de nuevo con los mismos ids y confirmar=true. Se puede deshacer con restaurar_movimientos.",
    };
  }
  if (errores.length) throw fallo("No se eliminó nada: " + errores.join("; "));
  $app.runInTransaction((tx) => {
    lista.forEach((x) => {
      x.r.set("eliminado", true);
      tx.save(x.r);
    });
  });
  return { modo: "guardado", guardado: true, eliminados: vista, deshacer: "restaurar_movimientos con estos ids" };
};

const restaurar_movimientos = (args, userId) => {
  const ids = listaDeIds(args.ids, MAX_IDS);
  const ctx = cargarContexto(userId);
  const { lista, errores } = reunirMovimientos(userId, ids, true);
  if (errores.length) throw fallo("No se restauró nada: " + errores.join("; "));
  $app.runInTransaction((tx) => {
    lista.forEach((x) => {
      x.r.set("eliminado", false);
      tx.save(x.r);
    });
  });
  return { restaurados: lista.map((x) => aFila(x.r, ctx)) };
};

// ---------------------------------------------------------------- confirmar contra el banco

const marcar_movimientos_confirmados = (args, userId) => {
  const ids = listaDeIds(args.ids, MAX_IDS_CONFIRMAR);
  const confirmado = args.confirmado === undefined ? true : args.confirmado === true;
  const resultado = [];
  const aGuardar = [];
  ids.forEach((id) => {
    let r;
    try {
      r = movimientoDelUsuario(userId, id);
    } catch (e) {
      resultado.push({ id, estado: "error", detalle: mensajeDe(e) });
      return;
    }
    if (r.getBool("eliminado")) resultado.push({ id, estado: "omitido", detalle: "está eliminado" });
    else if (r.getBool("reconciliado")) resultado.push({ id, estado: "omitido", detalle: "bloqueado (conciliado con el banco)" });
    else if (r.getBool("conciliado") === confirmado) resultado.push({ id, estado: "sin_cambio" });
    else {
      r.set("conciliado", confirmado);
      aGuardar.push(r);
      resultado.push({ id, estado: "actualizado", confirmado });
    }
  });
  $app.runInTransaction((tx) => {
    aGuardar.forEach((r) => tx.save(r));
  });
  return { actualizados: aGuardar.length, movimientos: resultado };
};

// ---------------------------------------------------------------- catálogo

const FECHA = { type: "string", description: "YYYY-MM-DD. Si se omite, hoy." };
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const ID = { type: "string", description: "El 'id' del movimiento (lo devuelve buscar_movimientos)." };

const TOOLS = [
  {
    name: "registrar_transferencia",
    description:
      "Mueve dinero entre dos cuentas propias (no es gasto ni ingreso; no afecta categorías). En dos pasos: vista previa y luego confirmar=true. El monto va en la moneda de la cuenta de ORIGEN; si las monedas difieren hay que dar tipo_cambio (cuántas unidades de la moneda destino por cada 1 de origen). No usa cuentas de préstamo: para pagar un préstamo usa pagar_cuota_prestamo.",
    inputSchema: {
      type: "object",
      properties: {
        transferencias: {
          type: "array",
          minItems: 1,
          maxItems: MAX_TRANSFERENCIAS,
          items: {
            type: "object",
            properties: {
              fecha: FECHA,
              monto: { type: "string", description: 'Monto positivo en la moneda de origen, p. ej. "1000.00".' },
              origen: { type: "string", description: "Cuenta de la que sale el dinero (nombre o id)." },
              destino: { type: "string", description: "Cuenta a la que entra (nombre o id)." },
              tipo_cambio: { type: "number", description: "Solo si las monedas son distintas." },
              descripcion: { type: "string" },
            },
            required: ["monto", "origen", "destino"],
            additionalProperties: false,
          },
        },
        confirmar: { type: "boolean", description: "false o ausente = vista previa; true = guarda." },
        permitir_duplicados: { type: "boolean", description: "Con confirmar=true, guarda también las marcadas como posible_duplicado." },
      },
      required: ["transferencias"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Registrar transferencia" }, ESCRITURA),
    run: registrar_transferencia,
  },
  {
    name: "editar_movimiento",
    description:
      "Corrige un gasto o ingreso existente (fecha, monto, cuenta, categoría, descripción, etiquetas o notas). Usa buscar_movimientos para obtener el id. En dos pasos: vista previa con antes/después y luego confirmar=true. No edita transferencias ni movimientos bloqueados (conciliados). Si cambia el monto o la cuenta de uno ya confirmado, vuelve a quedar sin confirmar.",
    inputSchema: {
      type: "object",
      properties: {
        id: ID,
        cambios: {
          type: "object",
          properties: {
            fecha: { type: "string", description: "YYYY-MM-DD." },
            monto: { type: "string", description: "Monto positivo; el tipo del movimiento define el signo." },
            cuenta: { type: "string", description: "Nombre o id; debe estar en la misma moneda." },
            categoria: { type: "string", description: "Nombre o id; del mismo tipo (gasto/ingreso)." },
            descripcion: { type: "string" },
            etiquetas: { type: "string", description: "Etiquetas separadas por espacio, sin # (reemplaza las actuales)." },
            notas: { type: "string" },
          },
          additionalProperties: false,
        },
        confirmar: { type: "boolean", description: "false o ausente = vista previa; true = guarda." },
      },
      required: ["id", "cambios"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Editar movimiento" }, ESCRITURA),
    run: editar_movimiento,
  },
  {
    name: "eliminar_movimientos",
    description:
      "Elimina movimientos (eliminación lógica, como el botón Eliminar de la app: dejan de contar pero se pueden restaurar con restaurar_movimientos). En dos pasos: vista previa y luego confirmar=true. Al eliminar una transferencia se elimina también su otra pata. No toca movimientos bloqueados (conciliados). Úsala, por ejemplo, para quitar un duplicado.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: ID, minItems: 1, maxItems: MAX_IDS },
        confirmar: { type: "boolean", description: "false o ausente = vista previa; true = elimina." },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: { title: "Eliminar movimientos", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: eliminar_movimientos,
  },
  {
    name: "restaurar_movimientos",
    description:
      "Deshace una eliminación: vuelve a activar movimientos eliminados (y la otra pata de una transferencia). Para encontrarlos usa buscar_movimientos con solo_eliminados=true.",
    inputSchema: {
      type: "object",
      properties: { ids: { type: "array", items: ID, minItems: 1, maxItems: MAX_IDS } },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Restaurar movimientos" }, ESCRITURA),
    run: restaurar_movimientos,
  },
  {
    name: "marcar_movimientos_confirmados",
    description:
      "Marca (o desmarca) movimientos como confirmados, es decir, ya verificados contra el banco. No concilia ni bloquea nada. Para revisar pendientes usa buscar_movimientos con estado=sin_confirmar. Omite los eliminados y los bloqueados.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: ID, minItems: 1, maxItems: MAX_IDS_CONFIRMAR },
        confirmado: { type: "boolean", description: "true (por defecto) = confirmar; false = quitar la confirmación." },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Confirmar contra el banco" }, ESCRITURA, { idempotentHint: true }),
    run: marcar_movimientos_confirmados,
  },
];

module.exports = { TOOLS };
