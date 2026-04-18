// Lista todos los items de Alegra (solo lectura)
// GET /api/alegra-list-items

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
    // Paginar para traer TODOS los items (Alegra limita a 30 por request)
    let allItems = [];
    let start = 0;
    const limit = 30;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.alegra.com/api/v1/items?limit=${limit}&start=${start}`,
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
        allItems = allItems.concat(data);
        start += limit;
        hasMore = data.length === limit;
      } else {
        hasMore = false;
      }

      // Safety cap: max 20 páginas (600 items)
      if (start >= 600) break;
    }

    // Devolver solo campos útiles
    const items = allItems.map(item => ({
      id: item.id,
      name: item.name,
      reference: item.reference,
      status: item.status,
      type: item.type,
      category: item.category?.name,
      price: Array.isArray(item.price) ? item.price[0]?.price : item.price
    }));

    return res.status(200).json({
      ok: true,
      total: items.length,
      items
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
