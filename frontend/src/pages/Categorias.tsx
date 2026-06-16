import { useState } from "react";
import {
  useCategorias,
  useDeleteCategoria,
  useSaveCategoria,
  useGrupos,
  useSaveGrupo,
  useDeleteGrupo,
} from "../hooks/queries";
import { Modal } from "../components/Modal";
import { pb } from "../lib/pb";
import type { Categoria, TipoCategoria } from "../lib/types";

interface CatForm {
  id?: string;
  nombre: string;
  tipo: TipoCategoria;
  grupo: string;
  activa: boolean;
  excluir: boolean;
  origGrupo?: string;
}
interface GrupoForm {
  id?: string;
  nombre: string;
  activa: boolean;
}

export function Categorias() {
  const { data: grupos = [] } = useGrupos();
  const { data: cats = [] } = useCategorias();
  const saveCat = useSaveCategoria();
  const delCat = useDeleteCategoria();
  const saveGrupo = useSaveGrupo();
  const delGrupo = useDeleteGrupo();

  const [catForm, setCatForm] = useState<CatForm | null>(null);
  const [grupoForm, setGrupoForm] = useState<GrupoForm | null>(null);
  const [error, setError] = useState("");

  const catsDeGrupo = (gid: string) =>
    cats.filter((c) => (c.grupo || "") === gid).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const sinGrupo = catsDeGrupo("");

  // Renumera orden = índice para los que cambian, y persiste solo esos.
  const persistOrden = async (
    items: { id: string; orden?: number }[],
    save: (d: { id: string; orden: number }) => Promise<unknown>
  ) => {
    await Promise.all(
      items.map((it, i) => (it.orden !== i ? save({ id: it.id, orden: i }) : null)).filter(Boolean) as Promise<unknown>[]
    );
  };

  const moveGrupo = async (idx: number, dir: number) => {
    const j = idx + dir;
    if (j < 0 || j >= grupos.length) return;
    const arr = [...grupos];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    await persistOrden(arr, (d) => saveGrupo.mutateAsync(d));
  };

  const moveCat = async (cat: Categoria, dir: number) => {
    const sibs = catsDeGrupo(cat.grupo || "");
    const idx = sibs.findIndex((c) => c.id === cat.id);
    const j = idx + dir;
    if (j < 0 || j >= sibs.length) return;
    const arr = [...sibs];
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    await persistOrden(arr, (d) => saveCat.mutateAsync(d));
  };

  // Borrar categoría con validación previa: si tiene movimientos (incluso eliminados),
  // no se puede borrar (rompería invariantes); se ofrece desactivarla.
  const handleDeleteCat = async (c: Categoria) => {
    try {
      const res = await pb.collection("movimientos").getList(1, 1, { filter: `categoria="${c.id}"` });
      if (res.totalItems > 0) {
        if (
          confirm(
            `"${c.nombre}" tiene ${res.totalItems} movimiento(s) asociados, así que no se puede eliminar.\n\n` +
              `¿Quieres desactivarla? Dejará de aparecer al crear movimientos, pero conservas su historial y sus reportes.`
          )
        ) {
          await saveCat.mutateAsync({ id: c.id, activa: false });
        }
        return;
      }
      if (confirm(`¿Eliminar "${c.nombre}"?`)) await delCat.mutateAsync(c.id);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "No se pudo eliminar la categoría");
    }
  };

  // ---- categoría ----
  const nuevaCat = (grupo = "") =>
    setCatForm({ nombre: "", tipo: "gasto", grupo, activa: true, excluir: false });
  const editarCat = (c: Categoria) =>
    setCatForm({
      id: c.id,
      nombre: c.nombre,
      tipo: c.tipo,
      grupo: c.grupo || "",
      activa: c.activa,
      excluir: c.excluir_presupuesto,
      origGrupo: c.grupo || "",
    });

  const submitCat = async () => {
    if (!catForm) return;
    setError("");
    if (!catForm.nombre.trim()) return setError("El nombre es requerido");
    const cambioGrupo = !catForm.id || catForm.origGrupo !== catForm.grupo;
    const orden = cambioGrupo ? catsDeGrupo(catForm.grupo).length : undefined;
    try {
      await saveCat.mutateAsync({
        id: catForm.id,
        nombre: catForm.nombre.trim(),
        tipo: catForm.tipo,
        grupo: catForm.grupo || "",
        activa: catForm.activa,
        excluir_presupuesto: catForm.excluir,
        ...(orden !== undefined ? { orden } : {}),
      });
      setCatForm(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  // ---- grupo ----
  const submitGrupo = async () => {
    if (!grupoForm) return;
    setError("");
    if (!grupoForm.nombre.trim()) return setError("El nombre del grupo es requerido");
    try {
      await saveGrupo.mutateAsync({
        id: grupoForm.id,
        nombre: grupoForm.nombre.trim(),
        activa: grupoForm.activa,
        ...(grupoForm.id ? {} : { orden: grupos.length }),
      });
      setGrupoForm(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al guardar el grupo");
    }
  };

  const renderCats = (lista: Categoria[]) => (
    <div className="cat-list">
      {lista.map((c, i) => (
        <div className="cat-row" key={c.id}>
          <span className="ord-btns">
            <button className="link" disabled={i === 0} onClick={() => moveCat(c, -1)} title="Subir">
              ↑
            </button>
            <button
              className="link"
              disabled={i === lista.length - 1}
              onClick={() => moveCat(c, 1)}
              title="Bajar"
            >
              ↓
            </button>
          </span>
          <span className="cat-name">{c.nombre}</span>
          <span className={"badge " + (c.tipo === "ingreso" ? "pos" : "neg")}>{c.tipo}</span>
          {!c.activa && <span className="muted">inactiva</span>}
          {c.excluir_presupuesto && <span className="badge" title="No cuenta en presupuesto ni reportes">excluida</span>}
          <span className="spacer" />
          <button className="link" onClick={() => editarCat(c)}>
            Editar
          </button>
          <button className="link danger" onClick={() => handleDeleteCat(c)}>
            Eliminar
          </button>
        </div>
      ))}
      {lista.length === 0 && <div className="muted cat-empty">Sin categorías en este grupo.</div>}
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <h2>Categorías</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setGrupoForm({ nombre: "", activa: true })}>+ Nuevo grupo</button>
          <button className="primary" onClick={() => nuevaCat(grupos[0]?.id ?? "")}>
            + Nueva categoría
          </button>
        </div>
      </div>

      {grupos.map((g, gi) => {
        const lista = catsDeGrupo(g.id);
        return (
          <div className="card grupo-card" key={g.id}>
            <div className="grupo-head">
              <span className="ord-btns">
                <button className="link" disabled={gi === 0} onClick={() => moveGrupo(gi, -1)} title="Subir grupo">
                  ↑
                </button>
                <button
                  className="link"
                  disabled={gi === grupos.length - 1}
                  onClick={() => moveGrupo(gi, 1)}
                  title="Bajar grupo"
                >
                  ↓
                </button>
              </span>
              <strong>{g.nombre}</strong>
              <span className="muted">({lista.length})</span>
              <span className="spacer" />
              <button className="link" onClick={() => nuevaCat(g.id)}>
                + Categoría
              </button>
              <button className="link" onClick={() => setGrupoForm({ id: g.id, nombre: g.nombre, activa: g.activa })}>
                Renombrar
              </button>
              <button
                className="link danger"
                onClick={() => {
                  if (
                    confirm(
                      `¿Eliminar el grupo "${g.nombre}"? Sus categorías quedarán sin grupo (no se borran).`
                    )
                  )
                    delGrupo.mutate(g.id);
                }}
              >
                Eliminar
              </button>
            </div>
            {renderCats(lista)}
          </div>
        );
      })}

      {sinGrupo.length > 0 && (
        <div className="card grupo-card">
          <div className="grupo-head">
            <strong>Sin grupo</strong>
            <span className="muted">({sinGrupo.length})</span>
          </div>
          {renderCats(sinGrupo)}
        </div>
      )}

      {/* Modal categoría */}
      {catForm && (
        <Modal title={catForm.id ? "Editar categoría" : "Nueva categoría"} onClose={() => setCatForm(null)}>
          <div className="field">
            <label>Nombre</label>
            <input value={catForm.nombre} onChange={(e) => setCatForm({ ...catForm, nombre: e.target.value })} />
          </div>
          <div className="row">
            <div className="field">
              <label>Tipo</label>
              <select
                value={catForm.tipo}
                onChange={(e) => setCatForm({ ...catForm, tipo: e.target.value as TipoCategoria })}
              >
                <option value="gasto">Gasto</option>
                <option value="ingreso">Ingreso</option>
              </select>
            </div>
            <div className="field">
              <label>Grupo</label>
              <select value={catForm.grupo} onChange={(e) => setCatForm({ ...catForm, grupo: e.target.value })}>
                <option value="">— Sin grupo —</option>
                {grupos.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={catForm.activa}
                style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setCatForm({ ...catForm, activa: e.target.checked })}
              />
              Activa
            </label>
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={catForm.excluir}
                style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setCatForm({ ...catForm, excluir: e.target.checked })}
              />
              Excluir del presupuesto y reportes
            </label>
            <span className="muted">No cuenta en las sumas del presupuesto ni en el reporte de gasto por categoría.</span>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setCatForm(null)}>Cancelar</button>
            <button className="primary" onClick={submitCat} disabled={saveCat.isPending}>
              Guardar
            </button>
          </div>
        </Modal>
      )}

      {/* Modal grupo */}
      {grupoForm && (
        <Modal title={grupoForm.id ? "Renombrar grupo" : "Nuevo grupo"} onClose={() => setGrupoForm(null)}>
          <div className="field">
            <label>Nombre del grupo</label>
            <input
              value={grupoForm.nombre}
              onChange={(e) => setGrupoForm({ ...grupoForm, nombre: e.target.value })}
            />
          </div>
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={grupoForm.activa}
                style={{ width: "auto", marginRight: 6 }}
                onChange={(e) => setGrupoForm({ ...grupoForm, activa: e.target.checked })}
              />
              Activo
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="modal-actions">
            <button onClick={() => setGrupoForm(null)}>Cancelar</button>
            <button className="primary" onClick={submitGrupo} disabled={saveGrupo.isPending}>
              Guardar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
