/// <reference path="../pb_data/types.d.ts" />

// Ayudantes compartidos por las herramientas MCP (mcp_tools*.js). No termina en .pb.js a
// propósito: PocketBase no lo carga como hook, solo se importa con require().
//
// Reglas (iguales a las de la app):
//  - Dinero = enteros en centavos; los montos entran/salen como texto decimal ("45.50").
//  - Todo se limita al usuario del token (MCP_USER_EMAIL).
//  - Escritura en dos pasos: vista previa (por defecto) y luego confirmar=true.
//  - Guardar pasa por los hooks de movimientos.pb.js (moneda, signo, tc_base, etiquetas).

const ACENTOS = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };

// ---------------------------------------------------------------- utilidades

// Error "esperado" de una herramienta: se devuelve al modelo como isError, sin tumbar la ruta.
const fallo = (mensaje) => ({ toolError: mensaje });

const norm = (s) =>
  String(s === undefined || s === null ? "" : s)
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (c) => ACENTOS[c])
    .trim();

const centsToStr = (c) => {
  const neg = c < 0;
  const a = Math.abs(c);
  return (neg ? "-" : "") + Math.floor(a / 100) + "." + String(a % 100).padStart(2, "0");
};

// Monto decimal -> centavos enteros, solo aritmética entera (mismo criterio que /api/import).
const decimalToCents = (raw) => {
  if (raw === undefined || raw === null) throw "monto vacío";
  let s = String(raw).trim();
  if (s === "") throw "monto vacío";
  let neg = false;
  if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^0-9.+-]/g, "");
  if (s.charAt(0) === "-") {
    neg = !neg;
    s = s.slice(1);
  } else if (s.charAt(0) === "+") {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw "monto inválido: " + raw;
  const parts = s.split(".");
  let frac = parts[1] || "";
  if (frac.length > 2) throw "monto con más de 2 decimales: " + raw;
  frac = (frac + "00").slice(0, 2);
  const cents = parseInt(parts[0], 10) * 100 + parseInt(frac, 10);
  return neg ? -cents : cents;
};

// Fecha de hoy en la zona del usuario (el servidor corre en UTC; Guatemala = UTC-6).
const hoy = () => {
  const off = parseInt($os.getenv("MCP_TZ_OFFSET_HOURS") || "-6", 10);
  return new Date(Date.now() + off * 3600 * 1000).toISOString().slice(0, 10);
};

const fechaValida = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const inicioMes = (ymd) => ymd.slice(0, 8) + "01";

// Valida un rango opcional; por defecto: del 1 del mes en curso a hoy.
const rango = (desde, hasta) => {
  const d = desde || inicioMes(hoy());
  const h = hasta || hoy();
  if (!fechaValida(d)) throw fallo("desde debe ser una fecha YYYY-MM-DD válida");
  if (!fechaValida(h)) throw fallo("hasta debe ser una fecha YYYY-MM-DD válida");
  if (d > h) throw fallo("desde no puede ser posterior a hasta");
  return { desde: d, hasta: h };
};

// Conversión a moneda base con el tipo de cambio manual, igual que convertCents() de la app.
const convertir = (cents, de, base, tc) => {
  if (de === base) return cents;
  if (de === "USD" && base === "GTQ") return Math.round(cents * tc);
  if (de === "GTQ" && base === "USD") return tc > 0 ? Math.round(cents / tc) : 0;
  return cents;
};

const parseTags = (t) =>
  String(t || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

// Etiquetas normalizadas igual que el hook de movimientos.pb.js (separadas por espacio o coma,
// sin '#', minúsculas, sin caracteres raros ni repetidas), para que la vista previa muestre
// exactamente lo que se va a guardar.
const normalizarEtiquetas = (raw) => {
  const vistas = {};
  const out = [];
  String(raw === undefined || raw === null ? "" : raw)
    .split(/[\s,]+/)
    .forEach((t) => {
      const limpia = t.replace(/^#+/, "").toLowerCase().replace(/[^a-z0-9_à-ÿ-]/g, "");
      if (limpia && !vistas[limpia]) {
        vistas[limpia] = true;
        out.push(limpia);
      }
    });
  return out;
};

// ---------------------------------------------------------------- datos del usuario

const cargarContexto = (userId) => {
  const p = { u: userId };
  const cuentas = $app.findRecordsByFilter("cuentas", "usuario = {:u}", "nombre", 0, 0, p).map((r) => ({
    id: r.id,
    nombre: r.getString("nombre"),
    tipo: r.getString("tipo"),
    moneda: r.getString("moneda"),
    activa: r.getBool("activa"),
    saldoInicial: r.getInt("saldo_inicial"),
  }));
  const grupos = $app.findRecordsByFilter("grupos", "usuario = {:u}", "orden", 0, 0, p).map((r) => ({
    id: r.id,
    nombre: r.getString("nombre"),
  }));
  const nombreGrupo = {};
  grupos.forEach((g) => (nombreGrupo[g.id] = g.nombre));
  const categorias = $app.findRecordsByFilter("categorias", "usuario = {:u}", "orden,nombre", 0, 0, p).map((r) => ({
    id: r.id,
    nombre: r.getString("nombre"),
    tipo: r.getString("tipo"),
    grupoId: r.getString("grupo"),
    grupo: nombreGrupo[r.getString("grupo")] || "",
    activa: r.getBool("activa"),
    excluida: r.getBool("excluir_presupuesto"),
  }));
  let monedaBase = "GTQ";
  let tc = 0;
  try {
    const s = $app.findFirstRecordByFilter("settings", "usuario = {:u}", p);
    monedaBase = s.getString("moneda_base") || "GTQ";
    tc = s.getFloat("tipo_cambio_usd");
  } catch (_) {}
  const porId = (lista) => {
    const m = {};
    lista.forEach((x) => (m[x.id] = x));
    return m;
  };
  return {
    userId,
    cuentas,
    categorias,
    grupos,
    cuentaPorId: porId(cuentas),
    categoriaPorId: porId(categorias),
    monedaBase,
    tc,
  };
};

// Movimientos NO eliminados en un rango de fechas (ambos extremos incluidos).
const movimientosEnRango = (userId, desde, hasta, extraFiltro, extraParams, eliminados) => {
  const params = { u: userId, d: desde, h: hasta + " 23:59:59.999Z", e: eliminados === true };
  for (const k in extraParams || {}) params[k] = extraParams[k];
  return $app.findRecordsByFilter(
    "movimientos",
    "usuario = {:u} && eliminado = {:e} && fecha >= {:d} && fecha <= {:h}" + (extraFiltro ? " && " + extraFiltro : ""),
    "-fecha,-created",
    0,
    0,
    params
  );
};

const aFila = (r, ctx) => {
  const cuenta = ctx.cuentaPorId[r.getString("cuenta")];
  const cat = ctx.categoriaPorId[r.getString("categoria")];
  return {
    id: r.id,
    fecha: r.getString("fecha").slice(0, 10),
    tipo: r.getString("tipo"),
    monto: centsToStr(r.getInt("monto")),
    moneda: r.getString("moneda"),
    cuenta: cuenta ? cuenta.nombre : null,
    categoria: cat ? cat.nombre : null,
    descripcion: r.getString("descripcion"),
    etiquetas: parseTags(r.getString("tags")),
    confirmado: r.getBool("conciliado"),
    bloqueado: r.getBool("reconciliado"),
  };
};

// Resuelve una cuenta/categoría por id o nombre (sin acentos ni mayúsculas, coincidencia exacta
// o por subcadena única). Devuelve { ok } o { error, candidatos }.
const resolver = (lista, ref, filtro, etiqueta) => {
  const q = norm(ref);
  if (!q) return { error: etiqueta + " vacía" };
  const pool = lista.filter(filtro);
  const nombres = (arr) => arr.map((x) => x.nombre);
  const porId = pool.filter((x) => x.id === String(ref).trim());
  if (porId.length === 1) return { ok: porId[0] };
  const exacta = pool.filter((x) => norm(x.nombre) === q);
  if (exacta.length === 1) return { ok: exacta[0] };
  if (exacta.length > 1) return { error: etiqueta + " ambigua", candidatos: nombres(exacta) };
  const parcial = pool.filter((x) => norm(x.nombre).indexOf(q) !== -1);
  if (parcial.length === 1) return { ok: parcial[0] };
  if (parcial.length > 1) return { error: etiqueta + " ambigua", candidatos: nombres(parcial).slice(0, 8) };
  return { error: etiqueta + ' no encontrada: "' + ref + '"', candidatos: nombres(pool).slice(0, 12) };
};


// ---------------------------------------------------------------- registros -> objetos planos
// Mismos nombres de campo que la API/frontend, para pasarlos a mcp_calculos.js.

const mapCuenta = (r) => ({
  id: r.id,
  nombre: r.getString("nombre"),
  tipo: r.getString("tipo"),
  moneda: r.getString("moneda"),
  activa: r.getBool("activa"),
  saldo_inicial: r.getInt("saldo_inicial"),
  tc_base_inicial: r.getFloat("tc_base_inicial"),
  limite_credito: r.getInt("limite_credito"),
  categoria_pago: r.getString("categoria_pago"),
});
const mapCategoria = (r) => ({
  id: r.id,
  nombre: r.getString("nombre"),
  tipo: r.getString("tipo"),
  grupo: r.getString("grupo"),
  orden: r.getInt("orden"),
  activa: r.getBool("activa"),
  excluir_presupuesto: r.getBool("excluir_presupuesto"),
});
const mapMovimiento = (r) => ({
  id: r.id,
  fecha: r.getString("fecha"),
  cuenta: r.getString("cuenta"),
  categoria: r.getString("categoria"),
  tipo: r.getString("tipo"),
  monto: r.getInt("monto"),
  moneda: r.getString("moneda"),
  tc_base: r.getFloat("tc_base"),
  conciliado: r.getBool("conciliado"),
  ingreso_proximo_mes: r.getBool("ingreso_proximo_mes"),
  tags: r.getString("tags"),
  eliminado: r.getBool("eliminado"),
});
const mapPresupuesto = (r) => ({ id: r.id, categoria: r.getString("categoria"), mes: r.getString("mes"), monto: r.getInt("monto") });

// Todo lo del usuario para los cálculos de presupuesto/patrimonio (movimientos incluye eliminados, con su flag).
const cargarDatos = (userId) => {
  const p = { u: userId };
  const todos = (col, orden) => $app.findRecordsByFilter(col, "usuario = {:u}", orden, 0, 0, p);
  let settings = null;
  try {
    const s = $app.findFirstRecordByFilter("settings", "usuario = {:u}", p);
    settings = { moneda_base: s.getString("moneda_base") || "GTQ", tipo_cambio_usd: s.getFloat("tipo_cambio_usd") };
  } catch (_) {}
  return {
    cuentas: todos("cuentas", "nombre").map(mapCuenta),
    categorias: todos("categorias", "orden,nombre").map(mapCategoria),
    grupos: todos("grupos", "orden").map((r) => ({ id: r.id, nombre: r.getString("nombre"), orden: r.getInt("orden") })),
    movimientos: todos("movimientos", "").map(mapMovimiento),
    presupuestos: todos("presupuestos", "").map(mapPresupuesto),
    settings,
  };
};

// ---------------------------------------------------------------- escritura

// Carga un movimiento del usuario por id; devuelve el Record o lanza un error de herramienta.
const movimientoDelUsuario = (userId, id) => {
  let r;
  try {
    r = $app.findRecordById("movimientos", String(id));
  } catch (_) {
    throw fallo("movimiento no encontrado: " + id);
  }
  if (r.getString("usuario") !== userId) throw fallo("movimiento no encontrado: " + id);
  return r;
};

// Guarda o actualiza el presupuesto de una categoría en un mes (monto 0 = quitarlo), como /api/budget/set.
const guardarPresupuesto = (tx, userId, categoriaId, mes, monto) => {
  let existente = null;
  try {
    existente = tx.findFirstRecordByFilter("presupuestos", "usuario = {:u} && categoria = {:c} && mes = {:m}", { u: userId, c: categoriaId, m: mes });
  } catch (_) {}
  if (monto === 0) {
    if (existente) tx.delete(existente);
    return;
  }
  if (existente) {
    existente.set("monto", monto);
    tx.save(existente);
    return;
  }
  const r = new Record($app.findCollectionByNameOrId("presupuestos"));
  r.set("usuario", userId);
  r.set("categoria", categoriaId);
  r.set("mes", mes);
  r.set("monto", monto);
  tx.save(r);
};

// ---------------------------------------------------------------- meses

const mesValido = (s) => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const mesActual = () => hoy().slice(0, 7);
const sumarMes = (ym, n) => {
  const d = new Date(Date.UTC(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 1 + n, 1));
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
};
const finDeMes = (ym) => {
  const d = new Date(Date.UTC(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10), 0));
  return ym + "-" + String(d.getUTCDate()).padStart(2, "0");
};

module.exports = {
  fallo,
  norm,
  centsToStr,
  decimalToCents,
  hoy,
  fechaValida,
  inicioMes,
  rango,
  convertir,
  parseTags,
  normalizarEtiquetas,
  cargarContexto,
  movimientosEnRango,
  aFila,
  resolver,
  mapCuenta,
  mapCategoria,
  mapMovimiento,
  mapPresupuesto,
  cargarDatos,
  movimientoDelUsuario,
  guardarPresupuesto,
  mesValido,
  mesActual,
  sumarMes,
  finDeMes,
};
