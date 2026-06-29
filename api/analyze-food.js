const MAX_TOTAL_IMAGE_CHARS = 9_000_000;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body));

  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_TOTAL_IMAGE_CHARS + 50_000) {
        reject(new Error('Imagenes demasiado grandes'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function extractGeminiText(payload) {
  return (payload.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Gemini no devolvio datos validos');
    return JSON.parse(match[0]);
  }
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
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
      route: '/api/analyze-food',
      has_key: Boolean(apiKey),
      message: 'API lista. Usa la app para enviar una o varias fotos por POST.'
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
    const images = Array.isArray(body.images) ? body.images : [body.image].filter(Boolean);
    const notes = String(body.notes || '').slice(0, 500);
    const parsedImages = images.slice(0, 4).map(parseDataUrl).filter(Boolean);

    if (!parsedImages.length) {
      return sendJson(res, 400, { error: 'Debes enviar al menos una imagen valida' });
    }

    const totalChars = parsedImages.reduce((sum, img) => sum + img.data.length, 0);
    if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
      return sendJson(res, 413, { error: 'Las imagenes son demasiado grandes' });
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const parts = [
      {
        text: `Analiza esta comida desde una o varias fotos y estima macros. Si hay varias imagenes, usalas juntas como referencia del mismo plato o comida. Si hay duda, usa valores razonables para una porcion normal. Contexto del usuario: ${notes || 'sin contexto'}.\n\nDevuelve solo JSON valido, sin markdown, con esta forma exacta: {"meal_name":"Almuerzo","food_item":"nombre breve del plato","portion":"porcion estimada","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":0.0,"notes":"observacion corta"}`
      },
      ...parsedImages.map(img => ({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data
        }
      }))
    ];

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 600,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await geminiRes.json().catch(() => ({}));
    if (!geminiRes.ok) {
      return sendJson(res, geminiRes.status, {
        error: payload.error?.message || 'Gemini no pudo analizar la imagen'
      });
    }

    const parsed = parseModelJson(extractGeminiText(payload));
    return sendJson(res, 200, {
      meal_name: parsed.meal_name || 'Almuerzo',
      food_item: parsed.food_item || 'Comida estimada',
      portion: parsed.portion || 'Porcion estimada',
      calories: Math.round(numberValue(parsed.calories)),
      protein: Math.round(numberValue(parsed.protein)),
      carbs: Math.round(numberValue(parsed.carbs)),
      fat: Math.round(numberValue(parsed.fat)),
      confidence: Math.min(1, numberValue(parsed.confidence)),
      notes: parsed.notes || 'Estimacion aproximada. Confirma porciones antes de guardar.'
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Error analizando comida con Gemini' });
  }
};
