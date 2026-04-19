// auth-drive.js
// Correr UNA SOLA VEZ para obtener el refresh token de Google Drive.
//
// Paso 1: Visitar https://vcr-manager.vercel.app/api/auth-drive?start=1
// Paso 2: Google te pide autorizar -> aceptar
// Paso 3: Te redirige a esta misma URL con un ?code=...
// Paso 4: El endpoint intercambia el code por un refresh token y lo muestra en pantalla
// Paso 5: Copiar el refresh token y pegarlo en Vercel como GOOGLE_DRIVE_REFRESH_TOKEN
// Paso 6: Redesplegar

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'https://vcr-manager.vercel.app/api/auth-drive';

export default async function handler(req, res) {
  const { code, start, error } = req.query;

  if (error) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:40px">
        <h2>Error de autorización</h2>
        <p>${error}</p>
        <p><a href="/api/auth-drive?start=1">Intentar de nuevo</a></p>
      </body></html>
    `);
  }

  // Paso 1: redirigir a Google consent screen
  if (start === '1') {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',  // fuerza a Google a dar refresh token aunque ya haya autorizado antes
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  // Si no hay code y no hay start, mostrar instrucciones
  if (!code) {
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
        <h2>Autorización de Google Drive</h2>
        <p>Hacé click abajo para autorizar VCR Manager a subir PDFs a tu Google Drive.</p>
        <a href="/api/auth-drive?start=1"
           style="display:inline-block;background:#4f8cff;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Autorizar Drive
        </a>
      </body></html>
    `);
  }

  // Paso 2: intercambiar code por tokens
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResp.json();

    if (!tokens.refresh_token) {
      return res.status(500).send(`
        <html><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:auto">
          <h2>Sin refresh token</h2>
          <p>Google no devolvió un refresh_token. Esto suele pasar si ya habías autorizado antes.</p>
          <p>Para forzar que te dé uno nuevo:</p>
          <ol>
            <li>Ir a <a href="https://myaccount.google.com/permissions" target="_blank">https://myaccount.google.com/permissions</a></li>
            <li>Buscar "VCR MANAGER" y eliminarle el acceso</li>
            <li>Volver a <a href="/api/auth-drive?start=1">autorizar desde cero</a></li>
          </ol>
          <hr>
          <h3>Respuesta de Google (debug):</h3>
          <pre>${JSON.stringify(tokens, null, 2)}</pre>
        </body></html>
      `);
    }

    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:auto">
        <h2>✓ Autorización exitosa</h2>
        <p><strong>Copiá este refresh token</strong> y pegalo en Vercel como variable de entorno:</p>
        <p><code>GOOGLE_DRIVE_REFRESH_TOKEN</code></p>
        <textarea readonly
          style="width:100%;padding:12px;font-family:monospace;font-size:13px;border:1px solid #ccc;border-radius:6px;min-height:80px"
          onclick="this.select()">${tokens.refresh_token}</textarea>
        <p style="color:#888;font-size:13px">Hacé click en el cuadro para seleccionar todo, después Ctrl+C (o Cmd+C).</p>
        <h3>Pasos siguientes:</h3>
        <ol>
          <li>Copiá el token de arriba</li>
          <li>Andá a Vercel → Settings → Environment Variables</li>
          <li>Crear nueva variable: <code>GOOGLE_DRIVE_REFRESH_TOKEN</code> con el valor copiado</li>
          <li>Redesplegar el proyecto</li>
        </ol>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send(`<pre>Error: ${err.message}</pre>`);
  }
}
