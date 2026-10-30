import { useEffect, useRef, useState } from "react";
import type { BalanceCategoria } from "../lib/finance";
import { centsToInput, formatMoney, parseAmountToCents } from "../lib/money";
import type { Categoria, Moneda } from "../lib/types";

export interface GrupoMovil {
  id: string;
  nombre: string;
  cats: Categoria[];
}

/**
 * Presupuesto en móvil: lista de categorías con letra grande (sin tabla). Tocar una
 * categoría abre un panel inferior para editar lo asignado, con atajos.
 */
export function PresupuestoMovil({
  grupos,
  bal,
  base,
  asignadoMesAnterior,
  guardando,
  onGuardar,
  onVerMovimientos,
}: {
  grupos: GrupoMovil[];
  bal: (id: string) => BalanceCategoria;
  base: Moneda;
  asignadoMesAnterior: Map<string, number>;
  guardando: boolean;
  onGuardar: (categoriaId: string, monto: number) => Promise<unknown>;
  onVerMovimientos: (categoriaId: string) => void;
}) {
  const [editando, setEditando] = useState<Categoria | null>(null);

  return (
    <div className="bm">
      {grupos.map((g) => {
        let gdisp = 0;
        for (const c of g.cats) gdisp += bal(c.id).disponible;
        return (
          <section key={g.id} className="bm-grupo">
            <div className="bm-grupo-head">
              <span>{g.nombre}</span>
              <span className={gdisp < 0 ? "neg" : ""}>{formatMoney(gdisp, base)}</span>
            </div>
            {g.cats.map((c) => {
              const b = bal(c.id);
              const inicio = b.disponible + b.gastadoMes; // disponible al inicio del mes
              const pct = inicio > 0 ? Math.min(100, (b.gastadoMes / inicio) * 100) : b.gastadoMes > 0 ? 100 : 0;
              return (
                <button key={c.id} className="bm-cat" onClick={() => setEditando(c)}>
                  <span className="bm-cat-top">
                    <span className="bm-nombre">{c.nombre}</span>
                    <span className={"bm-pill " + (b.disponible < 0 ? "neg" : b.disponible > 0 ? "pos" : "cero")}>
                      {formatMoney(b.disponible, base)}
                    </span>
                  </span>
                  <span className="bm-cat-sub">
                    Asignado {formatMoney(b.asignadoMes, base)} · Gastado {formatMoney(b.gastadoMes, base)}
                  </span>
                  <span className="budget-track">
                    <span
                      className={"budget-fill" + (b.disponible < 0 ? " over" : "")}
                      style={{ width: `${pct}%`, display: "block" }}
                    />
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}

      {editando && (
        <EditorAsignado
          cat={editando}
          b={bal(editando.id)}
          base={base}
          anterior={asignadoMesAnterior.get(editando.id) ?? 0}
          guardando={guardando}
          onCerrar={() => setEditando(null)}
          onGuardar={async (monto) => {
            await onGuardar(editando.id, monto);
            setEditando(null);
          }}
          onVerMovimientos={() => onVerMovimientos(editando.id)}
        />
      )}
    </div>
  );
}

function EditorAsignado({
  cat,
  b,
  base,
  anterior,
  guardando,
  onCerrar,
  onGuardar,
  onVerMovimientos,
}: {
  cat: Categoria;
  b: BalanceCategoria;
  base: Moneda;
  anterior: number;
  guardando: boolean;
  onCerrar: () => void;
  onGuardar: (monto: number) => Promise<void>;
  onVerMovimientos: () => void;
}) {
  const [valor, setValor] = useState(b.asignadoMes ? centsToInput(b.asignadoMes) : "");
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const cents = valor.trim() === "" ? 0 : parseAmountToCents(valor);
  const valido = !Number.isNaN(cents) && cents >= 0;
  // nuevo disponible = disponible actual − asignado actual + nuevo asignado
  const nuevoDisp = valido ? b.disponible - b.asignadoMes + cents : null;
  const cubrir = b.asignadoMes - b.disponible; // asignado que deja el disponible en 0

  const atajos: { label: string; monto: number }[] = [];
  if (b.disponible < 0) atajos.push({ label: "Cubrir negativo", monto: cubrir });
  if (b.gastadoMes > 0) atajos.push({ label: "Lo gastado", monto: b.gastadoMes });
  if (anterior > 0) atajos.push({ label: "Mes anterior", monto: anterior });
  atajos.push({ label: "0", monto: 0 });
  // sin botones repetidos con el mismo monto
  const atajosUnicos = atajos.filter((a, i) => atajos.findIndex((x) => x.monto === a.monto) === i);

  const guardar = async () => {
    if (!valido) return setError("Monto inválido");
    setError("");
    try {
      await onGuardar(cents);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onCerrar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>{cat.nombre}</strong>
          <button className="link" onClick={onVerMovimientos}>
            Ver movimientos
          </button>
        </div>
        <div className="sheet-stats">
          <span>Gastado: {formatMoney(b.gastadoMes, base)}</span>
          <span>
            Disponible:{" "}
            <strong className={nuevoDisp !== null && nuevoDisp < 0 ? "neg" : "pos"}>
              {nuevoDisp === null ? "—" : formatMoney(nuevoDisp, base)}
            </strong>
          </span>
        </div>
        <label className="muted">Asignado este mes ({base})</label>
        <input
          ref={ref}
          className="sheet-input"
          value={valor}
          placeholder="0.00"
          inputMode="decimal"
          enterKeyHint="done"
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar()}
        />
        <div className="sheet-chips">
          {atajosUnicos.map((a) => (
            <button key={a.label} onClick={() => setValor(centsToInput(a.monto))}>
              {a.label}
              {a.monto > 0 && <small> {formatMoney(a.monto, base)}</small>}
            </button>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="sheet-actions">
          <button onClick={onCerrar}>Cancelar</button>
          <button className="primary" onClick={guardar} disabled={guardando || !valido}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
