import { useState } from "react";
import { useCuentas, useDeleteCuenta, useSaveCuenta } from "../hooks/queries";
import { Modal } from "../components/Modal";
import { formatMoney, parseAmountToCents, centsToInput } from "../lib/money";
import type { Cuenta, Moneda, TipoCuenta } from "../lib/types";

const TIPOS: { v: TipoCuenta; l: string }[] = [
  { v: "monetaria", l: "Monetaria" },
  { v: "ahorro", l: "Ahorro" },
  { v: "tarjeta_credito", l: "Tarjeta de crédito" },
  { v: "efectivo", l: "Efectivo" },
];

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
};

export function Cuentas() {
  const { data: cuentas = [] } = useCuentas();
  const save = useSaveCuenta();
  const del = useDeleteCuenta();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");

  const openEdit = (c: Cuenta) =>
    setForm({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      moneda: c.moneda,
      saldo_inicial: centsToInput(c.saldo_inicial ?? 0),
      limite_credito: centsToInput(c.limite_credito ?? 0),
      dia_corte: c.dia_corte ? String(c.dia_corte) : "",
      dia_pago: c.dia_pago ? String(c.dia_pago) : "",
      activa: c.activa,
    });

  const submit = async () => {
    if (!form) return;
    setError("");
    const saldo = parseAmountToCents(form.saldo_inicial || "0");
    if (Number.isNaN(saldo)) return setError("Saldo inicial inválido");
    const esTC = form.tipo === "tarjeta_credito";
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
    };
    try {
      await save.mutateAsync(payload);
      setForm(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const esTC = form?.tipo === "tarjeta_credito";

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
              <td className="num">{formatMoney(c.saldo_inicial ?? 0, c.moneda)}</td>
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
            <label>Saldo inicial (en {form.moneda})</label>
            <input
              value={form.saldo_inicial}
              onChange={(e) => setForm({ ...form, saldo_inicial: e.target.value })}
            />
          </div>
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
            <button className="primary" onClick={submit} disabled={save.isPending}>
              Guardar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
