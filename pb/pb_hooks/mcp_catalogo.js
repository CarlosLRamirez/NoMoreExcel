/// <reference path="../pb_data/types.d.ts" />

// Catálogo de herramientas MCP: reúne los módulos mcp_tools*.js. Para agregar una herramienta,
// ponla en el módulo que le corresponda (o crea uno y súmalo aquí).

const MODULOS = [
  "mcp_tools.js", // cuentas, categorías, búsqueda, gasto por categoría, registrar movimientos
  "mcp_tools_lectura.js", // resúmenes y reportes
  "mcp_tools_movimientos.js", // transferencias, editar, eliminar, restaurar, confirmar
  "mcp_tools_presupuesto.js", // asignar, cubrir sobregastos, copiar mes
  "mcp_tools_prestamos.js", // pagar cuota
  "mcp_tools_catalogos.js", // crear cuenta y categoría
];

const TOOLS = [];
const vistos = {};
MODULOS.forEach((f) => {
  require(`${__hooks}/${f}`).TOOLS.forEach((t) => {
    if (vistos[t.name]) throw new Error("herramienta MCP repetida: " + t.name);
    vistos[t.name] = true;
    TOOLS.push(t);
  });
});

module.exports = { TOOLS };
