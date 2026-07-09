# AA Follow App - memoria para Codex

Esta app web vive principalmente en `index.html`, con funciones serverless en `api/`.
Se despliega desde GitHub a Vercel.

## Regla principal

El usuario quiere arreglar y agregar funciones sin perder el progreso de usuarios.
No cambiar ni migrar claves existentes de `localStorage` salvo que sea imprescindible y compatible.
La persistencia local usa el prefijo `ft_` mediante:

```js
localStorage.setItem('ft_' + key, JSON.stringify(value))
```

Tambien hay sincronizacion con Supabase en la tabla `aa_follow_data`.
No tocar la estructura de progreso de usuarios sin mucho cuidado.

## Archivos importantes

- `index.html`: UI, estilos y casi todo el JS inline.
- `api/analyze-food.js`: analiza comida con Gemini.
- `api/analyze-day.js`: IA para describir el dia y generar un borrador editable.
- `api/analyze-week.js`: Coach IA semanal.
- `api/suggest-meal.js`: sugiere comidas segun objetivos y lo consumido en el dia.
- `manifest.webmanifest`: PWA.

## Variables de IA

Las APIs usan la misma key/modelo:

```js
process.env.GEMINI_API_KEY || process.env.gemini_api_key
process.env.GEMINI_MODEL || 'gemini-3.5-flash'
```

## Cambios hechos en esta conversacion

### Seguridad y estabilidad

- Se escaparon textos libres antes de pintarlos con `innerHTML`.
- Se corrigio `renderStatChart()` para definir `mutedColor` y `gridColor` localmente.
- `api/analyze-food.js` fue endurecido:
  - valida JSON invalido como 400
  - payload grande como 413
  - restringe imagenes a `image/jpeg`, `image/png`, `image/webp`
  - maneja errores HTTP con `HttpError`

### IA Dia

Se creo `api/analyze-day.js` y una pantalla `IA Dia`.
Permite describir el dia y generar un borrador antes de aplicar.
El borrador puede incluir:

- comidas
- bodylog
- sesiones
- cardio
- suplementos
- bienestar
- agua
- nota

Importante: no guarda nada hasta tocar "Aplicar borrador".

### Editor rapido del dia

Se agrego un editor en "Hoy" para modificar registros sin borrar todo:

- comidas
- bodylog
- sesiones y series
- cardio
- sueno/energia
- agua
- notas

### Coach IA semanal

Se creo `api/analyze-week.js` y la pantalla `Coach IA`.
Lee datos semanales y genera recomendaciones.
Guarda reportes en una clave nueva:

```txt
ft_week_coach_reports
```

No modifica registros existentes.

### Dia libre

Se agrego boton de "Dia libre".
Guarda marcas en:

```txt
ft_free_days
```

Comportamiento actual:

- No exige lo que falte en ese dia.
- Si se registro comida, pasos, entreno, peso, agua o sueno, eso si se evalua.
- El Coach IA recibe `free_day: true` y debe evaluar solo lo cargado, sin marcar faltantes como fallo.

### Autosave de entrenamiento

Se agrego autosave para evitar perder series si se apaga/cierra el iPhone/PWA.
Claves nuevas:

```txt
ft_live_workout_draft
ft_session_workout_draft
```

Guarda mientras se editan ejercicios/series y tambien en:

- `visibilitychange`
- `pagehide`

Al guardar la sesion real, se limpia el borrador correspondiente.

### IA de comida por foto o texto

`api/analyze-food.js` ahora acepta:

- solo foto
- foto + descripcion
- solo descripcion de texto

La UI de Nutricion fue renombrada a "Analizar comida con IA".

### Sugeridor de comidas

Se creo `api/suggest-meal.js` y una card "Que puedo comer" en Nutricion.
El usuario elige tipo de comida, por ejemplo desayuno/almuerzo/cena, y puede escribir preferencias.
La IA recibe:

- objetivos de `nutconfig`
- macros consumidos del dia
- macros restantes
- comidas ya registradas
- si el dia esta marcado como libre

Devuelve opciones con macros estimados. No guarda nada automaticamente: el usuario toca "Usar" y se rellena el modal de alimento.

## Verificaciones usadas

Para validar el JS inline:

```bash
awk 'found && /<\/script>/{exit} found{print} /^<script>$/{found=1}' index.html > /tmp/aafollow-index-script.js && node --check /tmp/aafollow-index-script.js
```

Para validar APIs:

```bash
node --check api/analyze-food.js && node --check api/analyze-day.js && node --check api/analyze-week.js
```

Si existe `api/suggest-meal.js`, incluirlo:

```bash
node --check api/suggest-meal.js
```

## Cuando el usuario diga "subir a GitHub/Vercel"

Recordar que suelen necesitar subirse estos archivos segun cambios recientes:

- `index.html`
- `api/analyze-food.js`
- `api/analyze-day.js`
- `api/analyze-week.js`
- `api/suggest-meal.js`

## Estilo de respuesta al usuario

Responder en espanol, simple y directo.
El usuario quiere proteger el progreso de la app ante todo.
Si pide implementar algo, hacerlo con cambios acotados y verificar sintaxis.
