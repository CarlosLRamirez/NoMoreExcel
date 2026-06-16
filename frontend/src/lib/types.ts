// Tipos que reflejan las colecciones de PocketBase. Todos los montos son
// ENTEROS en centavos.

export type Moneda = "GTQ" | "USD";
export type TipoCuenta = "monetaria" | "ahorro" | "tarjeta_credito" | "efectivo";
export type TipoCategoria = "ingreso" | "gasto";
export type TipoMovimiento = "ingreso" | "gasto" | "transferencia";

export interface BaseRecord {
  id: string;
  created: string;
  updated: string;
}

export interface Usuario extends BaseRecord {
  email: string;
  nombre: string;
}

export interface Cuenta extends BaseRecord {
  usuario: string;
  nombre: string;
  tipo: TipoCuenta;
  moneda: Moneda;
  saldo_inicial: number; // centavos
  limite_credito: number | null; // centavos (solo TC)
  dia_corte: number | null;
  dia_pago: number | null;
  activa: boolean;
  ultima_conciliacion?: string;
  tc_base_inicial?: number; // moneda_base por unidad de la moneda de la cuenta (saldo_inicial)
}

export interface Grupo extends BaseRecord {
  usuario: string;
  nombre: string;
  orden: number;
  activa: boolean;
}

export interface Categoria extends BaseRecord {
  usuario: string;
  nombre: string;
  tipo: TipoCategoria;
  padre: string;
  grupo: string;
  orden: number;
  activa: boolean;
  excluir_presupuesto: boolean;
}

export interface Movimiento extends BaseRecord {
  usuario: string;
  fecha: string;
  cuenta: string;
  categoria: string;
  tipo: TipoMovimiento;
  monto: number; // centavos, con signo
  moneda: Moneda;
  descripcion: string;
  transfer_id: string;
  tipo_cambio: number | null;
  conciliado: boolean; // confirmado / "cleared": apareció en el banco
  reconciliado: boolean; // bloqueado tras un reconcile (reconciled ⇒ conciliado)
  ingreso_proximo_mes: boolean; // ingreso que se presupuesta el mes siguiente
  tc_base?: number; // moneda_base por unidad de la moneda del movimiento (costo histórico)
  eliminado: boolean;
  notas: string;
  expand?: {
    cuenta?: Cuenta;
    categoria?: Categoria;
  };
}

export interface Presupuesto extends BaseRecord {
  usuario: string;
  categoria: string;
  mes: string; // "YYYY-MM"
  monto: number; // centavos, en moneda_base
}

export interface Settings extends BaseRecord {
  usuario: string;
  moneda_base: Moneda;
  tipo_cambio_usd: number;
}
