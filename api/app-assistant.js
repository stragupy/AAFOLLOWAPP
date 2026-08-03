const MAX_BODY_CHARS = 100_000;
const MAX_REQUEST_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 72_000;
const MAX_OPERATIONS = 20;

const ARRAY_COLLECTIONS = new Set([
  'bodylogs', 'routines', 'sessions', 'meals', 'meal_templates', 'goals',
  'checking_cardio', 'checking_goals', 'supplements', 'calendar_events',
  'reminders', 'checking_reviews'
]);

const MAP_COLLECTIONS = new Set([
  'nutconfig', 'daily_water', 'daily_wellness', 'free_days',
  'supplement_checks', 'dashboard_moods'
]);

const ALLOWED_FIELDS = {
  bodylogs: ['date', 'weight', 'body_fat', 'arm', 'chest', 'waist', 'thigh', 'calf', 'notes'],
  routines: ['name', 'days'],
  sessions: ['date', 'routine_name', 'day_name', 'duration', 'notes', 'sets'],
  meals: ['date', 'meal_name', 'food_item', 'calories', 'protein', 'carbs', 'fat'],
  meal_templates: ['meal_name', 'food_item', 'calories', 'protein', 'carbs', 'fat'],
  goals: ['title', 'status', 'type', 'unit', 'current', 'target', 'date'],
  checking_cardio: ['week', 'date', 'type', 'value'],
  checking_goals: ['week', 'title', 'category', 'metric', 'target', 'unit', 'priority', 'due_day', 'observations', 'reflection', 'progress', 'status', 'done'],
  supplements: ['name', 'dose'],
  calendar_events: ['title', 'date', 'all_day', 'start_time', 'end_time', 'category', 'location', 'notes', 'color'],
  reminders: ['label', 'type', 'time', 'repeat', 'date', 'enabled'],
  checking_reviews: ['week', 'adherence', 'energy', 'win', 'obstacle', 'focus'],
  nutconfig: ['calories', 'protein', 'carbs', 'fat'],
  daily_water: ['value'],
  daily_wellness: ['sleep', 'energy'],
  free_days: ['active'],
  supplement_checks: ['supplement_id', 'taken'],
  dashboard_moods: ['value']
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    const size = JSON.stringify(req.body).length;
    if (size > MAX_BODY_CHARS) return Promise.reject(new HttpError(413, 'La solicitud es demasiado grande'));
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string') {
    if (req.body.length > MAX_BODY_CHARS) return Promise.reject(new HttpError(413, 'La solicitud es demasiado grande'));
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch {
      return Promise.reject(new HttpError(400, 'JSON invalido'));
    }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY_CHARS) {
        reject(new HttpError(413, 'La solicitud es demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, 'JSON invalido'));
      }
    });
    req.on('error', reject);
  });
}

function safeValue(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value.slice(0, 700);
  if (depth >= 8) return null;
  if (Array.isArray(value)) return value.slice(0, 120).map(item => safeValue(item, depth + 1));
  if (typeof value !== 'object') return null;
  const clean = {};
  Object.entries(value).slice(0, 70).forEach(([key, item]) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return;
    clean[key] = safeValue(item, depth + 1);
  });
  return clean;
}

function pickData(collection, data) {
  const safe = safeValue(data || {}) || {};
  const fields = ALLOWED_FIELDS[collection] || [];
  return Object.fromEntries(fields.filter(field => safe[field] !== undefined).map(field => [field, safe[field]]));
}

function extractGeminiText(payload) {
  return (payload.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
}

function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function parseModelJson(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const objectText = firstJsonObject(cleaned);
    if (!objectText) throw new Error('Gemini no devolvio datos validos');
    return JSON.parse(objectText);
  }
}

function explicitDeleteRequest(request) {
  return /\b(borra|borrar|borralo|elimina|eliminar|quita|quitar|remueve|delete)\b/i.test(request);
}

function normalizeOperation(raw, index, context, canDelete) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').toLowerCase();
  const collection = String(raw.collection || '');
  const isArray = ARRAY_COLLECTIONS.has(collection);
  const isMap = MAP_COLLECTIONS.has(collection);
  if (!isArray && !isMap) return null;
  if (isArray && !['create', 'update', 'delete'].includes(action)) return null;
  if (isMap && !['set', 'update', 'delete'].includes(action)) return null;
  if (action === 'delete' && !canDelete) return null;

  const target = safeValue(raw.target || {}) || {};
  const data = pickData(collection, raw.data);
  if (isArray && ['update', 'delete'].includes(action) && !target.id) return null;
  if (isMap && collection !== 'nutconfig' && !target.date) {
    target.date = context.selected_date;
  }
  if (collection === 'supplement_checks' && !target.supplement_id && data.supplement_id) {
    target.supplement_id = data.supplement_id;
  }
  if (collection === 'supplement_checks' && !target.supplement_id) return null;
  if (collection === 'nutconfig' && action === 'delete') return null;
  if (action !== 'delete' && !Object.keys(data).length) return null;

  return {
    id: String(raw.id || `operation-${index + 1}`).slice(0, 80),
    action,
    collection,
    target,
    data,
    label: String(raw.label || `${action} ${collection}`).slice(0, 180)
  };
}

function normalizeResponse(raw, request, context) {
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .map(item => String(item).slice(0, 240))
    .slice(0, 8);
  const sourceOperations = Array.isArray(raw.operations) ? raw.operations : [];
  const operations = sourceOperations
    .map((operation, index) => normalizeOperation(operation, index, context, explicitDeleteRequest(request)))
    .filter(Boolean)
    .slice(0, MAX_OPERATIONS);
  if (operations.length < sourceOperations.length) {
    warnings.push('Se omitieron cambios que no cumplian las reglas de seguridad o no tenian un registro identificable.');
  }
  const needsClarification = Boolean(raw.needs_clarification);
  return {
    message: String(raw.message || (operations.length ? 'Revise los cambios antes de aplicarlos.' : 'No encontre cambios concretos para preparar.')).slice(0, 700),
    summary: String(raw.summary || 'Cambios propuestos').slice(0, 220),
    needs_clarification: needsClarification,
    clarification: String(raw.clarification || '').slice(0, 700),
    warnings: [...new Set(warnings)].slice(0, 8),
    operations: needsClarification ? [] : operations
  };
}

function assistantPrompt(request, contextText) {
  return `Eres el asistente operativo de AA Follow, una app personal de fitness, nutricion y seguimiento.

Tu tarea es interpretar una solicitud y devolver una VISTA PREVIA de cambios estructurados. No ejecutas nada. La app pedira confirmacion al usuario.

REGLAS OBLIGATORIAS:
1. Responde solo un objeto JSON valido, sin markdown.
2. Nunca inventes IDs. Para update o delete usa exactamente un id presente en CONTEXTO. Si no puedes identificar un unico registro, pide aclaracion y devuelve operations vacio.
3. Usa fechas YYYY-MM-DD y semanas YYYY-Www. Interpreta fechas relativas desde today y selected_date.
4. Maximo ${MAX_OPERATIONS} operaciones. Una operacion por registro o ajuste.
5. No accedas ni propongas cambios en usuarios, autenticacion, nube, claves, fotos, progreso, notas, papelera, historial, backups o configuracion tecnica.
6. Solo elimina cuando la solicitud lo pida expresamente. No elimines como efecto secundario de mover o editar.
7. No inventes comida, entrenamiento, peso, macros ni medidas que el usuario no haya indicado. Puedes completar defaults tecnicos obvios, pero si falta un dato esencial pide aclaracion.
8. Para una correccion o movimiento de algo existente usa update con su id; no crees un duplicado.
9. Si el usuario solo pide consejo o analisis y no solicita modificar datos, responde sin operaciones.

COLECCIONES Y CAMPOS PERMITIDOS:
- bodylogs: date, weight, body_fat, arm, chest, waist, thigh, calf, notes
- routines: name, days[{name, exercises[{name,target_sets,reps}]}]
- sessions: date, routine_name, day_name, duration, notes, sets[{exercise_name,set_number,target_sets,target_reps,reps,weight}]
- meals: date, meal_name, food_item, calories, protein, carbs, fat
- meal_templates: meal_name, food_item, calories, protein, carbs, fat
- goals: title, status, type, unit, current, target, date
- checking_cardio: week, date, type (steps o minutes), value
- checking_goals: week, title, category, metric, target, unit, priority, due_day, observations, reflection, progress, status, done
- supplements: name, dose
- calendar_events: title, date, all_day, start_time, end_time, category, location, notes, color (blue, green, amber, red o violet)
- reminders: label, type, time, repeat (daily, weekdays, weekends o once), date, enabled
- checking_reviews: week, adherence, energy, win, obstacle, focus
- nutconfig: calories, protein, carbs, fat
- daily_water: target.date y data.value en ml
- daily_wellness: target.date y data.sleep/data.energy
- free_days: target.date y data.active
- supplement_checks: target.date, target.supplement_id y data.taken
- dashboard_moods: target.date y data.value

ACCIONES:
- Colecciones de registros: create, update o delete.
- Configuraciones/mapas: set, update o delete.
- create lleva target {} y data con el registro.
- update/delete sobre registros lleva target {"id":"ID EXISTENTE"}.

FORMA EXACTA:
{"message":"respuesta breve","summary":"titulo de la propuesta","needs_clarification":false,"clarification":"","warnings":[],"operations":[{"id":"op-1","action":"create","collection":"meals","target":{},"data":{"date":"2026-08-02","meal_name":"Cena","food_item":"Pollo con arroz","calories":0,"protein":0,"carbs":0,"fat":0},"label":"Registrar cena del domingo"}]}

Si faltan datos esenciales:
{"message":"Necesito un dato mas.","summary":"Solicitud incompleta","needs_clarification":true,"clarification":"Pregunta concreta en espanol","warnings":[],"operations":[]}

SOLICITUD DEL USUARIO:
${request}

CONTEXTO ACTUAL DE LA APP:
${contextText}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return sendJson(res, 200, { ok: true });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      provider: 'gemini',
      route: '/api/app-assistant',
      has_key: Boolean(apiKey)
    });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Metodo no permitido' });
  if (!apiKey) return sendJson(res, 500, { error: 'Falta GEMINI_API_KEY o gemini_api_key en Vercel' });

  try {
    const body = await parseBody(req);
    const request = String(body.request || '').trim().slice(0, MAX_REQUEST_CHARS);
    if (request.length < 4) return sendJson(res, 400, { error: 'Escribe una solicitud mas concreta' });
    const context = safeValue(body.context || {}) || {};
    const contextText = JSON.stringify(context);
    if (contextText.length > MAX_CONTEXT_CHARS) {
      return sendJson(res, 413, { error: 'Hay demasiados registros en el contexto. Intenta nuevamente.' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: assistantPrompt(request, contextText) }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4_500,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      const message = payload.error?.message || 'Gemini no pudo preparar los cambios';
      if (/quota|rate.?limit|exceeded/i.test(message)) {
        return sendJson(res, 429, { error: `Cuota de Gemini agotada para el modelo ${model}. Intenta mas tarde. Detalle: ${message}` });
      }
      return sendJson(res, geminiRes.status, { error: message });
    }

    const parsed = parseModelJson(extractGeminiText(payload));
    return sendJson(res, 200, normalizeResponse(parsed, request, context));
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Error preparando cambios con Gemini' });
  }
};
