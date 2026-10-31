import { formatMoney } from "../lib/money";
import type { Moneda } from "../lib/types";

// Montos cortos para el eje Y: Q950, Q1.2k, Q15k.
const corto = (cents: number, moneda: Moneda) => {
  const s = moneda === "USD" ? "$" : "Q";
  const v = cents / 100;
  if (v >= 10000) return `${s}${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${s}${(v / 1000).toFixed(1)}k`;
  return `${s}${Math.round(v)}`;
};

/**
 * Gasto acumulado del mes día a día (SVG propio, sin librerías):
 *  - línea sólida: este mes hasta hoy
 *  - línea tenue: mes anterior (mismo día del mes)
 *  - punteada: ritmo esperado = total asignado repartido parejo en el mes
 */
export function GastoMesChart({
  actual,
  anterior,
  presupuesto,
  hoy,
  moneda,
}: {
  actual: number[]; // acumulado por día del mes actual (largo = días del mes)
  anterior: number[]; // acumulado por día del mes anterior
  presupuesto: number; // total asignado del mes (centavos); 0 = sin línea de ritmo
  hoy: number; // día del mes (1..n)
  moneda: Moneda;
}) {
  const n = actual.length;
  const W = 340;
  const H = 180;
  const pad = { l: 44, r: 10, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const hasta = actual.slice(0, hoy);
  // el mes anterior se compara por día del mes (si tuvo menos días, se queda en su total)
  const prev = Array.from({ length: n }, (_, i) => anterior[Math.min(i, anterior.length - 1)] ?? 0);
  const max = Math.max(1, presupuesto, ...hasta, ...prev) * 1.08;

  const x = (dia: number) => pad.l + ((dia - 1) / Math.max(1, n - 1)) * iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const linea = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const ticks = [0, max / 2, max].map((v) => Math.round(v));
  const gastado = hasta[hasta.length - 1] ?? 0;
  const ritmoHoy = presupuesto > 0 ? Math.round((presupuesto * hoy) / n) : 0;
  const pasado = presupuesto > 0 && gastado > ritmoHoy;

  return (
    <figure className="gm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gasto acumulado del mes">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="gm-grid" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" className="gm-axis">
              {corto(v, moneda)}
            </text>
          </g>
        ))}
        {[1, Math.ceil(n / 2), n].map((d) => (
          <text key={d} x={x(d)} y={H - 6} textAnchor="middle" className="gm-axis">
            {d}
          </text>
        ))}
        {presupuesto > 0 && (
          <line x1={x(1)} y1={y(presupuesto / n)} x2={x(n)} y2={y(presupuesto)} className="gm-ritmo" />
        )}
        <path d={linea(prev)} className="gm-prev" />
        <path d={linea(hasta)} className={"gm-actual" + (pasado ? " over" : "")} />
        <circle cx={x(hoy)} cy={y(gastado)} r={4} className={"gm-punto" + (pasado ? " over" : "")} />
      </svg>
      <figcaption className="gm-leyenda">
        <span>
          <i className={"gm-sw actual" + (pasado ? " over" : "")} /> Este mes
        </span>
        <span>
          <i className="gm-sw prev" /> Mes anterior
        </span>
        {presupuesto > 0 && (
          <span>
            <i className="gm-sw ritmo" /> Ritmo del presupuesto
          </span>
        )}
      </figcaption>
      <span className="sr-only">
        Gastado {formatMoney(gastado, moneda)} al día {hoy}
      </span>
    </figure>
  );
}
