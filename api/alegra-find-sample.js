// Busca una bill reciente donde el concepto sea "Atencion a Clientes"
// para ver EXACTAMENTE que estructura usa (item o category)
// GET /api/alegra-find-sample

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan env' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    // Traer 20 bills recientes y revisar estructura de cada una
    const listResp = await fetch('https://api.alegra.com/api/v1/bills?limit=20&order_direction=DESC&order_field=date', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const list = await listResp.json();
    if (!listResp.ok) return res.status(502).json({ ok: false, error: list });

    // Para cada una, traer detalle completo
    const samples = [];
    for (const b of list.slice(0, 10)) {
      const d = await fetch(`https://api.alegra.com/api/v1/bills/${b.id}`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });
      const detail = await d.json();
      samples.push({
        id: detail.id,
        date: detail.date,
        provider: detail.provider?.name,
        has_purchases_categories: !!(detail.purchases?.categories?.length),
        has_items: !!(detail.items?.length),
        has_purchases_items: !!(detail.purchases?.items?.length),
        categories_names: (detail.purchases?.categories || []).map(c => c.name),
        items_names: (detail.items || []).map(i => i.name),
        top_level_keys: Object.keys(detail),
        purchases_keys: detail.purchases ? Object.keys(detail.purchases) : null
      });
    }

    return res.status(200).json({ ok: true, samples });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
