import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data } = await supabase.from('gmail_sync').select('last_sync_at,token_expiry').limit(1).single();
    
    if (!data) return res.json({ connected: false });
    
    return res.json({
      connected: true,
      lastSync: data.last_sync_at,
      tokenValid: new Date(data.token_expiry) > new Date(),
    });
  } catch (err) {
    return res.json({ connected: false, error: err.message });
  }
}
