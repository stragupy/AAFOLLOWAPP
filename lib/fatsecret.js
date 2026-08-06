const crypto = require('crypto');

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API_ROOT = 'https://platform.fatsecret.com/rest';
const METHOD_API_URL = `${API_ROOT}/server.api`;
const REQUEST_TIMEOUT_MS = 9000;

let cachedToken = '';
let cachedTokenExpiresAt = 0;
let tokenRequest = null;

class FatSecretError extends Error {
  constructor(message, code = 'FATSECRET_ERROR', status = 502, providerCode = '') {
    super(message);
    this.name = 'FatSecretError';
    this.code = code;
    this.status = status;
    this.providerCode = String(providerCode || '');
  }
}

function cleanEnv(name) {
  return String(process.env[name] || '').trim();
}

function fatSecretConfig() {
  const clientId = cleanEnv('FATSECRET_CLIENT_ID');
  const clientSecret = cleanEnv('FATSECRET_CLIENT_SECRET');
  const consumerKey = cleanEnv('FATSECRET_CONSUMER_KEY');
  const consumerSecret = cleanEnv('FATSECRET_CONSUMER_SECRET');
  const region = cleanEnv('FATSECRET_REGION').toUpperCase();
  const language = cleanEnv('FATSECRET_LANGUAGE');
  const scope = cleanEnv('FATSECRET_SCOPE');
  const oauth1Configured = Boolean(consumerKey && consumerSecret);
  const oauth2Configured = Boolean(clientId && clientSecret);
  return {
    clientId,
    clientSecret,
    consumerKey,
    consumerSecret,
    region,
    language: region ? language : '',
    scope,
    oauth1Configured,
    oauth2Configured,
    configured: oauth1Configured || oauth2Configured,
    authMode: oauth1Configured ? 'oauth1' : 'oauth2'
  };
}

function isFatSecretConfigured() {
  return fatSecretConfig().configured;
}

function localeParams() {
  const { region, language } = fatSecretConfig();
  return {
    ...(region ? { region } : {}),
    ...(region && language ? { language } : {})
  };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rounded(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    return { response, data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new FatSecretError('FatSecret tardo demasiado en responder', 'FATSECRET_TIMEOUT', 504);
    }
    throw new FatSecretError('No se pudo conectar con FatSecret', 'FATSECRET_UNAVAILABLE', 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function requestAccessToken() {
  const config = fatSecretConfig();
  if (!config.oauth2Configured) {
    throw new FatSecretError(
      'FatSecret aun no esta configurado en Vercel',
      'FATSECRET_NOT_CONFIGURED',
      503
    );
  }

  if (cachedToken && Date.now() < cachedTokenExpiresAt) return cachedToken;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    if (config.scope) body.set('scope', config.scope);
    const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const { response, data } = await fetchJson(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: body.toString()
    });

    if (!response.ok || !data.access_token) {
      throw new FatSecretError(
        'FatSecret rechazo las credenciales o la IP del servidor',
        'FATSECRET_AUTH_FAILED',
        response.status === 401 || response.status === 403 ? response.status : 502,
        data.error
      );
    }

    const expiresIn = Math.max(Number(data.expires_in) || 3600, 120);
    cachedToken = String(data.access_token);
    cachedTokenExpiresAt = Date.now() + Math.max(expiresIn - 60, 60) * 1000;
    return cachedToken;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

function providerError(data) {
  const error = data?.error;
  if (!error) return null;
  if (typeof error === 'string') return { code: error, message: error };
  return {
    code: error.code || '',
    message: error.message || error.error_description || 'FatSecret no pudo completar la consulta'
  };
}

function throwForFatSecretResponse(response, data) {
  const apiError = providerError(data);
  if (response.ok && !apiError) return data;
  const providerCode = apiError?.code || response.status;
  const missingScope = String(providerCode) === '14';
  throw new FatSecretError(
    missingScope
      ? 'La cuenta FatSecret no tiene los permisos requeridos'
      : 'FatSecret no pudo completar la consulta',
    missingScope ? 'FATSECRET_SCOPE_REQUIRED' : 'FATSECRET_REQUEST_FAILED',
    response.status >= 400 ? response.status : 502,
    providerCode
  );
}

async function fatSecretOAuth2Get(path, params = {}, retryAuth = true) {
  const token = await requestAccessToken();
  const query = new URLSearchParams({ ...params, format: 'json' });
  const { response, data } = await fetchJson(`${API_ROOT}${path}?${query.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    }
  });

  if (response.status === 401 && retryAuth) {
    cachedToken = '';
    cachedTokenExpiresAt = 0;
    return fatSecretOAuth2Get(path, params, false);
  }

  return throwForFatSecretResponse(response, data);
}

function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauth1Method(path) {
  return ({
    '/food/barcode/find-by-id/v1': 'food.find_id_for_barcode',
    '/food/v5': 'food.get.v5',
    '/foods/search/v5': 'foods.search.v5',
    '/foods/search/v1': 'foods.search'
  })[path] || '';
}

async function fatSecretOAuth1Request(path, params = {}) {
  const config = fatSecretConfig();
  if (!config.oauth1Configured) {
    throw new FatSecretError('FatSecret OAuth 1.0 no esta configurado', 'FATSECRET_NOT_CONFIGURED', 503);
  }
  const method = oauth1Method(path);
  if (!method) throw new FatSecretError('Metodo FatSecret no soportado', 'FATSECRET_METHOD_UNSUPPORTED', 500);

  const requestParams = {
    ...params,
    format: 'json',
    method,
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0'
  };
  const normalized = Object.entries(requestParams)
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA !== keyB) return keyA < keyB ? -1 : 1;
      if (valueA === valueB) return 0;
      return valueA < valueB ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const signatureBase = `POST&${rfc3986(METHOD_API_URL)}&${rfc3986(normalized)}`;
  const signingKey = `${rfc3986(config.consumerSecret)}&`;
  const signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
  const body = new URLSearchParams({ ...requestParams, oauth_signature: signature });
  const { response, data } = await fetchJson(METHOD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString()
  });
  return throwForFatSecretResponse(response, data);
}

async function fatSecretGet(path, params = {}) {
  return fatSecretConfig().authMode === 'oauth1'
    ? fatSecretOAuth1Request(path, params)
    : fatSecretOAuth2Get(path, params);
}

function toGtin13(code) {
  const digits = String(code || '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(digits)) return null;
  if (digits.length <= 13) return digits.padStart(13, '0');
  return digits.startsWith('0') ? digits.slice(1) : null;
}

function extractFoodId(payload) {
  const value = payload?.food_id?.value ?? payload?.food_id;
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) && id !== '0' ? id : null;
}

async function findFoodIdByBarcode(code) {
  const barcode = toGtin13(code);
  if (!barcode) return null;
  const data = await fatSecretGet('/food/barcode/find-by-id/v1', {
    barcode,
    ...localeParams()
  });
  return extractFoodId(data);
}

function nutrientsFromServing(serving) {
  const raw = {
    calories: numberOrNull(serving?.calories),
    protein: numberOrNull(serving?.protein),
    carbs: numberOrNull(serving?.carbohydrate),
    fat: numberOrNull(serving?.fat)
  };
  return {
    values: {
      calories: rounded(raw.calories),
      protein: rounded(raw.protein),
      carbs: rounded(raw.carbs),
      fat: rounded(raw.fat)
    },
    available: Object.values(raw).some(value => value != null)
  };
}

function normalizeServing(serving, index) {
  const metricAmount = numberOrNull(serving?.metric_serving_amount);
  const metricUnit = String(serving?.metric_serving_unit || '').trim().toLowerCase();
  const numberOfUnits = numberOrNull(serving?.number_of_units);
  const measurement = String(serving?.measurement_description || '').trim().toLowerCase().slice(0, 32);
  const hasMetric = metricAmount != null && metricAmount > 0 && ['g', 'ml', 'oz'].includes(metricUnit);
  const amount = hasMetric ? metricAmount : (numberOfUnits && numberOfUnits > 0 ? numberOfUnits : 1);
  const unit = hasMetric ? metricUnit : (measurement && measurement !== 'serving' ? measurement : 'porcion');
  const nutrition = nutrientsFromServing(serving);
  return {
    id: String(serving?.serving_id || `serving-${index}`),
    description: String(serving?.serving_description || `${amount} ${unit}`).slice(0, 140),
    amount: rounded(amount),
    unit,
    nutrients: nutrition.values,
    nutrition_available: nutrition.available,
    is_default: Number(serving?.is_default) === 1
  };
}

function foodImages(food) {
  return asArray(food?.food_images?.food_image || food?.food_image);
}

function chooseImage(food) {
  const images = foodImages(food);
  const preferred = images.find(image => String(image?.image_type || '').toLowerCase() === 'standard') || images[0];
  return String(preferred?.image_url || '');
}

function chooseServing(servings) {
  return servings.find(serving => serving.is_default && serving.nutrition_available)
    || servings.find(serving => serving.amount === 100 && ['g', 'ml'].includes(serving.unit) && serving.nutrition_available)
    || servings.find(serving => ['g', 'ml', 'oz'].includes(serving.unit) && serving.nutrition_available)
    || servings.find(serving => serving.nutrition_available)
    || servings[0];
}

function normalizeFood(food, options = {}) {
  const foodId = String(food?.food_id || options.foodId || '').trim();
  const servings = asArray(food?.servings?.serving || food?.serving)
    .map(normalizeServing)
    .filter(serving => serving.amount > 0);
  const selected = chooseServing(servings);
  if (!selected || !selected.nutrition_available) {
    throw new FatSecretError(
      'FatSecret encontro el alimento pero no informo sus macronutrientes',
      'FATSECRET_NUTRITION_MISSING',
      422
    );
  }

  const name = String(food?.food_name || options.name || `Alimento ${foodId}`).slice(0, 180);
  const brands = String(food?.brand_name || options.brand || '').slice(0, 160);
  const per100 = ['g', 'ml'].includes(selected.unit)
    ? Object.fromEntries(Object.entries(selected.nutrients).map(([key, value]) => [key, rounded(value * 100 / selected.amount)]))
    : selected.nutrients;

  return {
    code: String(options.code || ''),
    food_id: foodId,
    serving_id: selected.id,
    name,
    brands,
    image_url: chooseImage(food),
    source: 'FatSecret',
    serving_amount: selected.amount,
    serving_unit: selected.unit,
    serving_grams: selected.unit === 'g' ? selected.amount : null,
    reference_amount: selected.amount,
    reference_unit: selected.unit,
    per_reference: selected.nutrients,
    per_100g: per100,
    servings,
    nutrition_available: true
  };
}

async function getFoodById(foodId, options = {}) {
  const id = String(foodId || '').trim();
  if (!/^\d+$/.test(id)) {
    throw new FatSecretError('Identificador de alimento invalido', 'INVALID_FOOD_ID', 400);
  }
  const data = await fatSecretGet('/food/v5', {
    food_id: id,
    ...localeParams()
  });
  return normalizeFood(data?.food || data, { ...options, foodId: id });
}

function extractSearchFoods(data) {
  return asArray(
    data?.foods_search?.results?.food
    || data?.foods_search?.food
    || data?.foods?.food
    || data?.food
  );
}

function normalizeSearchResult(food) {
  const foodId = String(food?.food_id || '').trim();
  if (!/^\d+$/.test(foodId)) return null;
  return {
    food_id: foodId,
    name: String(food?.food_name || `Alimento ${foodId}`).slice(0, 180),
    brand: String(food?.brand_name || '').slice(0, 160),
    type: String(food?.food_type || ''),
    description: String(food?.food_description || '').slice(0, 220)
  };
}

async function searchFoods(query, limit = 12) {
  const searchExpression = String(query || '').trim().slice(0, 120);
  if (searchExpression.length < 2) {
    throw new FatSecretError('Escribe al menos 2 caracteres', 'INVALID_SEARCH', 400);
  }
  const maxResults = Math.min(Math.max(Number(limit) || 12, 1), 20);
  const params = {
    search_expression: searchExpression,
    max_results: String(maxResults),
    page_number: '0',
    ...localeParams()
  };

  // Search v5 is Premier-only. The v1 search returns the food IDs needed by
  // every edition; food.get v5 supplies the full serving data after selection.
  const data = await fatSecretGet('/foods/search/v1', params);

  return extractSearchFoods(data).map(normalizeSearchResult).filter(Boolean).slice(0, maxResults);
}

async function checkFatSecretConnection() {
  const config = fatSecretConfig();
  await fatSecretGet('/foods/search/v1', {
    search_expression: 'apple',
    max_results: '1',
    page_number: '0',
    ...localeParams()
  });
  return {
    configured: true,
    authentication: config.authMode === 'oauth1' ? 'OAuth 1.0 firmado' : 'OAuth 2.0',
    region: config.region || 'US (predeterminado)',
    language: config.language || 'en (predeterminado)',
    scope: config.authMode === 'oauth1' ? 'permisos habilitados en la cuenta' : (config.scope || 'permisos habilitados en la cuenta')
  };
}

function publicFatSecretError(error) {
  if (error instanceof FatSecretError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  return { message: 'FatSecret no pudo completar la consulta', code: 'FATSECRET_ERROR', status: 502 };
}

module.exports = {
  checkFatSecretConnection,
  findFoodIdByBarcode,
  getFoodById,
  isFatSecretConfigured,
  publicFatSecretError,
  searchFoods,
  toGtin13
};
