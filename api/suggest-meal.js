const MAX_BODY_CHARS = 18_000;

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
        reject(new HttpError(413, 'Pedido demasiado largo'));
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

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cleanString(value, max = 220) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSuggestion(item) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanString(item.title || item.food_item || item.name, 120);
  if (!title) return null;
  return {
    title,
    meal_name: cleanString(item.meal_name, 40),
    food_item: cleanString(item.food_item || title, 180),
    portion: cleanString(item.portion, 140),
    calories: Math.round(numberValue(item.calories)),
    protein: Math.round(numberValue(item.protein)),
    carbs: Math.round(numberValue(item.carbs)),
    fat: Math.round(numberValue(item.fat)),
    reason: cleanString(item.reason, 280),
    prep: cleanString(item.prep, 280)
  };
}

function normalizeResponse(parsed, fallbackMeal) {
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map(normalizeSuggestion)
    .filter(Boolean)
    .slice(0, 4)
    .map(item => ({ ...item, meal_name: item.meal_name || fallbackMeal || 'Comida' }));

  return {
    summary: cleanString(parsed.summary || 'Opciones ajustadas a tus objetivos del dia.', 260),
    suggestions
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
      route: '/api/suggest-meal',
      has_key: Boolean(apiKey),
      message: 'API lista. Envia objetivos, comida del dia y tipo de comida por POST.'
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
    const mealName = cleanString(body.meal_name || body.mealName || 'Almuerzo', 40) || 'Almuerzo';
    const preferences = cleanString(body.preferences, 1000);
    const context = JSON.stringify(body.context || {}).slice(0, 9000);

    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const prompt = `Recomienda comidas practicas para una app fitness. El usuario pide ideas para: ${mealName}. Ajusta las opciones a sus objetivos y a lo que ya comio hoy. Si faltan muchas calorias o proteina, prioriza eso. Si ya esta cerca del objetivo, sugiere opciones mas livianas. Si es dia libre, no lo marques como fallo: igual intenta que la opcion sea razonable. Preferencias o restricciones del usuario: ${preferences || 'sin preferencias'}. Contexto nutricional local: ${context}.

Devuelve un unico objeto JSON valido, sin markdown, con esta forma exacta:
{"summary":"lectura breve","suggestions":[{"title":"nombre de la opcion","meal_name":"${mealName}","food_item":"descripcion breve para guardar","portion":"porcion sugerida","calories":0,"protein":0,"carbs":0,"fat":0,"reason":"por que encaja con los objetivos","prep":"preparacion corta"}]}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 1600,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      const message = payload.error?.message || 'Gemini no pudo sugerir comidas';
      if (/quota|rate.?limit|exceeded/i.test(message)) {
        return sendJson(res, 429, {
          error: `Cuota de Gemini agotada para el modelo ${model}. Prueba mas tarde o cambia GEMINI_MODEL en Vercel. Detalle: ${message}`
        });
      }
      return sendJson(res, geminiRes.status, { error: message });
    }

    const parsed = parseModelJson(extractGeminiText(payload));
    const data = normalizeResponse(parsed, mealName);
    if (!data.suggestions.length) {
      return sendJson(res, 500, { error: 'Gemini no devolvio opciones validas' });
    }
    return sendJson(res, 200, data);
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message || 'Error sugiriendo comidas con Gemini' });
  }
};
