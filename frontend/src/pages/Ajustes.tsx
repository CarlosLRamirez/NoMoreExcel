import { useEffect, useState } from "react";
import { useSaveSettings, useSettings } from "../hooks/queries";
import type { Moneda } from "../lib/types";

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
    </div>
  );
}
