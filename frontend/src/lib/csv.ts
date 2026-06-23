import type { Cuenta, Categoria, Movimiento } from "./types";
import { centsToInput } from "./money";

// Columnas canónicas del CSV (orden fijo).
export const CSV_COLUMNS = [
  "fecha",
  "cuenta",
  "categoria",
  "tipo",
  "monto",
  "descripcion",
  "transfer_id",
  "conciliado",
  "reconciliado",
  "ingreso_proximo_mes",
  "tags",
  "notas",
] as const;

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

function escapeField(v: string): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Exporta movimientos (no eliminados) al esquema CSV; monto como decimal legible. */
export function exportToCsv(
  movimientos: Movimiento[],
  cuentas: Map<string, Cuenta>,
  categorias: Map<string, Categoria>
): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const m of movimientos) {
    if (m.eliminado) continue;
    const fila: CsvRow = {
      fecha: (m.fecha || "").slice(0, 10),
      cuenta: cuentas.get(m.cuenta)?.nombre ?? "",
      categoria: m.categoria ? categorias.get(m.categoria)?.nombre ?? "" : "",
      tipo: m.tipo,
      monto: centsToInput(m.monto),
      descripcion: m.descripcion || "",
      transfer_id: m.transfer_id || "",
      conciliado: m.conciliado ? "true" : "false",
      reconciliado: m.reconciliado ? "true" : "false",
      ingreso_proximo_mes: m.ingreso_proximo_mes ? "true" : "false",
      tags: m.tags || "",
      notas: m.notas || "",
    };
    lines.push(CSV_COLUMNS.map((c) => escapeField(fila[c])).join(","));
  }
  return lines.join("\n");
}

/**
 * CSV de ejemplo/plantilla que muestra el formato esperado por la importación.
 * Incluye un ingreso, un gasto y una transferencia balanceada (dos patas con el
 * mismo transfer_id). Los nombres de `cuenta`/`categoria` deben existir ya en tu
 * cuenta antes de importar (no se crean automáticamente).
 */
export function exampleCsv(): string {
  const rows: CsvRow[] = [
    {
      fecha: "2026-06-01",
      cuenta: "Banco GTQ",
      categoria: "Sueldo",
      tipo: "ingreso",
      monto: "15000.00",
      descripcion: "Salario de junio",
      transfer_id: "",
      conciliado: "false",
      reconciliado: "false",
      ingreso_proximo_mes: "false",
      tags: "",
      notas: "",
    },
    {
      fecha: "2026-06-03",
      cuenta: "Banco GTQ",
      categoria: "Comida",
      tipo: "gasto",
      monto: "-85.50",
      descripcion: "Supermercado",
      transfer_id: "",
      conciliado: "true",
      reconciliado: "false",
      ingreso_proximo_mes: "false",
      tags: "#ejemplo",
      notas: "compra semanal",
    },
    {
      fecha: "2026-06-08",
      cuenta: "Banco GTQ",
      categoria: "",
      tipo: "transferencia",
      monto: "-500.00",
      descripcion: "Retiro a efectivo",
      transfer_id: "TRANSFER-1",
      conciliado: "false",
      reconciliado: "false",
      ingreso_proximo_mes: "false",
      tags: "",
      notas: "",
    },
    {
      fecha: "2026-06-08",
      cuenta: "Efectivo",
      categoria: "",
      tipo: "transferencia",
      monto: "500.00",
      descripcion: "Retiro a efectivo",
      transfer_id: "TRANSFER-1",
      conciliado: "false",
      reconciliado: "false",
      ingreso_proximo_mes: "false",
      tags: "",
      notas: "",
    },
  ];
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => escapeField(r[c])).join(","));
  return lines.join("\n");
}

// ---- Export del presupuesto mensual ----
export interface PresupuestoCsvRow {
  nivel: "TOTAL" | "GRUPO" | "CATEGORIA";
  grupo: string;
  categoria: string;
  presupuesto: number; // centavos
  gastado: number; // centavos
  disponible: number; // centavos
}

/** Genera el CSV del presupuesto de un mes (montos como decimal legible en moneda_base). */
export function presupuestoToCsv(mes: string, moneda: string, filas: PresupuestoCsvRow[]): string {
  const cols = ["mes", "moneda", "nivel", "grupo", "categoria", "presupuesto", "gastado", "disponible"];
  const lines = [cols.join(",")];
  for (const f of filas) {
    lines.push(
      [
        mes,
        moneda,
        f.nivel,
        f.grupo,
        f.categoria,
        centsToInput(f.presupuesto),
        centsToInput(f.gastado),
        centsToInput(f.disponible),
      ]
        .map(escapeField)
        .join(",")
    );
  }
  return lines.join("\n");
}

/** Parser CSV mínimo que respeta comillas dobles y comas/saltos escapados. */
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const t = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQuotes) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // último campo/fila
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Convierte texto CSV a filas-objeto usando el encabezado. */
export function csvToRows(text: string): CsvRow[] {
  const matrix = parseCsvText(text);
  if (matrix.length === 0) return [];
  const header = matrix[0].map((h) => h.trim());
  return matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (cells[i] ?? "").trim();
    });
    return obj as CsvRow;
  });
}
