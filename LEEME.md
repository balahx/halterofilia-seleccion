# Halterofilia · Selección

App web instalable (PWA) para registrar los entrenamientos de la selección de halterofilia. Funciona en iPhone, Android, Windows y Mac desde un solo código, sin pasar por las tiendas de aplicaciones.

**Estado: fase 4.** Cuentas con correo y contraseña, solicitud de acceso, aprobación por el entrenador, app instalable que abre sin conexión, y **copia automática de los datos de cada atleta en su cuenta** (sesiones, máximos, perfil y plan semanal), para verlos en cualquier dispositivo, y **carga del plan anual desde Excel** por el entrenador (pestaña Planes), y la **semana asignada a cada atleta** (el entrenador la asigna y ajusta los % desde 90 %; el atleta ve su semana con sus kilos, inicia la sesión ya armada y pasa de semana tras el corte).

## Cómo funciona el acceso

1. Cada persona crea su cuenta (nombre, correo y contraseña). Eso envía una **solicitud de acceso**.
2. El entrenador (Cristian Mateluna) ve las solicitudes en la pestaña **Equipo** y las aprueba o rechaza.
3. Al aprobarla, la pantalla de espera del atleta se actualiza sola y entra a la app.
4. El entrenador puede quitar el acceso a un atleta cuando quiera. Sus datos no se borran.

El entrenador es quien figura en el documento `config/team` de Firestore. Ese documento se crea **a mano** en la consola de Firebase, una sola vez (ver abajo), así nadie puede declararse entrenador desde la app.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css` | Pantalla y estilos |
| `app.js` | La app de entrenamiento (sesiones, plan, máximos, progreso, temporizador) |
| `cloud.js` | Cuentas: ingreso, solicitud de acceso, aprobación, pestaña Equipo |
| `plan-import.js` | Lee el Excel del plan anual (planilla de Cristian o plantilla simple) y lo convierte a datos. Incluye el glosario de abreviaturas |
| `plan-ui.js` | Pestaña **Planes** del entrenador: cargar Excel, revisar, publicar, activar y eliminar planes |
| `firebase-config.js` | Configuración pública del proyecto Firebase de esta app (no es una clave secreta) |
| `firestore.rules` | Reglas de seguridad de la base de datos |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y funcionamiento sin conexión |
| `sync.js` | Sincronización de los datos propios (fase 2) |
| `assign.js` | Semana asignada (fase 4): asignación y ajustes del entrenador, pestaña **Semana** del atleta, cumplimiento y avance semanal |
| `tests/` | Pruebas automáticas |

## Puesta en marcha (una sola vez)

1. **Publicar las reglas.** Consola de Firebase → Firestore Database → Reglas → pegar el contenido de `firestore.rules` → Publicar.
2. **Publicar el sitio** en una dirección `https://` (por ejemplo GitHub Pages) y agregar ese dominio en Firebase → Authentication → Configuración → Dominios autorizados.
3. **Crear la cuenta del entrenador:** Cristian abre la app, crea su cuenta y espera en «Solicitud enviada».
4. **Nombrar al entrenador:** en Firebase → Authentication → Usuarios, copiar el **UID** de Cristian. En Firestore Database crear la colección `config`, documento `team`, con un campo de texto `coachUid` y ese UID. Al volver a abrir la app, Cristian entra como entrenador y ve «Equipo».
5. **Aprobar atletas:** cada atleta crea su cuenta; Cristian los aprueba desde «Equipo».

## Sincronización de los datos (fase 2)

- Cada sesión, cada ejercicio (con su máximo), el perfil y el plan semanal se guardan como un registro en `users/{uid}/records/{clave}` (código en `sync.js`).
- Funciona sin conexión: los cambios quedan en una cola guardada en el dispositivo y se envían al volver internet. En **Ajustes → Cuenta** se ve el estado («Al día», «2 cambios por enviar», «Sin conexión») y hay un botón **Sincronizar ahora**.
- Si el mismo dato se cambió en dos dispositivos, **gana el cambio más reciente**.
- Borrar una sesión o un ejercicio también lo borra en los demás dispositivos. «Borrar todos mis datos» y «Importar respaldo» actúan sobre la nube también.
- Un dispositivo nuevo baja todo lo que hay en la cuenta y no pisa datos reales con valores de fábrica. Un perfil con solo el nombre puesto, el plan vacío y los ejercicios sin máximo cuentan como «de fábrica».
- Solo el dueño (si está aprobado) y el entrenador pueden leer los registros; solo el dueño puede escribirlos. Las reglas están en `firestore.rules`.
- **Después de actualizar la app hay que publicar de nuevo `firestore.rules`** (Firestore → Reglas): sin ellas la sincronización muestra «Sin permiso».

## Instalación en cada equipo

| Plataforma | Cómo |
|---|---|
| iPhone / iPad | Abrir en Safari → Compartir → Agregar a pantalla de inicio |
| Android | Abrir en Chrome → menú ⋮ → Instalar aplicación |
| Windows / Mac | Abrir en Chrome o Edge → ícono de instalar en la barra de direcciones |

## Pruebas automáticas

Necesitan Node y Playwright (`npm i playwright`). No usan Firebase real: `tests/fake-remote.js` imita Auth y Firestore con las mismas reglas.

```
node tests/e2e.js          # cuentas, solicitudes, aprobación, entrenador, sin conexión
node tests/regression.js   # app de entrenamiento (sesiones, máximos, gráficos, exportar)
node tests/pwa.js          # manifest, service worker, apertura sin conexión
node tests/sync-unit.js    # motor de sincronización: varios dispositivos, conflictos, cola sin conexión
node tests/sync-e2e.js     # sincronización dentro de la app real
node tests/plan-import.js  # lectura del plan (sin navegador)
node tests/plan.js         # el entrenador carga, publica y activa un plan
node tests/assign-unit.js  # hora de corte en Chile, sesión armada desde el plan, avance de semana
node tests/assign-e2e.js   # asignar semana, ajustar %, cumplir sesiones y pasar de semana (con las reglas)
```

## Plan anual (fase 3): cargar el Excel cada año

En **Planes** el entrenador sube el Excel del año. Se aceptan dos formatos:

- **Planilla de Cristian** (la de 2026): bloques por semana, días de lunes a viernes en las columnas D a H. La prescripción (`70% 8-10repsX3`) va en la celda de arriba del ejercicio al que se aplica.
- **Plantilla simple** (recomendada para los años siguientes, se descarga desde la misma pantalla): una fila por ejercicio con Etapa, Semana, Día, Orden, Bloque, Ejercicio, %, Repeticiones, Series.

Reglas de lectura: el % es del máximo del mismo ejercicio (arranque o envión); las fechas del Excel se ignoran; las cargas escritas en la celda («snatch press 30k») no se guardan; `+` junta ejercicios de un complejo y `/` separa alternativas. Un número suelto después de un curl de bíceps («biceps 30») y `(15")` en «iso carga» son segundos de espera isométrica. Desde 90% los porcentajes quedan marcados como ajustables (el entrenador los adapta a cada atleta). «drop» es una serie descendente (normalmente la última) al % indicado del máximo del mismo ejercicio («drop 46K 65%» = drop al 65%); «max» como prescripción es el máximo, 100 % o un nuevo 100 %. Una semana de transición (descanso de halterofilia, actividad libre) se lee como semana sin sesiones; en la plantilla simple se escribe `Transición` en la columna Ejercicio.
La app muestra una revisión antes de publicar: una muestra de la primera semana y los ejercicios que no reconoce. El entrenador les pone nombre y quedan en el catálogo (`exercises`), así no se vuelven a preguntar. Cada carga crea un plan nuevo; los anteriores se conservan, y el atleta ve el que esté **activo**.

**No subir el Excel ni el plan convertido a este repositorio:** es público. El plan vive solo en Firestore.

## Semana asignada (fase 4)

- **Entrenador:** en **Equipo**, el botón **Semana** de cada atleta abre su ficha: asigna o mueve la semana del plan activo, ve qué sesiones cumplió (con fecha y hora) y ajusta los porcentajes de 90 % o más solo para ese atleta (los deja vacíos para usar el del plan).
- **Atleta:** la pestaña **Semana** muestra «Semana N · Etapa», cada sesión con sus series y los kilos (su máximo × %). **Iniciar esta sesión** la deja armada en «Hoy». El % se calcula sobre el **máximo propio** del ejercicio y, si no lo tiene, sobre el del **ejercicio principal** (derivados: el arranque de potencia y las variantes del arranque o la cargada salen del arranque o la cargada al 100 %; la sentadilla de arranque, del 120 % del arranque; ver `DERIVED` en `assign.js`). Ejemplo: 70 % de sentadilla de arranque = 70 % de 124 kg si ese es su máximo, o 70 % de 120 kg (120 % de un arranque de 100) si no lo tiene. Si no hay forma de calcularlo, lo avisa y deja los kilos en blanco. Un complejo (`a + b + c`) se arma como un solo ejercicio y su referencia es, en este orden: (1) **el máximo del complejo mismo**, si el atleta lo tiene; (2) el del **primer movimiento** que tenga máximo (propio o derivado), con el % que indica la planilla (p. ej. 120 % de un arranque de 100 kg = 120 kg; el entrenador puede afinarlo por atleta desde 90 %). El máximo del complejo se anota en «Máximos» o se **estima con «Proyectar máximo»** (peso y repeticiones → 1RM, «Guardar como máximo de» el complejo); los complejos de la semana aparecen en esa lista apenas el atleta ve su semana, y los que la app ya trae (arranque + sentadilla sobre la cabeza, cargada + sentadilla frontal + envión) comparten el mismo máximo. Al terminar la sesión queda registrada como cumplida con la hora del servidor.
- **Cambio de semana:** el botón **Pasar a la semana siguiente** se habilita desde el viernes a las 23:59 (hora de Chile) de la semana asignada y con la **última sesión de la semana cumplida**; una semana de transición no exige sesiones. Solo avanza de a una semana. Todo lo demás (mover de semana o de etapa) lo hace el entrenador.
- **Qué impiden las reglas** (`firestore.rules`): que el atleta se asigne una semana, falsee la fecha de una sesión, registre una de otra semana, reescriba una cumplida, cambie sus ajustes o avance antes del corte o sin la última sesión. No pueden impedir que marque como hecha una sesión que no entrenó; para eso están los informes del entrenador.
- **Sin conexión:** la última semana vista queda guardada en el dispositivo; las sesiones cumplidas se envían al volver la conexión.
- **Datos:** `assignments/{uid}` (semana asignada y hora de corte), `users/{uid}/completions/{plan_semana_n}` (sesiones cumplidas, solo se crean) y `adjustments/{uid}_{plan}_{semana}` (ajustes de %). Cada semana del plan guarda `next` (la semana siguiente), por eso un plan publicado antes de la fase 4 debe volver a cargarse.

## Nombres de los ejercicios

El inglés es el idioma principal y el español va debajo, en pequeño: en la semana, la sesión, los máximos, el historial y las listas. Cada atleta puede invertirlo en **Ajustes → Nombres de los ejercicios** (se sincroniza con su cuenta). Los ejercicios que el atleta crea por su cuenta tienen un solo nombre.

## Lo que viene

- Informes para el entrenador (planificado vs realizado y observaciones de los atletas): ahora que existe la base de datos del plan y las sesiones cumplidas, son la fase 4b.
