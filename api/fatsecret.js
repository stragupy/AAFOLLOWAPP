const {
  exchangeFatSecretUserToken,
  fatSecretDateInt,
  getFatSecretFoodEntries,
  requestFatSecretUserAuthorization
} = require('../lib/fatsecret-diary');

const DEFAULT_SUPABASE_URL = 'https://fqydbdssmmfvkrzefspq.supabase.co';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

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

function config() {
  return {
    url: String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY || 'sb_publishable_HigCZOqLwj1zwO6mNiDwZg_uN9Y2MTt',
    serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
    encryptionKey: String(process.env.FATSECRET_TOKEN_ENCRYPTION_KEY || '')
  };
}

function encryptionKey(cfg) {
  if (!/^[a-f\d]{64}$/i.test(cfg.encryptionKey)) {
    throw new HttpError(503, 'Falta FATSECRET_TOKEN_ENCRYPTION_KEY de 32 bytes en Vercel');
  }
  return Buffer.from(cfg.encryptionKey, 'hex');
}

function encryptSecret(value, cfg) {
  const iv = require('crypto').randomBytes(12);
  const cipher = require('crypto').createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey(cfg), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecret(value, cfg) {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new HttpError(502, 'No se pudieron leer las credenciales FatSecret');
  try {
    const decipher = require('crypto').createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey(cfg), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    throw new HttpError(502, 'La llave de cifrado de FatSecret cambió o no coincide');
  }
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

async function supabaseRequest(cfg, path, options = {}) {
  const { prefer = '', ...requestOptions } = options;
  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...requestOptions,
    headers: { ...serviceHeaders(cfg, prefer), ...(options.headers || {}) }
  });
  if (!response.ok) {
    const detail = await response.text();
    const message = /does not exist|schema cache/i.test(detail)
      ? 'Falta crear la tabla aa_follow_fatsecret_connections en Supabase'
      : 'No se pudo guardar la conexión FatSecret';
    throw new HttpError(response.status === 404 ? 503 : 502, message);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function bearerToken(req) {
  return String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
}

async function authenticatedUser(req, cfg) {
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'Inicia sesión en AA Follow para conectar FatSecret');
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` }
  });
  const user = await response.json().catch(() => ({}));
  if (!response.ok || !user.id) throw new HttpError(401, 'La sesión de AA Follow no es válida');
  return user;
}

function callbackUrl(req) {
  if (process.env.FATSECRET_CALLBACK_URL) return String(process.env.FATSECRET_CALLBACK_URL).trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!host) throw new HttpError(503, 'No se pudo determinar la URL de callback de FatSecret');
  return `${protocol}://${host}/api/fatsecret?action=callback`;
}

function appRedirectUrl(req, status) {
  const callback = new URL(callbackUrl(req));
  const target = new URL('/', callback.origin);
  target.searchParams.set('fatsecret', status);
  return target.toString();
}

function dateFromDateInt(value) {
  const dateInt = Number(value);
  if (!Number.isInteger(dateInt) || dateInt < 0 || dateInt > 100000) return '';
  return new Date(dateInt * 86400000).toISOString().slice(0, 10);
}

function normalizeMeal(entry) {
  const entryId = String(entry?.food_entry_id || '').trim();
  const date = dateFromDateInt(entry?.date_int);
  if (!/^\d+$/.test(entryId) || !date) return null;
  const mealType = String(entry.meal || '').toLowerCase();
  const mealNames = { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', snack: 'Snack', other: 'Snack' };
  const food = String(entry.food_entry_description || entry.food_entry_name || '').trim();
  if (!food) return null;
  return {
    id: `fatsecret_${entryId}`,
    date,
    meal_name: mealNames[mealType] || 'Snack',
    food_item: food,
    calories: Number(entry.calories) || 0,
    protein: Number(entry.protein) || 0,
    carbs: Number(entry.carbohydrate) || 0,
    fat: Number(entry.fat) || 0,
    source: 'fatsecret',
    fatsecret_entry_id: entryId
  };
}

async function loadConnection(cfg, query) {
  const rows = await supabaseRequest(cfg, `aa_follow_fatsecret_connections?select=*&${query}&limit=1`);
  return rows?.[0] || null;
}

async function handleCallback(req, res, cfg, requestUrl) {
  try {
    const requestToken = String(requestUrl.searchParams.get('oauth_token') || '');
    const verifier = String(requestUrl.searchParams.get('oauth_verifier') || '');
    const denied = String(requestUrl.searchParams.get('denied') || '');
    if (!requestToken || !verifier || denied) throw new HttpError(400, 'Autorización FatSecret cancelada o incompleta');
    const pending = await loadConnection(cfg, `request_token=eq.${encodeURIComponent(requestToken)}`);
    if (!pending?.request_secret || !pending.request_expires_at || Date.parse(pending.request_expires_at) < Date.now()) {
      throw new HttpError(400, 'La solicitud de autorización FatSecret venció; vuelve a conectar la cuenta');
    }
    const access = await exchangeFatSecretUserToken(
      requestToken,
      decryptSecret(pending.request_secret, cfg),
      verifier
    );
    await supabaseRequest(cfg, `aa_follow_fatsecret_connections?user_id=eq.${encodeURIComponent(pending.user_id)}&request_token=eq.${encodeURIComponent(requestToken)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({
        access_token: encryptSecret(access.accessToken, cfg),
        access_secret: encryptSecret(access.accessSecret, cfg),
        request_token: null,
        request_secret: null,
        request_expires_at: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', appRedirectUrl(req, 'connected'));
    return res.end();
  } catch (error) {
    res.statusCode = 302;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', appRedirectUrl(req, 'error'));
    return res.end();
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return sendJson(res, 200, { ok: true });
  }
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const action = String(req.query?.action || requestUrl.searchParams.get('action') || '').toLowerCase();
  if (req.method === 'GET' && action === 'callback') return handleCallback(req, res, config(), requestUrl);
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'Método no permitido' });

  const cfg = config();
  if (!cfg.serviceKey) return sendJson(res, 503, { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en Vercel' });
  try {
    const user = await authenticatedUser(req, cfg);
    if (req.method === 'GET' && action === 'status') {
      const connection = await loadConnection(cfg, `user_id=eq.${encodeURIComponent(user.id)}`);
      return sendJson(res, 200, {
        ok: true,
        connected: Boolean(connection?.access_token && connection?.access_secret),
        connected_at: connection?.connected_at || null,
        last_sync_at: connection?.last_sync_at || null
      });
    }

    if (req.method === 'POST' && action === 'connect') {
      const current = await loadConnection(cfg, `user_id=eq.${encodeURIComponent(user.id)}`);
      const pending = await requestFatSecretUserAuthorization(callbackUrl(req));
      const now = new Date();
      await supabaseRequest(cfg, 'aa_follow_fatsecret_connections?on_conflict=user_id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: JSON.stringify({
          user_id: user.id,
          access_token: current?.access_token || null,
          access_secret: current?.access_secret || null,
          connected_at: current?.connected_at || null,
          last_sync_at: current?.last_sync_at || null,
          request_token: pending.requestToken,
          request_secret: encryptSecret(pending.requestTokenSecret, cfg),
          request_expires_at: new Date(now.getTime() + 15 * 60000).toISOString(),
          updated_at: now.toISOString()
        })
      });
      return sendJson(res, 200, { ok: true, authorization_url: pending.authorizationUrl });
    }

    if (req.method === 'POST' && action === 'disconnect') {
      await supabaseRequest(cfg, `aa_follow_fatsecret_connections?user_id=eq.${encodeURIComponent(user.id)}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      return sendJson(res, 200, { ok: true, connected: false });
    }

    if (req.method === 'POST' && action === 'sync') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const date = String(body.date || new Date().toISOString().slice(0, 10));
      if (fatSecretDateInt(date) == null) throw new HttpError(400, 'La fecha seleccionada no es válida');
      const days = Math.min(14, Math.max(1, Number(body.days) || 1));
      const connection = await loadConnection(cfg, `user_id=eq.${encodeURIComponent(user.id)}`);
      if (!connection?.access_token || !connection?.access_secret) throw new HttpError(409, 'Primero conecta tu cuenta de FatSecret');
      const accessToken = decryptSecret(connection.access_token, cfg);
      const accessSecret = decryptSecret(connection.access_secret, cfg);
      const meals = [];
      const [year, month, day] = date.split('-').map(Number);
      for (let offset = 0; offset < days; offset++) {
        const target = new Date(Date.UTC(year, month - 1, day - offset));
        const targetDate = target.toISOString().slice(0, 10);
        const entries = await getFatSecretFoodEntries(accessToken, accessSecret, targetDate);
        entries.map(normalizeMeal).filter(Boolean).forEach(meal => meals.push(meal));
      }
      await supabaseRequest(cfg, `aa_follow_fatsecret_connections?user_id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      });
      return sendJson(res, 200, { ok: true, meals, synced_days: days });
    }

    return sendJson(res, 400, { error: 'Acción FatSecret no soportada' });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: error.message || 'Error de sincronización FatSecret',
      code: error.code || 'FATSECRET_SYNC_ERROR'
    });
  }
};
