function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

module.exports = function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo no permitido' });
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  if (!publicKey) return sendJson(res, 503, { error: 'Falta VAPID_PUBLIC_KEY en Vercel' });
  return sendJson(res, 200, { publicKey });
};
