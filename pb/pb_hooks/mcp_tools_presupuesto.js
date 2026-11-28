/// <reference path="../pb_data/types.d.ts" />

// Herramientas MCP de PRESUPUESTO: asignar, cubrir sobregastos y copiar el mes anterior.
// Mismas reglas que la app (budget.pb.js y la pantalla de Presupuesto):
//  - El presupuesto es por (categoría, mes); monto 0 lo quita.
//  - "Disponible para asignar" y el saldo acumulado por categoría salen de mcp_calculos.js.
//  - Dos pasos: vista previa (por defecto) y confirmar=true.

const {
  fallo,
  norm,
  centsToStr,
  decimalToCents,
  cargarDatos,
  resolver,
  guardarPresupuesto,
  mesValido,
  mesActual,
  sumarMes,
} = require(`${__hooks}/mcp_util.js`);
const C = require(`${__hooks}/mcp_calculos.js`);

const MAX_ASIGNACIONES = 30;
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const mesDe = (mes) => {
  const m = mes === undefined ? mesActual() : mes;
  if (!mesValido(m)) throw fallo("mes debe tener formato YYYY-MM");
  return m;
};

// Copia de los presupuestos con los cambios aplicados: { categoriaId: monto } para `mes`.
const conCambios = (presupuestos, mes, cambios) => {
  const resto = presupuestos.filter((p) => !(p.mes === mes && Object.prototype.hasOwnProperty.call(cambios, p.categoria)));
  Object.keys(cambios).forEach((cat) => {
    if (cambios[cat] > 0) resto.push({ categoria: cat, mes, monto: cambios[cat] });
  });
  return resto;
};

// Estado antes/después de un conjunto de cambios en un mes.
const efecto = (d, mes, cambios) => {
  const excluidas = new Set(d.categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id));
  const nuevos = conCambios(d.presupuestos, mes, cambios);
  return {
    dispAntes: C.disponibleParaAsignar(d.movimientos, d.presupuestos, mes, d.settings, excluidas).disponible,
    dispDespues: C.disponibleParaAsignar(d.movimientos, nuevos, mes, d.settings, excluidas).disponible,
    balAntes: C.balancesCategoria(d.movimientos, d.presupuestos, mes, d.settings, d.cuentas),
    balDespues: C.balancesCategoria(d.movimientos, nuevos, mes, d.settings, d.cuentas),
  };
};

const cero = { asignadoMes: 0, gastadoMes: 0, disponible: 0 };

const avisoDisponible = (dispDespues) =>
  dispDespues < 0 ? "Quedarías asignando " + centsToStr(-dispDespues) + " más de lo que tienes disponible (la app lo permite, pero se pone en rojo)." : undefined;

// Aplica { categoriaId: monto } en la base, en una transacción.
const aplicar = (userId, mes, cambios) => {
  $app.runInTransaction((tx) => {
    Object.keys(cambios).forEach((cat) => guardarPresupuesto(tx, userId, cat, mes, cambios[cat]));
  });
};

// Fila de vista previa para una categoría con su efecto.
const filaPresupuesto = (nombre, id, nuevoMonto, ef) => {
  const a = ef.balAntes[id] || cero;
  const b = ef.balDespues[id] || cero;
  return {
    categoria: nombre,
    asignado_antes: centsToStr(a.asignadoMes),
    asignado_despues: centsToStr(nuevoMonto),
    disponible_acumulado_antes: centsToStr(a.disponible),
    disponible_acumulado_despues: centsToStr(b.disponible),
  };
};

// ---------------------------------------------------------------- herramientas

const asignar_presupuesto = (args, userId) => {
  const mes = mesDe(args.mes);
  const items = args.asignaciones;
  if (!Array.isArray(items) || items.length === 0) throw fallo("asignaciones debe ser una lista con al menos un elemento");
  if (items.length > MAX_ASIGNACIONES) throw fallo("máximo " + MAX_ASIGNACIONES + " asignaciones por llamada");
  const d = cargarDatos(userId);
  const actual = {};
  d.presupuestos.forEach((p) => {
    if (p.mes === mes) actual[p.categoria] = (actual[p.categoria] || 0) + p.monto;
  });

  const errores = [];
  const cambios = {}; // categoriaId -> monto final
  const nombres = {};
  const filas = [];
  items.forEach((it, i) => {
    const n = i + 1;
    const err = (m, c) => errores.push("#" + n + ": " + (c ? m + ". Opciones: " + c.join(", ") : m));
    if (!it || typeof it !== "object" || Array.isArray(it)) return err("cada asignación debe ser un objeto con categoria y monto");
    const cat = resolver(d.categorias, it.categoria, (c) => c.activa && c.tipo === "gasto", "categoría");
    if (!cat.ok) return err(cat.error, cat.candidatos);
    const modo = it.modo === undefined ? "fijar" : it.modo;
    if (modo !== "fijar" && modo !== "sumar") return err('modo debe ser "fijar" o "sumar"');
    let cents;
    try {
      cents = decimalToCents(it.monto);
    } catch (m) {
      return err(String(m));
    }
    if (cents < 0) return err("el monto no puede ser negativo");
    if (modo === "sumar" && cents === 0) return err("sumar 0 no cambia nada");
    if (Object.prototype.hasOwnProperty.call(cambios, cat.ok.id)) return err("la categoría '" + cat.ok.nombre + "' está repetida");
    const final = modo === "sumar" ? (actual[cat.ok.id] || 0) + cents : cents;
    cambios[cat.ok.id] = final;
    nombres[cat.ok.id] = cat.ok.nombre;
  });
  if (errores.length) {
    if (args.confirmar === true) throw fallo("No se guardó nada: " + errores.join("; "));
    return { modo: "vista_previa", guardado: false, errores, siguiente_paso: "Corrige los errores y vuelve a llamar." };
  }

  const ef = efecto(d, mes, cambios);
  Object.keys(cambios).forEach((id) => filas.push(filaPresupuesto(nombres[id], id, cambios[id], ef)));
  const base = {
    mes,
    asignaciones: filas,
    disponible_para_asignar_antes: centsToStr(ef.dispAntes),
    disponible_para_asignar_despues: centsToStr(ef.dispDespues),
    aviso: avisoDisponible(ef.dispDespues),
  };
  if (args.confirmar !== true) {
    return Object.assign({ modo: "vista_previa", guardado: false, siguiente_paso: "Muestra esto al usuario. Si lo aprueba, llama de nuevo con las mismas asignaciones y confirmar=true." }, base);
  }
  aplicar(userId, mes, cambios);
  return Object.assign({ modo: "guardado", guardado: true }, base);
};

const cubrir_sobregastos = (args, userId) => {
  const mes = mesDe(args.mes);
  const d = cargarDatos(userId);
  const bal = C.balancesCategoria(d.movimientos, d.presupuestos, mes, d.settings, d.cuentas);
  const cambios = {};
  const nombres = {};
  d.categorias
    .filter((c) => c.tipo === "gasto" && !c.excluir_presupuesto)
    .forEach((c) => {
      const b = bal[c.id];
      if (b && b.disponible < 0) {
        cambios[c.id] = b.asignadoMes - b.disponible; // lo justo para dejar el disponible acumulado en 0
        nombres[c.id] = c.nombre;
      }
    });
  const ids = Object.keys(cambios);
  if (ids.length === 0) return { mes, guardado: false, mensaje: "No hay categorías en negativo en " + mes + "; no hay nada que cubrir." };

  const ef = efecto(d, mes, cambios);
  const base = {
    mes,
    categorias_cubiertas: ids.map((id) => filaPresupuesto(nombres[id], id, cambios[id], ef)),
    asignado_extra: centsToStr(ids.reduce((a, id) => a + cambios[id] - ((bal[id] || cero).asignadoMes), 0)),
    disponible_para_asignar_antes: centsToStr(ef.dispAntes),
    disponible_para_asignar_despues: centsToStr(ef.dispDespues),
    aviso: avisoDisponible(ef.dispDespues),
  };
  if (args.confirmar !== true) {
    return Object.assign(
      { modo: "vista_previa", guardado: false, siguiente_paso: "Solo sube lo asignado en las categorías en negativo, lo justo para dejarlas en 0; no baja nada. Si el usuario lo aprueba, llama de nuevo con confirmar=true." },
      base
    );
  }
  aplicar(userId, mes, cambios);
  return Object.assign({ modo: "guardado", guardado: true }, base);
};

const copiar_presupuesto = (args, userId) => {
  if (!mesValido(args.mes)) throw fallo("mes (destino) debe tener formato YYYY-MM");
  const mes = args.mes;
  const prev = sumarMes(mes, -1);
  const d = cargarDatos(userId);
  const nombre = {};
  d.categorias.forEach((c) => (nombre[c.id] = c.nombre));
  const origen = d.presupuestos.filter((p) => p.mes === prev);
  if (origen.length === 0) return { mes, guardado: false, mensaje: "No hay presupuestos en " + prev + " para copiar." };

  const cambios = {};
  origen.forEach((p) => (cambios[p.categoria] = (cambios[p.categoria] || 0) + p.monto));
  const actual = {};
  d.presupuestos.forEach((p) => {
    if (p.mes === mes) actual[p.categoria] = (actual[p.categoria] || 0) + p.monto;
  });
  const ef = efecto(d, mes, cambios);
  const base = {
    desde: prev,
    hacia: mes,
    categorias: Object.keys(cambios).map((id) => ({
      categoria: nombre[id] || id,
      monto: centsToStr(cambios[id]),
      reemplaza: actual[id] !== undefined ? centsToStr(actual[id]) : null,
    })),
    disponible_para_asignar_antes: centsToStr(ef.dispAntes),
    disponible_para_asignar_despues: centsToStr(ef.dispDespues),
    aviso: avisoDisponible(ef.dispDespues),
  };
  if (args.confirmar !== true) {
    return Object.assign(
      { modo: "vista_previa", guardado: false, siguiente_paso: "Sobrescribe lo asignado en " + mes + " solo para las categorías que tenían presupuesto en " + prev + ". Si el usuario lo aprueba, llama de nuevo con confirmar=true." },
      base
    );
  }
  aplicar(userId, mes, cambios);
  return Object.assign({ modo: "guardado", guardado: true }, base);
};

// ---------------------------------------------------------------- catálogo

const MES = { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Mes YYYY-MM. Por defecto, el mes actual." };
const CONFIRMAR = { type: "boolean", description: "false o ausente = vista previa; true = guarda." };

const TOOLS = [
  {
    name: "asignar_presupuesto",
    description:
      "Asigna dinero del presupuesto a categorías de gasto en un mes. modo 'fijar' (por defecto) deja ese monto total; 'sumar' lo agrega a lo ya asignado (p. ej. repartir lo que sobra en 'Disponible para asignar'). monto 0 en 'fijar' quita la asignación. En dos pasos: la vista previa muestra el antes/después de cada categoría y del dinero disponible; guarda con confirmar=true.",
    inputSchema: {
      type: "object",
      properties: {
        mes: MES,
        asignaciones: {
          type: "array",
          minItems: 1,
          maxItems: MAX_ASIGNACIONES,
          items: {
            type: "object",
            properties: {
              categoria: { type: "string", description: "Categoría de gasto (nombre o id)." },
              monto: { type: "string", description: 'Monto en la moneda base, p. ej. "120.40".' },
              modo: { type: "string", enum: ["fijar", "sumar"] },
            },
            required: ["categoria", "monto"],
            additionalProperties: false,
          },
        },
        confirmar: CONFIRMAR,
      },
      required: ["asignaciones"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Asignar presupuesto" }, ESCRITURA),
    run: asignar_presupuesto,
  },
  {
    name: "cubrir_sobregastos",
    description:
      "Cubre las categorías que están en negativo (gastaste más de lo que tenían): sube lo asignado este mes justo para dejarlas en 0. Nunca baja nada ni toca categorías con saldo. En dos pasos: vista previa y luego confirmar=true.",
    inputSchema: { type: "object", properties: { mes: MES, confirmar: CONFIRMAR }, additionalProperties: false },
    annotations: Object.assign({ title: "Cubrir sobregastos" }, ESCRITURA),
    run: cubrir_sobregastos,
  },
  {
    name: "copiar_presupuesto",
    description:
      "Copia el presupuesto del mes anterior al mes indicado (sobrescribe lo asignado en las categorías que tenían presupuesto el mes anterior; las demás no se tocan). En dos pasos: vista previa y luego confirmar=true.",
    inputSchema: {
      type: "object",
      properties: { mes: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Mes DESTINO, YYYY-MM." }, confirmar: CONFIRMAR },
      required: ["mes"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Copiar presupuesto del mes anterior" }, ESCRITURA),
    run: copiar_presupuesto,
  },
];

module.exports = { TOOLS };
