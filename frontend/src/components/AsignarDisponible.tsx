import { useMemo, useState } from "react";
import type { BalanceCategoria } from "../lib/finance";
import { centsToInput, formatMoney, parseAmountToCents } from "../lib/money";
import type { Categoria, Moneda } from "../lib/types";

export interface GrupoCats {
  id: string;
  nombre: string;
  cats: Categoria[];
}

/** Reparte `total` centavos en `n` partes enteras; los centavos sobrantes van a las primeras. */
export function repartir(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const resto = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * "Asignar lo disponible": reparte lo que queda en "Disponible para asignar" entre una o
 * varias categorías elegidas (en partes iguales, editables). Suma a lo ya asignado este mes.
 */
export function AsignarDisponible({
  disponible,
  base,
  mesLabel,
  grupos,
  bal,
  guardando,
  onAsignar,
  onCerrar,
}: {
  disponible: number; // centavos > 0
  base: Moneda;
  mesLabel: string;
  grupos: GrupoCats[];
  bal: (id: string) => BalanceCategoria;
  guardando: boolean;
  onAsignar: (items: { categoria: string; monto: number }[]) => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [error, setError] = useState("");

  const nombre = useMemo(() => {
    const m = new Map<string, string>();
    grupos.forEach((g) => g.cats.forEach((c) => m.set(c.id, c.nombre)));
    return m;
  }, [grupos]);

  // Al cambiar la selección se vuelve a repartir todo en partes iguales.
  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    const partes = repartir(disponible, next.length);
    setSel(next);
    setMontos(Object.fromEntries(next.map((x, i) => [x, centsToInput(partes[i])])));
    setError("");
  };

  const cents = sel.map((id) => parseAmountToCents(montos[id] || "0"));
  const invalido = cents.some((c) => Number.isNaN(c) || c < 0);
  const suma = invalido ? 0 : cents.reduce((a, c) => a + c, 0);
  const resta = disponible - suma;

  const q = busca.trim().toLowerCase();
  const filtrados = grupos
    .map((g) => ({ ...g, cats: g.cats.filter((c) => !q || c.nombre.toLowerCase().includes(q)) }))
    .filter((g) => g.cats.length > 0);

  const guardar = async () => {
    if (sel.length === 0) return setError("Elige al menos una categoría");
    if (invalido) return setError("Hay un monto inválido");
    if (resta < 0) return setError(`Te pasas por ${formatMoney(-resta, base)} de lo disponible`);
    setError("");
    try {
      await onAsignar(
        sel
          .map((id, i) => ({ categoria: id, monto: bal(id).asignadoMes + cents[i] }))
          .filter((_, i) => cents[i] > 0)
      );
      onCerrar();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo asignar");
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onCerrar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Asignar lo disponible</strong>
          <span className="pos">{formatMoney(disponible, base)}</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Elige una o varias categorías. Se suma a lo ya asignado en {mesLabel}.
        </p>

        {sel.length > 0 && (
          <div className="ad-sel">
            {sel.map((id) => (
              <div key={id} className="ad-fila">
                <button className="link" onClick={() => toggle(id)} title="Quitar">
                  ✕
                </button>
                <span className="ad-nombre">{nombre.get(id)}</span>
                <input
                  value={montos[id] ?? ""}
                  inputMode="decimal"
                  onChange={(e) => setMontos({ ...montos, [id]: e.target.value })}
                />
              </div>
            ))}
            <div className={"ad-resta " + (resta < 0 ? "neg" : "")}>
              {resta === 0
                ? "✓ Todo repartido"
                : resta > 0
                  ? `Quedan ${formatMoney(resta, base)} sin asignar`
                  : `Te pasas por ${formatMoney(-resta, base)}`}
            </div>
          </div>
        )}

        <input
          className="rr-desc"
          value={busca}
          placeholder="Buscar categoría…"
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="ad-lista">
          {filtrados.map((g) => (
            <div key={g.id || "_"}>
              <div className="ad-grupo">{g.nombre}</div>
              {g.cats.map((c) => (
                <label key={c.id} className="ad-cat">
                  <input
                    type="checkbox"
                    checked={sel.includes(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span>{c.nombre}</span>
                  <span className={"ad-disp " + (bal(c.id).disponible < 0 ? "neg" : "muted")}>
                    {formatMoney(bal(c.id).disponible, base)}
                  </span>
                </label>
              ))}
            </div>
          ))}
          {filtrados.length === 0 && <p className="muted">Sin resultados.</p>}
        </div>

        {error && <div className="error">{error}</div>}
        <div className="sheet-actions">
          <button onClick={onCerrar}>Cancelar</button>
          <button className="primary" onClick={guardar} disabled={guardando || sel.length === 0}>
            Asignar
          </button>
        </div>
      </div>
    </div>
  );
}
