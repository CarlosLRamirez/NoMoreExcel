# App de Finanzas Personales — v1

Aplicación de finanzas personales multi-usuario, **local-first** y lista para desplegar en la nube.

- **Backend / DB / Auth / API / Admin:** [PocketBase](https://pocketbase.io) **v0.39.4** (versión PINEADA). PocketBase **es** el backend; no hay servidor Node/Express aparte.
- **Frontend:** React + Vite + TypeScript, SDK oficial `pocketbase`, data fetching con TanStack Query.
- **Lógica crítica de servidor:** hooks JS de PocketBase (`pb/pb_hooks/*.pb.js`).
- **Esquema reproducible:** migraciones (`pb/pb_migrations/*.js`). No se configura nada a mano en el admin UI.

## Reglas de dinero (no negociables)

- **Dinero = enteros en centavos** (campos `number` con `onlyInt`). Nunca float ni texto decimal. Toda la aritmética (también en el frontend) se hace en enteros; el formateo `Q1,234.56` es solo presentación (`Intl.NumberFormat`).
- **Moneda base = GTQ.** Monedas soportadas: `GTQ`, `USD`.
- **Saldos NO se guardan**: se computan como `saldo_inicial + SUMA(montos no eliminados)`.
- **IDs** = strings aleatorios de PocketBase. `created`/`updated` automáticos. **Soft delete** (`eliminado`) en `movimientos`.
- **Signo:** negativo = sale de la cuenta, positivo = entra.

---

## Estructura

```
pb/
  pb_migrations/   Esquema: colecciones, campos, reglas de acceso, índices
  pb_hooks/        Invariantes + endpoints (transferencias, import)
  pocketbase       Binario (descargado por script, no versionado)
  pb_data/         Datos (no versionado)
frontend/          React + Vite + TS
scripts/
  download-pocketbase.sh   Descarga el binario PINEADO
  verify.mjs               Verifica los 5 criterios de aceptación
```

---

## Cómo correr (local)

### 1) Backend — PocketBase

```bash
# Descarga el binario pineado (v0.39.4) para tu SO/arquitectura
./scripts/download-pocketbase.sh

# Crea el superusuario del panel admin (una sola vez)
cd pb
./pocketbase superuser upsert admin@example.com TuPasswordSegura

# Arranca el servidor (aplica migraciones y carga los hooks automáticamente)
./pocketbase serve
```

- API REST:  `http://127.0.0.1:8090/api/`
- Panel admin: `http://127.0.0.1:8090/_/`

Las migraciones de `pb/pb_migrations/` se aplican solas al arrancar; crean las colecciones `cuentas`, `categorias`, `movimientos`, `settings` y añaden `nombre` a `users`.

### 2) Frontend — React/Vite

```bash
cd frontend
cp .env.example .env        # ajusta VITE_PB_URL si tu PocketBase no está en el default
npm install
npm run dev                 # http://localhost:5173
```

`.env`:

```
VITE_PB_URL=http://127.0.0.1:8090
```

Regístrate desde la pantalla de login (registro público). Al crear el usuario se generan automáticamente su registro `settings` (moneda base GTQ) y un set de **categorías por defecto** (gastos e ingresos), vía el hook `pb/pb_hooks/settings.pb.js`.

---

## Modelo de datos (colecciones)

- **users** (auth): campos por defecto + `nombre`.
- **cuentas**: `usuario`, `nombre`, `tipo` (`monetaria|ahorro|tarjeta_credito|efectivo`), `moneda` (`GTQ|USD`), `saldo_inicial` (centavos), `limite_credito`/`dia_corte`/`dia_pago` (solo TC), `activa`.
- **grupos**: `usuario`, `nombre`, `orden`, `activa` — grupos de categorías (estilo YNAB).
- **categorias**: `usuario`, `nombre`, `tipo` (`ingreso|gasto`), `grupo` (relation→grupos), `orden` (dentro del grupo), `padre` (reservado), `activa`.
- **movimientos**: `usuario`, `fecha`, `cuenta`, `categoria`, `tipo` (`ingreso|gasto|transferencia`), `monto` (centavos con signo), `moneda` (= `cuenta.moneda`, denormalizada), `descripcion`, `transfer_id`, `tipo_cambio` (solo cross-currency), `conciliado`, `eliminado`, `notas`.
- **presupuestos**: `usuario`, `categoria`, `mes` (`YYYY-MM`), `monto` (centavos, en moneda_base). Único por `(usuario, categoria, mes)`. Presupuesto mensual por categoría (estilo YNAB); el total del grupo se calcula como suma de sus categorías.
- **settings**: `usuario`, `moneda_base`, `tipo_cambio_usd` (USD→GTQ manual, solo para consolidar).

Acceso a todas las colecciones de datos: **solo el dueño** (`@request.auth.id = usuario`).
Índices en `movimientos`: `usuario`, `fecha`, `cuenta`, `categoria`, `transfer_id`, `tipo`.

### Previsto para v2 (no construido, esquema ya compatible)

Recurrentes, presupuestos por categoría, adjuntos/recibos, etiquetas, sync offline. Compatible gracias a IDs string, timestamps y soft delete.

---

## Invariantes (en hooks, no solo en el cliente)

Implementadas en `pb/pb_hooks/`:

- `monto` debe ser entero (`movimientos.pb.js`).
- `movimientos.moneda` se fija automáticamente a `cuenta.moneda`.
- `tipo=transferencia` ⇒ `categoria` vacía y `transfer_id` presente.
- `tipo` en (`ingreso`,`gasto`) ⇒ `categoria` requerida, `transfer_id` vacío y coherencia de signo (`ingreso>0`, `gasto<0`).
- La cuenta/categoría deben pertenecer al usuario.
- **No se pueden crear patas de transferencia a mano** por la API de colección (`guards.pb.js`); ni editar sus campos núcleo.
- Una **tarjeta de crédito** es un pasivo: las compras son `gasto` (negativo); el **pago de la TC es una transferencia**, nunca un gasto.
- **No se puede eliminar una cuenta o categoría que tenga movimientos** (rompería las invariantes al anular relaciones requeridas); la API responde con un mensaje claro. Para “archivarlas”, usa `activa = false`. Al **eliminar un usuario** se borran primero sus movimientos y luego en cascada cuentas/categorías/settings.

## Endpoints de servidor (custom)

- `POST /api/transfers` — crea una transferencia como **operación atómica que inserta las DOS patas** en una transacción.
  - Body: `{ fecha, cuenta_origen, cuenta_destino, monto (centavos positivos, moneda de origen), tipo_cambio?, descripcion?, notas? }`
  - Misma moneda: patas con mismo `|monto|` y signo opuesto.
  - Distinta moneda: `monto_destino = round(monto * tipo_cambio)`; ambas patas guardan `tipo_cambio`.
- `POST /api/transfers/update` — **corrige** una transferencia existente actualizando AMBAS patas de forma atómica (body con `transfer_id` + los mismos campos que crear). Útil cuando te equivocaste de cuenta de origen/destino, monto o tipo de cambio; las patas quedan como no confirmadas para volver a conciliar.
- `POST /api/import` — importación de movimientos **todo-o-nada** (transacción). Resuelve `cuenta`/`categoria` por nombre (si no existen, **falla** con reporte de errores por fila), convierte `monto` decimal → centavos enteros, valida transferencias balanceadas por `transfer_id`.
- `POST /api/budget/set` — fija (upsert) el presupuesto de una categoría para un mes. Body `{ categoria, mes (YYYY-MM), monto (centavos) }`. `monto=0` elimina el registro. Único por `(usuario, categoria, mes)`.
- `POST /api/budget/copy` — copia (atómico) los presupuestos del mes anterior al mes indicado. Body `{ mes (YYYY-MM) }`. Sobrescribe los montos del mes destino para las categorías presupuestadas el mes previo.
- `POST /api/reconcile` — conciliación estilo **YNAB** (atómica). Body `{ cuenta, saldo_real (centavos), fecha? }`. Compara el **saldo confirmado** (suma de movimientos con `conciliado=true`) con el saldo real del banco; si difieren crea un movimiento de **ajuste** (categoría "Ajuste de conciliación"), y marca como `reconciliado` (bloqueado) todos los confirmados. Los movimientos sin confirmar (flotantes) no se tocan.

### Conciliación (modelo YNAB)

- `movimientos.conciliado` = **confirmado / "cleared"**: el movimiento ya apareció en el banco (toggle por movimiento en la lista).
- `movimientos.reconciliado` = **bloqueado** tras un reconcile (reconciled ⇒ conciliado; se enforce en hook).
- `cuentas.ultima_conciliacion` = fecha del último reconcile.
- En el **Resumen** cada cuenta muestra el saldo de trabajo (todo) y el **confirmado** (cleared); el botón **Conciliar** abre el flujo: ingresas el saldo real del banco y el sistema cuadra (crea ajuste si hace falta) y bloquea los confirmados.

### Dinero disponible para asignar y alertas

- **Disponible para asignar (modelo YNAB)**: el ingreso queda disponible **el mes en que se recibe** y lo que **no asignas se acumula** (rollover) a los meses siguientes. Para el mes M: `Disponible = arrastrado del mes anterior + ingresos de M − asignado en M`, equivalente a `Σ ingresos con fecha ≤ fin de M − Σ presupuestos de meses ≤ M`. Negativo = asignaste de más (rojo en el panel de Presupuesto, que muestra el desglose). Cálculo en `frontend/src/lib/finance.ts` (`disponibleParaAsignar`). No hay paso manual de "disponibilizar": para guardar dinero de un mes para el siguiente, simplemente no lo asignas y se acumula.
- **Ingreso para el próximo mes** (`movimientos.ingreso_proximo_mes`): un ingreso recibido a fin de mes (p. ej. salario el día 28) que en realidad financia el mes siguiente se marca con este flag. Mantiene su **fecha real**, pero queda disponible para asignar el **mes siguiente** (no el de su fecha). Los ingresos chicos de inicio de mes se dejan sin marcar y cuentan en su propio mes.
- **Saldo acumulado por categoría (sinking funds)**: en el panel de Presupuesto, la columna "Disponible" de cada categoría es el saldo rodante `Σ asignado − Σ gastado` de todos los meses ≤ mes (lo no gastado se acumula). Cálculo en `balancesCategoria`.
- **Categorías excluidas** (`categorias.excluir_presupuesto`) no entran en sumas de presupuesto, ni en el reporte de gasto por categoría, ni en "Disponible para asignar", ni en el reporte ingreso vs gasto; hay un toggle "Incluir ocultas". Útiles para **ajustes de patrimonio / puesta al día**: un ingreso en la categoría "Ajuste de patrimonio" (excluida) sube el saldo/patrimonio y queda registrado, pero no afecta presupuesto ni reportes.
- **Alertas** (en el Resumen, `components/Alertas.tsx`): dinero sin asignar / sobre-asignado, movimientos sin categoría, categorías que se pasaron del presupuesto del mes, y tipo de cambio USD sin configurar habiendo cuentas en USD.

El **balance por cuenta, patrimonio neto y reportes** se computan (no se guardan) en el frontend con aritmética entera (`frontend/src/lib/finance.ts`). La **exportación CSV** se genera en el cliente (`frontend/src/lib/csv.ts`).

---

## CSV

Columnas canónicas: `fecha` (YYYY-MM-DD), `cuenta` (nombre), `categoria` (nombre, vacío si transferencia), `tipo`, `monto` (decimal en la moneda de la cuenta, ej. `-1234.56`), `descripcion`, `transfer_id` (opcional), `conciliado` (`true`/`false`), `reconciliado` (`true`/`false`, opcional), `notas`. El import tolera símbolos de moneda y separadores de miles en `monto` (ej. `"Q2,000.00"`).

- **Import:** resuelve por nombre; no crea cuentas/categorías silenciosamente; convierte decimal→centavos; fija `moneda` desde la cuenta; valida filas con mismo `transfer_id` como transferencia balanceada; atómico por archivo.
- **Export:** vuelca movimientos no eliminados al mismo esquema (monto decimal legible).
- **CSV de ejemplo:** en la pantalla de Movimientos, el botón **“CSV de ejemplo”** descarga una plantilla (`ejemplo_importacion.csv`) con el formato exacto: un ingreso, un gasto y una transferencia balanceada de dos patas (mismo `transfer_id`). Recuerda que los nombres de `cuenta`/`categoria` deben existir ya en tu cuenta antes de importar.

---

## Verificación / criterios de aceptación

Con PocketBase corriendo:

```bash
node scripts/verify.mjs
```

Cubre y verifica automáticamente:

1. Un `gasto` de Q100 reduce el saldo en Q100.
2. Una transferencia en la misma moneda **no** cambia el patrimonio neto.
3. Comprar Q500 con TC aumenta la deuda en Q500; pagar la TC por transferencia **no** es gasto ni duplica.
4. Transferencia GTQ→TC-USD: la cuenta GTQ baja X y la deuda USD baja Y según `tipo_cambio`, redondeado a centavos.
5. Export seguido de import reproduce exactamente los mismos saldos.

Salida esperada: `Resultado: 13 OK, 0 fallos`.

---

## Notas de implementación

- Los **handlers de PocketBase corren en un runtime aislado**: las funciones helper deben definirse *dentro* del handler (no en el scope del módulo), por eso `pb_hooks/import.pb.js` declara sus utilidades internamente.
- El consolidado de patrimonio y los reportes con mezcla de monedas usan el **tipo de cambio manual** de `settings.tipo_cambio_usd` y se marcan como **aproximados** en la UI.
