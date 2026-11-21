import { useState } from "react";
import { parseTags } from "../lib/finance";
import { formatMoney } from "../lib/money";
import type { Categoria, Cuenta, Movimiento } from "../lib/types";

const PAGINA = 60;

// Etiqueta del día ("Hoy", "Ayer", "mié, 19 nov") con la fecha LOCAL: no se parsea el
// "YYYY-MM-DD" como UTC, que en Guatemala corre el día.
function etiquetaDia(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const f = new Date(y, m - 1, d);
  const hoy = new Date();
  const h0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const diff = Math.round((h0.getTime() - f.getTime()) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  const s = f.toLocaleDateString("es-GT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(y !== hoy.getFullYear() ? { year: "numeric" as const } : {}),
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Lista de movimientos para móvil: tarjetas agrupadas por día en vez de tabla. El círculo de
 * la izquierda confirma/desconfirma (para revisar contra el banco); tocar la tarjeta abre el
 * detalle con las acciones (editar, eliminar, ir a la otra pata de una transferencia).
 */
export function MovimientosMovil({
  movs,
  cuentaMap,
  catMap,
  flujo,
  highlightId,
  onToggle,
  onEdit,
  onDelete,
  onJump,
  onTag,
}: {
  movs: Movimiento[]; // ya filtrados y ordenados por fecha descendente
  cuentaMap: Map<string, Cuenta>;
  catMap: Map<string, Categoria>;
  flujo: (m: Movimiento) => { origenNombre: string; destinoNombre: string };
  highlightId: string | null;
  onToggle: (id: string, conciliado: boolean) => void;
  onEdit: (m: Movimiento) => void;
  onDelete: (m: Movimiento) => void;
  onJump: (m: Movimiento) => void;
  onTag: (tag: string) => void;
}) {
  const [limite, setLimite] = useState(PAGINA);
  const [sel, setSel] = useState<Movimiento | null>(null);

  // Si se salta a la otra pata de una transferencia, asegurar que quede dentro de lo visible.
  const idxResaltado = highlightId ? movs.findIndex((m) => m.id === highlightId) : -1;
  const visibles = movs.slice(0, Math.max(limite, idxResaltado + 1));

  const datos = (m: Movimiento) => {
    const cuenta = cuentaMap.get(m.cuenta)?.nombre ?? "—";
    const categoria = m.categoria ? catMap.get(m.categoria)?.nombre ?? "—" : "";
    if (m.tipo === "transferencia") {
      const f = flujo(m);
      return {
        titulo: `${f.origenNombre} → ${f.destinoNombre}`,
        sub: m.descripcion ? `Transferencia · ${m.descripcion}` : "Transferencia",
        cuenta,
        categoria,
      };
    }
    return {
      titulo: m.descripcion || categoria || "(sin categoría)",
      sub: [m.descripcion ? categoria : "", cuenta, m.ingreso_proximo_mes ? "para el próximo mes" : ""]
        .filter(Boolean)
        .join(" · "),
      cuenta,
      categoria,
    };
  };

  const claseMonto = (m: Movimiento) => (m.tipo === "transferencia" ? "" : m.monto < 0 ? "neg" : "pos");

  const grupos: { dia: string; items: Movimiento[] }[] = [];
  for (const m of visibles) {
    const dia = (m.fecha || "").slice(0, 10);
    const ult = grupos[grupos.length - 1];
    if (ult && ult.dia === dia) ult.items.push(m);
    else grupos.push({ dia, items: [m] });
  }

  return (
    <div className="mv">
      {grupos.map((g) => (
        <section key={g.dia}>
          <div className="mv-dia">{g.dia ? etiquetaDia(g.dia) : "Sin fecha"}</div>
          {g.items.map((m) => {
            const d = datos(m);
            const tags = parseTags(m.tags);
            return (
              <div
                key={m.id}
                id={`mov-${m.id}`}
                className={"mv-card" + (highlightId === m.id ? " row-highlight" : "")}
              >
                <button
                  className={"mv-check" + (m.reconciliado ? " lock" : m.conciliado ? " on" : "")}
                  disabled={m.reconciliado}
                  aria-label={
                    m.reconciliado ? "Conciliado" : m.conciliado ? "Quitar confirmación" : "Marcar como confirmado"
                  }
                  onClick={() => onToggle(m.id, !m.conciliado)}
                >
                  <span className="mv-dot">{m.reconciliado ? "🔒" : m.conciliado ? "✓" : ""}</span>
                </button>
                <button className="mv-body" onClick={() => setSel(m)}>
                  <span className="mv-top">
                    <span className="mv-titulo">{d.titulo}</span>
                    <span className={"mv-monto " + claseMonto(m)}>{formatMoney(m.monto, m.moneda)}</span>
                  </span>
                  <span className="mv-sub">{d.sub}</span>
                  {tags.length > 0 && (
                    <span className="mv-tags">
                      {tags.map((t) => (
                        <span key={t} className="badge">
                          #{t}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </section>
      ))}

      {movs.length === 0 && <p className="muted">Sin movimientos.</p>}
      {visibles.length < movs.length && (
        <button className="mv-mas" onClick={() => setLimite(visibles.length + PAGINA)}>
          Mostrar más ({movs.length - visibles.length} restantes)
        </button>
      )}

      {sel && (
        <div className="sheet-backdrop" onClick={() => setSel(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>{datos(sel).titulo}</strong>
              <span className={"mv-monto " + claseMonto(sel)}>{formatMoney(sel.monto, sel.moneda)}</span>
            </div>
            <dl className="mv-det">
              <dt>Fecha</dt>
              <dd>{(sel.fecha || "").slice(0, 10)}</dd>
              <dt>Cuenta</dt>
              <dd>{datos(sel).cuenta}</dd>
              {sel.tipo !== "transferencia" && (
                <>
                  <dt>Categoría</dt>
                  <dd>{datos(sel).categoria || "—"}</dd>
                </>
              )}
              {sel.descripcion && (
                <>
                  <dt>Descripción</dt>
                  <dd>{sel.descripcion}</dd>
                </>
              )}
              {sel.notas && (
                <>
                  <dt>Notas</dt>
                  <dd>{sel.notas}</dd>
                </>
              )}
              <dt>Estado</dt>
              <dd>{sel.reconciliado ? "🔒 Conciliado" : sel.conciliado ? "✓ Confirmado" : "Sin confirmar"}</dd>
            </dl>
            {parseTags(sel.tags).length > 0 && (
              <div className="sheet-chips">
                {parseTags(sel.tags).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      onTag(t);
                      setSel(null);
                    }}
                    title="Filtrar por esta etiqueta"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            )}
            <div className="sheet-actions">
              {!sel.reconciliado && (
                <button
                  onClick={() => {
                    onToggle(sel.id, !sel.conciliado);
                    setSel(null);
                  }}
                >
                  {sel.conciliado ? "Quitar confirmación" : "Marcar confirmado"}
                </button>
              )}
              {sel.tipo === "transferencia" && (
                <button
                  onClick={() => {
                    onJump(sel);
                    setSel(null);
                  }}
                >
                  Ver otra pata ↗
                </button>
              )}
            </div>
            <div className="sheet-actions">
              <button
                className="danger"
                onClick={() => {
                  const m = sel;
                  setSel(null);
                  onDelete(m);
                }}
              >
                Eliminar
              </button>
              <button
                className="primary"
                onClick={() => {
                  const m = sel;
                  setSel(null);
                  onEdit(m);
                }}
              >
                Editar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
