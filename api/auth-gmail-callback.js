import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        redirect_uri: process.env.GMAIL_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.status(400).json({ error: tokens.error_description });

    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    
    // Store tokens
    const { data: existing } = await supabase.from('gmail_sync').select('id').limit(1);
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      last_sync_at: new Date().toISOString(),
    };
    
    if (existing && existing.length > 0) {
      await supabase.from('gmail_sync').update(tokenData).eq('id', existing[0].id);
    } else {
      await supabase.from('gmail_sync').insert(tokenData);
    }

    res.status(200).send('<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f1117;color:#e8eaf0"><div style="text-align:center"><h1>Gmail conectado</h1><p>Puede cerrar esta ventana.</p></div></body></html>');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
