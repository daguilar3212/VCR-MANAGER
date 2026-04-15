import { createClient } from '@supabase/supabase-js';

export function getSupabase() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

export async function getGmailToken() {
  const supabase = getSupabase();
  const { data } = await supabase.from('gmail_sync').select('*').limit(1).single();
  if (!data) throw new Error('Gmail not connected');

  // Check if token expired
  if (new Date(data.token_expiry) < new Date()) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: data.refresh_token,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
    const newTokens = await refreshRes.json();
    if (newTokens.error) throw new Error('Token refresh failed: ' + newTokens.error);

    await supabase.from('gmail_sync').update({
      access_token: newTokens.access_token,
      token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    }).eq('id', data.id);

    return newTokens.access_token;
  }

  return data.access_token;
}

export async function gmailAPI(path, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}
