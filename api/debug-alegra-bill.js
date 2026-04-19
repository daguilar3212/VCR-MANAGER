// debug-alegra-bill.js
// Endpoint temporal: ver el JSON completo de un bill existente en Alegra
// Uso: GET /api/debug-alegra-bill?number=CM-75

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

export default async function handler(req, res) {
  const { number, id } = req.query;

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

    // Si pasa number, buscar por query
    if (number) {
      const result = await doFetch(`${ALEGRA_BASE}/bills?query=${encodeURIComponent(number)}&limit=5&order_direction=DESC`);
      return res.status(200).json({ ok: true, result });
    }

    // Default: traer los ultimos 10 bills y buscar uno CRC y uno USD
    const list = await doFetch(`${ALEGRA_BASE}/bills?limit=20&order_direction=DESC`);

    let billCRC = null;
    let billUSD = null;

    if (Array.isArray(list)) {
      for (const b of list) {
        const code = b.currency?.code || b.currency;
        if (!billCRC && code === 'CRC') billCRC = b.id;
        if (!billUSD && code === 'USD') billUSD = b.id;
        if (billCRC && billUSD) break;
      }
    }

    // Traer detalle completo de cada uno
    const detailCRC = billCRC ? await doFetch(`${ALEGRA_BASE}/bills/${billCRC}`) : null;
    const detailUSD = billUSD ? await doFetch(`${ALEGRA_BASE}/bills/${billUSD}`) : null;

    return res.status(200).json({
      ok: true,
      sample_CRC: detailCRC,
      sample_USD: detailUSD,
      note: 'Ultimas 20 bills revisadas. Se traen los primeros encontrados de cada moneda.',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
