import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useCategorias, useGrupos, useMovimientos, useSettings } from "../hooks/queries";
import { gastoPorGrupo, ingresoVsGastoPorMes, totalesPorTag } from "../lib/finance";
import { formatMoney } from "../lib/money";

const inicioMes = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const hoy = () => new Date().toISOString().slice(0, 10);

// Grupos que el usuario sacó de los reportes (a) y (b), recordados en este dispositivo.
const KEY_GRUPOS_EXCL = "nme_rep_grupos_excl";
const leerExcluidos = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_GRUPOS_EXCL) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export function Reportes() {
  const { data: movimientos = [] } = useMovimientos();
  const { data: categorias = [] } = useCategorias();
  const { data: grupos = [] } = useGrupos();
  const { data: settings } = useSettings();
  const [desde, setDesde] = useState(inicioMes());
  const [hasta, setHasta] = useState(hoy());
  const [incluirOcultas, setIncluirOcultas] = useState(false);
  const [gruposExcl, setGruposExcl] = useState<string[]>(leerExcluidos);

  const guardarExcluidos = (next: string[]) => {
    setGruposExcl(next);
    try {
      localStorage.setItem(KEY_GRUPOS_EXCL, JSON.stringify(next));
    } catch {
      // sin almacenamiento: el filtro vale solo mientras la página esté abierta
    }
  };
  const toggleGrupo = (id: string) =>
    guardarExcluidos(gruposExcl.includes(id) ? gruposExcl.filter((x) => x !== id) : [...gruposExcl, id]);
  // Categorías de los grupos excluidos: se quitan de (a) y (b), no de (c) por etiqueta.
  const catsExcl = new Set(categorias.filter((c) => gruposExcl.includes(c.grupo)).map((c) => c.id));
  const movsFiltrados = catsExcl.size ? movimientos.filter((m) => !catsExcl.has(m.categoria)) : movimientos;
  const gruposConCats = [...grupos]
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .filter((g) => categorias.some((c) => c.grupo === g.id));

  const base = settings?.moneda_base ?? "GTQ";
  const reporte = gastoPorGrupo(movsFiltrados, desde, hasta, settings ?? null, grupos, categorias, incluirOcultas);
  const maxCat = Math.max(1, ...reporte.flatMap((g) => g.categorias.map((c) => c.total)));
  const totalGeneral = reporte.reduce((a, g) => a + g.total, 0);
  const excluidasIds = new Set(
    incluirOcultas ? [] : categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id)
  );
  const porMes = ingresoVsGastoPorMes(movsFiltrados, settings ?? null, excluidasIds);
  const porTag = totalesPorTag(movimientos, desde, hasta, settings ?? null);

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
        <h3 style={{ marginTop: 0 }}>Grupos en los reportes</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Toca un grupo para sacarlo de (a) y (b), p. ej. un negocio aparte, y ver tu gasto
          personal real. No cambia tu presupuesto. Se recuerda en este dispositivo.
        </p>
        <div className="sheet-chips rep-grupos">
          {gruposConCats.map((g) => {
            const incluido = !gruposExcl.includes(g.id);
            return (
              <button
                key={g.id}
                className={incluido ? "active" : "rep-grupo-off"}
                onClick={() => toggleGrupo(g.id)}
                aria-pressed={incluido}
              >
                {incluido ? "✓ " : ""}
                {g.nombre}
              </button>
            );
          })}
        </div>
        {gruposExcl.length > 0 && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Excluidos: {gruposExcl.length} grupo(s).{" "}
            <button className="link" onClick={() => guardarExcluidos([])}>
              Incluir todos
            </button>
          </p>
        )}
      </div>

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
        <h3>(c) Por etiqueta (rango de arriba)</h3>
        <table>
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th className="num">Gasto ({base})</th>
              <th className="num">Ingreso ({base})</th>
              <th className="num" title="Ingreso − gasto">Neto</th>
              <th className="num"># mov.</th>
            </tr>
          </thead>
          <tbody>
            {porTag.map((t) => (
              <tr key={t.tag}>
                <td>
                  <Link to={`/movimientos?tag=${t.tag}`} title="Ver movimientos con esta etiqueta">
                    #{t.tag}
                  </Link>
                </td>
                <td className="num neg">{t.gasto ? formatMoney(t.gasto, base) : "—"}</td>
                <td className="num pos">{t.ingreso ? formatMoney(t.ingreso, base) : "—"}</td>
                <td className={"num " + (t.ingreso - t.gasto < 0 ? "neg" : "pos")}>
                  <strong>{formatMoney(t.ingreso - t.gasto, base)}</strong>
                </td>
                <td className="num">{t.conteo}</td>
              </tr>
            ))}
            {porTag.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Sin movimientos etiquetados en el rango. Agrega etiquetas como #viaje en cada movimiento.
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
