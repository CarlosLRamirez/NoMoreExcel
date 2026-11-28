/// <reference path="../pb_data/types.d.ts" />

// Herramientas MCP para crear cuentas y categorías (lo que se hace en Cuentas y Categorías de la app).
// Dos pasos: vista previa (por defecto) y confirmar=true. No hay herramientas para editar ni borrar
// cuentas o categorías, ni para crear préstamos o grupos: eso se hace en la app.

const { fallo, norm, centsToStr, decimalToCents, cargarDatos, resolver } = require(`${__hooks}/mcp_util.js`);

const TIPOS_CUENTA = ["monetaria", "ahorro", "efectivo", "tarjeta_credito"];
const ESCRITURA = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const nombreValido = (s) => {
  const n = String(s === undefined || s === null ? "" : s).trim();
  if (!n) throw fallo("el nombre es obligatorio");
  if (n.length > 255) throw fallo("el nombre excede 255 caracteres");
  return n;
};

const diaValido = (v, campo) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 31) throw fallo(campo + " debe ser un entero entre 1 y 31");
  return n;
};

const crear_cuenta = (args, userId) => {
  const d = cargarDatos(userId);
  const nombre = nombreValido(args.nombre);
  if (d.cuentas.some((c) => norm(c.nombre) === norm(nombre))) throw fallo('ya existe una cuenta llamada "' + nombre + '"');
  if (TIPOS_CUENTA.indexOf(args.tipo) === -1) throw fallo("tipo debe ser uno de: " + TIPOS_CUENTA.join(", ") + " (los préstamos se crean en la app)");
  const moneda = args.moneda === undefined ? (d.settings && d.settings.moneda_base) || "GTQ" : args.moneda;
  if (moneda !== "GTQ" && moneda !== "USD") throw fallo('moneda debe ser "GTQ" o "USD"');
  const esTarjeta = args.tipo === "tarjeta_credito";
  let saldo = 0;
  let limite = null;
  try {
    if (args.saldo_inicial !== undefined && args.saldo_inicial !== null && args.saldo_inicial !== "") saldo = decimalToCents(args.saldo_inicial);
    if (args.limite_credito !== undefined && args.limite_credito !== null && args.limite_credito !== "") limite = decimalToCents(args.limite_credito);
  } catch (m) {
    throw fallo(String(m));
  }
  if (!esTarjeta && (limite !== null || args.dia_corte !== undefined || args.dia_pago !== undefined)) {
    throw fallo("limite_credito, dia_corte y dia_pago solo aplican a tarjetas de crédito");
  }
  if (limite !== null && limite < 0) throw fallo("limite_credito no puede ser negativo");
  const diaCorte = diaValido(args.dia_corte, "dia_corte");
  const diaPago = diaValido(args.dia_pago, "dia_pago");

  const vista = {
    nombre,
    tipo: args.tipo,
    moneda,
    saldo_inicial: centsToStr(saldo),
    limite_credito: limite === null ? null : centsToStr(limite),
    dia_corte: diaCorte,
    dia_pago: diaPago,
  };
  if (args.confirmar !== true) {
    return {
      modo: "vista_previa",
      guardado: false,
      cuenta: vista,
      siguiente_paso:
        "Muestra esto al usuario. El saldo inicial es lo que la cuenta tiene hoy (en una tarjeta, lo que se debe va en negativo). Si lo aprueba, llama de nuevo con confirmar=true.",
    };
  }
  const r = new Record($app.findCollectionByNameOrId("cuentas"));
  r.set("usuario", userId);
  r.set("nombre", nombre);
  r.set("tipo", args.tipo);
  r.set("moneda", moneda);
  r.set("saldo_inicial", saldo);
  if (esTarjeta) {
    r.set("limite_credito", limite === null ? 0 : limite);
    if (diaCorte !== null) r.set("dia_corte", diaCorte);
    if (diaPago !== null) r.set("dia_pago", diaPago);
  }
  r.set("activa", true);
  $app.save(r);
  return { modo: "guardado", guardado: true, id: r.id, cuenta: vista };
};

const crear_categoria = (args, userId) => {
  const d = cargarDatos(userId);
  const nombre = nombreValido(args.nombre);
  if (args.tipo !== "gasto" && args.tipo !== "ingreso") throw fallo('tipo debe ser "gasto" o "ingreso"');
  if (d.categorias.some((c) => c.tipo === args.tipo && norm(c.nombre) === norm(nombre))) throw fallo('ya existe una categoría de ' + args.tipo + ' llamada "' + nombre + '"');
  let grupo = null;
  if (args.grupo !== undefined && args.grupo !== null && args.grupo !== "") {
    const g = resolver(d.grupos, args.grupo, () => true, "grupo");
    if (!g.ok) throw fallo(g.error + (g.candidatos ? ". Opciones: " + g.candidatos.join(", ") + " (los grupos nuevos se crean en la app)" : ""));
    grupo = g.ok;
  }
  const hermanas = d.categorias.filter((c) => (grupo ? c.grupo === grupo.id : !c.grupo));
  const orden = hermanas.reduce((m, c) => Math.max(m, c.orden || 0), -1) + 1;
  const vista = { nombre, tipo: args.tipo, grupo: grupo ? grupo.nombre : null };
  if (args.confirmar !== true) {
    return { modo: "vista_previa", guardado: false, categoria: vista, siguiente_paso: "Muestra esto al usuario. Si lo aprueba, llama de nuevo con confirmar=true." };
  }
  const r = new Record($app.findCollectionByNameOrId("categorias"));
  r.set("usuario", userId);
  r.set("nombre", nombre);
  r.set("tipo", args.tipo);
  if (grupo) r.set("grupo", grupo.id);
  r.set("orden", orden);
  r.set("activa", true);
  r.set("excluir_presupuesto", false);
  $app.save(r);
  return { modo: "guardado", guardado: true, id: r.id, categoria: vista };
};

const CONFIRMAR = { type: "boolean", description: "false o ausente = vista previa; true = crea." };

const TOOLS = [
  {
    name: "crear_cuenta",
    description:
      "Crea una cuenta (monetaria, ahorro, efectivo o tarjeta de crédito). El saldo inicial es lo que tiene hoy; en una tarjeta, lo que se debe va en negativo. No crea préstamos. En dos pasos: vista previa y luego confirmar=true.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        tipo: { type: "string", enum: TIPOS_CUENTA },
        moneda: { type: "string", enum: ["GTQ", "USD"], description: "Por defecto, la moneda base." },
        saldo_inicial: { type: "string", description: 'Saldo de hoy, p. ej. "1500.00" (negativo si se debe).' },
        limite_credito: { type: "string", description: "Solo tarjetas." },
        dia_corte: { type: "integer", minimum: 1, maximum: 31, description: "Solo tarjetas." },
        dia_pago: { type: "integer", minimum: 1, maximum: 31, description: "Solo tarjetas." },
        confirmar: CONFIRMAR,
      },
      required: ["nombre", "tipo"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Crear cuenta" }, ESCRITURA),
    run: crear_cuenta,
  },
  {
    name: "crear_categoria",
    description:
      "Crea una categoría de gasto o de ingreso, opcionalmente dentro de un grupo que ya exista. En dos pasos: vista previa y luego confirmar=true.",
    inputSchema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        tipo: { type: "string", enum: ["gasto", "ingreso"] },
        grupo: { type: "string", description: "Nombre de un grupo existente (opcional)." },
        confirmar: CONFIRMAR,
      },
      required: ["nombre", "tipo"],
      additionalProperties: false,
    },
    annotations: Object.assign({ title: "Crear categoría" }, ESCRITURA),
    run: crear_categoria,
  },
];

module.exports = { TOOLS };
