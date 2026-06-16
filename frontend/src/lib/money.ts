import type { Moneda } from "./types";

// =============================================================================
// Dinero = ENTEROS en centavos. Estas utilidades convierten entre centavos y
// representación. La aritmética de dinero SIEMPRE se hace en enteros; el formateo
// a "Q1,234.56" es solo presentación.
// =============================================================================

/** Convierte un string decimal escrito por el usuario ("-1,234.56") a centavos enteros. */
export function parseAmountToCents(input: string): number {
  let s = String(input).trim().replace(/,/g, "");
  if (s === "" || s === "-" || s === "+") return NaN;
  let neg = false;
  if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  } else if (s[0] === "+") {
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const [intPart, fracRaw = ""] = s.split(".");
  if (fracRaw.length > 2) return NaN;
  const fracPart = (fracRaw + "00").slice(0, 2);
  const cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
  return neg ? -cents : cents;
}

/** Centavos -> string decimal plano sin separadores, ideal para inputs ("-1234.56"). */
export function centsToInput(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.trunc(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${intPart}.${frac}`;
}

const SYMBOL: Record<Moneda, string> = { GTQ: "Q", USD: "$" };

/** Centavos -> presentación "Q1,234.56". Solo para mostrar. */
export function formatMoney(cents: number, moneda: Moneda): string {
  const neg = cents < 0;
  const formatted = new Intl.NumberFormat("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
  return `${neg ? "-" : ""}${SYMBOL[moneda]}${formatted}`;
}
