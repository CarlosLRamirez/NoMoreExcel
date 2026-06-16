/// <reference path="../pb_data/types.d.ts" />

// Al ELIMINAR un usuario (cierre de cuenta / cleanup), borrar primero TODOS sus
// movimientos para que el cascade hacia cuentas/categorias no intente poner en null
// relaciones requeridas (lo cual dispararía las invariantes y abortaría el borrado).
// Corre dentro de la misma transacción que el delete del usuario.
onRecordDelete((e) => {
  const movs = e.app.findRecordsByFilter("movimientos", "usuario = {:u}", "", 0, 0, {
    u: e.record.id,
  });
  for (const m of movs) {
    e.app.delete(m);
  }
  e.next();
}, "users");

// Al registrarse un usuario, crear su registro `settings` con valores por defecto
// (moneda_base = GTQ). Un registro de settings por usuario.
onRecordAfterCreateSuccess((e) => {
  try {
    const col = e.app.findCollectionByNameOrId("settings");
    const s = new Record(col);
    s.set("usuario", e.record.id);
    s.set("moneda_base", "GTQ");
    s.set("tipo_cambio_usd", 0);
    e.app.save(s);

    // Grupos y categorías por defecto (genéricos) para el usuario nuevo (con orden).
    const GRUPOS = [
      { nombre: "Ingresos", tipo: "ingreso", cats: ["Salario", "Otros ingresos"] },
      { nombre: "Vivienda", tipo: "gasto", cats: ["Renta/Hipoteca", "Electricidad", "Agua", "Gas", "Internet"] },
      { nombre: "Alimentación", tipo: "gasto", cats: ["Supermercado", "Restaurantes"] },
      { nombre: "Transporte", tipo: "gasto", cats: ["Combustible", "Transporte público", "Mantenimiento vehículo"] },
      { nombre: "Servicios y Suscripciones", tipo: "gasto", cats: ["Teléfono", "Streaming"] },
      { nombre: "Salud", tipo: "gasto", cats: ["Médico", "Medicamentos", "Seguros"] },
      { nombre: "Educación", tipo: "gasto", cats: ["Colegiatura", "Útiles"] },
      { nombre: "Personal", tipo: "gasto", cats: ["Ropa", "Entretenimiento", "Cuidado personal"] },
      { nombre: "Financiero", tipo: "gasto", cats: ["Comisiones bancarias", "Pago de tarjeta"] },
      { nombre: "Otros", tipo: "gasto", cats: ["Imprevistos", "Regalos"] },
      // Categorías excluidas del presupuesto/reportes (ajustes/puesta al día).
      { nombre: "Ajustes", tipo: "ingreso", excluir: true, cats: ["Ajuste de patrimonio"] },
    ];

    const grupoCol = e.app.findCollectionByNameOrId("grupos");
    const catCol = e.app.findCollectionByNameOrId("categorias");
    GRUPOS.forEach((g, gi) => {
      const grupo = new Record(grupoCol);
      grupo.set("usuario", e.record.id);
      grupo.set("nombre", g.nombre);
      grupo.set("orden", gi);
      grupo.set("activa", true);
      e.app.save(grupo);

      g.cats.forEach((nombre, ci) => {
        const c = new Record(catCol);
        c.set("usuario", e.record.id);
        c.set("nombre", nombre);
        c.set("tipo", g.tipo);
        c.set("grupo", grupo.id);
        c.set("orden", ci);
        c.set("activa", true);
        c.set("excluir_presupuesto", !!g.excluir);
        e.app.save(c);
      });
    });
  } catch (err) {
    e.app.logger().error("No se pudo inicializar el usuario", "error", String(err));
  }
  e.next();
}, "users");
