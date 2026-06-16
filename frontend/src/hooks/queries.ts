import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pb";
import type { Cuenta, Categoria, Grupo, Movimiento, Presupuesto, Settings } from "../lib/types";
import type { CsvRow } from "../lib/csv";

const uid = () => pb.authStore.record?.id ?? "";

// --------------------------- Cuentas ---------------------------
export function useCuentas() {
  return useQuery({
    queryKey: ["cuentas"],
    queryFn: () =>
      pb.collection("cuentas").getFullList<Cuenta>({ sort: "nombre", requestKey: "cuentas" }),
  });
}

export function useSaveCuenta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Cuenta> & { id?: string }) => {
      const payload = { ...data, usuario: uid() };
      return data.id
        ? pb.collection("cuentas").update<Cuenta>(data.id, payload)
        : pb.collection("cuentas").create<Cuenta>(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cuentas"] }),
  });
}

export function useDeleteCuenta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pb.collection("cuentas").delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cuentas"] }),
  });
}

// --------------------------- Grupos ---------------------------
export function useGrupos() {
  return useQuery({
    queryKey: ["grupos"],
    queryFn: () =>
      pb.collection("grupos").getFullList<Grupo>({ sort: "orden,nombre", requestKey: "grupos" }),
  });
}

export function useSaveGrupo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Grupo> & { id?: string }) => {
      const payload = { ...data, usuario: uid() };
      return data.id
        ? pb.collection("grupos").update<Grupo>(data.id, payload)
        : pb.collection("grupos").create<Grupo>(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grupos"] }),
  });
}

export function useDeleteGrupo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pb.collection("grupos").delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grupos"] });
      qc.invalidateQueries({ queryKey: ["categorias"] });
    },
  });
}

// --------------------------- Categorias ---------------------------
export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: () =>
      pb.collection("categorias").getFullList<Categoria>({ sort: "orden,nombre", requestKey: "categorias" }),
  });
}

export function useSaveCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Categoria> & { id?: string }) => {
      const payload = { ...data, usuario: uid() };
      return data.id
        ? pb.collection("categorias").update<Categoria>(data.id, payload)
        : pb.collection("categorias").create<Categoria>(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categorias"] }),
  });
}

export function useDeleteCategoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pb.collection("categorias").delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categorias"] }),
  });
}

// --------------------------- Movimientos ---------------------------
export function useMovimientos() {
  return useQuery({
    queryKey: ["movimientos"],
    queryFn: () =>
      pb.collection("movimientos").getFullList<Movimiento>({
        filter: "eliminado = false",
        sort: "-fecha,-created",
        expand: "cuenta,categoria",
        requestKey: "movimientos",
      }),
  });
}

export function useSaveMovimiento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Movimiento> & { id?: string }) => {
      const payload = { ...data, usuario: uid() };
      return data.id
        ? pb.collection("movimientos").update<Movimiento>(data.id, payload)
        : pb.collection("movimientos").create<Movimiento>(payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

/** Soft delete. */
export function useDeleteMovimiento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pb.collection("movimientos").update(id, { eliminado: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

export function useToggleConciliado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, conciliado }: { id: string; conciliado: boolean }) =>
      pb.collection("movimientos").update(id, { conciliado }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

export interface TransferInput {
  fecha: string;
  cuenta_origen: string;
  cuenta_destino: string;
  monto: number; // centavos positivos, moneda de origen
  tipo_cambio?: number;
  descripcion?: string;
  notas?: string;
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferInput) =>
      pb.send("/api/transfers", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

export function useUpdateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TransferInput & { transfer_id: string }) =>
      pb.send("/api/transfers/update", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

export interface ReconcileResult {
  ok: boolean;
  diferencia: number;
  ajuste: string | null;
  reconciliados: number;
  saldo_confirmado_previo: number;
}

export function useReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { cuenta: string; saldo_real: number; fecha?: string }) =>
      pb.send<ReconcileResult>("/api/reconcile", { method: "POST", body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["movimientos"] });
      qc.invalidateQueries({ queryKey: ["cuentas"] });
    },
  });
}

export interface ImportResult {
  ok: boolean;
  importados: number;
  errores: { fila: number; errores: string[] }[];
}

export function useImportCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rows: CsvRow[]) =>
      pb.send<ImportResult>("/api/import", { method: "POST", body: { rows } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["movimientos"] }),
  });
}

// --------------------------- Presupuestos ---------------------------
export function usePresupuestos(mes: string) {
  return useQuery({
    queryKey: ["presupuestos", mes],
    queryFn: () =>
      pb.collection("presupuestos").getFullList<Presupuesto>({
        filter: `mes = "${mes}"`,
        requestKey: `presupuestos_${mes}`,
      }),
  });
}

/** Todos los presupuestos del usuario (para el cálculo de "disponible para asignar"). */
export function useAllPresupuestos() {
  return useQuery({
    queryKey: ["presupuestos", "all"],
    queryFn: () =>
      pb.collection("presupuestos").getFullList<Presupuesto>({ requestKey: "presupuestos_all" }),
  });
}

export function useSetPresupuesto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { categoria: string; mes: string; monto: number }) =>
      pb.send("/api/budget/set", { method: "POST", body: data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["presupuestos"] }),
  });
}

export function useCopyPresupuesto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { mes: string }) =>
      pb.send<{ ok: boolean; copiados: number; desde: string }>("/api/budget/copy", {
        method: "POST",
        body: data,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["presupuestos"] }),
  });
}

// --------------------------- Settings ---------------------------
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const list = await pb
        .collection("settings")
        .getFullList<Settings>({ requestKey: "settings" });
      return list[0] ?? null;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Settings> & { id: string }) =>
      pb.collection("settings").update<Settings>(data.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
