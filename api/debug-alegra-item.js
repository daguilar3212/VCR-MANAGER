// debug-alegra-item.js
// Endpoint temporal: ver el JSON completo de un item existente en Alegra
// Uso: GET /api/debug-alegra-item?id=76

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ ok: false, error: 'falta parametro id' });
  }

  try {
    const email = process.env.ALEGRA_EMAIL;
    const token = process.env.ALEGRA_TOKEN;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const response = await fetch(`${ALEGRA_BASE}/items/${id}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    return res.status(200).json({
      ok: true,
      item: data,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
