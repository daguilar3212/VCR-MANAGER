// Diagnostico: trae las bills mas recientes de Alegra para ver que estructura tienen
// GET /api/alegra-sample-bill

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan ALEGRA_EMAIL o ALEGRA_TOKEN' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    // Trae las 3 bills mas recientes con metadata completa
    const listResp = await fetch('https://api.alegra.com/api/v1/bills?limit=3&order_direction=DESC&order_field=date', {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const listData = await listResp.json();

    if (!listResp.ok) {
      return res.status(listResp.status).json({ ok: false, step: 'list', error: listData });
    }

    if (!Array.isArray(listData) || listData.length === 0) {
      return res.status(200).json({ ok: true, message: 'No hay bills en la cuenta', list: listData });
    }

    // Tomar el ID de la primera y hacer GET completo para ver TODOS los campos
    const firstId = listData[0].id;

    const detailResp = await fetch(`https://api.alegra.com/api/v1/bills/${firstId}`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });

    const detailData = await detailResp.json();

    return res.status(200).json({
      ok: true,
      sample_bill_full: detailData,
      top_level_keys: Object.keys(detailData),
      list_summary: listData.map(b => ({
        id: b.id,
        date: b.date,
        provider_name: b.provider?.name,
        currency: b.currency,
        total: b.total,
        status: b.status
      }))
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
