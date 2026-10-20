import { useEffect, useState } from "react";
import { fetchBackup, useCuentas, useMovimientos, useReset, useSaveSettings, useSettings } from "../hooks/queries";
import { Modal } from "../components/Modal";
import { centsToInput, formatMoney, parseAmountToCents } from "../lib/money";
import { saldosPorCuenta } from "../lib/finance";
import type { Moneda } from "../lib/types";

const hoy = () => new Date().toISOString().slice(0, 10);

async function descargarBackup() {
  const data = await fetchBackup();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nomoreexcel_backup_${hoy()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Ajustes() {
  const { data: settings, isLoading } = useSettings();
  const save = useSaveSettings();
  const [monedaBase, setMonedaBase] = useState<Moneda>("GTQ");
  const [tc, setTc] = useState("0");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (settings) {
      setMonedaBase(settings.moneda_base);
      setTc(String(settings.tipo_cambio_usd ?? 0));
    }
  }, [settings]);

  if (isLoading) return <p>Cargando…</p>;
  if (!settings) return <p className="muted">No se encontró la configuración del usuario.</p>;

  const submit = async () => {
    setMsg("");
    const tcNum = Number(tc);
    if (Number.isNaN(tcNum) || tcNum < 0) {
      setMsg("Tipo de cambio inválido");
      return;
    }
    await save.mutateAsync({ id: settings.id, moneda_base: monedaBase, tipo_cambio_usd: tcNum });
    setMsg("Guardado.");
  };

  return (
    <div>
      <div className="page-head">
        <h2>Ajustes</h2>
      </div>
      <div className="card" style={{ maxWidth: 460 }}>
        <div className="field">
          <label>Moneda base</label>
          <select value={monedaBase} onChange={(e) => setMonedaBase(e.target.value as Moneda)}>
            <option value="GTQ">GTQ</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="field">
          <label>Tipo de cambio USD → GTQ (manual)</label>
          <input value={tc} onChange={(e) => setTc(e.target.value)} placeholder="7.80" />
          <span className="muted">
            Solo se usa para consolidar el patrimonio y reportes cuando hay mezcla de monedas.
          </span>
        </div>
        {msg && <div className={msg === "Guardado." ? "pos" : "error"}>{msg}</div>}
        <div className="modal-actions">
          <button className="primary" onClick={submit} disabled={save.isPending}>
            Guardar
          </button>
        </div>
      </div>
      <ZonaPeligrosa />
    </div>
  );
}

// Respaldo + "empezar de cero": borra movimientos y presupuestos, conserva cuentas y
// categorías, y fija el saldo inicial de cada cuenta (editable después en Cuentas).
function ZonaPeligrosa() {
  const { data: cuentas = [] } = useCuentas();
  const reset = useReset();
  const [abierto, setAbierto] = useState(false);
  const [saldos, setSaldos] = useState<Record<string, string>>({});
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const abrir = () => {
    const init: Record<string, string> = {};
    cuentas.forEach((c) => (init[c.id] = ""));
    setSaldos(init);
    setConfirmacion("");
    setError("");
    setAbierto(true);
  };

  const backup = async () => {
    setMsg("");
    setError("");
    try {
      await descargarBackup();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo generar el backup");
    }
  };

  const ejecutar = async () => {
    setError("");
    const payload: Record<string, number> = {};
    for (const c of cuentas) {
      const raw = (saldos[c.id] ?? "").trim();
      const cents = raw === "" ? 0 : parseAmountToCents(raw);
      if (Number.isNaN(cents)) return setError(`Saldo inválido en "${c.nombre}"`);
      payload[c.id] = cents;
    }
    setOcupado(true);
    try {
      // El backup se descarga SIEMPRE antes de borrar; si falla, no se borra nada.
      await descargarBackup();
      const res = await reset.mutateAsync(payload);
      setAbierto(false);
      setMsg(
        `Listo: se borraron ${res.movimientos} movimientos y ${res.presupuestos} asignaciones de presupuesto. ` +
          "Puedes ajustar el saldo inicial de cada cuenta en Cuentas."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo completar el reset");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 460, marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Backup y empezar de cero</h3>
      <p className="muted">
        El backup descarga un JSON con todos tus datos (cuentas, categorías, movimientos,
        presupuestos). No reemplaza el backup completo del panel de PocketBase.
      </p>
      {msg && <div className="pos">{msg}</div>}
      {!abierto && error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <button onClick={backup}>Descargar backup</button>
        <button className="danger" onClick={abrir} disabled={cuentas.length === 0}>
          Empezar de cero…
        </button>
      </div>

      {abierto && (
        <Modal title="Empezar de cero" onClose={() => !ocupado && setAbierto(false)}>
          <p>
            Se borrarán <b>todos tus movimientos</b> y <b>todo el presupuesto</b>. Se conservan
            cuentas, grupos, categorías y ajustes. Antes de borrar se descargará un backup.
          </p>
          <p className="muted">
            Escribe el saldo real de hoy de cada cuenta (vacío = 0). Si no lo tienes a mano,
            déjalo vacío y luego edítalo en Cuentas → saldo inicial.
          </p>
          <SaldosTabla saldos={saldos} setSaldos={setSaldos} />
          <div className="field">
            <label>
              Escribe <b>BORRAR</b> para confirmar
            </label>
            <input value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setAbierto(false)} disabled={ocupado}>
              Cancelar
            </button>
            <button
              className="danger"
              onClick={ejecutar}
              disabled={ocupado || confirmacion !== "BORRAR"}
            >
              {ocupado ? "Procesando…" : "Descargar backup y borrar"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SaldosTabla({
  saldos,
  setSaldos,
}: {
  saldos: Record<string, string>;
  setSaldos: (s: Record<string, string>) => void;
}) {
  const { data: cuentas = [] } = useCuentas();
  const { data: movimientos = [] } = useMovimientos();
  const actuales = new Map(saldosPorCuenta(cuentas, movimientos).map((s) => [s.cuenta.id, s.saldo]));

  return (
    <table>
      <thead>
        <tr>
          <th>Cuenta</th>
          <th className="num">Saldo en la app</th>
          <th className="num">Saldo real</th>
        </tr>
      </thead>
      <tbody>
        {cuentas.map((c) => {
          const actual = actuales.get(c.id) ?? c.saldo_inicial ?? 0;
          return (
            <tr key={c.id}>
              <td>
                {c.nombre} {!c.activa && <span className="badge">inactiva</span>}
              </td>
              <td className="num">
                <button
                  className="link"
                  title="Usar este valor"
                  onClick={() => setSaldos({ ...saldos, [c.id]: centsToInput(actual) })}
                >
                  {formatMoney(actual, c.moneda)}
                </button>
              </td>
              <td className="num">
                <input
                  value={saldos[c.id] ?? ""}
                  onChange={(e) => setSaldos({ ...saldos, [c.id]: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  style={{ width: 110, textAlign: "right" }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
