import { useState } from "react";
import { useCuentas, useMovimientos, useSettings, useReconcile } from "../hooks/queries";
import type { ReconcileResult } from "../hooks/queries";
import { saldosPorCuenta, patrimonio, type SaldoCuenta } from "../lib/finance";
import { formatMoney, parseAmountToCents, centsToInput } from "../lib/money";
import { Modal } from "../components/Modal";
import { Alertas } from "../components/Alertas";
import type { Moneda } from "../lib/types";

const TIPO_LABEL: Record<string, string> = {
  monetaria: "Monetaria",
  ahorro: "Ahorro",
  tarjeta_credito: "Tarjeta de crédito",
  efectivo: "Efectivo",
};

const hoy = () => new Date().toISOString().slice(0, 10);

export function Dashboard() {
  const cuentas = useCuentas();
  const movimientos = useMovimientos();
  const settings = useSettings();
  const reconcile = useReconcile();

  const [target, setTarget] = useState<SaldoCuenta | null>(null);
  const [saldoReal, setSaldoReal] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [reconError, setReconError] = useState("");
  const [reconResult, setReconResult] = useState<ReconcileResult | null>(null);

  if (cuentas.isLoading || movimientos.isLoading) return <p>Cargando…</p>;

  const saldos = saldosPorCuenta(cuentas.data ?? [], movimientos.data ?? []);
  const pat = patrimonio(saldos, settings.data ?? null);

  const abrirConciliar = (s: SaldoCuenta) => {
    setTarget(s);
    setSaldoReal(centsToInput(s.saldoCleared));
    setFecha(hoy());
    setReconError("");
    setReconResult(null);
  };

  const submitConciliar = async () => {
    if (!target) return;
    setReconError("");
    const cents = parseAmountToCents(saldoReal);
    if (Number.isNaN(cents)) {
      setReconError("Saldo inválido");
      return;
    }
    try {
      const res = await reconcile.mutateAsync({
        cuenta: target.cuenta.id,
        saldo_real: cents,
        fecha,
      });
      setReconResult(res);
    } catch (e: unknown) {
      setReconError(e instanceof Error ? e.message : "Error al conciliar");
    }
  };

  return (
    <div>
      <div className="page-head">
        <h2>Resumen</h2>
      </div>

      <Alertas />

      <div className="card">
        <div className="muted">Patrimonio neto consolidado ({pat.monedaBase})</div>
        <div className="stat">{formatMoney(pat.consolidado, pat.monedaBase)}</div>
        <p className="muted">
          Consolidado con tipo de cambio manual USD→GTQ = {pat.tipoCambioUsd || "—"} (aproximado).
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          {Object.entries(pat.porMoneda).map(([m, cents]) => (
            <div key={m}>
              <div className="muted">Subtotal {m}</div>
              <div className="stat" style={{ fontSize: 18 }}>
                {formatMoney(cents, m as Moneda)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <h3>Saldos por cuenta</h3>
      <div className="grid">
        {saldos
          .filter((s) => s.cuenta.activa)
          .map((s) => {
            const sinConfirmar = s.saldo - s.saldoCleared;
            const moneda = s.cuenta.moneda;
            return (
              <div className="card" key={s.cuenta.id}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{s.cuenta.nombre}</strong>
                  <span className="badge">{moneda}</span>
                </div>
                <div className="muted">{TIPO_LABEL[s.cuenta.tipo]}</div>
                <div className={"stat " + (s.saldo < 0 ? "neg" : "")} style={{ marginTop: 6 }}>
                  {formatMoney(s.saldo, moneda)}
                </div>
                <div className="muted">Saldo de trabajo (todo)</div>

                <div className="recon-lines">
                  <div>
                    Confirmado: <strong>{formatMoney(s.saldoCleared, moneda)}</strong>
                  </div>
                  {sinConfirmar !== 0 && (
                    <div className="muted">Sin confirmar: {formatMoney(sinConfirmar, moneda)}</div>
                  )}
                </div>

                {s.disponible !== null && (
                  <div className="muted">
                    Disponible: {formatMoney(s.disponible, moneda)} · Límite{" "}
                    {formatMoney(s.cuenta.limite_credito ?? 0, moneda)}
                  </div>
                )}

                <div className="recon-foot">
                  {s.cuenta.ultima_conciliacion && (
                    <span className="muted">
                      Conciliada: {s.cuenta.ultima_conciliacion.slice(0, 10)}
                    </span>
                  )}
                  <button className="link" onClick={() => abrirConciliar(s)}>
                    Conciliar
                  </button>
                </div>
              </div>
            );
          })}
        {saldos.length === 0 && <p className="muted">Aún no tienes cuentas. Crea una en “Cuentas”.</p>}
      </div>

      {target && (
        <Modal title={`Conciliar: ${target.cuenta.nombre}`} onClose={() => setTarget(null)}>
          {!reconResult ? (
            <>
              <p className="muted">
                Saldo confirmado (suma de movimientos marcados como confirmados):{" "}
                <strong>{formatMoney(target.saldoCleared, target.cuenta.moneda)}</strong>. Ingresa el
                saldo real que muestra tu banco. Si difiere, se creará un ajuste por la diferencia y
                se bloquearán los confirmados. Lo flotante (sin confirmar) no se toca.
              </p>
              <div className="row">
                <div className="field">
                  <label>Saldo real del banco ({target.cuenta.moneda})</label>
                  <input value={saldoReal} onChange={(e) => setSaldoReal(e.target.value)} />
                </div>
                <div className="field">
                  <label>Fecha</label>
                  <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                </div>
              </div>
              {reconError && <div className="error">{reconError}</div>}
              <div className="modal-actions">
                <button onClick={() => setTarget(null)}>Cancelar</button>
                <button className="primary" onClick={submitConciliar} disabled={reconcile.isPending}>
                  Conciliar
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flash">
                ✓ Conciliación completada.
                {reconResult.diferencia === 0
                  ? ` Sin diferencia. Se bloquearon ${reconResult.reconciliados} movimiento(s) confirmados.`
                  : ` Se creó un ajuste de ${formatMoney(
                      reconResult.diferencia,
                      target.cuenta.moneda
                    )} y se bloquearon los confirmados.`}
              </div>
              <div className="modal-actions">
                <button className="primary" onClick={() => setTarget(null)}>
                  Listo
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
