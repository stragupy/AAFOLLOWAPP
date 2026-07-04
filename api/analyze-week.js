const MAX_BODY_CHARS = 36_000;

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
        reject(new HttpError(413, 'Resumen semanal demasiado largo'));
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

function cleanString(value, max = 260) {
  return String(value || '').trim().slice(0, max);
}

function stringList(value, maxItems = 5, maxChars = 220) {
  return (Array.isArray(value) ? value : [])
    .map(item => cleanString(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizePriority(item) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanString(item.title, 80);
  const detail = cleanString(item.detail, 240);
  if (!title && !detail) return null;
  return { title: title || 'Prioridad', detail };
}

function normalizeGoal(item) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanString(item.title, 90);
  if (!title) return null;
  return {
    title,
    type: cleanString(item.type || 'other', 40),
    target: cleanString(item.target, 40),
    unit: cleanString(item.unit, 30)
  };
}

function normalizeReport(parsed, week) {
  const plan = parsed.next_week_plan && typeof parsed.next_week_plan === 'object' ? parsed.next_week_plan : {};
  const score = Math.round(Number(parsed.score));

  return {
    week,
    headline: cleanString(parsed.headline || 'Lectura semanal lista.', 180),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    wins: stringList(parsed.wins, 5),
    risks: stringList(parsed.risks, 5),
    priorities: (Array.isArray(parsed.priorities) ? parsed.priorities : [])
      .map(normalizePriority)
      .filter(Boolean)
      .slice(0, 4),
    next_week_plan: {
      training: cleanString(plan.training, 260),
      nutrition: cleanString(plan.nutrition, 260),
      recovery: cleanString(plan.recovery, 260),
      tracking: cleanString(plan.tracking, 260)
    },
    suggested_goals: (Array.isArray(parsed.suggested_goals) ? parsed.suggested_goals : [])
      .map(normalizeGoal)
      .filter(Boolean)
      .slice(0, 4),
    closing_note: cleanString(parsed.closing_note, 260),
    generated_at: new Date().toISOString()
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
      route: '/api/analyze-week',
      has_key: Boolean(apiKey),
      message: 'API lista. Envia un resumen semanal por POST.'
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
    const week = /^\d{4}-W\d{2}$/.test(body.week || '') ? body.week : 'semana actual';
    const summary = JSON.stringify(body.summary || {}).slice(0, 24_000);
    const note = cleanString(body.user_note, 1200);

    if (summary.length < 80) {
      return sendJson(res, 400, { error: 'Faltan datos de la semana para analizar' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const prompt = `Actua como coach semanal de una app fitness. Analiza la semana seleccionada con tono directo, claro y practico. No diagnostiques salud, no inventes datos no presentes y si hay poca informacion dilo. Tu objetivo es ayudar al usuario a decidir que repetir, que corregir y que hacer la proxima semana. Semana: ${week}. Nota opcional del usuario: ${note || 'sin nota'}. Datos locales resumidos: ${summary}

Devuelve un unico objeto JSON valido, sin markdown, con esta forma exacta:
{"headline":"lectura principal en una frase","score":0,"wins":["logro concreto"],"risks":["riesgo o hueco de seguimiento"],"priorities":[{"title":"prioridad","detail":"accion concreta"}],"next_week_plan":{"training":"plan de entrenamiento","nutrition":"plan de nutricion","recovery":"plan de recuperacion","tracking":"que registrar mejor"},"suggested_goals":[{"title":"objetivo semanal sugerido","type":"training_count","target":"4","unit":"sesiones"}],"closing_note":"cierre breve"}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 1800,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      const message = payload.error?.message || 'Gemini no pudo analizar la semana';
      if (/quota|rate.?limit|exceeded/i.test(message)) {
        return sendJson(res, 429, {
          error: `Cuota de Gemini agotada para el modelo ${model}. Prueba mas tarde o cambia GEMINI_MODEL en Vercel. Detalle: ${message}`
        });
      }
      return sendJson(res, geminiRes.status, { error: message });
    }

    const parsed = parseModelJson(extractGeminiText(payload));
    return sendJson(res, 200, normalizeReport(parsed, week));
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message || 'Error analizando la semana con Gemini' });
  }
};
