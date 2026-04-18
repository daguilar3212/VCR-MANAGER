// Trae las ultimas 20 bills con TODO su detalle: IDs de cuentas, impuestos exactos,
// estructura de categorias, etc. Para analizar patrones reales.
// GET /api/alegra-analyze-bills

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan env' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const BASE = 'https://api.alegra.com/api/v1';

  const call = async (path) => {
    const r = await fetch(`${BASE}${path}`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });
    return { ok: r.ok, status: r.status, data: await r.json() };
  };

  try {
    // 1) Listar 20 bills recientes
    const list = await call('/bills?limit=20&order_direction=DESC&order_field=date');
    if (!list.ok) return res.status(list.status).json({ ok: false, step: 'list', error: list.data });

    // 2) Para cada una, traer detalle completo
    const detailed = [];
    for (const b of list.data) {
      const d = await call(`/bills/${b.id}`);
      if (!d.ok) continue;
      const bill = d.data;

      // Extraer solo lo esencial para analizar
      detailed.push({
        id: bill.id,
        date: bill.date,
        provider_name: bill.provider?.name,
        provider_id: bill.provider?.id,
        currency: bill.currency,
        total: bill.total,
        status: bill.status,
        warehouse: bill.warehouse,
        numberTemplate: bill.numberTemplate,
        decimalPrecision: bill.decimalPrecision,
        calculationScale: bill.calculationScale,
        observations: bill.observations,
        // Lo mas importante: las categorias con su ID y su tax
        categories: (bill.purchases?.categories || []).map(c => ({
          id: c.id,
          name: c.name,
          price: c.price,
          quantity: c.quantity,
          discount: c.discount,
          observations: c.observations,
          tax: (c.tax || []).map(t => ({
            id: t.id,
            name: t.name,
            percentage: t.percentage
          })),
          subtotal: c.subtotal,
          total: c.total,
          taxAmount: c.taxAmount
        })),
        retentions: bill.retentions || [],
        costCenter: bill.costCenter,
        // Todas las claves top-level presentes (por si hay alguna que se me escapa)
        keys_present: Object.keys(bill)
      });
    }

    // 3) Resumen: extraer IDs unicos de cuentas contables y taxes usadas
    const uniqueAccounts = {};
    const uniqueTaxes = {};
    for (const bill of detailed) {
      for (const c of bill.categories) {
        if (c.id) {
          uniqueAccounts[c.id] = c.name;
        }
        for (const t of c.tax) {
          if (t.id) {
            uniqueTaxes[t.id] = `${t.name} (${t.percentage}%)`;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      total_bills: detailed.length,
      unique_account_ids_found: uniqueAccounts,
      unique_tax_ids_found: uniqueTaxes,
      bills: detailed
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
