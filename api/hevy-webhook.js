function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key, Authorization');
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key, Authorization');
    res.end();
    return;
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      service: 'AA Follow App - Hevy Webhook Receiver',
      message: 'Endpoint de webhook activo y listo para recibir eventos de Hevy',
      instructions: 'Configura esta URL en hevy.com/settings?developer para recibir notificaciones en tiempo real al finalizar entrenamientos'
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Método no permitido' });
  }

  try {
    const payload = await parseBody(req);
    const event = payload?.event || payload?.type || 'workout_completed';
    const workoutId = (
      payload?.workoutId ||
      payload?.workout_id ||
      payload?.id ||
      payload?.data?.id ||
      payload?.data?.workout_id ||
      null
    );

    console.log(`[Hevy Webhook] Evento recibido: ${event}, workoutId: ${workoutId}`);

    return sendJson(res, 200, {
      ok: true,
      received: true,
      event,
      workout_id: workoutId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Hevy Webhook Error]', error);
    return sendJson(res, 200, {
      ok: true,
      received: true,
      warning: 'Processed with warnings',
      error: error.message
    });
  }
};
