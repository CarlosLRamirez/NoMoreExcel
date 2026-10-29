import { useState } from "react";
import {
  useCategorias,
  useCuentas,
  useDeleteCuenta,
  useGrupos,
  useSaveCategoria,
  useSaveCuenta,
} from "../hooks/queries";
import { Modal } from "../components/Modal";
import { formatMoney, parseAmountToCents, centsToInput } from "../lib/money";
import type { Cuenta, Moneda, TipoCuenta } from "../lib/types";

const TIPOS: { v: TipoCuenta; l: string }[] = [
  { v: "monetaria", l: "Monetaria" },
  { v: "ahorro", l: "Ahorro" },
  { v: "tarjeta_credito", l: "Tarjeta de crédito" },
  { v: "efectivo", l: "Efectivo" },
  { v: "prestamo", l: "Préstamo" },
];

// Valor especial del select de categoría de pago: crear una categoría nueva para el préstamo.
const NUEVA_CAT = "__nueva__";

interface FormState {
  id?: string;
  nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  saldo_inicial: string;
  limite_credito: string;
  dia_corte: string;
  dia_pago: string;
  activa: boolean;
  // préstamo
  monto_original: string;
  cuota: string;
  tasa_anual: string;
  categoria_pago: string;
}

const empty: FormState = {
  nombre: "",
  tipo: "monetaria",
  moneda: "GTQ",
  saldo_inicial: "0",
  limite_credito: "0",
  dia_corte: "",
  dia_pago: "",
  activa: true,
  monto_original: "",
  cuota: "",
  tasa_anual: "",
  categoria_pago: NUEVA_CAT,
};

export function Cuentas() {
  const { data: cuentas = [] } = useCuentas();
  const save = useSaveCuenta();
  const del = useDeleteCuenta();
  const { data: categorias = [] } = useCategorias();
  const { data: grupos = [] } = useGrupos();
  const saveCat = useSaveCategoria();
  const catsGasto = categorias.filter((c) => c.tipo === "gasto");
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");

  const openEdit = (c: Cuenta) =>
    setForm({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      moneda: c.moneda,
      // en préstamos se edita la deuda en positivo (se guarda negativa)
      saldo_inicial: centsToInput(c.tipo === "prestamo" ? -(c.saldo_inicial ?? 0) : c.saldo_inicial ?? 0),
      limite_credito: centsToInput(c.limite_credito ?? 0),
      dia_corte: c.dia_corte ? String(c.dia_corte) : "",
      dia_pago: c.dia_pago ? String(c.dia_pago) : "",
      activa: c.activa,
      monto_original: c.monto_original ? centsToInput(c.monto_original) : "",
      cuota: c.cuota ? centsToInput(c.cuota) : "",
      tasa_anual: c.tasa_anual ? String(c.tasa_anual) : "",
      categoria_pago: c.categoria_pago || "",
    });

  const submit = async () => {
    if (!form) return;
    setError("");
    let saldo = parseAmountToCents(form.saldo_inicial || "0");
    if (Number.isNaN(saldo)) return setError("Saldo inicial inválido");
    const esTC = form.tipo === "tarjeta_credito";
    const esPrestamo = form.tipo === "prestamo";
    const prestamo: Partial<Cuenta> = {};
    if (esPrestamo) {
      if (saldo < 0) return setError("La deuda pendiente se escribe en positivo");
      saldo = -saldo;
      const original = parseAmountToCents(form.monto_original || "0");
      const cuota = parseAmountToCents(form.cuota || "0");
      const tasa = Number(form.tasa_anual || "0");
      if (Number.isNaN(original) || original < 0) return setError("Monto original inválido");
      if (Number.isNaN(cuota) || cuota < 0) return setError("Cuota inválida");
      if (Number.isNaN(tasa) || tasa < 0) return setError("Tasa inválida");
      prestamo.monto_original = original || -saldo;
      prestamo.cuota = cuota;
      prestamo.tasa_anual = tasa;
      prestamo.categoria_pago = form.categoria_pago === NUEVA_CAT ? "" : form.categoria_pago;
    }
    const payload: Partial<Cuenta> & { id?: string } = {
      id: form.id,
      nombre: form.nombre,
      tipo: form.tipo,
      moneda: form.moneda,
      saldo_inicial: saldo,
      activa: form.activa,
      limite_credito: esTC ? parseAmountToCents(form.limite_credito || "0") : null,
      dia_corte: esTC && form.dia_corte ? Number(form.dia_corte) : null,
      dia_pago: esTC && form.dia_pago ? Number(form.dia_pago) : null,
      ...prestamo,
    };
    try {
      if (esPrestamo && form.categoria_pago === NUEVA_CAT) {
        // Categoría de gasto propia para presupuestar la cuota, en el grupo "Financiero" si existe.
        const grupo = grupos.find((g) => g.nombre === "Financiero");
        const cat = await saveCat.mutateAsync({
          nombre: `Préstamo ${form.nombre}`.trim(),
          tipo: "gasto",
          grupo: grupo?.id ?? "",
          activa: true,
        });
        payload.categoria_pago = cat.id;
        setForm({ ...form, categoria_pago: cat.id }); // si el guardado falla, no se duplica al reintentar
      }
      await save.mutateAsync(payload);
      setForm(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const esTC = form?.tipo === "tarjeta_credito";
  const esPrestamo = form?.tipo === "prestamo";

  return (
    <div>
      <div className="page-head">
        <h2>Cuentas</h2>
        <button className="primary" onClick={() => setForm({ ...empty })}>
          + Nueva cuenta
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Moneda</th>
            <th className="num">Saldo inicial</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {cuentas.map((c) => (
            <tr key={c.id}>
              <td>{c.nombre}</td>
              <td>{TIPOS.find((t) => t.v === c.tipo)?.l}</td>
              <td>{c.moneda}</td>
              <td className="num">
                {formatMoney(c.saldo_inicial ?? 0, c.moneda)}
                {c.tipo === "prestamo" && c.cuota ? (
                  <div className="muted">Cuota {formatMoney(c.cuota, c.moneda)}</div>
                ) : null}
              </td>
              <td>{c.activa ? "Activa" : <span className="muted">Inactiva</span>}</td>
              <td className="num">
                <button className="link" onClick={() => openEdit(c)}>
                  Editar
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(`¿Eliminar la cuenta "${c.nombre}"? (debe no tener movimientos)`))
                      del.mutate(c.id);
                  }}
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
          {cuentas.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Sin cuentas todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {form && (
        <Modal title={form.id ? "Editar cuenta" : "Nueva cuenta"} onClose={() => setForm(null)}>
          <div className="field">
            <label>Nombre</label>
            <input
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoCuenta })}
              >
                {TIPOS.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Moneda</label>
              <select
                value={form.moneda}
                onChange={(e) => setForm({ ...form, moneda: e.target.value as Moneda })}
              >
                <option value="GTQ">GTQ</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>
              {esPrestamo ? `Deuda pendiente hoy (en ${form.moneda})` : `Saldo inicial (en ${form.moneda})`}
            </label>
            <input
              value={form.saldo_inicial}
              onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
            />
            {esPrestamo && (
              <span className="muted">
                Lo que debes hoy, en positivo. Los pagos que registres después lo van bajando.
              </span>
            )}
          </div>
          {esPrestamo && (
            <>
              <div className="row">
                <div className="field">
                  <label>Monto original</label>
                  <input
                    value={form.monto_original}
                    placeholder="= deuda pendiente"
                    onChange={(e) => setForm({ ...form, monto_original: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Cuota mensual</label>
                  <input
                    value={form.cuota}
                    onChange={(e) => setForm({ ...form, cuota: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label>Tasa anual %</label>
                  <input
                    value={form.tasa_anual}
                    placeholder="opcional"
                    onChange={(e) => setForm({ ...form, tasa_anual: e.target.value })}
                  />
                </div>
              </div>
              <div className="field">
                <label>Categoría de pago (presupuesto)</label>
                <select
                  value={form.categoria_pago}
                  onChange={(e) => setForm({ ...form, categoria_pago: e.target.value })}
                >
                  <option value={NUEVA_CAT}>+ Crear “Préstamo {form.nombre || "…"}”</option>
                  <option value="">(ninguna)</option>
                  {catsGasto.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
                <span className="muted">
                  Asigna la cuota a esta categoría cada mes en Presupuesto; cada pago cuenta como
                  gastado en ella.
                </span>
              </div>
            </>
          )}
          {esTC && (
            <div className="row">
              <div className="field">
                <label>Límite de crédito</label>
                <input
                  value={form.limite_credito}
                  onChange={(e) => setForm({ ...form, limite_credito: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Día corte</label>
                <input
                  value={form.dia_corte}
                  onChange={(e) => setForm({ ...form, dia_corte: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Día pago</label>
                <input
                  value={form.dia_pago}
                  onChange={(e) => setForm({ ...form, dia_pago: e.target.value })}
                />
              </div>
            </div>
          )}
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={form.activa}
                style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setForm({ ...form, activa: e.target.checked })}
              />
              Activa
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setForm(null)}>Cancelar</button>
            <button className="primary" onClick={submit} disabled={save.isPending || saveCat.isPending}>
              Guardar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
