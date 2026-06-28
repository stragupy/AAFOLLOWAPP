const MAX_IMAGE_CHARS = 7_000_000;

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
      if (raw.length > MAX_IMAGE_CHARS + 50_000) {
        reject(new Error('Imagen demasiado grande'));
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

function extractText(payload) {
  if (payload.output_text) return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('La IA no devolvio datos validos');
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

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Metodo no permitido' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 500, { error: 'Falta OPENAI_API_KEY en Vercel' });
  }

  try {
    const body = await parseBody(req);
    const image = String(body.image || '');
    const notes = String(body.notes || '').slice(0, 500);

    if (!image.startsWith('data:image/')) {
      return sendJson(res, 400, { error: 'Debes enviar una imagen valida' });
    }
    if (image.length > MAX_IMAGE_CHARS) {
      return sendJson(res, 413, { error: 'La imagen es demasiado grande' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_FOOD_MODEL || 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: 'Eres un nutricionista deportivo. Estima macros desde fotos de comida. Devuelve solo JSON valido, sin markdown. Se conservador y explica incertidumbres brevemente.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: `Analiza esta comida y estima macros. Si hay duda, usa valores razonables para una porcion normal. Contexto del usuario: ${notes || 'sin contexto'}.\n\nJSON requerido: {"meal_name":"Almuerzo","food_item":"nombre breve del plato","portion":"porcion estimada","calories":0,"protein":0,"carbs":0,"fat":0,"confidence":0.0,"notes":"observacion corta"}`
              },
              {
                type: 'input_image',
                image_url: image,
                detail: 'low'
              }
            ]
          }
        ],
        max_output_tokens: 600
      })
    });

    const payload = await openaiRes.json().catch(() => ({}));
    if (!openaiRes.ok) {
      return sendJson(res, openaiRes.status, {
        error: payload.error?.message || 'OpenAI no pudo analizar la imagen'
      });
    }

    const parsed = parseModelJson(extractText(payload));
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
    return sendJson(res, 500, { error: err.message || 'Error analizando comida' });
  }
};
