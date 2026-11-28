/// <reference path="../pb_data/types.d.ts" />

// Herramientas del servidor MCP (la ruta y el protocolo están en mcp.pb.js).
// Este archivo NO termina en .pb.js a propósito: PocketBase no lo carga como hook, solo
// se importa con require() desde el handler.
//
// Reglas (iguales a las de la app):
//  - Dinero = enteros en centavos; los montos entran/salen como texto decimal ("45.50").
//  - Todo se limita al usuario del token (MCP_USER_EMAIL). Nada de reset, backup, importar ni borrar.
//  - Escritura en dos pasos: vista previa (por defecto) y luego confirmar=true.
//  - Guardar pasa por los hooks de movimientos.pb.js (moneda, signo, tc_base, etiquetas).

const {
  fallo,
  norm,
  centsToStr,
  decimalToCents,
  hoy,
  fechaValida,
  rango,
  convertir,
  parseTags,
  normalizarEtiquetas,
  cargarContexto,
  movimientosEnRango,
  aFila,
  resolver,
} = require(`${__hooks}/mcp_util.js`);

const MAX_ITEMS = 25;

// ---------------------------------------------------------------- herramientas

const listar_cuentas = (args, userId) => {
  const ctx = cargarContexto(userId);
  const saldos = {};
  $app.findRecordsByFilter("movimientos", "usuario = {:u} && eliminado = false", "", 0, 0, { u: userId }).forEach((r) => {
    const c = r.getString("cuenta");
    saldos[c] = (saldos[c] || 0) + r.getInt("monto");
  });
  return {
    cuentas: ctx.cuentas.map((c) => {
      const saldo = c.saldoInicial + (saldos[c.id] || 0);
      const fila = { id: c.id, nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, activa: c.activa, saldo: centsToStr(saldo) };
      if (c.tipo === "prestamo") fila.deuda = centsToStr(Math.max(0, -saldo));
      return fila;
    }),
  };
};

const listar_categorias = (args, userId) => {
  const ctx = cargarContexto(userId);
  const tipo = args.tipo;
  if (tipo !== undefined && tipo !== "gasto" && tipo !== "ingreso") throw fallo('tipo debe ser "gasto" o "ingreso"');
  return {
    categorias: ctx.categorias
      .filter((c) => (args.incluir_inactivas || c.activa) && (!tipo || c.tipo === tipo))
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        tipo: c.tipo,
        grupo: c.grupo || null,
        activa: c.activa,
        excluida_del_presupuesto: c.excluida,
      })),
  };
};

const buscar_movimientos = (args, userId) => {
  const ctx = cargarContexto(userId);
  const r = rango(args.desde || "2000-01-01", args.hasta);
  const limite = Math.min(Math.max(parseInt(args.limite || 20, 10) || 20, 1), 100);
  let cuentaId = "";
  let categoriaId = "";
  if (args.cuenta) {
    const res = resolver(ctx.cuentas, args.cuenta, () => true, "cuenta");
    if (!res.ok) throw fallo(res.error + (res.candidatos ? ". Opciones: " + res.candidatos.join(", ") : ""));
    cuentaId = res.ok.id;
  }
  if (args.categoria) {
    const res = resolver(ctx.categorias, args.categoria, () => true, "categoría");
    if (!res.ok) throw fallo(res.error + (res.candidatos ? ". Opciones: " + res.candidatos.join(", ") : ""));
    categoriaId = res.ok.id;
  }
  if (args.tipo !== undefined && ["gasto", "ingreso", "transferencia"].indexOf(args.tipo) === -1) {
    throw fallo('tipo debe ser "gasto", "ingreso" o "transferencia"');
  }
  const texto = norm(args.texto || "");
  const etiqueta = norm(args.etiqueta || "").replace(/^#+/, "");
  if (args.estado !== undefined && ["sin_confirmar", "confirmado"].indexOf(args.estado) === -1) {
    throw fallo('estado debe ser "sin_confirmar" o "confirmado"');
  }
  const filas = movimientosEnRango(userId, r.desde, r.hasta, "", {}, args.solo_eliminados === true).filter((m) => {
    if (args.estado && (args.estado === "confirmado") !== m.getBool("conciliado")) return false;
    if (cuentaId && m.getString("cuenta") !== cuentaId) return false;
    if (categoriaId && m.getString("categoria") !== categoriaId) return false;
    if (args.tipo && m.getString("tipo") !== args.tipo) return false;
    if (texto && norm(m.getString("descripcion")).indexOf(texto) === -1) return false;
    if (etiqueta && parseTags(m.getString("tags")).indexOf(etiqueta) === -1) return false;
    return true;
  });
  return {
    desde: r.desde,
    hasta: r.hasta,
    total_encontrados: filas.length,
    mostrando: Math.min(filas.length, limite),
    movimientos: filas.slice(0, limite).map((m) => aFila(m, ctx)),
  };
};

const gasto_por_categoria = (args, userId) => {
  const ctx = cargarContexto(userId);
  const r = rango(args.desde, args.hasta);
  const excluirGrupos = (args.excluir_grupos || []).map(norm);
  const acc = {};
  let sinTipoCambio = 0;
  movimientosEnRango(userId, r.desde, r.hasta, "tipo = 'gasto'").forEach((m) => {
    const cat = ctx.categoriaPorId[m.getString("categoria")];
    if (!cat) return;
    if (cat.excluida && !args.incluir_categorias_excluidas) return;
    if (cat.grupo && excluirGrupos.indexOf(norm(cat.grupo)) !== -1) return;
    const moneda = m.getString("moneda");
    const cents = Math.abs(m.getInt("monto"));
    if (moneda !== ctx.monedaBase && ctx.tc <= 0) sinTipoCambio++;
    acc[cat.id] = (acc[cat.id] || 0) + convertir(cents, moneda, ctx.monedaBase, ctx.tc);
  });
  const porGrupo = {};
  let total = 0;
  Object.keys(acc).forEach((id) => {
    const cat = ctx.categoriaPorId[id];
    const g = cat.grupo || "Sin grupo";
    (porGrupo[g] = porGrupo[g] || { grupo: g, cents: 0, categorias: [] }).cents += acc[id];
    porGrupo[g].categorias.push({ categoria: cat.nombre, cents: acc[id] });
    total += acc[id];
  });
  const grupos = Object.keys(porGrupo)
    .map((k) => porGrupo[k])
    .sort((a, b) => b.cents - a.cents)
    .map((g) => ({
      grupo: g.grupo,
      total: centsToStr(g.cents),
      categorias: g.categorias.sort((a, b) => b.cents - a.cents).map((c) => ({ categoria: c.categoria, total: centsToStr(c.cents) })),
    }));
  const out = { desde: r.desde, hasta: r.hasta, moneda: ctx.monedaBase, total: centsToStr(total), grupos };
  if (sinTipoCambio > 0) out.aviso = sinTipoCambio + " movimiento(s) en otra moneda no se convirtieron: el tipo de cambio está en 0 en Ajustes.";
  return out;
};

const registrar_movimientos = (args, userId) => {
  const items = args.movimientos;
  if (!Array.isArray(items) || items.length === 0) throw fallo("movimientos debe ser una lista con al menos un elemento");
  if (items.length > MAX_ITEMS) throw fallo("máximo " + MAX_ITEMS + " movimientos por llamada");
  const confirmar = args.confirmar === true;
  const ctx = cargarContexto(userId);
  const hoyStr = hoy();

  // 1) Resolver y validar cada elemento.
  const filas = items.map((it, i) => {
    const fila = { n: i + 1, estado: "ok", errores: [] };
    const err = (m, candidatos) => {
      fila.estado = "error";
      fila.errores.push(candidatos ? m + ". Opciones: " + candidatos.join(", ") : m);
    };
    if (!it || typeof it !== "object" || Array.isArray(it)) {
      err("cada movimiento debe ser un objeto con monto, cuenta y categoria");
      it = {};
    }
    const tipo = it.tipo === undefined ? "gasto" : it.tipo;
    if (tipo !== "gasto" && tipo !== "ingreso") err('tipo debe ser "gasto" o "ingreso" (las transferencias no están disponibles todavía)');
    fila.tipo = tipo;

    const fecha = it.fecha || hoyStr;
    if (!fechaValida(fecha)) err("fecha inválida (usa YYYY-MM-DD): " + it.fecha);
    fila.fecha = fecha;

    let cents = 0;
    try {
      cents = decimalToCents(it.monto);
      if (cents <= 0) err("el monto debe ser mayor que 0 (el tipo define si resta o suma)");
    } catch (m) {
      err(String(m));
    }
    fila.monto = centsToStr(Math.abs(cents));
    fila.cents = Math.abs(cents);

    const cuenta = resolver(ctx.cuentas, it.cuenta, (c) => c.activa && c.tipo !== "prestamo", "cuenta");
    if (cuenta.ok) {
      fila.cuenta = cuenta.ok.nombre;
      fila.cuentaId = cuenta.ok.id;
      fila.moneda = cuenta.ok.moneda;
    } else {
      err(cuenta.error, cuenta.candidatos);
    }
    const categoria = resolver(ctx.categorias, it.categoria, (c) => c.activa && c.tipo === tipo, "categoría");
    if (categoria.ok) {
      fila.categoria = categoria.ok.nombre;
      fila.categoriaId = categoria.ok.id;
    } else {
      err(categoria.error, categoria.candidatos);
    }
    fila.descripcion = String(it.descripcion || "").trim();
    if (fila.descripcion.length > 500) err("la descripción excede 500 caracteres");
    fila.etiquetas = normalizarEtiquetas(it.etiquetas);
    if (fila.etiquetas.join(" ").length > 500) err("las etiquetas exceden 500 caracteres");
    return fila;
  });

  // 2) Posibles duplicados: contra lo ya guardado y dentro del mismo lote.
  const validas = filas.filter((f) => f.estado === "ok");
  if (validas.length > 0) {
    const fechas = validas.map((f) => f.fecha).sort();
    const existentes = {};
    movimientosEnRango(userId, fechas[0], fechas[fechas.length - 1]).forEach((m) => {
      const k = [m.getString("cuenta"), m.getString("fecha").slice(0, 10), m.getInt("monto")].join("|");
      (existentes[k] = existentes[k] || []).push(m);
    });
    const vistos = {};
    validas.forEach((f) => {
      const signo = f.tipo === "gasto" ? -f.cents : f.cents;
      const k = [f.cuentaId, f.fecha, signo].join("|");
      if (existentes[k]) {
        f.estado = "posible_duplicado";
        const d = existentes[k][0];
        f.duplicado_de = { id: d.id, descripcion: d.getString("descripcion"), fecha: f.fecha };
      } else if (vistos[k]) {
        f.estado = "posible_duplicado";
        f.duplicado_de = { en_este_lote: vistos[k] };
      }
      vistos[k] = vistos[k] || f.n;
    });
  }

  const hayErrores = filas.some((f) => f.estado === "error");
  const permitirDup = args.permitir_duplicados === true;
  const vista = filas.map((f) => {
    const o = {
      n: f.n,
      estado: f.estado,
      fecha: f.fecha,
      tipo: f.tipo,
      monto: f.monto,
      moneda: f.moneda || null,
      cuenta: f.cuenta || null,
      categoria: f.categoria || null,
      descripcion: f.descripcion,
      etiquetas: f.etiquetas,
    };
    if (f.errores.length) o.errores = f.errores;
    if (f.duplicado_de) o.duplicado_de = f.duplicado_de;
    return o;
  });

  // 3) Vista previa (por defecto) o guardado.
  if (!confirmar) {
    return {
      modo: "vista_previa",
      guardado: false,
      movimientos: vista,
      siguiente_paso: hayErrores
        ? "Hay errores: corrígelos (pregunta al usuario lo que falte) y vuelve a llamar sin confirmar."
        : "Muestra esta lista al usuario. Si la aprueba, llama de nuevo con los mismos movimientos y confirmar=true." +
          (filas.some((f) => f.estado === "posible_duplicado")
            ? " Los 'posible_duplicado' se omitirán salvo que el usuario diga que son distintos (entonces permitir_duplicados=true)."
            : ""),
    };
  }
  if (hayErrores) {
    throw fallo("No se guardó nada: hay movimientos con errores. " + JSON.stringify(vista.filter((v) => v.estado === "error")));
  }

  const aGuardar = filas.filter((f) => f.estado === "ok" || (f.estado === "posible_duplicado" && permitirDup));
  const col = $app.findCollectionByNameOrId("movimientos");
  const ids = {};
  $app.runInTransaction((tx) => {
    aGuardar.forEach((f) => {
      const r = new Record(col);
      r.set("usuario", userId);
      r.set("fecha", f.fecha);
      r.set("cuenta", f.cuentaId);
      r.set("categoria", f.categoriaId);
      r.set("tipo", f.tipo);
      r.set("monto", f.tipo === "gasto" ? -f.cents : f.cents);
      r.set("descripcion", f.descripcion);
      r.set("tags", f.etiquetas.join(" "));
      r.set("conciliado", false);
      tx.save(r); // dispara las invariantes de movimientos.pb.js
      ids[f.n] = r.id;
    });
  });
  const omitidos = filas.filter((f) => !ids[f.n]);
  return {
    modo: "guardado",
    guardado: true,
    guardados: aGuardar.length,
    omitidos_por_duplicado: omitidos.length,
    movimientos: vista.map((v) => {
      if (ids[v.n]) v.id = ids[v.n];
      else v.estado = "omitido_por_duplicado";
      return v;
    }),
  };
};

// ---------------------------------------------------------------- catálogo

const FECHA = { type: "string", description: "Fecha YYYY-MM-DD." };
const SOLO_LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: "listar_cuentas",
    description:
      "Lista las cuentas del usuario con su saldo actual (saldo inicial + movimientos). Úsala para saber qué cuentas existen y cuánto hay en cada una.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: Object.assign({ title: "Cuentas y saldos" }, SOLO_LECTURA),
    run: listar_cuentas,
  },
  {
    name: "listar_categorias",
    description:
      "Lista las categorías (gasto o ingreso) con su grupo. Úsala antes de registrar movimientos si no estás seguro de qué categoría usar.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "ingreso"], description: "Filtra por tipo." },
        incluir_inactivas: { type: "boolean", description: "Incluye categorías desactivadas (por defecto no)." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Categorías" }, SOLO_LECTURA),
    run: listar_categorias,
  },
  {
    name: "buscar_movimientos",
    description:
      "Busca movimientos (por defecto los vigentes), del más reciente al más antiguo; cada uno trae su id, si está confirmado y si está bloqueado (conciliado, no editable). Todos los filtros son opcionales; cuenta y categoría aceptan el nombre. Úsala para revisar lo registrado, detectar duplicados o encontrar el id de un movimiento a corregir o eliminar.",
    inputSchema: {
      type: "object",
      properties: {
        desde: FECHA,
        hasta: FECHA,
        cuenta: { type: "string", description: "Nombre (o id) de la cuenta." },
        categoria: { type: "string", description: "Nombre (o id) de la categoría." },
        tipo: { type: "string", enum: ["gasto", "ingreso", "transferencia"] },
        texto: { type: "string", description: "Texto contenido en la descripción." },
        etiqueta: { type: "string", description: "Etiqueta, sin #." },
        estado: { type: "string", enum: ["sin_confirmar", "confirmado"], description: "sin_confirmar = aún no verificado contra el banco." },
        solo_eliminados: { type: "boolean", description: "Lista los eliminados (para restaurarlos) en lugar de los vigentes." },
        limite: { type: "integer", minimum: 1, maximum: 100, description: "Máximo de filas (por defecto 20)." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Buscar movimientos" }, SOLO_LECTURA),
    run: buscar_movimientos,
  },
  {
    name: "gasto_por_categoria",
    description:
      "Total gastado por categoría y grupo en un rango de fechas, en la moneda base. Solo gastos reales: no incluye transferencias ni categorías excluidas del presupuesto (salvo que se pida). Por defecto: del día 1 del mes actual a hoy. Para '¿cuánto llevo en medicamentos este mes?' úsala sin parámetros.",
    inputSchema: {
      type: "object",
      properties: {
        desde: FECHA,
        hasta: FECHA,
        excluir_grupos: {
          type: "array",
          items: { type: "string" },
          description: "Nombres de grupos a dejar fuera (p. ej. un negocio aparte) para ver el gasto personal.",
        },
        incluir_categorias_excluidas: { type: "boolean", description: "Incluye las categorías excluidas del presupuesto." },
      },
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Gasto por categoría" }, SOLO_LECTURA),
    run: gasto_por_categoria,
  },
  {
    name: "registrar_movimientos",
    description:
      "Registra gastos o ingresos. SIEMPRE en dos pasos: 1) llámala sin 'confirmar' para obtener una vista previa (resuelve cuenta y categoría por nombre, avisa de errores y de posibles duplicados); 2) enseña la vista previa al usuario y, solo si la aprueba, llámala otra vez con los mismos movimientos y confirmar=true. No inventes datos: si falta cuenta, categoría o monto, pregunta. Si la categoría es ambigua, pregunta cuál. Las fechas por defecto son hoy. Los montos van en positivo (el tipo define si resta o suma). No registra transferencias.",
    inputSchema: {
      type: "object",
      properties: {
        movimientos: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ITEMS,
          items: {
            type: "object",
            properties: {
              fecha: { type: "string", description: "YYYY-MM-DD. Si se omite, hoy." },
              tipo: { type: "string", enum: ["gasto", "ingreso"], description: "Por defecto gasto." },
              monto: { type: "string", description: 'Monto positivo en la moneda de la cuenta, p. ej. "45.50".' },
              cuenta: { type: "string", description: "Nombre (o id) de la cuenta." },
              categoria: { type: "string", description: "Nombre (o id) de una categoría del mismo tipo." },
              descripcion: { type: "string", description: "Comercio o motivo (opcional)." },
              etiquetas: { type: "string", description: "Etiquetas separadas por espacio, sin # (opcional)." },
            },
            required: ["monto", "cuenta", "categoria"],
            additionalProperties: false,
          },
        },
        confirmar: { type: "boolean", description: "false o ausente = solo vista previa. true = guarda." },
        permitir_duplicados: { type: "boolean", description: "Con confirmar=true, guarda también los marcados como posible_duplicado." },
      },
      required: ["movimientos"],
      additionalProperties: false,
    },
    annotations: { title: "Registrar movimientos", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: registrar_movimientos,
  },
];

module.exports = { TOOLS };
