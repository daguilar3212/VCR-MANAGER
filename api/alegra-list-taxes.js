// Lista los impuestos configurados en Alegra (solo lectura).
// Necesario para saber que ID usar al mandar IVA en los bills.
// GET /api/alegra-list-taxes

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan ALEGRA_EMAIL o ALEGRA_TOKEN' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const response = await fetch('https://api.alegra.com/api/v1/taxes', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: data });
    }

    // Devolver solo lo relevante
    const taxes = data.map(t => ({
      id: t.id,
      name: t.name,
      percentage: t.percentage,
      type: t.type,
      status: t.status,
      description: t.description
    }));

    return res.status(200).json({
      ok: true,
      total: taxes.length,
      taxes
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
