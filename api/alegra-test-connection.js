// Prueba de conexion con Alegra API (solo lectura)
// GET /api/alegra-test-connection

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({
      ok: false,
      error: 'Faltan env vars ALEGRA_EMAIL o ALEGRA_TOKEN en Vercel'
    });
  }

  // Alegra usa Basic Auth: base64(email:token)
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const response = await fetch('https://api.alegra.com/api/v1/users/self', {
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
        status: response.status,
        error: data
      });
    }

    return res.status(200).json({
      ok: true,
      message: 'Conexion exitosa con Alegra',
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
        company: data.company?.name
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
