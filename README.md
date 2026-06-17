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

## Desplegar en la nube (Fly.io)

Un solo contenedor: **PocketBase sirve la API y el frontend** (compilado en `pb_public`). Archivos: `Dockerfile`, `fly.toml`, `.dockerignore`.

### Pasos

```bash
# 1) Instalar flyctl y autenticarse
brew install flyctl          # o: curl -L https://fly.io/install.sh | sh
fly auth login

# 2) Crear la app (elige un nombre único; actualiza "app" en fly.toml si difiere)
fly launch --no-deploy --copy-config --name TU-APP --region mia
#   (detecta el Dockerfile y el [mounts]; si pregunta por el volumen, acepta)

# 3) Crear el volumen persistente para la base de datos (SQLite)
fly volumes create pb_data --region mia --size 1 --yes

# 4) Desplegar
fly deploy

# 5) Crear el superusuario del panel admin (una vez)
fly ssh console -C "/pb/pocketbase superuser upsert TU_EMAIL TU_PASSWORD"
```

Tu app queda en `https://TU-APP.fly.dev` (API + frontend + panel admin en `/_/`).

> **Importante:** PocketBase usa SQLite, así que corre **una sola máquina**. No escales a múltiples instancias. El volumen `pb_data` conserva tus datos entre despliegues.

### Migrar tus datos locales a la nube (backups de PocketBase)

1. Local: `http://127.0.0.1:8090/_/` → **Settings → Backups → New backup** → descarga el `.zip`.
2. Nube: `https://TU-APP.fly.dev/_/` (entra con el superusuario del paso 5) → **Settings → Backups → Upload backup** → sube el zip y **Restore**.
3. El restore reemplaza la base con la tuya (cuentas, categorías, movimientos, presupuestos y usuarios). Tras restaurar, inicia sesión con tu usuario de la app.

### Actualizar

`fly deploy` reconstruye la imagen; las migraciones nuevas se aplican solas al arrancar y `pb_data` (en el volumen) se conserva.

### Auto-deploy con GitHub Actions

`.github/workflows/fly-deploy.yml` despliega automáticamente en cada push a `main` (o manualmente desde la pestaña Actions). Configúralo una vez:

```bash
# genera un token de deploy de Fly
fly tokens create deploy -x 999999h
```

Copia el token y agrégalo como **secret** del repo en GitHub: *Settings → Secrets and variables → Actions → New repository secret*, con nombre **`FLY_API_TOKEN`**. Desde ahí, cada push a `main` redepliega solo (compila en los builders de Fly con `--remote-only`).

## Instalar como PWA (en el teléfono)

La app es una **PWA** (manifest + service worker, vía `vite-plugin-pwa`). Una vez desplegada con HTTPS:

- **Android / Chrome:** abre `https://TU-APP.fly.dev` → menú ⋮ → **Instalar app**.
- **iPhone / Safari:** abre la URL → **Compartir** → **Agregar a inicio**.

Queda como ícono en pantalla, a pantalla completa (`display: standalone`). Íconos en `frontend/public/` (generados por `scripts/gen-icons.py`).

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
- **"Asignar lo gastado"**: botón que pone el Asignado de cada categoría igual a su Gastado del mes (deja el aporte del mes en 0). Como el Gastado ya es un entero en centavos de la moneda base, los gastos en USD cuadran exacto en 0.
- **Categorías excluidas** (`categorias.excluir_presupuesto`) no entran en sumas de presupuesto, ni en el reporte de gasto por categoría, ni en "Disponible para asignar", ni en el reporte ingreso vs gasto; hay un toggle "Incluir ocultas". Útiles para **ajustes de patrimonio / puesta al día**: un ingreso en la categoría "Ajuste de patrimonio" (excluida) sube el saldo/patrimonio y queda registrado, pero no afecta presupuesto ni reportes.
- **Alertas** (en el Resumen, `components/Alertas.tsx`): dinero sin asignar / sobre-asignado, movimientos sin categoría, categorías que se pasaron del presupuesto del mes, y tipo de cambio USD sin configurar habiendo cuentas en USD.

El **balance por cuenta, patrimonio neto y reportes** se computan (no se guardan) en el frontend con aritmética entera (`frontend/src/lib/finance.ts`). La **exportación CSV** se genera en el cliente (`frontend/src/lib/csv.ts`).

### Patrimonio a costo histórico (multimoneda)

El patrimonio consolidado en `moneda_base` usa **costo histórico**: cada movimiento y saldo inicial en moneda extranjera guarda su propia tasa (`movimientos.tc_base`, `cuentas.tc_base_inicial` = moneda_base por unidad de la moneda de la cuenta, al momento). El patrimonio = Σ equivalentes a esas tasas, **no** `saldo × tasa_global`. Así:
- Las transferencias cross-currency se valúan a su tasa real y quedan en **residuo 0** (no inventan ganancia/pérdida cambiaria).
- Las compras/ingresos en USD quedan **congelados** a la tasa del momento (`POST /api/transfers` fija la de cada transferencia; el hook congela el resto a la tasa global vigente al registrar).
- Si un movimiento no tiene `tc_base` (datos viejos), cae a la tasa global. La migración `1750000700` rellena los existentes.

---

## Manual de uso: casos comunes

La app tiene **dos capas** que conviene no confundir:

- **Patrimonio (capa de cuentas):** suma de saldos de tus cuentas (`saldo_inicial + Σ movimientos`). Es la foto real de tu dinero/deuda. Siempre refleja todo, sin importar cómo presupuestes.
- **Presupuesto (capa de asignación):** "Disponible para asignar" (RTA) y el saldo por categoría. Es tu plan de cómo repartir el dinero.

### Empezar con deuda (patrimonio negativo)
Al crear tus cuentas pones su **saldo real**. Si debes más de lo que tienes (tarjetas, sobregiros), tu patrimonio arranca negativo. Eso es correcto y esperado: registra los saldos reales y la app lo mostrará tal cual.

### Sobregasto que se arrastra
Si en un mes gastas más de lo que te entró, eso se refleja en:
1. El **patrimonio**, que baja (financiaste la diferencia con deuda), y
2. El **saldo de la categoría**, que queda **negativo y se arrastra** al mes siguiente (la lógica de saldo acumulado funciona en ambos sentidos).

Ojo: sobre**gastar** no es lo mismo que sobre**asignar**. Solo asignar más de lo que entró pone "Disponible para asignar" en rojo.

### Puesta al día con un ingreso extra (bono, etc.)
Cuando entra dinero para "ponerte al día" y quieres que **resetee tanto el patrimonio como el arrastre del presupuesto**:

1. Regístralo como **ingreso normal** (en una categoría de ingreso real, **no** en "Ajuste de patrimonio").
2. Con eso:
   - El **patrimonio** sube por el saldo de la cuenta (vuelve hacia 0). Ejemplo: empezaste en −10,000, arrastraste −1,500 de sobregasto en dos meses (patrimonio −11,500); un extra de +11,500 (más tu ingreso normal del mes) te deja el patrimonio en el valor esperado a inicio de mes.
   - El ingreso te da saldo en **"Disponible para asignar"** para **cubrir las categorías que quedaron en rojo** (las asignas hasta dejarlas en 0) y arrancar limpio.
3. De ahí en adelante, mantén tus gastos dentro de tu ingreso mensual (eso ya es disciplina, no app 🙂).

> Aparecerá como ingreso en el reporte de ingreso vs gasto, lo cual es correcto: sí recibiste ese dinero.

### "Ajuste de patrimonio" (categoría excluida) — cuándo SÍ usarla
Úsala solo cuando quieras corregir el **patrimonio sin tocar el presupuesto ni los reportes** (p. ej. una corrección puntual de saldo, un reembolso que no es ingreso real). Un ingreso en la categoría **"Ajuste de patrimonio"** (excluida): sube el saldo de la cuenta, pero **no** cuenta en "Disponible para asignar" ni aparece en reportes. **No** sirve para tapar sobreasignación/sobregasto del presupuesto (para eso usa ingreso normal).

### Ahorro / metas (sinking funds)
Para guardar dinero hacia una meta: crea una categoría (ej. "Vacaciones") y **asígnale** monto cada mes sin gastar. La columna **Disponible (acum.)** muestra el saldo creciendo mes a mes (Q500 → Q1,000 → …). Cuando lo uses, registras el gasto contra esa categoría. Alternativamente, una **cuenta de ahorro dedicada** y mueves el dinero con **transferencias** (el saldo de la cuenta es tu fondo).

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
