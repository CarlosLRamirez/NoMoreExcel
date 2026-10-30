import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAllPresupuestos,
  useCategorias,
  useCuentas,
  useGrupos,
  useMovimientos,
  useSaveMovimiento,
  useSettings,
} from "../hooks/queries";
import { balancesCategoria } from "../lib/finance";
import { formatMoney, parseAmountToCents } from "../lib/money";
import type { Categoria, TipoCategoria } from "../lib/types";

const KEY_CUENTA = "nme_ult_cuenta";

// Fecha local (no UTC: en Guatemala, después de las 18:00 toISOString() ya es mañana).
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const leer = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const guardarLocal = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // sin almacenamiento: solo no se recuerda la cuenta
  }
};

/** Botón flotante "+" y panel para registrar gastos/ingresos del día a día en pocos toques. */
export function RegistroRapido() {
  const [abierto, setAbierto] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <>
      <button className="fab" onClick={() => setAbierto(true)} aria-label="Registrar gasto">
        +
      </button>
      {toast && <div className="toast">{toast}</div>}
      {abierto && <PanelRegistro onCerrar={() => setAbierto(false)} onGuardado={setToast} />}
    </>
  );
}

function PanelRegistro({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: (msg: string) => void }) {
  const { data: cuentas = [] } = useCuentas();
  const { data: categorias = [] } = useCategorias();
  const { data: grupos = [] } = useGrupos();
  const { data: movimientos = [] } = useMovimientos();
  const { data: presupuestos = [] } = useAllPresupuestos();
  const { data: settings } = useSettings();
  const save = useSaveMovimiento();

  const cuentasActivas = cuentas.filter((c) => c.activa && c.tipo !== "prestamo");
  const [tipo, setTipo] = useState<TipoCategoria>("gasto");
  const [monto, setMonto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [cuenta, setCuenta] = useState(leer(KEY_CUENTA));
  const [fecha, setFecha] = useState(hoyLocal());
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState("");
  const montoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    montoRef.current?.focus();
  }, []);

  // cuenta por defecto: la última usada si sigue activa, si no la primera
  const cuentaSel = cuentasActivas.some((c) => c.id === cuenta) ? cuenta : cuentasActivas[0]?.id ?? "";
  const moneda = cuentasActivas.find((c) => c.id === cuentaSel)?.moneda ?? "GTQ";

  const catsTipo = categorias.filter((c) => c.activa && c.tipo === tipo);

  // Atajos: las categorías más usadas en los últimos 60 días para este tipo.
  const frecuentes = useMemo(() => {
    const desde = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const conteo = new Map<string, number>();
    for (const m of movimientos) {
      if (m.eliminado || m.tipo !== tipo || (m.fecha || "") < desde) continue;
      conteo.set(m.categoria, (conteo.get(m.categoria) ?? 0) + 1);
    }
    const ids = new Set(catsTipo.filter((c) => !c.excluir_presupuesto).map((c) => c.id));
    const top = [...conteo.entries()].filter(([id]) => ids.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const relleno = catsTipo.filter((c) => !c.excluir_presupuesto && !top.includes(c.id)).map((c) => c.id);
    return [...top, ...relleno].slice(0, 6).map((id) => catsTipo.find((c) => c.id === id)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movimientos, categorias, tipo]);

  // Agrupadas para el selector completo.
  const porGrupo = useMemo(() => {
    const out: { nombre: string; cats: Categoria[] }[] = [];
    for (const g of [...grupos].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))) {
      const cats = catsTipo.filter((c) => c.grupo === g.id);
      if (cats.length) out.push({ nombre: g.nombre, cats });
    }
    const sueltas = catsTipo.filter((c) => !grupos.some((g) => g.id === c.grupo));
    if (sueltas.length) out.push({ nombre: "Sin grupo", cats: sueltas });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, categorias, tipo]);

  const cents = parseAmountToCents(monto);
  const montoOk = !Number.isNaN(cents) && cents > 0;

  // Disponible de la categoría este mes (en moneda base) y cómo queda tras este gasto.
  const mes = fecha.slice(0, 7);
  const base = settings?.moneda_base ?? "GTQ";
  const disp =
    tipo === "gasto" && categoria
      ? balancesCategoria(movimientos, presupuestos, mes, settings ?? null, cuentas).get(categoria)?.disponible ?? 0
      : null;

  const cambiarTipo = (t: TipoCategoria) => {
    setTipo(t);
    setCategoria("");
  };

  const guardar = async (otro: boolean) => {
    setError("");
    if (!montoOk) return setError("Escribe un monto mayor que 0");
    if (!categoria) return setError("Elige una categoría");
    if (!cuentaSel) return setError("No tienes cuentas activas");
    try {
      await save.mutateAsync({
        fecha,
        cuenta: cuentaSel,
        tipo,
        categoria,
        monto: tipo === "gasto" ? -cents : cents,
        descripcion: descripcion.trim(),
      });
      guardarLocal(KEY_CUENTA, cuentaSel);
      const nombre = categorias.find((c) => c.id === categoria)?.nombre ?? "";
      const msg = `✓ ${tipo === "gasto" ? "Gasto" : "Ingreso"} de ${formatMoney(cents, moneda)} en ${nombre}`;
      if (otro) {
        onGuardado(msg);
        setMonto("");
        setDescripcion("");
        setCategoria("");
        montoRef.current?.focus();
      } else {
        onGuardado(msg);
        onCerrar();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <div className="sheet-backdrop" onClick={onCerrar}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button className={tipo === "gasto" ? "active" : ""} onClick={() => cambiarTipo("gasto")}>
            Gasto
          </button>
          <button className={tipo === "ingreso" ? "active" : ""} onClick={() => cambiarTipo("ingreso")}>
            Ingreso
          </button>
        </div>

        <input
          ref={montoRef}
          className="sheet-input"
          value={monto}
          placeholder="0.00"
          inputMode="decimal"
          enterKeyHint="done"
          aria-label="Monto"
          onChange={(e) => setMonto(e.target.value)}
        />

        <div className="sheet-chips">
          {frecuentes.map((c) => (
            <button key={c.id} className={categoria === c.id ? "active" : ""} onClick={() => setCategoria(c.id)}>
              {c.nombre}
            </button>
          ))}
        </div>
        <select
          className="rr-select"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          aria-label="Categoría"
        >
          <option value="">Otra categoría…</option>
          {porGrupo.map((g) => (
            <optgroup key={g.nombre} label={g.nombre}>
              {g.cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {disp !== null && (
          <p className="rr-disp">
            Disponible: {formatMoney(disp, base)}
            {montoOk && moneda === base && (
              <>
                {" → "}
                <strong className={disp - cents < 0 ? "neg" : "pos"}>{formatMoney(disp - cents, base)}</strong>
              </>
            )}
          </p>
        )}

        <div className="rr-fila">
          <select value={cuentaSel} onChange={(e) => setCuenta(e.target.value)} aria-label="Cuenta">
            {cuentasActivas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
        </div>
        <input
          className="rr-desc"
          value={descripcion}
          placeholder="Descripción (opcional)"
          onChange={(e) => setDescripcion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && guardar(false)}
        />

        {error && <div className="error">{error}</div>}
        <div className="sheet-actions">
          <button onClick={() => guardar(true)} disabled={save.isPending}>
            Guardar y otro
          </button>
          <button className="primary" onClick={() => guardar(false)} disabled={save.isPending}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
