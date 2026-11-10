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
| `privacy.js` | Aviso de privacidad (texto y versión). Se muestra al crear la cuenta (hay que marcarlo), en el ingreso y en Ajustes → Cuenta |
| `compare.js` | Pestaña **Marcas** del entrenador (fase 6): marcas de arranque, dos tiempos y total por sexo y categoría de peso, con diferencia respecto del líder |
| `backup.js` | Respaldo del equipo (solo entrenador): descarga un JSON con miembros, planes, semanas asignadas, ajustes, registros y sesiones cumplidas de todos |
| `guard.js` | Si la app se muestra dentro de otra página, se oculta (antifraude de marcos) |
| `report.js` | Informes del entrenador (fase 4b): planificado vs realizado y observaciones, por semana o por día |
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
node tools/run-tests.js    # corre TODAS las pruebas y dice cuáles fallan
node tests/a11y-audit.js   # accesibilidad: tamaño de los controles (44 px), nombres, contraste, sin desborde
node tests/version-unit.js # formato de version.js, tools/bump.js y archivos de la caché sin conexión
node tools/bump.js feature # sube la versión (fix → +0.0.1 · feature → +0.1.0 · big → +1.0.0)
node tests/plan.js         # el entrenador carga, publica y activa un plan
node tests/assign-unit.js  # hora de corte en Chile, sesión armada desde el plan, avance de semana
node tests/report-unit.js  # armado de los informes: planificado vs realizado, estados, observaciones, texto
node tests/assign-e2e.js   # asignar semana, ajustar %, cumplir sesiones y pasar de semana (con las reglas)
node tests/routines-e2e.js # rutinas especiales: el entrenador las crea (con descanso y pausa en el movimiento) y el atleta las entrena
node tests/weeknotice-e2e.js # avisos de semana en «Hoy» (semana nueva, ya puede pasar, faltan sesiones) y «Duplicar» rutinas
node tests/fastplan-e2e.js # plan en un solo documento: lo arma sola la app del entrenador y el atleta lo lee con 1 lectura
node tests/multiplan-e2e.js # varios planes a la vez: plan y semana por atleta, informe por plan, no se elimina un plan en uso
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
- **Atleta:** la pestaña **Semana** muestra «Semana N · Etapa», cada sesión con sus series y los kilos (su máximo × %). **Iniciar esta sesión** la deja armada en «Hoy». El % se calcula sobre el **máximo propio** del ejercicio y, si no lo tiene, sobre el del **ejercicio principal** (derivados: el arranque de potencia y las variantes del arranque o la cargada salen del arranque o la cargada al 100 %; la sentadilla de arranque, del 120 % del arranque; ver `DERIVED` en `assign.js`). Ejemplo: 70 % de sentadilla de arranque = 70 % de 124 kg si ese es su máximo, o 70 % de 120 kg (120 % de un arranque de 100) si no lo tiene. El entrenador puede cambiar el **factor** de un derivado para un atleta y una semana (en su ficha, «Derivados · factor sobre el ejercicio principal»; p. ej. 130 % en vez de 120 % para la sentadilla sobre la cabeza): solo se usa si el atleta no tiene máximo propio de ese ejercicio. Si no hay forma de calcularlo, lo avisa y deja los kilos en blanco. Un complejo (`a + b + c`) se arma como un solo ejercicio y **no tiene máximo propio**: su % de la planilla se aplica al máximo del ejercicio principal del **primer movimiento que tenga máximo** (propio o derivado). Arranque + sentadilla de arranque → máximo de arranque; cargada + sentadilla frontal → máximo de cargada; un complejo al 120 % con arranque de 100 kg pide 120 kg. Por eso «Máximos» no lista los complejos. Al terminar la sesión queda registrada como cumplida con la hora del servidor.
- **Cambio de semana:** el botón **Pasar a la semana siguiente** se habilita desde el domingo a las 23:59 (hora de Chile) de la semana asignada y con la **última sesión de la semana cumplida**; una semana de transición no exige sesiones. Solo avanza de a una semana. Todo lo demás (mover de semana o de etapa) lo hace el entrenador.
- **Avisos de semana (4.14.0):** con la app abierta, «Hoy» avisa cuando el entrenador asigna o cambia la semana («Tu entrenador te asignó la semana N», con «Ver mi semana» y «Entendido»), cuando ya se puede pasar a la semana siguiente (con el botón ahí mismo) y cuando ya pasó el corte pero faltan sesiones. La última semana vista se guarda en el dispositivo. Sin avisos con la app cerrada (requeriría un servidor).
- **Duplicar rutinas (4.14.0):** en la ficha del atleta, cada rutina especial tiene «Duplicar»: abre la copia en el editor («(copia)» en el nombre) y deja elegir para qué atleta se guarda. La original no cambia.
- **Plan en un solo documento (4.15.0):** la app del entrenador arma sola `plans/{id}/fast/all` (semanas, etapas y catálogo, comprimido con gzip) con lo que ya descargó; no hay botón. La compara con 1 lectura al abrir y la reescribe solo si falta, cambió la versión del plan o cambió el contenido (p. ej. una edición en la consola de Firebase, que llega con la red de seguridad de 24 h). Los atletas la bajan con 1 lectura y la guardan en el dispositivo (también se renueva a las 24 h). Si falta, quedó vieja o no se puede leer, se lee como antes. Regla nueva en `firestore.rules` (`plans/{id}/fast/{docId}`).
- **Varios planes a la vez (4.16.0):** hasta 6 planes publicados (p. ej. uno por nivel). Ya no hay «plan activo» (`config/plan` no se usa): en Equipo → atleta el entrenador elige **plan y semana** («Cambiar a este plan» al pasarlo a otro; historial y marcas se conservan). Lo mismo en «Mi semana» del entrenador. Equipo, ficha, ajustes e informe usan el plan de cada atleta; el atleta ve «Plan · Semana N» en Hoy y Semana. «Planes» muestra cuántos atletas tiene cada plan y no deja eliminar uno en uso. Cada plan tiene su documento único. Sin cambios en las reglas de Firestore.
- **Qué impiden las reglas** (`firestore.rules`): que el atleta se asigne una semana, falsee la fecha de una sesión, registre una de otra semana, reescriba una cumplida, cambie sus ajustes o avance antes del corte o sin la última sesión. No pueden impedir que marque como hecha una sesión que no entrenó; para eso están los informes del entrenador.
- **Sin conexión:** la última semana vista queda guardada en el dispositivo; las sesiones cumplidas se envían al volver la conexión.
- **Datos:** `assignments/{uid}` (semana asignada y hora de corte), `users/{uid}/completions/{plan_semana_n}` (sesiones cumplidas, solo se crean) y `adjustments/{uid}_{plan}_{semana}` (ajustes de %). Cada semana del plan guarda `next` (la semana siguiente), por eso un plan publicado antes de la fase 4 debe volver a cargarse.

## Nombres de los ejercicios

El inglés es el idioma principal y el español va debajo, en pequeño: en la semana, la sesión, los máximos, el historial y las listas. Cada atleta puede invertirlo en **Ajustes → Nombres de los ejercicios** (se sincroniza con su cuenta). Los ejercicios que el atleta crea por su cuenta tienen un solo nombre.

## Informes del entrenador (fase 4b)

En **Equipo → Semana** de cada atleta, la tarjeta **Informe del atleta** → «Ver informe». No necesita reglas nuevas: el entrenador ya puede leer los registros de sus atletas (`users/{uid}/records`) y las sesiones cumplidas.
- **Semana:** elige una semana del plan. Muestra cuántas sesiones se registraron de las planificadas, series hechas de las planificadas, repeticiones, tonelaje y RPE medio; y por sesión y ejercicio lo planificado (series y %, con los ajustes del entrenador) frente a lo hecho (series, kilos y repeticiones). Estados: **Completo**, **Parcial**, **Omitido**, **Sin registrar** (sesión no registrada) y **Extra** (ejercicio fuera del plan).
- **Día:** todas las sesiones registradas en una fecha, del plan (comparadas con lo planificado) o libres.
- **Observaciones:** las «Notas de la sesión» que escribe el atleta (técnica, sensaciones, molestias) se reúnen al final y también van en el texto.
- **Salida:** «Copiar texto», «Compartir» (donde el equipo lo permita) e «Imprimir o guardar PDF». Con el plan gratuito no hay envío automático (sin correos ni avisos programados): el informe se arma al abrirlo y refleja lo que el atleta ya sincronizó.
- Si una sesión del plan se registró más de una vez, cuenta la última. Lo que el atleta no ha sincronizado todavía (sin conexión) aparece como «Sin registrar».

## Aviso de privacidad y observaciones por ejercicio (fase 5)

- **Aviso de privacidad** (`privacy.js`): texto breve sobre qué se guarda (incluidas notas que pueden hablar de molestias: datos de salud), para qué, quién lo ve (el atleta y el entrenador), dónde (Firebase, base de datos en Santiago) y los derechos. Al **crear la cuenta** hay que marcar que se leyó. Quien ya usaba la app recibe un aviso una vez; queda siempre en Ajustes → Cuenta. Si cambia lo que la app guarda, hay que editar el texto y subir `VERSION`. **No es asesoría legal**: conviene que lo revise quien corresponda (Ley 19.628, reformada por la Ley 21.719, vigente desde el 1-dic-2026), y confirmar con Cristian que acepta ser el contacto para consultas.
- **Borrar todos mis datos** deja en la nube solo el nombre y correo (cuenta) y el registro de las sesiones cumplidas (fecha y semana): las reglas impiden borrarlos desde la app. Para eliminar también eso hay que hacerlo desde la consola de Firebase.
- **Observación por ejercicio:** cada ejercicio de la sesión tiene un campo «Observación» (200 caracteres). Se ve en el historial y llega al informe del entrenador, junto a las notas de la sesión.

## Seguridad y uso de la cuota gratuita (fase 5)

- **Política de seguridad del contenido (CSP)**, en `index.html`: la página solo puede ejecutar scripts propios, el SDK de Firebase (`www.gstatic.com/firebasejs/`) y el lector de Excel (`cdnjs…/ajax/libs/xlsx/`); solo puede conectarse a los servicios de Google (`*.googleapis.com`). Un script inyectado o una conexión a otro sitio queda bloqueado. El lector de Excel además lleva huella de integridad (SRI, `sha384-…`): si el archivo del CDN cambiara, el navegador no lo ejecuta. **Si algún día se cambia la versión de SheetJS, hay que calcular la huella nueva** y actualizar `XLSX_URL` y `XLSX_SRI` en `plan-ui.js`. Si se agrega otro servicio externo, hay que permitirlo en la CSP.
- **Clave de API de Firebase**: es pública por diseño (va en `firebase-config.js`); lo que protege los datos son las reglas. Conviene restringirla en Google Cloud → APIs y servicios → Credenciales → «Browser key» → Restricciones de aplicación → Sitios web → `https://balahx.github.io/*`.
- **Lectura reducida**: la atleta y el entrenador solo piden las sesiones cumplidas de **la semana asignada** (no todo el historial); el informe de otra semana las pide una vez. Con ~17 atletas se espera usar una fracción de las 50 000 lecturas diarias del plan gratuito.
- **Respaldo del equipo** (Equipo → «Descargar respaldo»): un clic baja `respaldo-equipo-AAAA-MM-DD.json`. Contiene datos personales y de salud: guardarlo en un lugar privado. Cada descarga cuesta una lectura por documento (cientos o pocos miles), así que se recomienda una vez por semana.

## Indicadores y comparación (fase 6)

**Atleta (todo en `app.js`, sin reglas nuevas: los datos van dentro de los registros que ya se sincronizan):**
- **Serie fallada (✕):** botón por serie. Cuenta como intento, pero no suma tonelaje, repeticiones, 1RM ni récords. Se puede apagar en Ajustes. Alimenta la **efectividad** (general, por ejercicio y desde 90 %).
- **Carga de sesión** = duración (min) × RPE de la sesión, en UA. El RPE es el anotado o el promedio de las series; la duración, la anotada o hasta la última serie. Gráfico semanal y aviso si la última semana completa subió más de 30 % (referencial).
- **Progreso:** intensidad media (ponderada por repeticiones), repeticiones (NL), efectividad, tabla semanal y resumen mensual, y peso corporal.
- **Máximos:** razones entre máximos (arranque/dos tiempos, sentadillas/dos tiempos, tirones) y total por kg de peso corporal. **Meta** por ejercicio (kg y fecha opcional): faltan X kg, semanas al ritmo actual y kg por semana necesarios para la fecha.
- **Sexo obligatorio:** se elige al crear la cuenta (queda en el perfil al primer ingreso). Las cuentas anteriores sin sexo reciben una ventana que no se puede cerrar hasta elegir (el entrenador no la ve). Se puede cambiar en Ajustes, pero no dejar vacío.
- **Perfil:** sexo, categoría de peso (automática según el peso, o elegida) y peso corporal semanal (la pantalla Hoy lo pide si pasó una semana). Categorías IWF (senior y junior) vigentes desde el 1 de agosto de 2026: M 60, 65, 70, 75, 85, 95, 110, +110; F 49, 53, 57, 61, 69, 77, 86, +86 (`WEIGHT_CATS` en `app.js`; fuente iwf.sport, 3-nov-2025; confirmar con el reglamento de cada torneo). Las categorías juveniles (youth) no se usan. Una categoría elegida que ya no existe se descarta y vuelve la automática según el peso.
- El CSV de historial incluye ahora `fallada`, `duracion_min`, `rpe_sesion` y `carga_sesion`.

**Entrenador (Marcas del equipo, en «Más» → Equipo; `compare.js`):** lee perfil, arranque y dos tiempos de cada atleta (3 lecturas por atleta al abrir o actualizar) y los agrupa por sexo y categoría, ordenados por total. Al tocar un atleta se ven todos sus máximos y metas. Los atletas de cuentas antiguas que aún no abrieron la app (sin sexo) aparecen aparte, de forma transitoria. Compara marcas registradas por los atletas, no resultados oficiales.

Pruebas nuevas: `tests/indicators-unit.js`, `tests/compare-unit.js`, `tests/compare-e2e.js`, `tests/sex-e2e.js`. El aviso de privacidad pasó a la versión `2026-11-05.2` (sexo, categoría, peso semanal, RPE y duración).

## Diseño WL · Selección (fase 7)

- **Marca:** «WL» con «SELECCIÓN» debajo; el logo es el caballito de mar dorado levantando una barra (`icons/wl-marca-claro.svg` y `icons/wl-marca-oscuro.svg`, la marca sola; los íconos de la app en `icons/icon-*.png` salen de `D:\proyecto halt\WL-iconos\pwa`). **El logo es un calco aproximado de una captura**: cuando llegue el vector original del entrenador hay que regenerar los archivos y confirmar el permiso de uso del escudo con él y la institución.
- **Paleta** (en `styles.css`, claro y oscuro): azul de marca #274F83 (en oscuro #3F72B8 para botones), dorado #A07E34 (en oscuro #DDB962), fondo #F3F5F9 / #0E1A2E, superficie #FFFFFF / #16263F, texto #14233B / #EEF2F8. Las zonas de carga (blanco, verde, amarillo, azul, rojo) no cambian. Tipografía: Barlow Condensed 700 (títulos y números) y Barlow (texto).
- **Menú inferior:** atleta = Hoy · Semana · Progreso · Máximos · Más. Entrenador = Equipo · Planes · Mi semana · Mi sesión · Más (Marcas del equipo, Progreso y Máximos están en «Más»).
- **«Más»** agrupa: plan semanal libre, historial de sesiones, mis ejercicios, calculadora de discos, ajustes, aviso de privacidad y cerrar sesión; el entrenador además ve «Mi entrenamiento» (progreso, máximos, plan libre), el respaldo del equipo y las solicitudes de acceso.
- Prueba: `node tests/design-e2e.js` (con `SHOTS=carpeta` guarda capturas en claro y oscuro).
- **Estados vacíos y de error:** `HalterApp.empty(...)` y `HalterApp.errorBox(mensaje, {retry})` son los componentes comunes. Una franja amarilla bajo la cabecera avisa cuando no hay conexión, falta permiso en la nube o falla la sincronización (los registros siguen guardándose en el dispositivo). La pantalla de ingreso sin servicio de cuentas muestra el icono en rojo con «Reintentar».
- **Escritorio (≥ 1024 px):** el menú pasa a una barra lateral de 248 px con icono y texto, el contenido se acomoda en columnas (Hoy, Semana, Equipo, Sesión en curso) y las hojas se centran. En el celular no cambia nada. Prueba: `node tests/error-e2e.js` (variables `VW`, `VH`, `DSF` cambian el tamaño de las capturas de las demás pruebas; ej. `VW=1280 VH=800 DSF=1 SHOTS=carpeta node tests/assign-e2e.js`).

## Actualizar la app sin reinstalarla
- **Ajustes → Aplicación → «Buscar actualización»** compara la versión que corre con la publicada (`version.js`, siempre pedida a la red). Si hay una nueva aparece «Actualizar ahora»: renueva el service worker, borra lo guardado antes y recarga. **La cuenta y los datos se conservan: no hay que volver a ingresar.** Sin conexión avisa y no se rompe. Es igual en computador y celular.
- 6 segundos después de abrir la app se comprueba en silencio; si hay una versión nueva, el engranaje muestra un punto dorado.
- La versión se ve en Ajustes → Aplicación («Versión 4.2.0»). Al final de «Más» y de Ajustes solo va el crédito «Created & Developed by Felipe González» (dorado, seminegrita).
- **Al publicar cambios, sube la versión en `version.js`**: `n` (el número que se ve, «Versión 4.2.0») y `v` (`AAAA.MM.DD.n`, nombra el caché; la fecha debe coincidir). **Regla de `n` (X.Y.Z), sube en cada publicación:** arreglo pequeño → Z (4.2.0 → 4.2.1); función nueva → Y y Z vuelve a 0 (4.2.1 → 4.3.0); cambio grande → X (4.2.0 → 5.0.0). La comparación es numérica por partes (4.10.0 es más nueva que 4.9.0). Sin ese cambio las personas no ven «Hay una versión nueva». El caché del service worker usa ese número.
- Pruebas: `node tests/update-unit.js` y `node tests/update-e2e.js`.

## Lo que viene

- Informe automático diario y semanal con aviso al entrenador (pide un servicio de envío fuera del plan gratuito; por ahora se abre a mano).

## El entrenador también entrena (fase 9)

- **Mi semana:** el entrenador se asigna una semana del plan activo (cualquiera, sin corte de domingo ni requisitos) y entrena las mismas sesiones que el equipo, con sus kilos calculados desde sus propios máximos. Se guarda en `assignments/{su uid}` y `users/{su uid}/completions`. **No es miembro**: no aparece en Marcas ni en las comparaciones del equipo.
- **Reglas de Firestore:** nueva función `isTrainee(uid)` (atleta aprobado, o el entrenador con su propia cuenta) en la asignación, el avance, las sesiones cumplidas y la lectura de ajustes. **Hay que volver a publicar `firestore.rules` en la consola de Firebase** (Firestore → Reglas → pegar → Publicar).
- **Indicadores propios:** Progreso y Máximos (en «Más») muestran sus indicadores individuales; en Ajustes puede poner sexo, peso y categoría para sus torneos externos (no entra en las comparaciones del equipo).
- **Categorías IWF:** hombres 60 · 65 · 70 · 75 · 85 · 95 · 110 · +110; mujeres 49 · 53 · 57 · 61 · 69 · 77 · 86 · +86 (vigentes desde el 1 de agosto de 2026).
- **Pantalla fija en el teléfono:** sin zoom por pellizco ni doble toque (`viewport`, `touch-action`, bloqueo de gestos); todos los campos son de 16 px o más para que iOS no acerque la pantalla al tocarlos. Contrapartida de accesibilidad: no se puede ampliar con gestos (para letra más grande está el ajuste del sistema).
- **Temporizador:** minimizado, se abre tocándolo en cualquier parte; solo el botón de pausa/reanudar conserva su función.
- **Repeticiones planificadas:** en la sesión del plan (semana asignada o plan semanal libre) las repeticiones aparecen sombreadas como guía y el campo queda vacío: el atleta anota las que realmente hace (sin ellas no se puede marcar la serie; «Falló» también las pide).
- Pruebas: `node tests/coach-self-e2e.js` y `node tests/phone-e2e.js`.
- **Semanas que ya no existen:** si se vuelve a subir el plan y la semana asignada a un atleta desaparece, él ve «Semana no encontrada» y el entrenador ve en Equipo un aviso rojo con los nombres, y la fila del atleta marca «ya no existe en el plan». Se resuelve asignándole una semana de nuevo.

## Rutinas especiales para atletas (versiones 4.1.1–4.2.0)

- Para atletas iniciados que aún no tienen una semana del plan: en **Equipo**, al abrir un atleta aparece la tarjeta **Rutinas especiales** → «Nueva rutina». El editor es el mismo de la planificación de la app (sesiones con ejercicios, series, repeticiones y % del máximo) y además cada ejercicio lleva dos tiempos distintos: el **Descanso** entre series (el selector de siempre; «Auto» usa el habitual del ejercicio) y la **Pausa (s)**, de 0 a 10 segundos, que es la pausa que el atleta hace *dentro* del movimiento (p. ej. sentadilla sobre la cabeza con pausa de 1 s abajo). El atleta la ve en el ejercicio como «Pausa de 1 s en el movimiento»; 0 = sin pausa.
- La rutina tiene nombre, nota opcional y de 1 a 14 sesiones; se puede editar o eliminar (pide confirmar). Se guarda en `routines/{id}` y solo la ve el atleta indicado (y el entrenador).
- **El atleta** ve en «Semana» la tarjeta «Rutina de tu entrenador» con un botón **Iniciar** por sesión; entrena con la misma pantalla de sesión (kilos desde sus máximos, repeticiones sombreadas, pausa del entrenador como temporizador de descanso). También se guarda para abrir sin conexión.
- Una rutina no reemplaza ni borra la semana asignada: conviven.
- **Reglas de Firestore:** hay una regla nueva para `routines`. **Hay que volver a publicar `firestore.rules`** (Firestore → Reglas → pegar el archivo → Publicar); si no, las rutinas no se pueden guardar ni leer.
- Prueba: `node tests/routines-e2e.js`.

### Kilos, días y modo (versión 4.2.0)
- **Kilos fijos:** cada ejercicio de la rutina tiene un campo **Kilos** además del % del máximo. Vacío («auto») = el atleta calcula con su máximo; con un valor, esos kilos valen tal cual (0,1 a 600).
- **Día de entrenamiento:** cada sesión puede llevar un día (Lunes a Domingo) o «Cualquier día». El atleta ve el día en la sesión y se marca «(hoy)» cuando corresponde.
- **Modo, a elección del entrenador:** *Complementa el plan semanal* (el atleta ve su semana del plan y la rutina: entrena una, otra o ambas) o *Reemplaza el plan semanal* (mientras la rutina exista, el atleta solo ve la rutina; su semana asignada queda guardada, oculta, y reaparece si se quita la rutina o pasa a complementaria). En la ficha del atleta cada rutina muestra su modo y sus días.
- **Reglas de Firestore:** la rutina ahora guarda el campo `mode` (`extra` o `replace`). **Hay que volver a publicar `firestore.rules`**; si no, guardar una rutina falla con «Sin permiso».

## Automatización en GitHub (carpeta `.github/workflows`)
- **Pruebas** (`ci.yml`): en cada subida a `main` corre todas las pruebas, prueba `firestore.rules` con el **emulador de Firestore** (`tests/rules-emulator.js`, solo corre allí) y, tras publicar, comprueba que la página muestre la versión nueva; si no la muestra en 35 minutos el trabajo queda en rojo y GitHub avisa por correo.
- **Publicación condicionada (opcional):** en *Settings → Pages* elegir «GitHub Actions» y en *Settings → Secrets and variables → Actions → Variables* crear `DEPLOY_PAGES` = `true`. Desde entonces la página solo se publica si todas las pruebas pasan.
