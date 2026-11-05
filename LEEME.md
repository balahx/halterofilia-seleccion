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
```

## Lo que viene

- Fase 2: copia en la nube de los registros de cada atleta (motor de sincronización como el de «app finanzas»).
- Fase 3 y 4: plan anual desde el Excel de Cristian, asignación de etapa y semana por atleta, avance semanal con corte el viernes 23:59 (hora de Chile).
- Informes para el entrenador (planificado vs realizado y observaciones de los atletas): pendientes hasta que exista la base de datos del plan.
