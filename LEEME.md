# Halterofilia · Selección

App web instalable (PWA) para registrar los entrenamientos de la selección de halterofilia. Funciona en iPhone, Android, Windows y Mac desde un solo código, sin pasar por las tiendas de aplicaciones.

**Estado: fase 1.** Cuentas con correo y contraseña, solicitud de acceso, aprobación por el entrenador, app instalable que abre sin conexión. Los registros de entrenamiento todavía se guardan en cada dispositivo; la copia en la nube llega en la fase 2.

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
| `tests/` | Pruebas automáticas |

## Puesta en marcha (una sola vez)

1. **Publicar las reglas.** Consola de Firebase → Firestore Database → Reglas → pegar el contenido de `firestore.rules` → Publicar.
2. **Publicar el sitio** en una dirección `https://` (por ejemplo GitHub Pages) y agregar ese dominio en Firebase → Authentication → Configuración → Dominios autorizados.
3. **Crear la cuenta del entrenador:** Cristian abre la app, crea su cuenta y espera en «Solicitud enviada».
4. **Nombrar al entrenador:** en Firebase → Authentication → Usuarios, copiar el **UID** de Cristian. En Firestore Database crear la colección `config`, documento `team`, con un campo de texto `coachUid` y ese UID. Al volver a abrir la app, Cristian entra como entrenador y ve «Equipo».
5. **Aprobar atletas:** cada atleta crea su cuenta; Cristian los aprueba desde «Equipo».

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
node tests/plan-import.js  # lectura del plan (sin navegador)
node tests/plan.js         # el entrenador carga, publica y activa un plan
```

## Plan anual (fase 3): cargar el Excel cada año

En **Planes** el entrenador sube el Excel del año. Se aceptan dos formatos:

- **Planilla de Cristian** (la de 2026): bloques por semana, días de lunes a viernes en las columnas D a H. La prescripción (`70% 8-10repsX3`) va en la celda de arriba del ejercicio al que se aplica.
- **Plantilla simple** (recomendada para los años siguientes, se descarga desde la misma pantalla): una fila por ejercicio con Etapa, Semana, Día, Orden, Bloque, Ejercicio, %, Repeticiones, Series.

Reglas de lectura: el % es del máximo del mismo ejercicio (arranque o envión); las fechas del Excel se ignoran; las cargas escritas en la celda («snatch press 30k») no se guardan; `+` junta ejercicios de un complejo y `/` separa alternativas. Un número suelto después de un curl de bíceps («biceps 30») y `(15")` en «iso carga» son segundos de espera isométrica. Desde 90% los porcentajes quedan marcados como ajustables (el entrenador los adapta a cada atleta). Una semana de transición (descanso de halterofilia, actividad libre) se lee como semana sin sesiones; en la plantilla simple se escribe `Transición` en la columna Ejercicio.
La app muestra una revisión antes de publicar: una muestra de la primera semana y los ejercicios que no reconoce. El entrenador les pone nombre y quedan en el catálogo (`exercises`), así no se vuelven a preguntar. Cada carga crea un plan nuevo; los anteriores se conservan, y el atleta ve el que esté **activo**.

**No subir el Excel ni el plan convertido a este repositorio:** es público. El plan vive solo en Firestore.

## Lo que viene

- Fase 2: copia en la nube de los registros de cada atleta (motor de sincronización como el de «app finanzas»).
- Fase 3 (carga del plan: hecha) y fase 4: asignación de etapa y semana por atleta, pantalla del atleta con su semana, avance semanal con corte el viernes 23:59 (hora de Chile).
- Informes para el entrenador (planificado vs realizado y observaciones de los atletas): pendientes hasta que exista la base de datos del plan.
