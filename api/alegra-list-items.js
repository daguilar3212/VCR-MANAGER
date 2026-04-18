// Lista todos los items de Alegra con su cuenta contable asociada.
// GET /api/alegra-list-items
// Solo lectura, no modifica nada.

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan ALEGRA_EMAIL o ALEGRA_TOKEN' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const PAGE_SIZE = 30;
  let start = 0;
  const items = [];

  try {
    while (true) {
      const url = `https://api.alegra.com/api/v1/items?start=${start}&limit=${PAGE_SIZE}&status=active`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });

      if (!resp.ok) {
        const err = await resp.json();
        return res.status(resp.status).json({ ok: false, step: 'fetch', start, error: err });
      }

      const page = await resp.json();
      if (!Array.isArray(page) || page.length === 0) break;

      for (const it of page) {
        items.push({
          id: it.id,
          name: it.name,
          description: it.description || null,
          reference: it.reference || null,
          type: it.type || null,
          // La cuenta contable asociada al item para gastos (compras)
          account_purchase: it.accounting?.accountPurchase || null,
          account_sales: it.accounting?.account || null,
          tax: (it.tax || []).map(t => ({ id: t.id, name: t.name, percentage: t.percentage })),
          price_base: it.price?.[0]?.price || null,
          cabys: it.customFields?.find?.(f => f.name?.toLowerCase()?.includes('cabys'))?.value || null
        });
      }

      if (page.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
      if (start > 5000) break; // seguridad
    }

    return res.status(200).json({
      ok: true,
      total: items.length,
      items
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
