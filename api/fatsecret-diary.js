const crypto = require('crypto');

const REQUEST_TOKEN_URL = 'https://authentication.fatsecret.com/oauth/request_token';
const AUTHORIZE_URL = 'https://authentication.fatsecret.com/oauth/authorize';
const ACCESS_TOKEN_URL = 'https://authentication.fatsecret.com/oauth/access_token';
const API_URL = 'https://platform.fatsecret.com/rest/server.api';
const REQUEST_TIMEOUT_MS = 12000;

function credentials() {
  const consumerKey = String(process.env.FATSECRET_CONSUMER_KEY || '').trim();
  const consumerSecret = String(process.env.FATSECRET_CONSUMER_SECRET || '').trim();
  if (!consumerKey || !consumerSecret) {
    const error = new Error('FatSecret requiere FATSECRET_CONSUMER_KEY y FATSECRET_CONSUMER_SECRET en Vercel');
    error.code = 'FATSECRET_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  return { consumerKey, consumerSecret };
}

function rfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizedParameters(params) {
  return Object.entries(params)
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort(([keyA, valueA], [keyB, valueB]) => keyA === keyB
      ? (valueA === valueB ? 0 : valueA < valueB ? -1 : 1)
      : keyA < keyB ? -1 : 1)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

async function signedRequest(url, method, params, tokenSecret = '') {
  const { consumerKey, consumerSecret } = credentials();
  const requestParams = {
    ...params,
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0'
  };
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(normalizedParameters(requestParams))}`;
  const key = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;
  requestParams.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const isGet = method.toUpperCase() === 'GET';
    const target = isGet ? `${url}?${new URLSearchParams(requestParams)}` : url;
    const response = await fetch(target, {
      method: method.toUpperCase(),
      headers: {
        Accept: 'application/json, application/x-www-form-urlencoded',
        ...(isGet ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' })
      },
      ...(isGet ? {} : { body: new URLSearchParams(requestParams).toString() }),
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = Object.fromEntries(new URLSearchParams(text));
    }
    if (!response.ok || data.error || data.error_message) {
      const error = new Error('FatSecret no pudo completar la autorización o consulta del diario');
      error.code = 'FATSECRET_REQUEST_FAILED';
      error.status = response.status >= 400 ? response.status : 502;
      throw error;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('FatSecret tardó demasiado en responder');
      timeoutError.code = 'FATSECRET_TIMEOUT';
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestFatSecretUserAuthorization(callbackUrl) {
  const token = await signedRequest(REQUEST_TOKEN_URL, 'POST', { oauth_callback: callbackUrl });
  if (!token.oauth_token || !token.oauth_token_secret) {
    const error = new Error('FatSecret no devolvió un token temporal válido');
    error.code = 'FATSECRET_REQUEST_TOKEN_FAILED';
    error.status = 502;
    throw error;
  }
  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('oauth_token', token.oauth_token);
  return {
    requestToken: token.oauth_token,
    requestTokenSecret: token.oauth_token_secret,
    authorizationUrl: authorize.toString()
  };
}

async function exchangeFatSecretUserToken(requestToken, requestTokenSecret, verifier) {
  const token = await signedRequest(ACCESS_TOKEN_URL, 'GET', {
    oauth_token: requestToken,
    oauth_verifier: verifier
  }, requestTokenSecret);
  if (!token.oauth_token || !token.oauth_token_secret) {
    const error = new Error('FatSecret no devolvió credenciales de acceso');
    error.code = 'FATSECRET_ACCESS_TOKEN_FAILED';
    error.status = 502;
    throw error;
  }
  return { accessToken: token.oauth_token, accessSecret: token.oauth_token_secret };
}

function fatSecretDateInt(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return Math.floor(timestamp / 86400000);
}

function listOf(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function getFatSecretFoodEntries(accessToken, accessSecret, date) {
  const dateInt = fatSecretDateInt(date);
  if (dateInt == null) {
    const error = new Error('La fecha de sincronización de FatSecret es inválida');
    error.code = 'INVALID_DATE';
    error.status = 400;
    throw error;
  }
  const response = await signedRequest(API_URL, 'POST', {
    method: 'food_entries.get.v2',
    date: String(dateInt),
    format: 'json',
    oauth_token: accessToken
  }, accessSecret);
  const entries = response.food_entries?.food_entry ?? response.food_entry ?? [];
  return listOf(entries);
}

module.exports = {
  exchangeFatSecretUserToken,
  fatSecretDateInt,
  getFatSecretFoodEntries,
  requestFatSecretUserAuthorization
};
