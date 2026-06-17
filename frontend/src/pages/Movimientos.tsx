import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useCategorias,
  useCreateTransfer,
  useCuentas,
  useDeleteMovimiento,
  useImportCsv,
  useMovimientos,
  useSaveMovimiento,
  useToggleConciliado,
  useUpdateTransfer,
  type ImportResult,
} from "../hooks/queries";
import { Modal } from "../components/Modal";
import { Combobox } from "../components/Combobox";
import { centsToInput, formatMoney, parseAmountToCents } from "../lib/money";
import { csvToRows, exportToCsv, exampleCsv } from "../lib/csv";
import type { Cuenta, Categoria, Movimiento, TipoMovimiento } from "../lib/types";

const hoy = () => new Date().toISOString().slice(0, 10);

// Configuración de columnas de la tabla (orden + ancho ajustable).
const COLS = [
  { key: "fecha", label: "Fecha", num: false, sortable: true },
  { key: "cuenta", label: "Cuenta", num: false, sortable: true },
  { key: "categoria", label: "Categoría", num: false, sortable: true },
  { key: "tipo", label: "Tipo", num: false, sortable: true },
  { key: "descripcion", label: "Descripción", num: false, sortable: true },
  { key: "monto", label: "Monto", num: true, sortable: true },
  { key: "conciliado", label: "Conf.", num: false, sortable: true },
  { key: "acciones", label: "", num: true, sortable: false },
] as const;

const DEFAULT_WIDTHS = [110, 150, 150, 110, 220, 120, 64, 150];
type SortState = { key: string; dir: "asc" | "desc" };

interface MovForm {
  id?: string;
  fecha: string;
  cuenta: string;
  tipo: "ingreso" | "gasto";
  categoria: string;
  montoMag: string;
  descripcion: string;
  notas: string;
  conciliado: boolean;
  proximoMes: boolean; // ingreso para el próximo mes
  lockedTransfer?: boolean; // editando una pata de transferencia
  origReadonly?: { cuentaNombre: string; montoStr: string; tipo: string };
}

interface TransferForm {
  transferId?: string; // presente => edición de una transferencia existente
  fecha: string;
  cuenta_origen: string;
  cuenta_destino: string;
  montoMag: string;
  tipo_cambio: string;
  descripcion: string;
  notas: string;
}

export function Movimientos() {
  const { data: cuentas = [] } = useCuentas();
  const { data: categorias = [] } = useCategorias();
  const { data: movimientos = [] } = useMovimientos();
  const saveMov = useSaveMovimiento();
  const delMov = useDeleteMovimiento();
  const toggle = useToggleConciliado();
  const createTransfer = useCreateTransfer();
  const updateTransfer = useUpdateTransfer();
  const importCsv = useImportCsv();
  const fileRef = useRef<HTMLInputElement>(null);

  const cuentaMap = useMemo(() => new Map(cuentas.map((c) => [c.id, c])), [cuentas]);
  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

  // Agrupa las patas de cada transferencia por transfer_id (sobre TODOS los
  // movimientos, no solo los filtrados, para poder saltar a la pareja oculta).
  const transferGroups = useMemo(() => {
    const map = new Map<string, Movimiento[]>();
    for (const m of movimientos) {
      if (m.tipo !== "transferencia" || !m.transfer_id) continue;
      const arr = map.get(m.transfer_id) ?? [];
      arr.push(m);
      map.set(m.transfer_id, arr);
    }
    return map;
  }, [movimientos]);

  const transferFlow = (m: Movimiento) => {
    const legs = transferGroups.get(m.transfer_id) ?? [m];
    const origen = legs.find((l) => l.monto < 0) ?? m;
    const destino = legs.find((l) => l.monto > 0) ?? m;
    return {
      origenNombre: cuentaMap.get(origen.cuenta)?.nombre ?? "—",
      destinoNombre: cuentaMap.get(destino.cuenta)?.nombre ?? "—",
      sibling: legs.find((l) => l.id !== m.id) ?? null,
    };
  };

  const [highlightId, setHighlightId] = useState<string | null>(null);
  const jumpToSibling = (m: Movimiento) => {
    const sibling = (transferGroups.get(m.transfer_id) ?? []).find((l) => l.id !== m.id);
    if (!sibling) return;
    setFCuenta(""); // la otra pata es de otra cuenta: limpiar filtro para que sea visible
    if (sibling.reconciliado) setMostrarRec(true); // si está oculta por conciliada, mostrarla
    setHighlightId(sibling.id);
    setTimeout(() => {
      document.getElementById(`mov-${sibling.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setHighlightId(null), 2500);
  };

  // filtros (algunos se inicializan desde la URL al venir de otra pantalla)
  const [searchParams] = useSearchParams();
  const [fCuenta, setFCuenta] = useState("");
  const [fCategoria, setFCategoria] = useState(searchParams.get("categoria") ?? "");
  const [fTipo, setFTipo] = useState("");
  const [fDesde, setFDesde] = useState(searchParams.get("desde") ?? "");
  const [fHasta, setFHasta] = useState(searchParams.get("hasta") ?? "");

  const [movForm, setMovForm] = useState<MovForm | null>(null);
  const [transferForm, setTransferForm] = useState<TransferForm | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [importRes, setImportRes] = useState<ImportResult | null>(null);
  const montoRef = useRef<HTMLInputElement>(null);

  // Por defecto ocultamos los conciliados (bloqueados), estilo YNAB.
  const [mostrarRec, setMostrarRec] = useState<boolean>(() => {
    if (searchParams.get("categoria")) return true; // al venir del presupuesto, mostrar todo
    try {
      return localStorage.getItem("mov_show_rec") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    localStorage.setItem("mov_show_rec", mostrarRec ? "1" : "0");
  }, [mostrarRec]);

  const baseFiltrados = movimientos.filter((m) => {
    const f = (m.fecha || "").slice(0, 10);
    if (fCuenta && m.cuenta !== fCuenta) return false;
    if (fCategoria && m.categoria !== fCategoria) return false;
    if (fTipo && m.tipo !== fTipo) return false;
    if (fDesde && f < fDesde) return false;
    if (fHasta && f > fHasta) return false;
    return true;
  });
  const filtrados = mostrarRec ? baseFiltrados : baseFiltrados.filter((m) => !m.reconciliado);
  const ocultosReconciliados = baseFiltrados.length - filtrados.length;

  // -------- orden por columna (persistido) --------
  const [sort, setSort] = useState<SortState>(() => {
    try {
      const s = localStorage.getItem("mov_sort");
      if (s) return JSON.parse(s);
    } catch {
      /* ignore */
    }
    return { key: "fecha", dir: "desc" };
  });
  useEffect(() => {
    localStorage.setItem("mov_sort", JSON.stringify(sort));
  }, [sort]);

  const toggleSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const sortVal = (m: Movimiento, key: string): string | number => {
    switch (key) {
      case "fecha":
        return (m.fecha || "").slice(0, 10);
      case "cuenta":
        return cuentaMap.get(m.cuenta)?.nombre ?? "";
      case "categoria":
        return m.categoria ? catMap.get(m.categoria)?.nombre ?? "" : "";
      case "tipo":
        return m.tipo;
      case "descripcion":
        return m.descripcion || "";
      case "monto":
        return m.monto;
      case "conciliado":
        return m.conciliado ? 1 : 0;
      default:
        return "";
    }
  };

  const ordenados = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtrados].sort((a, b) => {
      const va = sortVal(a, sort.key);
      const vb = sortVal(b, sort.key);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "es") * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, sort, cuentaMap, catMap]);

  // -------- ancho de columnas ajustable (persistido) --------
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const s = localStorage.getItem("mov_widths");
      if (s) {
        const arr = JSON.parse(s);
        if (Array.isArray(arr) && arr.length === DEFAULT_WIDTHS.length) return arr;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_WIDTHS;
  });
  useEffect(() => {
    localStorage.setItem("mov_widths", JSON.stringify(widths));
  }, [widths]);

  const resizing = useRef<{ i: number; startX: number; startW: number } | null>(null);
  const onResizing = useCallback((e: MouseEvent) => {
    const r = resizing.current;
    if (!r) return;
    const w = Math.max(48, r.startW + (e.clientX - r.startX));
    setWidths((prev) => prev.map((x, idx) => (idx === r.i ? w : x)));
  }, []);
  const onResizeEnd = useCallback(() => {
    resizing.current = null;
    document.removeEventListener("mousemove", onResizing);
    document.removeEventListener("mouseup", onResizeEnd);
    document.body.style.cursor = "";
  }, [onResizing]);
  const onResizeStart = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { i, startX: e.clientX, startW: widths[i] };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onResizing);
    document.addEventListener("mouseup", onResizeEnd);
  };

  // -------- crear ingreso/gasto --------
  const nuevoMov = () => {
    setError("");
    setFlash("");
    setMovForm({
      fecha: hoy(),
      cuenta: cuentas[0]?.id ?? "",
      tipo: "gasto",
      categoria: "",
      montoMag: "",
      descripcion: "",
      notas: "",
      conciliado: false,
      proximoMes: false,
    });
  };

  const editarMov = (m: Movimiento) => {
    setError("");
    setFlash("");
    if (m.tipo === "transferencia") {
      setMovForm({
        id: m.id,
        fecha: (m.fecha || "").slice(0, 10),
        cuenta: m.cuenta,
        tipo: "gasto",
        categoria: "",
        montoMag: "",
        descripcion: m.descripcion,
        notas: m.notas,
        conciliado: m.conciliado,
        proximoMes: false,
        lockedTransfer: true,
        origReadonly: {
          cuentaNombre: cuentaMap.get(m.cuenta)?.nombre ?? "",
          montoStr: formatMoney(m.monto, m.moneda),
          tipo: "transferencia",
        },
      });
    } else {
      setMovForm({
        id: m.id,
        fecha: (m.fecha || "").slice(0, 10),
        cuenta: m.cuenta,
        tipo: m.tipo,
        categoria: m.categoria,
        montoMag: centsToInput(Math.abs(m.monto)),
        descripcion: m.descripcion,
        notas: m.notas,
        conciliado: m.conciliado,
        proximoMes: m.ingreso_proximo_mes,
      });
    }
  };

  const submitMov = async (another = false) => {
    if (!movForm) return;
    setError("");
    try {
      if (movForm.lockedTransfer && movForm.id) {
        // solo campos permitidos en una pata de transferencia
        await saveMov.mutateAsync({
          id: movForm.id,
          fecha: movForm.fecha,
          descripcion: movForm.descripcion,
          notas: movForm.notas,
          conciliado: movForm.conciliado,
        });
        setMovForm(null);
        return;
      }
      const mag = parseAmountToCents(movForm.montoMag);
      if (Number.isNaN(mag) || mag <= 0) return setError("Monto inválido (usa un número > 0)");
      if (!movForm.cuenta) return setError("Selecciona una cuenta");
      if (!movForm.categoria) return setError("Selecciona una categoría");
      const monto = movForm.tipo === "ingreso" ? mag : -mag;
      await saveMov.mutateAsync({
        id: movForm.id,
        fecha: movForm.fecha,
        cuenta: movForm.cuenta,
        tipo: movForm.tipo as TipoMovimiento,
        categoria: movForm.categoria,
        monto,
        descripcion: movForm.descripcion,
        notas: movForm.notas,
        conciliado: movForm.conciliado,
        ingreso_proximo_mes: movForm.tipo === "ingreso" ? movForm.proximoMes : false,
      });
      if (another) {
        // Mantiene fecha, cuenta, tipo y categoría; limpia monto/descripción/notas
        // para capturar el siguiente movimiento rápido.
        setFlash(`✓ Guardado: ${movForm.descripcion || formatMoney(monto, cuentaMap.get(movForm.cuenta)?.moneda ?? "GTQ")}`);
        setMovForm({ ...movForm, id: undefined, montoMag: "", descripcion: "", notas: "" });
        setTimeout(() => montoRef.current?.focus(), 0);
      } else {
        setMovForm(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  // -------- crear transferencia --------
  const nuevaTransfer = () => {
    setError("");
    setTransferForm({
      fecha: hoy(),
      cuenta_origen: cuentas[0]?.id ?? "",
      cuenta_destino: cuentas[1]?.id ?? "",
      montoMag: "",
      tipo_cambio: "",
      descripcion: "",
      notas: "",
    });
  };

  // Corregir una transferencia existente (cambiar cuentas, monto, etc.).
  const editarTransfer = (m: Movimiento) => {
    setError("");
    const legs = transferGroups.get(m.transfer_id) ?? [];
    const origen = legs.find((l) => l.monto < 0);
    const destino = legs.find((l) => l.monto > 0);
    if (!origen || !destino) {
      alert("No se encontraron las dos patas de esta transferencia; no se puede editar.");
      return;
    }
    setTransferForm({
      transferId: m.transfer_id,
      fecha: (m.fecha || "").slice(0, 10),
      cuenta_origen: origen.cuenta,
      cuenta_destino: destino.cuenta,
      montoMag: centsToInput(Math.abs(origen.monto)),
      tipo_cambio: origen.tipo_cambio ? String(origen.tipo_cambio) : "",
      descripcion: m.descripcion,
      notas: m.notas,
    });
  };

  const monedaOrigen = transferForm ? cuentaMap.get(transferForm.cuenta_origen)?.moneda : undefined;
  const monedaDestino = transferForm
    ? cuentaMap.get(transferForm.cuenta_destino)?.moneda
    : undefined;
  const crossCurrency = !!monedaOrigen && !!monedaDestino && monedaOrigen !== monedaDestino;

  const submitTransfer = async () => {
    if (!transferForm) return;
    setError("");
    const mag = parseAmountToCents(transferForm.montoMag);
    if (Number.isNaN(mag) || mag <= 0) return setError("Monto inválido (> 0, en moneda de origen)");
    if (transferForm.cuenta_origen === transferForm.cuenta_destino)
      return setError("Las cuentas deben ser distintas");
    let tc: number | undefined;
    if (crossCurrency) {
      tc = Number(transferForm.tipo_cambio);
      if (!tc || tc <= 0) return setError("Indica un tipo de cambio > 0 (origen→destino)");
    }
    const payload = {
      fecha: transferForm.fecha,
      cuenta_origen: transferForm.cuenta_origen,
      cuenta_destino: transferForm.cuenta_destino,
      monto: mag,
      tipo_cambio: tc,
      descripcion: transferForm.descripcion,
      notas: transferForm.notas,
    };
    try {
      if (transferForm.transferId) {
        await updateTransfer.mutateAsync({ ...payload, transfer_id: transferForm.transferId });
      } else {
        await createTransfer.mutateAsync(payload);
      }
      setTransferForm(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar la transferencia");
    }
  };

  // -------- import / export --------
  const descargar = (csv: string, nombre: string) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onExport = () => {
    const csv = exportToCsv(movimientos, cuentaMap as Map<string, Cuenta>, catMap as Map<string, Categoria>);
    descargar(csv, `movimientos_${hoy()}.csv`);
  };

  const onExampleCsv = () => descargar(exampleCsv(), "ejemplo_importacion.csv");

  const onImportFile = async (file: File) => {
    setImportRes(null);
    const text = await file.text();
    const rows = csvToRows(text);
    try {
      const res = await importCsv.mutateAsync(rows);
      setImportRes(res);
    } catch (e: unknown) {
      // PocketBase devuelve el cuerpo en e.data o e.response
      const anyE = e as { data?: ImportResult; response?: ImportResult };
      setImportRes(anyE.data ?? anyE.response ?? { ok: false, importados: 0, errores: [{ fila: 0, errores: [String(e)] }] });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const catsParaTipo = categorias.filter((c) => c.tipo === movForm?.tipo);

  return (
    <div>
      <div className="page-head">
        <h2>Movimientos</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onExampleCsv} title="Descarga una plantilla con el formato esperado">
            CSV de ejemplo
          </button>
          <button onClick={onExport}>Exportar CSV</button>
          <button onClick={() => fileRef.current?.click()}>Importar CSV</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])}
          />
          <button onClick={nuevaTransfer}>+ Transferencia</button>
          <button className="primary" onClick={nuevoMov}>
            + Movimiento
          </button>
        </div>
      </div>

      {importRes && (
        <div className="card">
          {importRes.ok ? (
            <span className="pos">Importados {importRes.importados} movimientos correctamente.</span>
          ) : (
            <div>
              <strong className="neg">Importación cancelada (todo-o-nada). Errores:</strong>
              <ul>
                {importRes.errores.map((er, i) => (
                  <li key={i}>
                    {er.fila ? `Fila ${er.fila}: ` : ""}
                    {er.errores.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="link" onClick={() => setImportRes(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="field">
          <label>Cuenta</label>
          <select value={fCuenta} onChange={(e) => setFCuenta(e.target.value)}>
            <option value="">Todas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Categoría</label>
          <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={fTipo} onChange={(e) => setFTipo(e.target.value)}>
            <option value="">Todos</option>
            <option value="ingreso">Ingreso</option>
            <option value="gasto">Gasto</option>
            <option value="transferencia">Transferencia</option>
          </select>
        </div>
        <div className="field">
          <label>Desde</label>
          <input type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text)" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={mostrarRec}
              onChange={(e) => setMostrarRec(e.target.checked)}
            />
            Mostrar conciliados
            {!mostrarRec && ocultosReconciliados > 0 ? ` (${ocultosReconciliados})` : ""}
          </label>
        </div>
      </div>

      <table className="resizable">
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((col, idx) => (
              <th key={col.key} className={col.num ? "num" : ""}>
                <div className="th-inner">
                  {col.sortable ? (
                    <button className="th-sort" onClick={() => toggleSort(col.key)} title="Ordenar">
                      {col.label}
                      {sort.key === col.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  ) : (
                    col.label
                  )}
                </div>
                <span className="col-resizer" onMouseDown={(e) => onResizeStart(idx, e)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordenados.map((m) => {
            const flow = m.tipo === "transferencia" ? transferFlow(m) : null;
            return (
            <tr key={m.id} id={`mov-${m.id}`} className={highlightId === m.id ? "row-highlight" : ""}>
              <td>{(m.fecha || "").slice(0, 10)}</td>
              <td title={cuentaMap.get(m.cuenta)?.nombre ?? ""}>{cuentaMap.get(m.cuenta)?.nombre ?? "—"}</td>
              <td title={m.categoria ? catMap.get(m.categoria)?.nombre ?? "" : ""}>
                {m.categoria ? catMap.get(m.categoria)?.nombre ?? "—" : <span className="muted">—</span>}
              </td>
              <td>
                {m.tipo === "transferencia" ? (
                  <button
                    className="badge badge-link"
                    title="Ir a la otra pata de la transferencia"
                    onClick={() => jumpToSibling(m)}
                  >
                    transferencia ↗
                  </button>
                ) : (
                  <span className={m.tipo === "ingreso" ? "pos" : "neg"}>
                    {m.tipo}
                    {m.ingreso_proximo_mes && (
                      <span className="badge" title="Disponible para asignar el próximo mes">
                        {" "}↦ próx.
                      </span>
                    )}
                  </span>
                )}
              </td>
              {flow ? (
                <td title={`${flow.origenNombre} → ${flow.destinoNombre}${m.descripcion ? " · " + m.descripcion : ""}`}>
                  <span className={m.monto < 0 ? "tf-this" : "tf-other"}>{flow.origenNombre}</span>
                  {" → "}
                  <span className={m.monto > 0 ? "tf-this" : "tf-other"}>{flow.destinoNombre}</span>
                  {m.descripcion ? <span className="muted"> · {m.descripcion}</span> : null}
                </td>
              ) : (
                <td title={m.descripcion}>{m.descripcion}</td>
              )}
              <td className={"num " + (m.monto < 0 ? "neg" : "pos")}>
                {formatMoney(m.monto, m.moneda)}
              </td>
              <td>
                {m.reconciliado ? (
                  <span title="Conciliado (bloqueado tras reconcile)">🔒</span>
                ) : (
                  <input
                    type="checkbox"
                    title="Confirmado / cleared: ya apareció en el banco"
                    checked={m.conciliado}
                    onChange={(e) => toggle.mutate({ id: m.id, conciliado: e.target.checked })}
                  />
                )}
              </td>
              <td className="num">
                <button
                  className="link"
                  onClick={() => (m.tipo === "transferencia" ? editarTransfer(m) : editarMov(m))}
                >
                  Editar
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm("¿Eliminar este movimiento? (soft delete)")) delMov.mutate(m.id);
                  }}
                >
                  Eliminar
                </button>
              </td>
            </tr>
            );
          })}
          {ordenados.length === 0 && (
            <tr>
              <td colSpan={COLS.length} className="muted">
                Sin movimientos.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Modal Movimiento (ingreso/gasto) */}
      {movForm && (
        <Modal
          title={movForm.lockedTransfer ? "Editar transferencia" : movForm.id ? "Editar movimiento" : "Nuevo movimiento"}
          onClose={() => setMovForm(null)}
        >
          {movForm.lockedTransfer && movForm.origReadonly && (
            <p className="muted">
              Pata de transferencia ({movForm.origReadonly.cuentaNombre},{" "}
              {movForm.origReadonly.montoStr}). Solo puedes cambiar fecha, descripción, notas y
              conciliación. El monto/cuenta se editan recreando la transferencia.
            </p>
          )}
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              value={movForm.fecha}
              onChange={(e) => setMovForm({ ...movForm, fecha: e.target.value })}
            />
          </div>

          {!movForm.lockedTransfer && (
            <>
              <div className="row">
                <div className="field">
                  <label>Tipo</label>
                  <select
                    value={movForm.tipo}
                    onChange={(e) =>
                      setMovForm({ ...movForm, tipo: e.target.value as "ingreso" | "gasto", categoria: "" })
                    }
                  >
                    <option value="gasto">Gasto</option>
                    <option value="ingreso">Ingreso</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cuenta</label>
                  <select
                    value={movForm.cuenta}
                    onChange={(e) => setMovForm({ ...movForm, cuenta: e.target.value })}
                  >
                    {cuentas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre} ({c.moneda})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label>Categoría (escribe para buscar)</label>
                  <Combobox
                    options={catsParaTipo.map((c) => ({ value: c.id, label: c.nombre }))}
                    value={movForm.categoria}
                    onChange={(value) => setMovForm({ ...movForm, categoria: value })}
                    placeholder="— Selecciona —"
                  />
                </div>
                <div className="field">
                  <label>Monto ({cuentaMap.get(movForm.cuenta)?.moneda ?? ""}, positivo)</label>
                  <input
                    ref={montoRef}
                    value={movForm.montoMag}
                    placeholder="0.00"
                    onChange={(e) => setMovForm({ ...movForm, montoMag: e.target.value })}
                  />
                </div>
              </div>
              {movForm.tipo === "ingreso" && (
                <div className="field">
                  <label>
                    <input
                      type="checkbox"
                      checked={movForm.proximoMes}
                      style={{ width: "auto", marginRight: 6 }}
                      onChange={(e) => setMovForm({ ...movForm, proximoMes: e.target.checked })}
                    />
                    Este ingreso es para el próximo mes
                  </label>
                  <span className="muted">
                    Mantiene la fecha real, pero queda disponible para asignar el mes siguiente.
                  </span>
                </div>
              )}
            </>
          )}

          <div className="field">
            <label>Descripción</label>
            <input
              value={movForm.descripcion}
              onChange={(e) => setMovForm({ ...movForm, descripcion: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Notas</label>
            <textarea
              rows={2}
              value={movForm.notas}
              onChange={(e) => setMovForm({ ...movForm, notas: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={movForm.conciliado}
                style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setMovForm({ ...movForm, conciliado: e.target.checked })}
              />
              Confirmado (ya apareció en el banco)
            </label>
          </div>
          {flash && <div className="flash">{flash}</div>}
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setMovForm(null)}>Cancelar</button>
            {!movForm.id && !movForm.lockedTransfer && (
              <button onClick={() => submitMov(true)} disabled={saveMov.isPending}>
                Guardar y otro
              </button>
            )}
            <button className="primary" onClick={() => submitMov(false)} disabled={saveMov.isPending}>
              Guardar
            </button>
          </div>
        </Modal>
      )}

      {/* Modal Transferencia */}
      {transferForm && (
        <Modal
          title={transferForm.transferId ? "Editar transferencia" : "Nueva transferencia"}
          onClose={() => setTransferForm(null)}
        >
          <div className="field">
            <label>Fecha</label>
            <input
              type="date"
              value={transferForm.fecha}
              onChange={(e) => setTransferForm({ ...transferForm, fecha: e.target.value })}
            />
          </div>
          <div className="row">
            <div className="field">
              <label>Cuenta origen</label>
              <select
                value={transferForm.cuenta_origen}
                onChange={(e) => setTransferForm({ ...transferForm, cuenta_origen: e.target.value })}
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.moneda})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Cuenta destino</label>
              <select
                value={transferForm.cuenta_destino}
                onChange={(e) => setTransferForm({ ...transferForm, cuenta_destino: e.target.value })}
              >
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.moneda})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Monto a transferir (en {monedaOrigen ?? "origen"})</label>
            <input
              value={transferForm.montoMag}
              placeholder="0.00"
              onChange={(e) => setTransferForm({ ...transferForm, montoMag: e.target.value })}
            />
          </div>
          {crossCurrency && (
            <div className="field">
              <label>
                Tipo de cambio {monedaOrigen}→{monedaDestino} (monto_destino = monto × tc)
              </label>
              <input
                value={transferForm.tipo_cambio}
                placeholder="0.0000"
                onChange={(e) => setTransferForm({ ...transferForm, tipo_cambio: e.target.value })}
              />
              <span className="muted">
                Ej: {monedaOrigen}→{monedaDestino}: si 1 {monedaOrigen} = 0.13 {monedaDestino},
                escribe 0.13
              </span>
            </div>
          )}
          <div className="field">
            <label>Descripción</label>
            <input
              value={transferForm.descripcion}
              onChange={(e) => setTransferForm({ ...transferForm, descripcion: e.target.value })}
            />
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setTransferForm(null)}>Cancelar</button>
            <button
              className="primary"
              onClick={submitTransfer}
              disabled={createTransfer.isPending || updateTransfer.isPending}
            >
              {transferForm.transferId ? "Guardar cambios" : "Crear transferencia"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
