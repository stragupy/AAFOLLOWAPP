const crypto = require('node:crypto');

// Server-owned identity; never accept a founder address from the request or profile.
const FOUNDER_EMAIL = 'agusarellano.romancito@gmail.com';
const CONNECTION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const requestWindows = new Map();

class AccessError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function config() {
  return {
    url: String(process.env.SUPABASE_URL || 'https://fqydbdssmmfvkrzefspq.supabase.co').replace(/\/$/, ''),
    anon: process.env.SUPABASE_ANON_KEY || 'sb_publishable_HigCZOqLwj1zwO6mNiDwZg_uN9Y2MTt',
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  };
}

async function request(url, options = {}) {
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); }
  catch { throw new AccessError(504, 'El servicio no responde. Intenta nuevamente.', 'SERVICE_TIMEOUT'); }
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}

async function requireUser(req) {
  const match = String(req.headers?.authorization || '').match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 8192) throw new AccessError(401, 'Inicia sesión para continuar.', 'AUTH_REQUIRED');
  const cfg = config();
  const response = await request(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${match[1]}` } });
  if (!response.ok) throw new AccessError(response.status >= 500 ? 503 : 401, 'No se pudo validar tu sesión. Vuelve a entrar.', 'INVALID_SESSION');
  const user = await response.json().catch(() => null);
  if (!user?.id || !user.email_confirmed_at) throw new AccessError(403, 'Confirma el correo de tu cuenta para continuar.', 'EMAIL_NOT_VERIFIED');
  return user;
}

function isFounder(user) {
  if (!user?.email_confirmed_at) return false;
  return String(user?.email || '').trim().toLowerCase() === FOUNDER_EMAIL;
}

async function service(path, options = {}) {
  const cfg = config();
  if (!cfg.service) throw new AccessError(503, 'La conexión administrativa existente no está disponible.', 'ADMIN_UNAVAILABLE');
  const response = await request(`${cfg.url}/${path}`, {
    ...options,
    headers: { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    throw new AccessError(503, 'No se pudo acceder al servicio de cuentas.', 'ACCOUNT_SERVICE_ERROR');
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

function encryptionKey() {
  const secret = process.env.GEMINI_API_KEY || process.env.gemini_api_key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new AccessError(503, 'La conexión de IA del servidor no está disponible.', 'AI_SERVER_UNAVAILABLE');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from(config().url), Buffer.from('aa-follow:personal-ai:v2'), 32));
}

function encryptKey(value, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`aa-follow:gemini:${userId}`));
  const issuedAt = Date.now();
  const payload = JSON.stringify({ key: value, issued_at: issuedAt, expires_at: issuedAt + CONNECTION_LIFETIME_MS });
  const data = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return ['v2', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

function openConnection(value, userId) {
  const key = encryptionKey();
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid token');
    const parts = value.split('.');
    if (parts.length !== 4) throw new Error('Invalid token');
    const [version, iv, tag, data] = parts;
    if (version !== 'v2') throw new Error('Invalid version');
    if (Buffer.from(iv, 'base64url').length !== 12 || Buffer.from(tag, 'base64url').length !== 16 || !data) throw new Error('Invalid cipher');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(`aa-follow:gemini:${userId}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8'));
    if (!Number.isFinite(parsed.issued_at) || !Number.isFinite(parsed.expires_at) || parsed.expires_at <= Date.now() || parsed.issued_at > Date.now() + 60000 || parsed.expires_at - parsed.issued_at !== CONNECTION_LIFETIME_MS || typeof parsed.key !== 'string' || !parsed.key) throw new Error('Invalid connection');
    return parsed;
  } catch { throw new AccessError(403, 'No se pudo abrir tu conexión. Vuelve a conectar Gemini.', 'AI_RECONNECT_REQUIRED'); }
}

function decryptKey(value, userId) { return openConnection(value, userId).key; }

const model = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

function claimRequest(userId) {
  const minute = Math.floor(Date.now() / 60000);
  if (requestWindows.size >= 2000) {
    for (const [id, entry] of requestWindows) if (entry.minute !== minute) requestWindows.delete(id);
    if (requestWindows.size >= 2000 && !requestWindows.has(userId)) throw new AccessError(429, 'El servicio está ocupado. Intenta más tarde.', 'AI_RATE_LIMIT');
  }
  const current = requestWindows.get(userId);
  const next = current?.minute === minute ? { minute, count: current.count + 1 } : { minute, count: 1 };
  if (next.count > 30) throw new AccessError(429, 'Estás enviando muchas solicitudes. Espera un minuto.', 'AI_RATE_LIMIT');
  requestWindows.set(userId, next);
}

async function resolveAiAccess(req) {
  const user = await requireUser(req);
  const shared = process.env.GEMINI_API_KEY || process.env.gemini_api_key;
  let apiKey;
  if (isFounder(user) && shared) apiKey = shared;
  else {
    const token = req.headers?.['x-aa-ai-connection'];
    if (!token) throw new AccessError(403, 'Conecta tu propia cuenta de Gemini en Perfil para usar la IA.', 'AI_CONNECTION_REQUIRED');
    apiKey = decryptKey(token, user.id);
  }
  await claimRequest(user.id);
  return { user, apiKey };
}

// Never include provider payloads in client errors: some providers echo request credentials.
async function geminiFetch(apiKey, body) {
  const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body)
  });
  if (!response.ok) {
    await response.arrayBuffer();
    if (response.status === 429) throw new AccessError(429, 'Gemini alcanzó la cuota de la conexión utilizada. Revisa tu cuota en Google AI Studio.', 'AI_PROVIDER_QUOTA');
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new AccessError(400, 'Gemini rechazó la solicitud. Comprueba la clave, sus permisos y el contenido enviado.', 'AI_PROVIDER_REJECTED');
    throw new AccessError(502, 'Gemini no pudo completar la solicitud. Intenta nuevamente.', 'AI_PROVIDER_ERROR');
  }
  return response;
}

async function readSmallBody(req) {
  let body = req.body;
  if (body == null) {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) throw new AccessError(413, 'Solicitud demasiado grande.', 'BODY_TOO_LARGE');
    }
    body = raw;
  }
  try {
    if (typeof body === 'string') {
      if (body.length > 4096) throw new AccessError(413, 'Solicitud demasiado grande.', 'BODY_TOO_LARGE');
      body = JSON.parse(body || '{}');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    if (JSON.stringify(body).length > 4096) throw new AccessError(413, 'Solicitud demasiado grande.', 'BODY_TOO_LARGE');
    return body;
  } catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(400, 'JSON inválido.', 'INVALID_BODY'); }
}

async function handleAccount(req, res) {
  const action = new URL(req.url || '/', 'http://localhost').searchParams.get('account');
  if (!action) return false;
  try {
    const user = await requireUser(req);
    const founder = isFounder(user);
    if (action === 'status' && req.method === 'GET') {
      const shared = founder && Boolean(process.env.GEMINI_API_KEY || process.env.gemini_api_key);
      let row = null, setupError = null;
      try { const token = req.headers?.['x-aa-ai-connection']; if (token) row = openConnection(token, user.id); }
      catch (error) { setupError = { code: error.code, message: error.message }; }
      sendJson(res, 200, {
        user: { id: user.id, email: user.email }, role: founder ? 'founder' : 'member', verified: true,
        founder_configured: true, admin_available: founder && Boolean(config().service),
        ai: { provider: 'gemini', model: model(), connected: Boolean(shared || row), personal_connected: Boolean(row), source: shared ? 'founder' : row ? 'personal' : null, connected_at: row ? new Date(row.issued_at).toISOString() : null, expires_at: row ? new Date(row.expires_at).toISOString() : null, storage: 'browser' },
        connection_error: setupError
      });
    } else if (action === 'connect' && req.method === 'POST') {
      const body = await readSmallBody(req);
      const apiKey = String(body.api_key || '').trim();
      if (!/^[A-Za-z0-9_-]{20,256}$/.test(apiKey)) throw new AccessError(400, 'La clave de Gemini no tiene un formato válido.', 'INVALID_AI_KEY');
      const encrypted = encryptKey(apiKey, user.id);
      await claimRequest(user.id);
      await geminiFetch(apiKey, { contents: [{ role: 'user', parts: [{ text: 'Responde OK.' }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } });
      sendJson(res, 200, { ok: true, connection_token: encrypted });
    } else if (action === 'disconnect' && req.method === 'DELETE') {
      sendJson(res, 200, { ok: true, clear_local_connection: true });
    } else if (action === 'users' && req.method === 'GET') {
      if (!founder) throw new AccessError(403, 'Esta función está reservada al fundador.', 'FOUNDER_REQUIRED');
      if (!config().service) throw new AccessError(503, 'El listado de cuentas no está disponible con la conexión administrativa actual. Tu acceso de fundador sigue activo.', 'ADMIN_UNAVAILABLE');
      const query = new URL(req.url, 'http://localhost').searchParams;
      const page = Math.min(10000, Math.max(1, Number.parseInt(query.get('page'), 10) || 1));
      const data = await service(`auth/v1/admin/users?page=${page}&per_page=30`);
      const users = (data?.users || []).map(item => ({ id: item.id, email: item.email, created_at: item.created_at, last_sign_in_at: item.last_sign_in_at, verified: Boolean(item.email_confirmed_at), role: isFounder(item) ? 'founder' : 'member' }));
      sendJson(res, 200, { users, page, has_more: users.length === 30 });
    } else throw new AccessError(405, 'Operación no permitida.', 'METHOD_NOT_ALLOWED');
  } catch (error) {
    sendJson(res, error.status || 500, { error: error instanceof AccessError ? error.message : 'No se pudo completar la operación.', code: error.code || 'ACCOUNT_ERROR' });
  }
  return true;
}

module.exports = { AccessError, requireUser, isFounder, resolveAiAccess, geminiFetch, handleAccount, encryptKey, decryptKey };
