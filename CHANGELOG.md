# Changelog

Todas las versiones notables de NoMoreExcel.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/)
y el proyecto usa [SemVer](https://semver.org/lang/es/).

## [1.4.0] - 2026-06-16

### Cambiado
- **Patrimonio a costo histórico (multimoneda).** El patrimonio consolidado ya no
  usa una sola tasa global para valuar los saldos en USD; ahora cada movimiento y
  saldo inicial extranjero guarda su tasa (`movimientos.tc_base`,
  `cuentas.tc_base_inicial`). Las transferencias cross-currency se valúan a su tasa
  real y quedan en **residuo 0** (eliminan la ganancia/pérdida cambiaria artificial);
  las compras/ingresos en USD se congelan a la tasa del momento.
- `POST /api/transfers` y `/api/transfers/update` fijan `tc_base` por pata; el hook de
  movimientos congela el resto. Migración `1750000700` agrega los campos y rellena
  datos existentes (transferencias a su tasa real, demás USD a la tasa global vigente).
- `finance.patrimonio` calcula el consolidado por costo histórico; `scripts/diagnose.mjs`
  reporta el patrimonio histórico y el residuo de transferencias.

## [1.3.0] - 2026-06-16

### Añadido
- Botón **"Asignar lo gastado"** en el panel de Presupuesto (estilo YNAB "budget =
  activity"): pone el Asignado de cada categoría visible igual a su Gastado del mes,
  dejando el aporte del mes en 0. Como el Gastado ya está en centavos enteros de la
  moneda base, los gastos hechos en dólares cuadran exacto en 0 (sin desfase por
  redondeo). Mutación en lote `useAssignSpent`.

## [1.2.0] - 2026-06-16

### Añadido
- **Ajuste de patrimonio / puesta al día**: las categorías marcadas como excluidas
  ahora también quedan fuera del **"Disponible para asignar"** y del reporte de
  **ingreso vs gasto**. Esto permite registrar una entrada de dinero que "te pone al
  día" (resetea tu patrimonio hacia 0) usando una categoría excluida: **sube el saldo
  de la cuenta / patrimonio**, queda registrada y auditable, pero **no afecta
  presupuesto ni reportes**. Los usuarios nuevos nacen con el grupo "Ajustes" y la
  categoría "Ajuste de patrimonio" (excluida).

### Cambiado
- `disponibleParaAsignar` e `ingresoVsGastoPorMes` aceptan un set de categorías
  excluidas y las ignoran.

## [1.1.0] - 2026-06-16

### Añadido
- **Saldo acumulado por categoría (sinking funds), estilo YNAB**: en el panel de
  Presupuesto, la columna "Disponible" de cada categoría ahora es el **saldo rodante**
  = `Σ asignado − Σ gastado` de todos los meses hasta el mes en curso. Lo que no gastas
  se acumula mes a mes (ideal para metas: Vacaciones, Fondo de emergencia, etc.), y el
  saldo negativo (sobregasto acumulado) se muestra en rojo. El total del grupo y del mes
  reflejan el acumulado; la barra de avance compara el gasto del mes contra lo disponible
  al inicio del mes. El export CSV usa el mismo saldo acumulado.
- Helper `balancesCategoria` en `frontend/src/lib/finance.ts`.

## [1.0.0] - 2026-06-16

Primer release. App de finanzas personales multi-usuario, local-first, con
PocketBase como backend (v0.39.4) y frontend React + Vite + TypeScript.

### Núcleo
- **Dinero en enteros (centavos)** en toda la aritmética; el formateo a `Q1,234.56`
  es solo presentación. Moneda base GTQ; soporta GTQ y USD.
- **Saldos calculados, no almacenados** (`saldo_inicial + Σ montos`).
- Esquema reproducible vía **migraciones** e invariantes críticas en **hooks JS**
  de PocketBase. Acceso por dueño en todas las colecciones (multi-usuario).
- Auth con la colección `users` (registro/login). Usuario nuevo nace con `settings`
  y un set de **grupos/categorías por defecto**.

### Cuentas y categorías
- CRUD de cuentas (monetaria, ahorro, tarjeta de crédito, efectivo).
- **Grupos de categorías** con orden configurable (↑/↓), categorías ordenables
  dentro de cada grupo, y categorías marcables como **excluidas del presupuesto/reportes**.
- Validación al borrar: no se elimina una cuenta/categoría con movimientos (se ofrece
  desactivar).

### Movimientos
- CRUD con soft delete; invariantes server-side (monto entero, moneda = la de la
  cuenta, coherencia de signo, categoría requerida en ingreso/gasto).
- **Transferencias atómicas de dos patas**, incluida cross-currency con tipo de cambio;
  edición de transferencias (corrige ambas patas) y navegación entre patas.
- Tabla con orden por columna y anchos de columna ajustables (persistidos).
- Filtros por cuenta, categoría, tipo y fechas.

### Conciliación (estilo YNAB)
- Estado **confirmado/cleared** por movimiento y **reconcile** por cuenta (compara el
  saldo confirmado con el saldo real del banco, crea ajuste por la diferencia y bloquea).
- Los conciliados se ocultan por defecto, con toggle para mostrarlos.

### Presupuesto (estilo YNAB)
- Presupuesto **mensual por categoría**, total por grupo, barra de avance gastado vs
  presupuestado (roja al pasarse), navegación mes a mes.
- **Disponible para asignar** con rollover: el ingreso queda disponible el mes en que
  se recibe y lo no asignado se acumula; flag **"ingreso para el próximo mes"** para
  salarios pagados a fin de mes (sin trucar fechas).
- Copiar presupuesto del mes anterior; exportar el mes a CSV.

### Reportes y alertas
- Reporte de gasto por categoría (agrupado, en orden) e ingreso vs gasto por mes,
  consolidados a moneda base.
- **Alertas** en el Resumen: dinero sin asignar / sobre-asignado, movimientos sin
  categoría, categorías sobregiradas, tipo de cambio USD sin configurar.

### Import / Export
- **Importar CSV** todo-o-nada con reporte de errores por fila (tolera símbolos de
  moneda y separadores de miles); **exportar CSV** y descarga de **CSV de ejemplo**.

### Verificación
- `scripts/verify.mjs` valida los criterios de aceptación (13 checks).
