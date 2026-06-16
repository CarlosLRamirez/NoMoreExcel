import { Link } from "react-router-dom";
import {
  useAllPresupuestos,
  useCategorias,
  useCuentas,
  useMovimientos,
  useSettings,
} from "../hooks/queries";
import { disponibleParaAsignar, gastoEnMesPorCategoria } from "../lib/finance";
import { formatMoney } from "../lib/money";

interface Alerta {
  sev: "warn" | "info";
  texto: string;
  to: string;
}

export function Alertas() {
  const { data: cuentas = [] } = useCuentas();
  const { data: movimientos = [] } = useMovimientos();
  const { data: categorias = [] } = useCategorias();
  const { data: allPresupuestos = [] } = useAllPresupuestos();
  const { data: settings } = useSettings();

  const base = settings?.moneda_base ?? "GTQ";
  const mes = new Date().toISOString().slice(0, 7);
  const alertas: Alerta[] = [];

  // 1) Dinero sin asignar / sobre-asignado (mes actual)
  const disp = disponibleParaAsignar(movimientos, allPresupuestos, mes, settings ?? null);
  if (disp.disponible < 0) {
    alertas.push({
      sev: "warn",
      texto: `Presupuestaste ${formatMoney(-disp.disponible, base)} más de lo disponible este mes.`,
      to: "/presupuesto",
    });
  } else if (disp.disponible > 0) {
    alertas.push({
      sev: "info",
      texto: `Tienes ${formatMoney(disp.disponible, base)} sin asignar este mes.`,
      to: "/presupuesto",
    });
  }

  // 2) Movimientos sin categoría (ingreso/gasto)
  const sinCat = movimientos.filter(
    (m) => !m.eliminado && (m.tipo === "ingreso" || m.tipo === "gasto") && !m.categoria
  ).length;
  if (sinCat > 0) {
    alertas.push({
      sev: "warn",
      texto: `${sinCat} movimiento(s) sin categoría.`,
      to: "/movimientos",
    });
  }

  // 3) Categorías que se pasaron del presupuesto este mes
  const spentMap = gastoEnMesPorCategoria(movimientos, mes, settings ?? null);
  const budgetMap = new Map(
    allPresupuestos.filter((p) => p.mes === mes).map((p) => [p.categoria, p.monto])
  );
  let sobre = 0;
  for (const c of categorias) {
    if (c.tipo !== "gasto" || c.excluir_presupuesto) continue;
    const b = budgetMap.get(c.id) ?? 0;
    const s = spentMap.get(c.id) ?? 0;
    if (b > 0 && s > b) sobre++;
  }
  if (sobre > 0) {
    alertas.push({
      sev: "warn",
      texto: `${sobre} categoría(s) se pasaron del presupuesto este mes.`,
      to: "/presupuesto",
    });
  }

  // 4) Tipo de cambio USD sin configurar pero hay cuentas en USD
  const hayUSD = cuentas.some((c) => c.moneda === "USD");
  if (hayUSD && (settings?.tipo_cambio_usd ?? 0) === 0) {
    alertas.push({
      sev: "warn",
      texto: "Tienes cuentas en USD pero el tipo de cambio USD→GTQ está en 0. Configúralo para consolidar bien.",
      to: "/ajustes",
    });
  }

  if (alertas.length === 0) return null;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Alertas</h3>
      <div className="alert-list">
        {alertas.map((a, i) => (
          <div key={i} className={"alert-item " + a.sev}>
            <span className="alert-ico">{a.sev === "warn" ? "⚠️" : "ℹ️"}</span>
            <span>{a.texto}</span>
            <span className="spacer" />
            <Link to={a.to}>Ver →</Link>
          </div>
        ))}
      </div>
    </div>
  );
}
