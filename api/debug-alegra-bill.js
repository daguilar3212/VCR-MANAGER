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

    // Traer ultimos 30 bills (limite maximo de Alegra)
    const all = await doFetch(`${ALEGRA_BASE}/bills?limit=30&order_direction=DESC`);

    if (!Array.isArray(all)) {
      return res.status(200).json({ ok: false, raw: all });
    }

    // Buscar el del 11 de febrero 2026 (CM-75 Nissan Kicks)
    const feb11 = all.filter(b => b.date === '2026-02-11');

    // Tambien listado compacto completo
    const compact = all.map(b => ({
      id: b.id,
      number: b.numberTemplate?.number,
      provider_name: b.provider?.name,
      provider_id: b.provider?.id,
      total: b.total,
      date: b.date,
    }));

    return res.status(200).json({
      ok: true,
      total_scanned: all.length,
      date_range: all.length > 0 ? {
        most_recent: all[0].date,
        oldest: all[all.length-1].date,
      } : null,
      feb_11_2026_matches: feb11,
      compact_summary: compact.slice(0, 50), // primeros 50 para no saturar
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
