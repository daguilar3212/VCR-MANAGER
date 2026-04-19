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

    // BUSCAR EL NISSAN KICKS (CM-75, RIVERA CHACON, 11 febrero 2026)
    // Filtrar por rango de fechas febrero 2026
    const febList = await doFetch(`${ALEGRA_BASE}/bills?limit=30&order_direction=DESC&start_date=2026-02-10&end_date=2026-02-15`);

    // Tambien buscar por texto "kicks" o "rivera"
    const textSearch = await doFetch(`${ALEGRA_BASE}/bills?query=kicks&limit=5`);

    return res.status(200).json({
      ok: true,
      febList: Array.isArray(febList) ? febList.slice(0, 10) : febList,
      textSearch: Array.isArray(textSearch) ? textSearch : textSearch,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
