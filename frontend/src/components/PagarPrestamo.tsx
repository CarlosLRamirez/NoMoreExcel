import { useState } from "react";
import { usePagarPrestamo } from "../hooks/queries";
import { estadoPrestamo, type SaldoCuenta } from "../lib/finance";
import { centsToInput, formatMoney, parseAmountToCents } from "../lib/money";
import { Modal } from "./Modal";

const hoy = () => new Date().toISOString().slice(0, 10);

/**
 * Registrar el pago de una cuota: la parte de capital es una transferencia hacia el préstamo
 * (baja la deuda) y la de interés un gasto; ambas cuentan en la categoría de pago del préstamo.
 */
export function PagarPrestamo({
  prestamo,
  saldos,
  onClose,
}: {
  prestamo: SaldoCuenta;
  saldos: SaldoCuenta[];
  onClose: () => void;
}) {
  const c = prestamo.cuenta;
  const est = estadoPrestamo(c, prestamo.saldo);
  const pagar = usePagarPrestamo();

  // Última cuota: no pagar más que la deuda + interés.
  const sugerido = Math.min(c.cuota || est.deuda + est.interesEstimado, est.deuda + est.interesEstimado);
  const origenes = saldos.filter(
    (s) => s.cuenta.activa && s.cuenta.tipo !== "prestamo" && s.cuenta.moneda === c.moneda
  );

  const [origen, setOrigen] = useState(origenes[0]?.cuenta.id ?? "");
  const [fecha, setFecha] = useState(hoy());
  const [monto, setMonto] = useState(centsToInput(sugerido));
  const [interes, setInteres] = useState(centsToInput(est.interesEstimado));
  const [error, setError] = useState("");
  const [listo, setListo] = useState<number | null>(null);

  const montoC = parseAmountToCents(monto);
  const interesC = parseAmountToCents(interes || "0");
  const capital = !Number.isNaN(montoC) && !Number.isNaN(interesC) ? montoC - interesC : NaN;

  const submit = async () => {
    setError("");
    if (!origen) return setError(`No hay una cuenta activa en ${c.moneda} desde la cual pagar`);
    if (Number.isNaN(montoC) || montoC <= 0) return setError("Monto inválido");
    if (Number.isNaN(interesC) || interesC < 0) return setError("Interés inválido");
    if (capital < 0) return setError("El interés no puede ser mayor que el monto");
    if (capital > est.deuda) return setError(`El abono a capital excede la deuda (${formatMoney(est.deuda, c.moneda)})`);
    try {
      const res = await pagar.mutateAsync({ prestamo: c.id, cuenta_origen: origen, fecha, monto: montoC, interes: interesC });
      setListo(res.deuda_restante);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo registrar el pago");
    }
  };

  return (
    <Modal title={`Pagar cuota: ${c.nombre}`} onClose={onClose}>
      {listo !== null ? (
        <>
          <div className="flash">
            ✓ Pago registrado.{" "}
            {listo === 0 ? "¡Préstamo saldado!" : `Deuda restante: ${formatMoney(listo, c.moneda)}.`}
          </div>
          <div className="modal-actions">
            <button className="primary" onClick={onClose}>
              Listo
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            Deuda pendiente: <strong>{formatMoney(est.deuda, c.moneda)}</strong>.
            {!c.categoria_pago && " Este préstamo no tiene categoría de pago: no se reflejará en el presupuesto."}
          </p>
          <div className="row">
            <div className="field">
              <label>Pagar desde</label>
              <select value={origen} onChange={(e) => setOrigen(e.target.value)}>
                {origenes.map((s) => (
                  <option key={s.cuenta.id} value={s.cuenta.id}>
                    {s.cuenta.nombre} ({formatMoney(s.saldo, s.cuenta.moneda)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Monto pagado ({c.moneda})</label>
              <input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" />
            </div>
            <div className="field">
              <label>De eso, interés</label>
              <input value={interes} onChange={(e) => setInteres(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <p className="muted">
            Abono a capital: <strong>{Number.isNaN(capital) ? "—" : formatMoney(capital, c.moneda)}</strong>
            {c.tasa_anual ? ` · interés estimado ${formatMoney(est.interesEstimado, c.moneda)} (${c.tasa_anual}% anual)` : ""}
          </p>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={onClose}>Cancelar</button>
            <button className="primary" onClick={submit} disabled={pagar.isPending}>
              Registrar pago
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
