const webPush = require('web-push');

const DEFAULT_SUPABASE_URL = 'https://fqydbdssmmfvkrzefspq.supabase.co';
const MAX_SUBSCRIPTIONS = 500;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function config() {
  return {
    url: String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    cronSecret: process.env.CRON_SECRET || '',
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  };
}

function authorized(req, secret) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return Boolean(secret && match?.[1] === secret);
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
  const { prefer = '', headers = {}, ...requestOptions } = options;
  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...requestOptions,
    headers: { ...serviceHeaders(cfg, prefer), ...headers }
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Supabase ${response.status}: ${detail.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function localTimeParts(now, timezone) {
  let zone = timezone || 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(now); }
  catch { zone = 'UTC'; }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: (+parts.hour * 60) + +parts.minute,
    weekday: weekdayMap[parts.weekday] ?? 0
  };
}

function reminderApplies(reminder, local) {
  if (!reminder || reminder.enabled === false) return false;
  if (!/^\d{2}:\d{2}$/.test(reminder.time || '')) return false;
  if (reminder.repeat === 'once' && reminder.date !== local.date) return false;
  if (reminder.repeat === 'weekdays' && (local.weekday === 0 || local.weekday === 6)) return false;
  if (reminder.repeat === 'weekends' && local.weekday !== 0 && local.weekday !== 6) return false;
  const [hour, minute] = reminder.time.split(':').map(Number);
  const due = hour * 60 + minute;
  return local.minute >= due && local.minute <= due + 2;
}

async function loadUserData(cfg, userIds) {
  const result = new Map();
  for (let start = 0; start < userIds.length; start += 60) {
    const ids = userIds.slice(start, start + 60);
    const filter = `(${ids.join(',')})`;
    const rows = await supabaseRequest(cfg, `aa_follow_data?select=user_id,data,updated_at&user_id=in.${encodeURIComponent(filter)}&order=updated_at.desc`);
    (rows || []).forEach(row => { if (!result.has(row.user_id)) result.set(row.user_id, row.data || {}); });
  }
  return result;
}

async function claimDelivery(cfg, subscription, reminder, occurrence) {
  const response = await fetch(`${cfg.url}/rest/v1/aa_follow_push_deliveries`, {
    method: 'POST',
    headers: serviceHeaders(cfg, 'return=minimal'),
    body: JSON.stringify({
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      reminder_id: String(reminder.id || '').slice(0, 180),
      occurrence,
      status: 'sending'
    })
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`No se pudo reservar el envio (${response.status})`);
  return true;
}

async function updateDelivery(cfg, subscription, reminder, occurrence, values) {
  const query = `subscription_id=eq.${encodeURIComponent(subscription.id)}&reminder_id=eq.${encodeURIComponent(String(reminder.id || '').slice(0, 180))}&occurrence=eq.${encodeURIComponent(occurrence)}`;
  await fetch(`${cfg.url}/rest/v1/aa_follow_push_deliveries?${query}`, {
    method: 'PATCH',
    headers: serviceHeaders(cfg, 'return=minimal'),
    body: JSON.stringify(values)
  });
}

async function disableSubscription(cfg, subscription) {
  await fetch(`${cfg.url}/rest/v1/aa_follow_push_subscriptions?id=eq.${encodeURIComponent(subscription.id)}`, {
    method: 'PATCH',
    headers: serviceHeaders(cfg, 'return=minimal'),
    body: JSON.stringify({ enabled: false, last_error: 'Suscripcion vencida', updated_at: new Date().toISOString() })
  });
}

async function sendOne(cfg, subscription, reminder, local) {
  const occurrence = `${local.date}T${reminder.time}`;
  if (!await claimDelivery(cfg, subscription, reminder, occurrence)) return { duplicate: 1 };
  const typeLabels = { training: 'Entreno', meal: 'Comida', water: 'Agua', supplement: 'Suplemento', checkin: 'Check-in', personal: 'Personal' };
  const payload = JSON.stringify({
    title: String(reminder.label || typeLabels[reminder.type] || 'Recordatorio').slice(0, 100),
    body: `AA Follow · ${typeLabels[reminder.type] || 'Recordatorio'} · ${reminder.time}`,
    tag: `aa-follow-${String(reminder.id || '').slice(0, 80)}`,
    url: './'
  });
  try {
    await webPush.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    }, payload, { TTL: 300, urgency: 'normal' });
    await updateDelivery(cfg, subscription, reminder, occurrence, { status: 'sent', sent_at: new Date().toISOString(), error: null });
    return { sent: 1 };
  } catch (error) {
    const stale = error.statusCode === 404 || error.statusCode === 410;
    if (stale) await disableSubscription(cfg, subscription);
    await updateDelivery(cfg, subscription, reminder, occurrence, {
      status: stale ? 'expired' : 'failed',
      error: String(error.message || 'Error Web Push').slice(0, 500)
    });
    return stale ? { expired: 1 } : { failed: 1 };
  }
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'Metodo no permitido' });
  const cfg = config();
  if (!authorized(req, cfg.cronSecret)) return sendJson(res, 401, { error: 'No autorizado' });
  if (!cfg.serviceKey || !cfg.publicKey || !cfg.privateKey) {
    return sendJson(res, 503, { error: 'Faltan variables de Supabase o VAPID en Vercel' });
  }
  try {
    webPush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    const subscriptions = await supabaseRequest(cfg, `aa_follow_push_subscriptions?select=id,user_id,endpoint,p256dh,auth,timezone&enabled=eq.true&limit=${MAX_SUBSCRIPTIONS}`) || [];
    const userIds = [...new Set(subscriptions.map(item => item.user_id).filter(Boolean))];
    const userData = await loadUserData(cfg, userIds);
    const now = new Date();
    const jobs = [];
    subscriptions.forEach(subscription => {
      const data = userData.get(subscription.user_id) || {};
      const local = localTimeParts(now, subscription.timezone);
      (Array.isArray(data.reminders) ? data.reminders : []).forEach(reminder => {
        if (reminderApplies(reminder, local)) jobs.push({ subscription, reminder, local });
      });
    });
    const totals = { sent: 0, duplicate: 0, failed: 0, expired: 0 };
    for (let start = 0; start < jobs.length; start += 10) {
      const results = await Promise.all(jobs.slice(start, start + 10).map(job => sendOne(cfg, job.subscription, job.reminder, job.local)));
      results.forEach(result => Object.entries(result).forEach(([key, value]) => { totals[key] = (totals[key] || 0) + value; }));
    }
    return sendJson(res, 200, { ok: true, subscriptions: subscriptions.length, due: jobs.length, ...totals });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'No se pudieron procesar recordatorios' });
  }
};
