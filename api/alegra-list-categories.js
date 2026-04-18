// Lista las cuentas contables (categorías) de Alegra (solo lectura)
// GET /api/alegra-list-categories

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({
      ok: false,
      error: 'Faltan env vars ALEGRA_EMAIL o ALEGRA_TOKEN'
    });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    // Paginar para traer TODAS las categorías (Alegra limita a 30 por request)
    let allCategories = [];
    let start = 0;
    const limit = 30;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.alegra.com/api/v1/categories?limit=${limit}&start=${start}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json'
          }
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ ok: false, error: data });
      }

      if (Array.isArray(data) && data.length > 0) {
        allCategories = allCategories.concat(data);
        start += limit;
        hasMore = data.length === limit;
      } else {
        hasMore = false;
      }

      // Safety cap
      if (start >= 600) break;
    }

    // Devolver solo campos útiles
    const categories = allCategories.map(cat => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      description: cat.description,
      parent_id: cat.parent?.id || null,
      parent_name: cat.parent?.name || null
    }));

    return res.status(200).json({
      ok: true,
      total: categories.length,
      categories
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
