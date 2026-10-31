import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useAllPresupuestos,
  useCategorias,
  useCuentas,
  useMovimientos,
  useSettings,
  useReconcile,
} from "../hooks/queries";
import type { ReconcileResult } from "../hooks/queries";
import {
  saldosPorCuenta,
  patrimonio,
  estadoPrestamo,
  disponibleParaAsignar,
  balancesCategoria,
  gastoAcumuladoPorDia,
  convertCents,
  type SaldoCuenta,
} from "../lib/finance";
import { GastoMesChart } from "../components/GastoMesChart";
import { formatMoney, parseAmountToCents, centsToInput } from "../lib/money";
import { Modal } from "../components/Modal";
import { Alertas } from "../components/Alertas";
import { PagarPrestamo } from "../components/PagarPrestamo";
import type { Moneda } from "../lib/types";

const TIPO_LABEL: Record<string, string> = {
  monetaria: "Monetaria",
  ahorro: "Ahorro",
  tarjeta_credito: "Tarjeta de crédito",
  efectivo: "Efectivo",
  prestamo: "Préstamo",
};

const hoy = () => new Date().toISOString().slice(0, 10);

// Fecha local (no UTC) para saber en qué día del mes estamos.
const ymdLocal = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Agrupación de cuentas para el resumen plegable.
const GRUPO_CUENTA: Record<string, string> = {
  monetaria: "Bancos y efectivo",
  ahorro: "Bancos y efectivo",
  efectivo: "Bancos y efectivo",
  tarjeta_credito: "Tarjetas de crédito",
  prestamo: "Préstamos",
};

const KEY_CUENTAS_ABIERTO = "nme_resumen_cuentas";
const leerAbierto = () => {
  try {
    return localStorage.getItem(KEY_CUENTAS_ABIERTO) === "1";
  } catch {
    return false;
  }
};

export function Dashboard() {
  const cuentas = useCuentas();
  const movimientos = useMovimientos();
  const settings = useSettings();
  const { data: categorias = [] } = useCategorias();
  const { data: presupuestos = [] } = useAllPresupuestos();
  const reconcile = useReconcile();
  const [cuentasAbierto, setCuentasAbierto] = useState(leerAbierto);

  const [target, setTarget] = useState<SaldoCuenta | null>(null);
  const [saldoReal, setSaldoReal] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [reconError, setReconError] = useState("");
  const [reconResult, setReconResult] = useState<ReconcileResult | null>(null);
  const [pagando, setPagando] = useState<SaldoCuenta | null>(null);

  if (cuentas.isLoading || movimientos.isLoading) return <p>Cargando…</p>;

  const saldos = saldosPorCuenta(cuentas.data ?? [], movimientos.data ?? []);
  const pat = patrimonio(saldos, settings.data ?? null, movimientos.data ?? []);

  // ---- vistazo del mes actual ----
  const st = settings.data ?? null;
  const movs = movimientos.data ?? [];
  const base = pat.monedaBase;
  const fechaHoy = ymdLocal();
  const mes = fechaHoy.slice(0, 7);
  const diaHoy = Number(fechaHoy.slice(8, 10));
  const prevDate = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 2, 1);
  const mesPrev = ymdLocal(prevDate).slice(0, 7);
  const excluidas = new Set(categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id));
  const disp = disponibleParaAsignar(movs, presupuestos, mes, st, excluidas);
  const acumulado = gastoAcumuladoPorDia(movs, mes, st, excluidas);
  const acumuladoPrev = gastoAcumuladoPorDia(movs, mesPrev, st, excluidas);
  const catGasto = new Set(categorias.filter((c) => c.tipo === "gasto" && !c.excluir_presupuesto).map((c) => c.id));
  const asignadoMes = presupuestos
    .filter((p) => p.mes === mes && catGasto.has(p.categoria))
    .reduce((a, p) => a + p.monto, 0);
  const gastadoHoy = acumulado[diaHoy - 1] ?? 0;
  const pctMes = Math.round((diaHoy / acumulado.length) * 100);
  const pctGastado = asignadoMes > 0 ? Math.round((gastadoHoy / asignadoMes) * 100) : null;
  const ritmoHoy = asignadoMes > 0 ? Math.round((asignadoMes * diaHoy) / acumulado.length) : 0;
  const prevMismoDia = acumuladoPrev[Math.min(diaHoy, acumuladoPrev.length) - 1] ?? 0;

  // Top 5 categorías por gasto del mes (criterio del presupuesto: incluye abonos a préstamos).
  const bal = balancesCategoria(movs, presupuestos, mes, st, cuentas.data ?? []);
  const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
  const top = [...bal.entries()]
    .filter(([id, b]) => catGasto.has(id) && b.gastadoMes > 0)
    .sort((a, b) => b[1].gastadoMes - a[1].gastadoMes)
    .slice(0, 5);
  const [yy, mm] = mes.split("-").map(Number);
  const finMes = `${mes}-${String(new Date(yy, mm, 0).getDate()).padStart(2, "0")}`;

  const ultimos = movs.filter((m) => !m.eliminado).slice(0, 5);

  // Totales por grupo de cuentas (en moneda base) para el resumen plegable.
  const tc = st?.tipo_cambio_usd ?? 0;
  const totalesGrupo = new Map<string, number>();
  for (const s of saldos.filter((x) => x.cuenta.activa)) {
    const g = GRUPO_CUENTA[s.cuenta.tipo] ?? "Otras";
    totalesGrupo.set(g, (totalesGrupo.get(g) ?? 0) + convertCents(s.saldo, s.cuenta.moneda, base, tc));
  }
  const toggleCuentas = (abierto: boolean) => {
    setCuentasAbierto(abierto);
    try {
      localStorage.setItem(KEY_CUENTAS_ABIERTO, abierto ? "1" : "0");
    } catch {
      // sin almacenamiento: solo no se recuerda
    }
  };

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

      <div className="kpis">
        <div className="card">
          <div className="muted">Patrimonio neto</div>
          <div className={"stat " + (pat.consolidado < 0 ? "neg" : "")}>{formatMoney(pat.consolidado, base)}</div>
          {Object.keys(pat.porMoneda).length > 1 && (
            <div className="muted">
              {Object.entries(pat.porMoneda)
                .map(([m, cents]) => formatMoney(cents, m as Moneda))
                .join(" · ")}{" "}
              (USD→GTQ {pat.tipoCambioUsd || "—"})
            </div>
          )}
        </div>
        <Link to="/presupuesto" className="card kpi-link">
          <div className="muted">Disponible para asignar</div>
          <div className={"stat " + (disp.disponible < 0 ? "neg" : "pos")}>{formatMoney(disp.disponible, base)}</div>
          {disp.disponible < 0 && <div className="muted neg">Asignaste de más</div>}
        </Link>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Gasto de este mes</h3>
          <Link to={`/reportes`} className="muted">
            Reportes →
          </Link>
        </div>
        <p className="gm-resumen">
          Llevas <strong>{formatMoney(gastadoHoy, base)}</strong>
          {asignadoMes > 0 && (
            <>
              {" "}
              de {formatMoney(asignadoMes, base)} asignado ({pctGastado}%)
            </>
          )}{" "}
          y va el {pctMes}% del mes.
          {asignadoMes > 0 && (
            <>
              {" "}
              {gastadoHoy > ritmoHoy ? (
                <span className="neg">Vas {formatMoney(gastadoHoy - ritmoHoy, base)} arriba del ritmo.</span>
              ) : (
                <span className="pos">Vas {formatMoney(ritmoHoy - gastadoHoy, base)} debajo del ritmo.</span>
              )}
            </>
          )}
          {prevMismoDia > 0 && (
            <span className="muted"> El mes pasado a esta fecha: {formatMoney(prevMismoDia, base)}.</span>
          )}
        </p>
        <GastoMesChart
          actual={acumulado}
          anterior={acumuladoPrev}
          presupuesto={asignadoMes}
          hoy={diaHoy}
          moneda={base}
        />
      </div>

      {top.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>Más gasto del mes</h3>
            <Link to="/presupuesto" className="muted">
              Presupuesto →
            </Link>
          </div>
          {top.map(([id, b]) => {
            const inicio = b.disponible + b.gastadoMes;
            const pct = inicio > 0 ? Math.min(100, (b.gastadoMes / inicio) * 100) : 100;
            return (
              <Link
                key={id}
                to={`/movimientos?categoria=${id}&desde=${mes}-01&hasta=${finMes}`}
                className="top-cat"
              >
                <span className="top-cat-fila">
                  <span>{nombreCat.get(id) ?? "(sin categoría)"}</span>
                  <strong>{formatMoney(b.gastadoMes, base)}</strong>
                </span>
                <span className="budget-track">
                  <span
                    className={"budget-fill" + (b.disponible < 0 ? " over" : "")}
                    style={{ width: `${pct}%`, display: "block" }}
                  />
                </span>
                <span className={"top-cat-disp " + (b.disponible < 0 ? "neg" : "muted")}>
                  {b.disponible < 0
                    ? `${formatMoney(-b.disponible, base)} sobregastado`
                    : `Quedan ${formatMoney(b.disponible, base)}`}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <Alertas />

      <div className="card">
        <div className="card-head">
          <h3>Últimos movimientos</h3>
          <Link to="/movimientos" className="muted">
            Ver todos →
          </Link>
        </div>
        {ultimos.length === 0 && <p className="muted">Aún no hay movimientos.</p>}
        {ultimos.map((m) => {
          const cuenta = (cuentas.data ?? []).find((c) => c.id === m.cuenta);
          const titulo =
            m.descripcion ||
            (m.tipo === "transferencia" ? "Transferencia" : nombreCat.get(m.categoria) ?? "(sin categoría)");
          return (
            <div key={m.id} className="ult-mov">
              <span className="ult-mov-txt">
                <span>{titulo}</span>
                <span className="muted">
                  {(m.fecha || "").slice(0, 10)} · {cuenta?.nombre ?? ""}
                  {m.descripcion && m.tipo !== "transferencia" && ` · ${nombreCat.get(m.categoria) ?? ""}`}
                </span>
              </span>
              <strong className={m.tipo === "transferencia" ? "" : m.monto < 0 ? "neg" : "pos"}>
                {formatMoney(m.monto, m.moneda)}
              </strong>
            </div>
          );
        })}
      </div>

      <details
        className="card cuentas-plegable"
        open={cuentasAbierto}
        onToggle={(e) => toggleCuentas((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <h3>Saldos por cuenta</h3>
          <span className="cuentas-totales">
            {[...totalesGrupo.entries()].map(([g, v]) => (
              <span key={g}>
                {g}: <strong className={v < 0 ? "neg" : ""}>{formatMoney(v, base)}</strong>
              </span>
            ))}
          </span>
        </summary>
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

                {s.cuenta.tipo === "prestamo" && (() => {
                  const est = estadoPrestamo(s.cuenta, s.saldo);
                  return (
                    <div style={{ marginTop: 6 }}>
                      {est.saldado ? (
                        <span className="badge pos">✓ Saldado</span>
                      ) : (
                        <>
                          <div style={{ background: "var(--border)", borderRadius: 4 }}>
                            <div className="bar" style={{ width: `${Math.round(est.avance * 100)}%` }} />
                          </div>
                          <div className="muted">
                            {Math.round(est.avance * 100)}% pagado
                            {s.cuenta.monto_original
                              ? ` de ${formatMoney(s.cuenta.monto_original, moneda)}`
                              : ""}
                            {est.cuotasRestantes !== null && ` · ~${est.cuotasRestantes} cuota(s) restantes`}
                          </div>
                          {s.cuenta.cuota ? (
                            <div className="muted">Cuota: {formatMoney(s.cuenta.cuota, moneda)}</div>
                          ) : null}
                        </>
                      )}
                    </div>
                  );
                })()}

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
                  <span>
                    {s.cuenta.tipo === "prestamo" && s.saldo < 0 && (
                      <button className="link" onClick={() => setPagando(s)}>
                        Pagar cuota
                      </button>
                    )}
                    <button className="link" onClick={() => abrirConciliar(s)}>
                      Conciliar
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        {saldos.length === 0 && <p className="muted">Aún no tienes cuentas. Crea una en “Cuentas”.</p>}
      </div>
      </details>

      {pagando && <PagarPrestamo prestamo={pagando} saldos={saldos} onClose={() => setPagando(null)} />}

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
