const https = require('node:https');

const WGER_API = 'https://wger.de/api/v2/exerciseinfo';

// IDs de wger elegidos para las variantes que usa esta app. El nombre del
// usuario nunca se guarda ni se modifica: solo se usa para elegir una referencia.
const EXACT_DEMOS = new Map(Object.entries({
  'chestpress maquina': 129,
  'curl bayesian doble': 95,
  'curl biceps inclinado': 1448,
  'curl femoral acostado': 365,
  'elev lateral unilateral': 1378,
  'extension de cuadriceps': 369,
  'extension triceps cuerda': 1900,
  'jalon prono': 158,
  'jalon supino': 1127,
  'leg press': 371,
  'peckdeck polea': 135,
  'peso muerto mancuerna': 1652,
  'posterior polea unilateral': 822,
  'press frances barra z': 246,
  'press inclinado smith': 925,
  'press plano mancuerna': 75,
  'remo barra libre': 83,
  'remo mancuerna inclinado': 1283,
  'remo sentado neutro': 1117,
  'sentadilla smith profunda': 1747
}));

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasAll(name, ...parts) {
  return parts.every(part => name.includes(part));
}

function resolveDemo(name) {
  const normalized = normalizeName(name);
  const exactId = EXACT_DEMOS.get(normalized);
  if (exactId) return { id: exactId, exact: true };

  if (hasAll(normalized, 'press', 'smith', 'incl')) return { id: 925, exact: false };
  if (hasAll(normalized, 'sentadilla', 'smith') || hasAll(normalized, 'squat', 'smith')) return { id: 1747, exact: false };
  if ((normalized.includes('curl femoral') || normalized.includes('leg curl')) && (normalized.includes('acost') || normalized.includes('lying') || normalized.includes('tumb'))) return { id: 365, exact: false };
  if (normalized.includes('curl femoral') || normalized.includes('leg curl')) return { id: 364, exact: false };
  if (hasAll(normalized, 'extension', 'cuadr') || normalized.includes('leg extension')) return { id: 369, exact: false };
  if ((normalized.includes('tricep') || normalized.includes('triceps')) && (normalized.includes('cuerda') || normalized.includes('rope'))) return { id: 1900, exact: false };
  if ((normalized.includes('press frances') || normalized.includes('skullcrusher') || normalized.includes('skull crusher')) && (normalized.includes('z') || normalized.includes('sz') || normalized.includes('ez'))) return { id: 246, exact: false };
  if (normalized.includes('press frances') || normalized.includes('skullcrusher') || normalized.includes('skull crusher')) return { id: 246, exact: false };
  if ((normalized.includes('posterior') || normalized.includes('rear delt') || normalized.includes('reverse fly')) && (normalized.includes('polea') || normalized.includes('cable'))) return { id: 822, exact: false };
  if (normalized.includes('peckdeck') || normalized.includes('pec deck') || normalized.includes('butterfly')) return { id: 135, exact: false };
  if ((normalized.includes('press') || normalized.includes('chestpress')) && normalized.includes('maquina')) return { id: 129, exact: false };
  if (hasAll(normalized, 'press', 'mancuerna') || hasAll(normalized, 'bench press', 'dumbbell')) return { id: normalized.includes('incl') ? 537 : 75, exact: false };
  if (normalized.includes('press banca') || normalized.includes('bench press')) return { id: normalized.includes('incl') ? 538 : 73, exact: false };
  if (normalized.includes('bayesian')) return { id: 95, exact: false };
  if ((normalized.includes('curl') || normalized.includes('bicep')) && normalized.includes('incl')) return { id: 1448, exact: false };
  if (normalized.includes('curl') || normalized.includes('bicep')) return { id: normalized.includes('polea') || normalized.includes('cable') ? 95 : 92, exact: false };
  if ((normalized.includes('elev') || normalized.includes('raise')) && normalized.includes('lateral')) return { id: normalized.includes('polea') || normalized.includes('cable') || normalized.includes('unilateral') ? 1378 : 348, exact: false };
  if ((normalized.includes('peso muerto') || normalized.includes('deadlift')) && (normalized.includes('mancuerna') || normalized.includes('dumbbell'))) return { id: 1652, exact: false };
  if (normalized.includes('peso muerto') || normalized.includes('deadlift')) return { id: 184, exact: false };
  if (normalized.includes('leg press') || normalized.includes('prensa')) return { id: 371, exact: false };
  if ((normalized.includes('jalon') || normalized.includes('pulldown')) && (normalized.includes('supino') || normalized.includes('supinat') || normalized.includes('reverse grip'))) return { id: 1127, exact: false };
  if (normalized.includes('jalon') || normalized.includes('pulldown') || normalized.includes('pull down')) return { id: 158, exact: false };
  if ((normalized.includes('remo') || normalized.includes('row')) && (normalized.includes('sentado') || normalized.includes('seated') || normalized.includes('cable') || normalized.includes('polea'))) return { id: 1117, exact: false };
  if ((normalized.includes('remo') || normalized.includes('row')) && (normalized.includes('mancuerna') || normalized.includes('dumbbell'))) return { id: normalized.includes('incl') ? 1283 : 81, exact: false };
  if (normalized.includes('remo') || normalized.includes('row')) return { id: 83, exact: false };
  if (normalized.includes('sentadilla') || normalized.includes('squat')) return { id: 1801, exact: false };
  if ((normalized.includes('tricep') || normalized.includes('triceps')) && (normalized.includes('polea') || normalized.includes('pushdown'))) return { id: 1185, exact: false };

  return null;
}

function sendJson(res, status, payload, cache = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache
    ? 'public, s-maxage=86400, stale-while-revalidate=604800'
    : 'no-store');
  res.end(JSON.stringify(payload));
}

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function truncateStep(value, maxLength = 240) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength + 1);
  const wordBoundary = candidate.lastIndexOf(' ');
  const end = wordBoundary >= Math.floor(maxLength * 0.75) ? wordBoundary : maxLength;
  return `${candidate.slice(0, end).replace(/[,:;\s]+$/, '')}...`;
}

function instructionSteps(translation) {
  const source = cleanText(translation?.description_source || translation?.description || '');
  if (!source) return [];
  const lines = source
    .split(/\n+/)
    .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(line => line.length >= 18);
  if (lines.length >= 2) return lines.slice(0, 4).map(line => truncateStep(line));
  return source
    .split(/(?<=[.!?])\s+/)
    .map(line => line.trim())
    .filter(line => line.length >= 18)
    .slice(0, 3)
    .map(line => truncateStep(line));
}

function safeWgerUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'wger.de' || url.hostname.endsWith('.wger.de'))
      ? url.href
      : '';
  } catch {
    return '';
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function selectExerciseImages(images) {
  const groups = new Map();
  (images || []).forEach(image => {
    const key = String(image.style || 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  });
  const candidates = [...groups.values()].sort((a, b) => {
    const pairDifference = Number(b.length >= 2) - Number(a.length >= 2);
    if (pairDifference) return pairDifference;
    return b.length - a.length;
  });
  const selected = [...(candidates[0] || [])].sort((a, b) => a.id - b.id);
  if (selected.length <= 2) return selected;
  return [selected[0], selected[selected.length - 1]];
}

async function fetchExercise(id) {
  return new Promise((resolve, reject) => {
    const request = https.get(`${WGER_API}/${id}/`, {
      family: 4,
      headers: { Accept: 'application/json', 'User-Agent': 'AAFollowApp/1.0 exercise demo' }
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`wger respondio ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1_500_000) request.destroy(new Error('Respuesta demasiado grande'));
      });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Respuesta de wger invalida')); }
      });
    });
    request.setTimeout(8000, () => {
      const error = new Error('La demostracion demoro demasiado en responder');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo no permitido' });
  const requestedName = String(req.query?.name || '').trim().slice(0, 120);
  if (!requestedName) return sendJson(res, 400, { error: 'Falta el nombre del ejercicio' });

  const match = resolveDemo(requestedName);
  if (!match) return sendJson(res, 404, { error: 'No encontramos una demostracion para este ejercicio' }, true);

  try {
    const exercise = await fetchExercise(match.id);
    const spanish = (exercise.translations || []).find(item => item.language === 4);
    const english = (exercise.translations || []).find(item => item.language === 2);
    const translation = spanish || english || exercise.translations?.[0] || null;
    const images = selectExerciseImages(exercise.images)
      .map(image => ({
        url: safeWgerUrl(image.thumbnails?.medium || image.image),
        full: safeWgerUrl(image.image),
        author: String(image.license_author || exercise.license_author || '').slice(0, 120)
      }))
      .filter(image => image.url)
      .slice(0, 2);

    if (!images.length) return sendJson(res, 404, { error: 'La referencia encontrada no tiene imagenes disponibles' }, true);

    return sendJson(res, 200, {
      requestedName,
      referenceName: String(translation?.name || requestedName).slice(0, 120),
      exact: match.exact,
      images,
      instructions: instructionSteps(translation),
      license: {
        name: String(exercise.license?.short_name || 'Licencia indicada por wger').trim().slice(0, 80),
        url: safeHttpsUrl(exercise.license?.url)
      },
      sourceUrl: `${WGER_API}/${match.id}/`
    }, true);
  } catch (error) {
    const timedOut = error?.name === 'AbortError' || error?.code === 'ETIMEDOUT';
    return sendJson(res, 502, {
      error: timedOut ? 'La demostracion demoro demasiado en responder' : 'No se pudo cargar la demostracion'
    });
  }
};

module.exports._test = { normalizeName, resolveDemo, cleanText, truncateStep, instructionSteps, safeWgerUrl, safeHttpsUrl, selectExerciseImages };
