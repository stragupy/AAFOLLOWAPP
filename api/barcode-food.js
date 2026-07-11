const BARCODE_PATTERN = /^\d{8,14}$/;

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rounded(value) {
  return Math.round((value || 0) * 10) / 10;
}

function servingGrams(product) {
  const quantity = numberOrNull(product.serving_quantity);
  const unit = String(product.serving_quantity_unit || '').toLowerCase();
  if (quantity != null && (!unit || unit === 'g' || unit === 'gram' || unit === 'grams')) return quantity;
  const match = String(product.serving_size || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*g\b/i);
  return match ? numberOrNull(match[1]) : null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Metodo no permitido' });

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const code = String(req.query?.code || requestUrl.searchParams.get('code') || '').trim();
  if (!BARCODE_PATTERN.test(code)) return sendJson(res, 400, { error: 'Codigo EAN o UPC invalido' });

  const fields = [
    'code', 'product_name', 'product_name_es', 'generic_name', 'brands',
    'serving_size', 'serving_quantity', 'serving_quantity_unit',
    'nutriments', 'image_front_small_url'
  ].join(',');
  const endpoint = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(code)}.json?fields=${encodeURIComponent(fields)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': process.env.OPEN_FOOD_FACTS_USER_AGENT || 'AAFollowApp/1.0 (Vercel product lookup)',
        Accept: 'application/json'
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    const product = payload.product;
    if (!response.ok || payload.status !== 'success' || !product) {
      return sendJson(res, 404, { error: 'Producto no encontrado en Open Food Facts' });
    }

    const nutrients = product.nutriments || {};
    let calories = numberOrNull(nutrients['energy-kcal_100g']);
    if (calories == null) {
      const kilojoules = numberOrNull(nutrients['energy-kj_100g'] ?? nutrients.energy_100g);
      if (kilojoules != null) calories = kilojoules / 4.184;
    }
    const protein = numberOrNull(nutrients.proteins_100g);
    const carbs = numberOrNull(nutrients.carbohydrates_100g);
    const fat = numberOrNull(nutrients.fat_100g);
    const name = product.product_name_es || product.product_name || product.generic_name || `Producto ${code}`;

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return sendJson(res, 200, {
      product: {
        code,
        name: String(name).slice(0, 180),
        brands: String(product.brands || '').slice(0, 160),
        serving_size: String(product.serving_size || '').slice(0, 80),
        serving_grams: servingGrams(product),
        image_url: product.image_front_small_url || '',
        per_100g: {
          calories: rounded(calories),
          protein: rounded(protein),
          carbs: rounded(carbs),
          fat: rounded(fat)
        },
        nutrition_available: [calories, protein, carbs, fat].some(value => value != null)
      },
      source: 'Open Food Facts'
    });
  } catch (err) {
    const message = err.name === 'AbortError' ? 'La consulta del producto tardo demasiado' : 'No se pudo consultar Open Food Facts';
    return sendJson(res, 502, { error: message });
  } finally {
    clearTimeout(timeout);
  }
};
