/// <reference path="../pb_data/types.d.ts" />

// Servidor MCP (Model Context Protocol) dentro de PocketBase: permite que Claude (u otro
// cliente MCP) consulte y registre movimientos hablando con esta app.
//
//   POST /api/mcp   JSON-RPC 2.0 sobre HTTP ("Streamable HTTP" sin estado: cada petición es
//                   independiente, responde JSON, sin sesiones ni SSE).
//   GET  /api/mcp   405 (no ofrecemos stream de eventos).
//
// Seguridad: la ruta está APAGADA (404) mientras no existan estas dos variables de entorno
// (en Fly: `fly secrets set MCP_TOKEN=... MCP_USER_EMAIL=...`):
//   MCP_TOKEN        secreto aleatorio de al menos 32 caracteres; el cliente lo envía como
//                    "Authorization: Bearer <token>". Se compara en tiempo constante.
//   MCP_USER_EMAIL   correo del usuario de la app sobre cuyos datos opera el token.
// Opcional: MCP_TZ_OFFSET_HOURS (por defecto -6, Guatemala) para calcular "hoy".
//
// Las herramientas viven en mcp_tools.js. No existe ninguna para borrar, resetear,
// exportar la base ni importar.
//
// NOTA: en PocketBase los handlers corren en un runtime aislado y no ven el scope del módulo,
// por eso todo va DENTRO del handler.

routerAdd("GET", "/api/mcp", (e) => {
  e.response.header().set("Allow", "POST");
  return e.json(405, { error: "method not allowed" });
});

routerAdd("POST", "/api/mcp", (e) => {
  const token = $os.getenv("MCP_TOKEN") || "";
  const email = $os.getenv("MCP_USER_EMAIL") || "";
  if (token.length < 32 || !email) return e.json(404, { error: "not found" }); // apagado

  const auth = e.request.header.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  // Sin cabecera WWW-Authenticate a propósito: no usamos OAuth y no queremos que el cliente lo intente.
  if (!m || !$security.equal(m[1].trim(), token)) return e.json(401, { error: "unauthorized" });

  let user;
  try {
    user = $app.findAuthRecordByEmail("users", email);
  } catch (_) {
    $app.logger().error("MCP: MCP_USER_EMAIL no corresponde a ningún usuario");
    return e.json(500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "servidor mal configurado" } });
  }

  let body;
  try {
    body = JSON.parse(toString(e.request.body));
  } catch (_) {
    return e.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
  }

  const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
  const INSTRUCCIONES =
    "Esta app lleva las finanzas personales del usuario (cuentas, categorías, movimientos y presupuesto). " +
    "Responde en español. Para registrar movimientos usa siempre registrar_movimientos en dos pasos: " +
    "primero la vista previa, enséñasela al usuario y guarda (confirmar=true) solo si la aprueba. " +
    "Nunca inventes montos, cuentas ni categorías: si falta algo o es ambiguo, pregunta. " +
    "Al leer una factura o captura, copia fecha, monto y comercio tal cual aparecen y avisa si algo no se lee bien. " +
    "Los montos van en positivo; el tipo (gasto o ingreso) define el signo.";

  const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
  const rpcOk = (id, result) => ({ jsonrpc: "2.0", id: id, result: result });

  // Procesa un mensaje JSON-RPC. Devuelve la respuesta, o null si no corresponde (notificaciones).
  const procesar = (msg) => {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      return rpcError(null, -32600, "petición inválida");
    }
    const esNotificacion = msg.id === undefined || msg.id === null;
    if (typeof msg.method !== "string") return null; // respuesta de cliente u otro: se ignora
    if (esNotificacion) return null; // notifications/initialized, cancelled, etc.

    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    switch (msg.method) {
      case "initialize": {
        const pedida = String(params.protocolVersion || "");
        return rpcOk(msg.id, {
          protocolVersion: SUPPORTED.indexOf(pedida) !== -1 ? pedida : SUPPORTED[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "nomoreexcel", title: "NoMoreExcel", version: "0.1.0" },
          instructions: INSTRUCCIONES,
        });
      }
      case "ping":
        return rpcOk(msg.id, {});
      case "tools/list": {
        const tools = require(`${__hooks}/mcp_tools.js`).TOOLS;
        return rpcOk(msg.id, {
          tools: tools.map((t) => ({
            name: t.name,
            title: t.annotations && t.annotations.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        });
      }
      case "tools/call": {
        const tools = require(`${__hooks}/mcp_tools.js`).TOOLS;
        const tool = tools.filter((t) => t.name === params.name)[0];
        if (!tool) return rpcError(msg.id, -32602, "herramienta desconocida: " + params.name);
        const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
        try {
          const out = tool.run(args, user.id);
          return rpcOk(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false });
        } catch (err) {
          if (err && typeof err === "object" && typeof err.toolError === "string") {
            return rpcOk(msg.id, { content: [{ type: "text", text: err.toolError }], isError: true });
          }
          // Error inesperado: al cliente un mensaje genérico, el detalle al log del servidor.
          $app.logger().error("MCP: fallo en la herramienta " + tool.name, "error", String(err));
          return rpcOk(msg.id, { content: [{ type: "text", text: "Error interno al ejecutar la herramienta." }], isError: true });
        }
      }
      default:
        return rpcError(msg.id, -32601, "método no soportado: " + msg.method);
    }
  };

  if (Array.isArray(body)) {
    if (body.length === 0) return e.json(400, rpcError(null, -32600, "lote vacío"));
    const respuestas = body.map(procesar).filter((r) => r !== null);
    if (respuestas.length === 0) return e.noContent(202);
    return e.json(200, respuestas);
  }
  const respuesta = procesar(body);
  if (respuesta === null) return e.noContent(202);
  return e.json(200, respuesta);
});
