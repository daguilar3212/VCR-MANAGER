// inspect-alegra-invoice.js
// Endpoint temporal para inspeccionar una factura existente en Alegra
// Uso: GET /api/inspect-alegra-invoice?id=<alegra_invoice_id>
// Retorna el JSON completo de la factura tal como Alegra lo tiene
// Útil para identificar nombres exactos de campos

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:900px;margin:auto">
        <h2>Inspeccionar factura Alegra</h2>
        <p>Uso: <code>/api/inspect-alegra-invoice?id=XXX</code></p>
        <p>Pasa el id de la factura de Alegra (el alegra_invoice_id que está en tu tabla sales).</p>
      </body></html>
    `);
  }

  try {
    const email = process.env.ALEGRA_EMAIL;
    const token = process.env.ALEGRA_TOKEN;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    const resp = await fetch(`${ALEGRA_BASE}/invoices/${id}`, {
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });
    const data = await resp.json();

    if (!resp.ok) {
      return res.status(resp.status).json({ ok: false, error: data });
    }

    // Devolver JSON formateado HTML para leer facil
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:30px;max-width:1200px;margin:auto">
        <h2>Factura Alegra ID: ${id}</h2>
        <p>Estos son los campos tal como Alegra los tiene:</p>
        <pre style="background:#1e1e1e;color:#d4d4d4;padding:20px;border-radius:8px;overflow:auto;font-size:13px">${JSON.stringify(data, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
