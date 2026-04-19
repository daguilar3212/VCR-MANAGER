// debug-alegra-bill.js
// Endpoint temporal: ver el JSON completo de bills existentes en Alegra
// Uso: GET /api/debug-alegra-bill

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

export default async function handler(req, res) {
  const { id } = req.query;

  try {
    const email = process.env.ALEGRA_EMAIL;
    const token = process.env.ALEGRA_TOKEN;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const doFetch = async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
        },
      });
      return response.json();
    };

    // Si pasa id, traer solo ese
    if (id) {
      const result = await doFetch(`${ALEGRA_BASE}/bills/${id}`);
      return res.status(200).json({ ok: true, result });
    }

    // Default: traer los ultimos 5 bills CON DETALLE completo
    const list = await doFetch(`${ALEGRA_BASE}/bills?limit=5&order_direction=DESC`);

    if (!Array.isArray(list)) {
      return res.status(200).json({
        ok: false,
        error: 'Respuesta inesperada',
        raw: list,
      });
    }

    // Traer detalle completo de cada uno
    const details = [];
    for (const b of list) {
      const full = await doFetch(`${ALEGRA_BASE}/bills/${b.id}`);
      details.push(full);
    }

    return res.status(200).json({
      ok: true,
      count: details.length,
      bills: details,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
