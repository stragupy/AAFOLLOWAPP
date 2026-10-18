const HEVY_API_BASE = 'https://api.hevyapp.com/v1';
const REQUEST_TIMEOUT_MS = 12000;

function sendJson(res, status, data, cacheControl = 'private, no-store, max-age=0') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key, x-hevy-api-key, Authorization');
  res.setHeader('Cache-Control', cacheControl);
  res.end(JSON.stringify(data));
}

async function fetchHevy(endpoint, apiKey, options = {}) {
  const url = `${HEVY_API_BASE}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'api-key': apiKey,
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const errorMsg = json?.error || json?.message || `Hevy API error (${response.status})`;
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = json;
      throw error;
    }

    return json;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key, x-hevy-api-key, Authorization');
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Método no permitido' });
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const action = String(req.query?.action || requestUrl.searchParams.get('action') || 'test').toLowerCase();

  const apiKey = (
    req.headers['api-key'] ||
    req.headers['x-hevy-api-key'] ||
    req.query?.apiKey ||
    requestUrl.searchParams.get('apiKey') ||
    process.env.HEVY_API_KEY ||
    process.env.hevy_api_key ||
    ''
  ).trim();

  if (!apiKey) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Falta la API Key de Hevy. Ingrésala en la app o configúrala en Vercel (HEVY_API_KEY)',
      code: 'HEVY_API_KEY_REQUIRED'
    });
  }

  try {
    if (action === 'test' || action === 'info') {
      let workoutCount = null;
      let userInfo = null;

      try {
        const countData = await fetchHevy('/workouts/count', apiKey);
        workoutCount = countData?.workout_count ?? countData?.count ?? null;
      } catch (err) {
        if (err.status === 401) throw err;
      }

      try {
        userInfo = await fetchHevy('/user/info', apiKey);
      } catch {
        // user/info could be optional or forbidden on some keys
      }

      return sendJson(res, 200, {
        ok: true,
        message: 'Conexión con Hevy API exitosa',
        workout_count: workoutCount,
        user: userInfo
      });
    }

    if (action === 'workouts') {
      const page = Math.max(1, parseInt(req.query?.page || requestUrl.searchParams.get('page') || '1', 10));
      const pageSize = Math.min(20, Math.max(1, parseInt(req.query?.pageSize || requestUrl.searchParams.get('pageSize') || '10', 10)));
      const since = req.query?.since || requestUrl.searchParams.get('since') || '';

      const queryParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (since) queryParams.set('since', since);

      const data = await fetchHevy(`/workouts?${queryParams.toString()}`, apiKey);
      return sendJson(res, 200, {
        ok: true,
        page: data?.page || page,
        page_count: data?.page_count || 1,
        workouts: data?.workouts || []
      });
    }

    if (action === 'workout') {
      const workoutId = req.query?.id || requestUrl.searchParams.get('id');
      if (!workoutId) return sendJson(res, 400, { ok: false, error: 'Falta el id del entrenamiento' });

      const workout = await fetchHevy(`/workouts/${encodeURIComponent(workoutId)}`, apiKey);
      return sendJson(res, 200, { ok: true, workout });
    }

    if (action === 'events') {
      const page = Math.max(1, parseInt(req.query?.page || requestUrl.searchParams.get('page') || '1', 10));
      const pageSize = Math.min(20, Math.max(1, parseInt(req.query?.pageSize || requestUrl.searchParams.get('pageSize') || '10', 10)));
      const since = req.query?.since || requestUrl.searchParams.get('since') || '';

      const queryParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });
      if (since) queryParams.set('since', since);

      const data = await fetchHevy(`/workouts/events?${queryParams.toString()}`, apiKey);
      return sendJson(res, 200, {
        ok: true,
        events: data?.events || data || []
      });
    }

    if (action === 'routines') {
      const page = Math.max(1, parseInt(req.query?.page || requestUrl.searchParams.get('page') || '1', 10));
      const pageSize = Math.min(20, Math.max(1, parseInt(req.query?.pageSize || requestUrl.searchParams.get('pageSize') || '10', 10)));

      const queryParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });

      const data = await fetchHevy(`/routines?${queryParams.toString()}`, apiKey);
      return sendJson(res, 200, {
        ok: true,
        page: data?.page || page,
        page_count: data?.page_count || 1,
        routines: data?.routines || []
      });
    }

    if (action === 'exercise_templates') {
      const page = Math.max(1, parseInt(req.query?.page || requestUrl.searchParams.get('page') || '1', 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(req.query?.pageSize || requestUrl.searchParams.get('pageSize') || '20', 10)));

      const queryParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize)
      });

      const data = await fetchHevy(`/exercise_templates?${queryParams.toString()}`, apiKey);
      return sendJson(res, 200, {
        ok: true,
        templates: data?.exercise_templates || []
      });
    }

    return sendJson(res, 400, { ok: false, error: `Acción no soportada: ${action}` });
  } catch (error) {
    if (error.name === 'AbortError') {
      return sendJson(res, 504, { ok: false, error: 'Tiempo de espera agotado al consultar Hevy API', code: 'TIMEOUT' });
    }

    const status = error.status || 500;
    if (status === 401) {
      return sendJson(res, 401, {
        ok: false,
        error: 'API Key de Hevy inválida o sin permisos Pro. Revisa tu clave en hevy.com/settings?developer',
        code: 'UNAUTHORIZED'
      });
    }

    if (status === 429) {
      return sendJson(res, 429, {
        ok: false,
        error: 'Se ha excedido el límite de peticiones de Hevy API. Espera unos momentos.',
        code: 'RATE_LIMIT'
      });
    }

    return sendJson(res, status, {
      ok: false,
      error: error.message || 'Error de comunicación con Hevy API',
      code: 'HEVY_API_ERROR',
      details: error.data || undefined
    });
  }
};
