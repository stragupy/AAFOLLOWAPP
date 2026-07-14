const MAX_BODY_CHARS = 60_000;
const DEFAULT_SUPABASE_URL = 'https://fqydbdssmmfvkrzefspq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_HigCZOqLwj1zwO6mNiDwZg_uN9Y2MTt';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch { return Promise.reject(new HttpError(400, 'JSON invalido')); }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY_CHARS) {
        reject(new HttpError(413, 'Solicitud demasiado grande'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new HttpError(400, 'JSON invalido')); }
    });
    req.on('error', reject);
  });
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function config() {
  return {
    url: String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

async function authenticatedUser(req, cfg) {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Inicia sesion para configurar avisos');
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id) throw new HttpError(401, 'La sesion de Supabase no es valida');
  return user;
}

function serviceHeaders(cfg, prefer = '') {
  const headers = {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

function validTimezone(value) {
  const timezone = String(value || 'UTC').slice(0, 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

function normalizeSubscription(body) {
  const source = body.subscription || body;
  const endpoint = String(source.endpoint || '').trim();
  const p256dh = String(source.keys?.p256dh || '').trim();
  const auth = String(source.keys?.auth || '').trim();
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2000) throw new HttpError(400, 'Suscripcion push invalida');
  if (!p256dh || !auth || p256dh.length > 500 || auth.length > 500) throw new HttpError(400, 'Claves push invalidas');
  return { endpoint, p256dh, auth };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return sendJson(res, 200, { ok: true });
  }
  if (!['POST', 'DELETE'].includes(req.method)) return sendJson(res, 405, { error: 'Metodo no permitido' });
  const cfg = config();
  if (!cfg.serviceKey) return sendJson(res, 503, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });

  try {
    const user = await authenticatedUser(req, cfg);
    const body = await parseBody(req);
    if (req.method === 'DELETE') {
      const endpoint = String(body.endpoint || body.subscription?.endpoint || '').trim();
      if (!endpoint) throw new HttpError(400, 'Falta el endpoint de la suscripcion');
      const response = await fetch(`${cfg.url}/rest/v1/aa_follow_push_subscriptions?user_id=eq.${encodeURIComponent(user.id)}&endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'DELETE',
        headers: serviceHeaders(cfg, 'return=minimal')
      });
      if (!response.ok) throw new HttpError(502, 'No se pudo eliminar la suscripcion push');
      return sendJson(res, 200, { ok: true });
    }

    const subscription = normalizeSubscription(body);
    const payload = {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      timezone: validTimezone(body.timezone),
      user_agent: String(body.userAgent || req.headers['user-agent'] || '').slice(0, 500),
      enabled: true,
      last_seen_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString()
    };
    const response = await fetch(`${cfg.url}/rest/v1/aa_follow_push_subscriptions?on_conflict=endpoint`, {
      method: 'POST',
      headers: serviceHeaders(cfg, 'resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const detail = await response.text();
      if (/does not exist|schema cache/i.test(detail)) throw new HttpError(503, 'Falta ejecutar supabase-push-setup.sql');
      throw new HttpError(502, 'No se pudo guardar la suscripcion push');
    }
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Error configurando avisos' });
  }
};
