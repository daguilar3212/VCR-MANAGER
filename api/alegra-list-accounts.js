// Lista las cuentas bancarias de Alegra (solo lectura)
// GET /api/alegra-list-accounts

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({
      ok: false,
      error: 'Faltan env vars ALEGRA_EMAIL o ALEGRA_TOKEN'
    });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const response = await fetch('https://api.alegra.com/api/v1/bank-accounts?limit=100', {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data
      });
    }

    // Devolvemos solo lo que necesitamos: id, nombre, tipo, moneda
    const accounts = data.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      currency: acc.currency?.code || acc.currency,
      status: acc.status
    }));

    return res.status(200).json({
      ok: true,
      total: accounts.length,
      accounts
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
