// Lista las monedas disponibles en la cuenta de Alegra
// GET /api/alegra-list-currencies

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan ALEGRA_EMAIL o ALEGRA_TOKEN' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    // Intentar endpoint de monedas
    const response = await fetch('https://api.alegra.com/api/v1/currencies', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: data });
    }

    return res.status(200).json({
      ok: true,
      total: Array.isArray(data) ? data.length : 0,
      currencies: data
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
