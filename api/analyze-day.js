const MAX_BODY_CHARS = 24_000;

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
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
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
        reject(new HttpError(413, 'Texto demasiado largo'));
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

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return '';
}

function parseModelJson(text) {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonText = firstJsonObject(cleaned);
    if (!jsonText) throw new Error('Gemini no devolvio datos validos');
    return JSON.parse(jsonText);
  }
}

function numberValue(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cleanString(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function normalizeMeal(meal) {
  const food = cleanString(meal.food_item || meal.name || meal.food, 140);
  if (!food) return null;
  return {
    meal_name: cleanString(meal.meal_name || 'Comida', 40) || 'Comida',
    food_item: food,
    calories: Math.round(numberValue(meal.calories, 0)),
    protein: Math.round(numberValue(meal.protein, 0)),
    carbs: Math.round(numberValue(meal.carbs, 0)),
    fat: Math.round(numberValue(meal.fat, 0))
  };
}

function normalizeSet(set, index) {
  const exercise = cleanString(set.exercise_name || set.exercise || set.name, 120);
  if (!exercise) return null;
  return {
    exercise_name: exercise,
    set_number: Math.max(1, Math.round(numberValue(set.set_number, index + 1))),
    target_sets: numberValue(set.target_sets, null),
    target_reps: numberValue(set.target_reps, null),
    reps: Math.round(numberValue(set.reps, 0)),
    weight: numberValue(set.weight, 0)
  };
}

function normalizeDraft(parsed, fallbackDate) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed.date || '') ? parsed.date : fallbackDate;
  const bodylog = parsed.bodylog && typeof parsed.bodylog === 'object' ? parsed.bodylog : null;
  const wellness = parsed.wellness && typeof parsed.wellness === 'object' ? parsed.wellness : null;
  const note = parsed.note && typeof parsed.note === 'object' ? parsed.note : null;

  return {
    date,
    summary: cleanString(parsed.summary || 'Borrador generado desde tu descripcion del dia.', 220),
    meals: (Array.isArray(parsed.meals) ? parsed.meals : []).map(normalizeMeal).filter(Boolean).slice(0, 12),
    bodylog: bodylog ? {
      weight: numberValue(bodylog.weight, null),
      body_fat: numberValue(bodylog.body_fat, null),
      arm: numberValue(bodylog.arm, null),
      chest: numberValue(bodylog.chest, null),
      waist: numberValue(bodylog.waist, null),
      thigh: numberValue(bodylog.thigh, null),
      calf: numberValue(bodylog.calf, null),
      notes: cleanString(bodylog.notes, 240)
    } : null,
    sessions: (Array.isArray(parsed.sessions) ? parsed.sessions : []).map(session => {
      const sets = (Array.isArray(session.sets) ? session.sets : [])
        .map(normalizeSet)
        .filter(Boolean)
        .slice(0, 60);
      if (!sets.length) return null;
      return {
        routine_name: cleanString(session.routine_name, 80),
        day_name: cleanString(session.day_name, 80),
        duration: numberValue(session.duration, null),
        notes: cleanString(session.notes, 240),
        sets
      };
    }).filter(Boolean).slice(0, 4),
    cardio: (Array.isArray(parsed.cardio) ? parsed.cardio : []).map(item => {
      const type = item.type === 'minutes' ? 'minutes' : item.type === 'steps' ? 'steps' : '';
      const value = Math.round(numberValue(item.value, 0));
      return type && value > 0 ? { type, value } : null;
    }).filter(Boolean).slice(0, 8),
    supplements: (Array.isArray(parsed.supplements) ? parsed.supplements : []).map(item => {
      const name = cleanString(item.name, 90);
      if (!name) return null;
      return { name, dose: cleanString(item.dose, 80), taken: item.taken !== false };
    }).filter(Boolean).slice(0, 12),
    wellness: wellness ? {
      sleep: numberValue(wellness.sleep, null),
      energy: numberValue(wellness.energy, null),
      mood: cleanString(wellness.mood, 30)
    } : null,
    water_ml: numberValue(parsed.water_ml, null),
    note: note && (note.title || note.content) ? {
      title: cleanString(note.title || 'Resumen del dia', 120),
      content: cleanString(note.content, 1200),
      mood: Math.min(5, Math.max(1, Math.round(numberValue(note.mood, 3))))
    } : null
  };
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
      route: '/api/analyze-day',
      has_key: Boolean(apiKey),
      message: 'API lista. Envia una descripcion del dia por POST.'
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Metodo no permitido' });
  }

  if (!apiKey) {
    return sendJson(res, 500, { error: 'Falta GEMINI_API_KEY o gemini_api_key en Vercel' });
  }

  try {
    const body = await parseBody(req);
    const description = cleanString(body.description, 8000);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : new Date().toISOString().slice(0, 10);
    const context = JSON.stringify(body.context || {}).slice(0, 5000);

    if (description.length < 12) {
      return sendJson(res, 400, { error: 'Describe un poco mas tu dia para poder cargar datos' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const prompt = `Convierte esta descripcion diaria en datos para una app de seguimiento fitness. Usa solo informacion mencionada o inferencias prudentes. Si no hay dato claro, usa arrays vacios o null. Si estima macros de comidas sin cantidades exactas, usa porciones razonables y confidence implicita conservadora. Fecha objetivo: ${date}. Contexto local opcional: ${context}. Descripcion del usuario: ${description}

Devuelve un unico objeto JSON valido, sin markdown, con esta forma exacta:
{"date":"${date}","summary":"resumen corto","meals":[{"meal_name":"Desayuno","food_item":"alimento o plato","calories":0,"protein":0,"carbs":0,"fat":0}],"bodylog":{"weight":null,"body_fat":null,"arm":null,"chest":null,"waist":null,"thigh":null,"calf":null,"notes":""},"sessions":[{"routine_name":"","day_name":"","duration":0,"notes":"","sets":[{"exercise_name":"Press banca","set_number":1,"target_sets":null,"target_reps":null,"reps":0,"weight":0}]}],"cardio":[{"type":"steps","value":0}],"supplements":[{"name":"Creatina","dose":"","taken":true}],"wellness":{"sleep":null,"energy":null,"mood":""},"water_ml":null,"note":{"title":"Resumen del dia","content":"","mood":3}}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 1800,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      const message = payload.error?.message || 'Gemini no pudo analizar el dia';
      if (/quota|rate.?limit|exceeded/i.test(message)) {
        return sendJson(res, 429, {
          error: `Cuota de Gemini agotada para el modelo ${model}. Prueba mas tarde o cambia GEMINI_MODEL en Vercel. Detalle: ${message}`
        });
      }
      return sendJson(res, geminiRes.status, { error: message });
    }

    const parsed = parseModelJson(extractGeminiText(payload));
    return sendJson(res, 200, normalizeDraft(parsed, date));
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message || 'Error analizando el dia con Gemini' });
  }
};
