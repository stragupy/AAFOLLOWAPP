const {
  checkFatSecretConnection,
  getFoodById,
  isFatSecretConfigured,
  publicFatSecretError,
  searchFoods
} = require('../lib/fatsecret');

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo no permitido' });

  if (!isFatSecretConfigured()) {
    return sendJson(res, 503, {
      error: 'FatSecret aun no esta configurado en Vercel',
      code: 'FATSECRET_NOT_CONFIGURED'
    });
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const statusRequested = String(req.query?.status || requestUrl.searchParams.get('status') || '') === '1';
  const foodId = String(req.query?.food_id || requestUrl.searchParams.get('food_id') || '').trim();
  const query = String(req.query?.q || requestUrl.searchParams.get('q') || '').trim();

  try {
    if (statusRequested) {
      const configuration = await checkFatSecretConnection();
      return sendJson(res, 200, { ok: true, provider: 'FatSecret', configuration });
    }

    if (foodId) {
      const product = await getFoodById(foodId);
      return sendJson(res, 200, { product, source: 'FatSecret' });
    }

    const results = await searchFoods(query, 12);
    return sendJson(res, 200, { results, source: 'FatSecret' });
  } catch (error) {
    const safe = publicFatSecretError(error);
    return sendJson(res, safe.status, { error: safe.message, code: safe.code });
  }
};
