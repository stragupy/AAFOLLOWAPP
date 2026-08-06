const {
  checkFatSecretConnection,
  getFoodById,
  isFatSecretConfigured,
  publicFatSecretError,
  searchFoods
} = require('../lib/fatsecret');

const OPEN_FOOD_FACTS_SEARCH_URL = 'https://search.openfoodfacts.org/search';
const OPEN_FOOD_FACTS_FIELDS = [
  'code', 'product_name', 'product_name_es', 'brands', 'nutriments',
  'serving_size', 'serving_quantity', 'serving_quantity_unit',
  'image_front_small_url', 'countries_tags'
];
const REQUEST_TIMEOUT_MS = 9000;

function sendJson(res, status, data, cacheControl = 'private, no-store, max-age=0') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(data));
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rounded(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function firstText(value) {
  if (Array.isArray(value)) return String(value.find(Boolean) || '');
  return String(value || '');
}

function openFoodFactsMacros(product) {
  const nutrients = product?.nutriments || {};
  let calories = numberOrNull(nutrients['energy-kcal_100g']);
  if (calories == null) {
    const kilojoules = numberOrNull(nutrients['energy-kj_100g'] ?? nutrients.energy_100g);
    if (kilojoules != null) calories = kilojoules / 4.184;
  }
  const protein = numberOrNull(nutrients.proteins_100g);
  const carbs = numberOrNull(nutrients.carbohydrates_100g);
  const fat = numberOrNull(nutrients.fat_100g);
  if ([calories, protein, carbs, fat].some(value => value == null)) return null;
  return {
    calories: rounded(calories),
    protein: rounded(protein),
    carbs: rounded(carbs),
    fat: rounded(fat)
  };
}

function normalizeChileanProduct(product) {
  const code = String(product?.code || '').replace(/\D/g, '');
  const name = String(product?.product_name_es || product?.product_name || '').trim().slice(0, 180);
  const macros = openFoodFactsMacros(product);
  if (!/^\d{8,14}$/.test(code) || !name || !macros) return null;
  const brand = firstText(product?.brands).trim().slice(0, 160);
  return {
    food_id: `off:${code}`,
    lookup_id: `off:${code}`,
    name,
    brand,
    type: 'Producto vendido en Chile',
    description: `${macros.calories} kcal | P ${macros.protein}g | C ${macros.carbs}g | G ${macros.fat}g por 100g`,
    source: 'Open Food Facts Chile'
  };
}

function safeSearchTerm(query) {
  return String(query || '')
    .replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function searchChileanProducts(query, limit = 8) {
  const searchTerm = safeSearchTerm(query);
  if (searchTerm.length < 2) return [];
  const response = await fetchWithTimeout(OPEN_FOOD_FACTS_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': process.env.OPEN_FOOD_FACTS_USER_AGENT || 'AAFollowApp/1.0 (Chile nutrition search)'
    },
    body: JSON.stringify({
      q: `${searchTerm} countries_tags:"en:chile"`,
      langs: ['es', 'en'],
      page: 1,
      page_size: 18,
      boost_phrase: true,
      fields: OPEN_FOOD_FACTS_FIELDS
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.hits)) throw new Error('OPEN_FOOD_FACTS_SEARCH_FAILED');
  return payload.hits.map(normalizeChileanProduct).filter(Boolean).slice(0, limit);
}

function extractGeminiText(payload) {
  return (payload?.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join(' ')
    .trim();
}

async function translateFoodQuery(query) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
  if (!apiKey) return String(query || '');
  const original = String(query || '').trim().slice(0, 120);
  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: `Translate this Chilean Spanish food search to concise US English. Preserve brand names. Return only the translated search, maximum 8 words: ${original}` }]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 30 }
        })
      },
      7000
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return original;
    const translated = extractGeminiText(payload)
      .replace(/[`"\r\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    return translated.length >= 2 ? translated : original;
  } catch {
    return original;
  }
}

function genericFatSecretResults(results, limit) {
  return (Array.isArray(results) ? results : [])
    .filter(item => String(item?.type || '').toLowerCase() === 'generic')
    .slice(0, limit)
    .map(item => ({
      ...item,
      food_id: `fs:${item.food_id}`,
      lookup_id: `fs:${item.food_id}`,
      source: 'FatSecret'
    }));
}

async function searchGenericFoods(query, limit = 5) {
  let results = genericFatSecretResults(await searchFoods(query, 12), limit);
  let translatedQuery = '';
  if (!results.length) {
    const translated = await translateFoodQuery(query);
    if (translated && translated.toLocaleLowerCase() !== String(query).trim().toLocaleLowerCase()) {
      translatedQuery = translated;
      results = genericFatSecretResults(await searchFoods(translated, 12), limit);
    }
  }
  return { results, translatedQuery };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo no permitido' });

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const statusRequested = String(req.query?.status || requestUrl.searchParams.get('status') || '') === '1';
  const foodId = String(req.query?.food_id || requestUrl.searchParams.get('food_id') || '').trim();
  const query = String(req.query?.q || requestUrl.searchParams.get('q') || '').trim();
  const fatSecretConfigured = isFatSecretConfigured();

  try {
    if (statusRequested) {
      if (!fatSecretConfigured) {
        return sendJson(res, 503, {
          error: 'FatSecret aun no esta configurado en Vercel',
          code: 'FATSECRET_NOT_CONFIGURED'
        });
      }
      const configuration = await checkFatSecretConnection();
      return sendJson(res, 200, { ok: true, provider: 'FatSecret', configuration });
    }

    if (foodId) {
      if (!fatSecretConfigured) {
        return sendJson(res, 503, {
          error: 'FatSecret aun no esta configurado en Vercel',
          code: 'FATSECRET_NOT_CONFIGURED'
        });
      }
      const normalizedFoodId = foodId.replace(/^fs:/, '');
      const product = await getFoodById(normalizedFoodId);
      return sendJson(res, 200, { product, source: 'FatSecret' });
    }

    if (query.length < 2) return sendJson(res, 400, { error: 'Escribe al menos 2 caracteres', code: 'INVALID_SEARCH' });

    const [chileanResult, genericResult] = await Promise.allSettled([
      searchChileanProducts(query, 8),
      fatSecretConfigured ? searchGenericFoods(query, 4) : Promise.resolve({ results: [], translatedQuery: '' })
    ]);
    const chileanProducts = chileanResult.status === 'fulfilled' ? chileanResult.value : [];
    const genericFoods = genericResult.status === 'fulfilled' ? genericResult.value.results : [];
    const translatedQuery = genericResult.status === 'fulfilled' ? genericResult.value.translatedQuery : '';
    const results = [...chileanProducts, ...genericFoods].slice(0, 12);

    if (!results.length && chileanResult.status === 'rejected' && genericResult.status === 'rejected') {
      const safe = publicFatSecretError(genericResult.reason);
      return sendJson(res, safe.status, { error: safe.message, code: safe.code });
    }

    return sendJson(res, 200, {
      results,
      source: 'Open Food Facts Chile + FatSecret',
      translated_query: translatedQuery || undefined
    }, 'public, s-maxage=300, stale-while-revalidate=900');
  } catch (error) {
    const safe = publicFatSecretError(error);
    return sendJson(res, safe.status, { error: safe.message, code: safe.code });
  }
};
