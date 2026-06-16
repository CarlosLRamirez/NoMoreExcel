import { Fragment, useState } from "react";
import { useCategorias, useGrupos, useMovimientos, useSettings } from "../hooks/queries";
import { gastoPorGrupo, ingresoVsGastoPorMes } from "../lib/finance";
import { formatMoney } from "../lib/money";

const inicioMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const hoy = () => new Date().toISOString().slice(0, 10);

export function Reportes() {
  const { data: movimientos = [] } = useMovimientos();
  const { data: categorias = [] } = useCategorias();
  const { data: grupos = [] } = useGrupos();
  const { data: settings } = useSettings();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [incluirOcultas, setIncluirOcultas] = useState(false);

  const base = settings?.moneda_base ?? "GTQ";
  const reporte = gastoPorGrupo(movimientos, desde, hasta, settings ?? null, grupos, categorias, incluirOcultas);
  const maxCat = Math.max(1, ...reporte.flatMap((g) => g.categorias.map((c) => c.total)));
  const totalGeneral = reporte.reduce((a, g) => a + g.total, 0);
  const excluidasIds = new Set(
    incluirOcultas ? [] : categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id)
  );
  const porMes = ingresoVsGastoPorMes(movimientos, settings ?? null, excluidasIds);

  const hayMezcla = new Set(movimientos.filter((m) => !m.eliminado).map((m) => m.moneda)).size > 1;

  return (
    <div>
      <div className="page-head">
        <h2>Reportes</h2>
      </div>

      {hayMezcla && (
        <p className="muted">
          Hay movimientos en más de una moneda. Los totales se consolidan en {base} con el tipo de
          cambio manual USD→GTQ = {settings?.tipo_cambio_usd || "—"} (aproximado).
        </p>
      )}

      <div className="card">
        <h3>(a) Gasto por categoría (por grupo)</h3>
        <div className="toolbar">
          <div className="field">
            <label>Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={incluirOcultas}
                onChange={(e) => setIncluirOcultas(e.target.checked)}
              />
              Incluir ocultas
            </label>
          </div>
          <div className="field">
            <label>Total del periodo</label>
            <div className="stat" style={{ fontSize: 18 }}>
              {formatMoney(totalGeneral, base)}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Distribución</th>
              <th className="num">Total ({base})</th>
            </tr>
          </thead>
          <tbody>
            {reporte.map((g) => (
              <Fragment key={g.grupoId || "sin-grupo"}>
                <tr className="rep-grupo">
                  <td colSpan={2}>
                    <strong>{g.grupoNombre}</strong>
                  </td>
                  <td className="num">
                    <strong>{formatMoney(g.total, base)}</strong>
                  </td>
                </tr>
                {g.categorias.map((c) => (
                  <tr key={c.categoriaId}>
                    <td style={{ paddingLeft: 24 }}>{c.nombre}</td>
                    <td>
                      <div className="bar" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                    </td>
                    <td className="num">{formatMoney(c.total, base)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {reporte.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Sin gastos en el rango.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>(b) Ingreso vs Gasto por mes</h3>
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Ingreso ({base})</th>
              <th className="num">Gasto ({base})</th>
              <th className="num">Neto ({base})</th>
            </tr>
          </thead>
          <tbody>
            {porMes.map((m) => (
              <tr key={m.mes}>
                <td>{m.mes}</td>
                <td className="num pos">{formatMoney(m.ingreso, base)}</td>
                <td className="num neg">{formatMoney(m.gasto, base)}</td>
                <td className={"num " + (m.ingreso - m.gasto < 0 ? "neg" : "pos")}>
                  {formatMoney(m.ingreso - m.gasto, base)}
                </td>
              </tr>
            ))}
            {porMes.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Sin datos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
