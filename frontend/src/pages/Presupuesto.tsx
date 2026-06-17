import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useCategorias,
  useGrupos,
  useMovimientos,
  usePresupuestos,
  useAllPresupuestos,
  useSetPresupuesto,
  useCopyPresupuesto,
  useAssignSpent,
  useSettings,
} from "../hooks/queries";
import { balancesCategoria, disponibleParaAsignar } from "../lib/finance";
import { formatMoney, parseAmountToCents, centsToInput } from "../lib/money";
import { presupuestoToCsv, type PresupuestoCsvRow } from "../lib/csv";
import type { Categoria } from "../lib/types";

const curMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (mes: string, delta: number) => {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (mes: string) => {
  const [y, m] = mes.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("es-GT", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function Barra({ spent, budget }: { spent: number; budget: number }) {
  const over = spent > budget && (budget > 0 || spent > 0);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className="budget-track" title={`${pct.toFixed(0)}%`}>
      <div className={"budget-fill" + (over ? " over" : "")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Presupuesto() {
  const { data: grupos = [] } = useGrupos();
  const { data: categorias = [] } = useCategorias();
  const { data: movimientos = [] } = useMovimientos();
  const { data: settings } = useSettings();
  const [mes, setMes] = useState(curMonth());
  const [incluirOcultas, setIncluirOcultas] = useState(false);
  const { data: presupuestos = [] } = usePresupuestos(mes);
  const { data: allPresupuestos = [] } = useAllPresupuestos();
  const setPres = useSetPresupuesto();
  const copyPres = useCopyPresupuesto();
  const assignSpent = useAssignSpent();
  const navigate = useNavigate();

  const copiarMesAnterior = async () => {
    const prev = shiftMonth(mes, -1);
    if (
      !confirm(
        `¿Copiar los presupuestos de ${monthLabel(prev)} a ${monthLabel(mes)}?\n\n` +
          `Sobrescribirá los montos de este mes para las categorías que tenían presupuesto el mes anterior.`
      )
    )
      return;
    const res = await copyPres.mutateAsync({ mes });
    if (res.copiados === 0) alert(`No hay presupuestos en ${monthLabel(prev)} para copiar.`);
  };

  // Ir a Movimientos filtrando por esta categoría y este mes (estilo YNAB).
  const verMovimientos = (catId: string) => {
    const [y, m] = mes.split("-").map(Number);
    const last = String(new Date(y, m, 0).getDate()).padStart(2, "0");
    navigate(`/movimientos?categoria=${catId}&desde=${mes}-01&hasta=${mes}-${last}`);
  };

  const base = settings?.moneda_base ?? "GTQ";
  const excluidasIds = new Set(
    incluirOcultas ? [] : categorias.filter((c) => c.excluir_presupuesto).map((c) => c.id)
  );
  const disp = disponibleParaAsignar(movimientos, allPresupuestos, mes, settings ?? null, excluidasIds);
  const balMap = balancesCategoria(movimientos, allPresupuestos, mes, settings ?? null);
  const bal = (id: string) =>
    balMap.get(id) ?? { asignadoMes: 0, gastadoMes: 0, disponible: 0 };
  const budgetMap = new Map(presupuestos.map((p) => [p.categoria, p.monto]));

  const catsGasto = categorias.filter(
    (c) => c.tipo === "gasto" && (incluirOcultas || !c.excluir_presupuesto)
  );
  const catsDe = (gid: string) =>
    catsGasto.filter((c) => (c.grupo || "") === gid).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

  // edición local de los inputs de presupuesto
  const [montos, setMontos] = useState<Record<string, string>>({});
  useEffect(() => {
    const m: Record<string, string> = {};
    for (const c of catsGasto) {
      const b = budgetMap.get(c.id);
      m[c.id] = b ? centsToInput(b) : "";
    }
    setMontos(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes, presupuestos, categorias]);

  const guardar = (catId: string) => {
    const cents = parseAmountToCents(montos[catId] || "0");
    setPres.mutate({ categoria: catId, mes, monto: Number.isNaN(cents) ? 0 : cents });
  };

  // Asigna a cada categoría visible exactamente lo gastado este mes (YNAB: "budget = activity").
  // Como "Gastado" ya está en centavos enteros de moneda base, los dólares cuadran exacto.
  const asignarGastado = async () => {
    if (
      !confirm(
        "¿Asignar a cada categoría exactamente lo gastado este mes? Sobrescribe las asignaciones de este mes."
      )
    )
      return;
    const items = catsGasto
      .map((c) => ({ categoria: c.id, mes, monto: bal(c.id).gastadoMes, cur: bal(c.id).asignadoMes }))
      .filter((it) => it.monto !== it.cur)
      .map(({ categoria, mes: m, monto }) => ({ categoria, mes: m, monto }));
    if (items.length === 0) return;
    await assignSpent.mutateAsync(items);
  };

  // totales: asignado y gastado del mes; disponible = saldo acumulado
  let totalBudget = 0;
  let totalSpent = 0;
  let totalDisp = 0;
  for (const c of catsGasto) {
    const b = bal(c.id);
    totalBudget += b.asignadoMes;
    totalSpent += b.gastadoMes;
    totalDisp += b.disponible;
  }

  const gruposConGasto = grupos.filter((g) => catsDe(g.id).length > 0);
  const sinGrupo = catsDe("");

  const filaCategoria = (c: Categoria) => {
    const { gastadoMes, disponible } = bal(c.id);
    const availStart = disponible + gastadoMes; // disponible al inicio del mes
    return (
      <tr key={c.id}>
        <td style={{ paddingLeft: 24 }}>
          <button className="link" onClick={() => verMovimientos(c.id)} title="Ver movimientos del mes">
            {c.nombre}
          </button>
        </td>
        <td className="num">
          <input
            className="bud-input"
            value={montos[c.id] ?? ""}
            placeholder="0.00"
            onChange={(e) => setMontos({ ...montos, [c.id]: e.target.value })}
            onBlur={() => guardar(c.id)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </td>
        <td className="num">{formatMoney(gastadoMes, base)}</td>
        <td className={"num " + (disponible < 0 ? "neg" : disponible > 0 ? "pos" : "muted")}>
          {formatMoney(disponible, base)}
        </td>
        <td>
          <Barra spent={gastadoMes} budget={availStart} />
        </td>
      </tr>
    );
  };

  const totalesGrupo = (cats: Categoria[]) => {
    let asig = 0;
    let gas = 0;
    let disp2 = 0;
    for (const c of cats) {
      const b = bal(c.id);
      asig += b.asignadoMes;
      gas += b.gastadoMes;
      disp2 += b.disponible;
    }
    return { asig, gas, disp: disp2 };
  };

  const exportarCsv = () => {
    const filas: PresupuestoCsvRow[] = [
      { nivel: "TOTAL", grupo: "", categoria: "", presupuesto: totalBudget, gastado: totalSpent, disponible: totalDisp },
    ];
    const addGrupo = (nombre: string, cats: Categoria[]) => {
      const { asig, gas, disp: gdisp } = totalesGrupo(cats);
      filas.push({ nivel: "GRUPO", grupo: nombre, categoria: "", presupuesto: asig, gastado: gas, disponible: gdisp });
      for (const c of cats) {
        const b = bal(c.id);
        filas.push({ nivel: "CATEGORIA", grupo: nombre, categoria: c.nombre, presupuesto: b.asignadoMes, gastado: b.gastadoMes, disponible: b.disponible });
      }
    };
    for (const g of gruposConGasto) addGrupo(g.nombre, catsDe(g.id));
    if (sinGrupo.length) addGrupo("Sin grupo", sinGrupo);

    const csv = presupuestoToCsv(mes, base, filas);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `presupuesto_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <div className="page-head">
        <h2>Presupuesto</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={incluirOcultas}
              onChange={(e) => setIncluirOcultas(e.target.checked)}
            />
            Incluir ocultas
          </label>
          <button onClick={asignarGastado} disabled={assignSpent.isPending} title="Asigna a cada categoría lo gastado este mes (deja el mes en 0)">
            Asignar lo gastado
          </button>
          <button onClick={copiarMesAnterior} disabled={copyPres.isPending}>
            Copiar mes anterior
          </button>
          <button onClick={exportarCsv}>Exportar CSV</button>
          <div className="month-nav">
            <button onClick={() => setMes(shiftMonth(mes, -1))} title="Mes anterior">
              ◀
            </button>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} />
          <strong>{monthLabel(mes)}</strong>
            <button onClick={() => setMes(shiftMonth(mes, 1))} title="Mes siguiente">
              ▶
            </button>
          </div>
        </div>
      </div>

      <div className={"card disponible-card" + (disp.disponible < 0 ? " neg" : "")}>
        <div className="muted">Disponible para asignar ({base})</div>
        <div className={"stat " + (disp.disponible < 0 ? "neg" : "pos")}>
          {formatMoney(disp.disponible, base)}
        </div>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Del mes anterior {formatMoney(disp.arrastrado, base)} + ingresos de {monthLabel(mes)}{" "}
          {formatMoney(disp.ingresosMes, base)} − asignado en {monthLabel(mes)}{" "}
          {formatMoney(disp.asignadoMes, base)}. Lo que no asignes se acumula al mes siguiente.
        </p>
        {disp.disponible < 0 && (
          <div className="error" style={{ marginBottom: 0 }}>
            ⚠ Estás asignando más de lo que tienes disponible.
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <div>
            <div className="muted">Presupuestado ({base})</div>
            <div className="stat" style={{ fontSize: 18 }}>
              {formatMoney(totalBudget, base)}
            </div>
          </div>
          <div>
            <div className="muted">Gastado</div>
            <div className="stat" style={{ fontSize: 18 }}>
              {formatMoney(totalSpent, base)}
            </div>
          </div>
          <div>
            <div className="muted">Disponible (acumulado)</div>
            <div className={"stat " + (totalDisp < 0 ? "neg" : "pos")} style={{ fontSize: 18 }}>
              {formatMoney(totalDisp, base)}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <table className="budget-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th className="num">Asignado ({base})</th>
              <th className="num">Gastado</th>
              <th className="num">Disponible (acum.)</th>
              <th>Avance</th>
            </tr>
          </thead>
          <tbody>
            {gruposConGasto.map((g) => {
              const cats = catsDe(g.id);
              const { asig, gas, disp: gdisp } = totalesGrupo(cats);
              return (
                <Fragment key={g.id}>
                  <tr className="rep-grupo">
                    <td>
                      <strong>{g.nombre}</strong>
                    </td>
                    <td className="num">
                      <strong>{formatMoney(asig, base)}</strong>
                    </td>
                    <td className="num">
                      <strong>{formatMoney(gas, base)}</strong>
                    </td>
                    <td className={"num " + (gdisp < 0 ? "neg" : gdisp > 0 ? "pos" : "")}>
                      <strong>{formatMoney(gdisp, base)}</strong>
                    </td>
                    <td>
                      <Barra spent={gas} budget={gdisp + gas} />
                    </td>
                  </tr>
                  {cats.map(filaCategoria)}
                </Fragment>
              );
            })}
            {sinGrupo.length > 0 && (
              <Fragment>
                <tr className="rep-grupo">
                  <td colSpan={5}>
                    <strong>Sin grupo</strong>
                  </td>
                </tr>
                {sinGrupo.map(filaCategoria)}
              </Fragment>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
