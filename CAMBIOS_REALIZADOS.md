# Resumen de Cambios y Mejoras - App de Remitos

Este documento resume las modificaciones realizadas en el repositorio `2do-remitos-app` para que cualquier IA o desarrollador pueda continuar con el proyecto.

## 1. Validación de Duplicados (Lógica Pura)
- **Archivo:** `js/ui.js` (Función `btn-save` listener).
- **Cambio:** Antes de guardar, se verifica en `_allRemitos` si ya existe un registro con el mismo `numeroRemito` y `chofer`. Si existe, se pide confirmación mediante un `confirm()`.

## 2. Gestión de Fotos en LocalStorage (Modo Gratuito)
- **Motivo:** Se descartó Firebase Storage para evitar costos/plan Blaze.
- **Implementación:**
  - Las fotos se optimizan a un máximo de 800px (ancho/alto) mediante `canvas` en `ui.js`.
  - Se guardan en el navegador del usuario usando `localStorage.setItem('foto_remito_[ID]', base64)`.
  - **Archivos:** `js/db.js` (funciones `saveFotoLocal`, `getFotoLocal`, `cleanOldPhotos`) y `js/ui.js` (lógica de guardado y visualización).
- **Visualización:** Se agregó una columna en la tabla con un icono de cámara 🖼️ que abre la foto local en una nueva pestaña.

## 3. Auto-borrado y Ciclo de Vida
- **Expiración:** Cada remito en Firestore tiene un campo `expiraEn` (calculado a 2 meses desde la creación).
- **Limpieza:** La función `cleanOldPhotos` en `db.js` se ejecuta cada vez que se reciben datos nuevos. Borra del `localStorage` cualquier foto cuya fecha haya expirado o cuyo remito ya no exista en la lista actual.

## 4. Mayúsculas Automáticas
- **Base de Datos:** La función `sanitizeRemito` en `db.js` aplica `.toUpperCase()` a los campos `numeroRemito`, `chofer`, `desde` y `hasta`.
- **Interfaz (UX):** Se agregó CSS en `styles.css` para que los inputs de texto muestren el contenido en mayúsculas mientras el usuario escribe.

## 5. Correcciones Técnicas (Bug Fixes)
- Se declaró la variable global `_remitoPhotoB64` en `ui.js` para evitar errores de "not defined".
- Se actualizó el `CACHE_NAME` en `sw.js` a `remitos-v2` para forzar la actualización de la PWA en los dispositivos de los usuarios.

---
**Nota para la siguiente IA:** El proyecto utiliza Firebase Firestore para los datos y LocalStorage para las imágenes. No intentar habilitar Firebase Storage a menos que el usuario lo pida explícitamente y confirme el plan Blaze.
