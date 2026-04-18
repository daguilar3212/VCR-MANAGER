// Semilla inicial de contactos proveedores desde Alegra hacia Supabase.
// Lee TODOS los contactos tipo "provider" en Alegra (paginado) y rellena
// provider_mapping.alegra_contact_id SOLO para cedulas que ya existen en
// provider_mapping. No crea filas nuevas para evitar conflicto con la
// constraint NOT NULL de default_category_id.
//
// Uso: GET /api/alegra-seed-contacts
// Es idempotente: se puede volver a correr sin duplicar nada.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan ALEGRA_EMAIL o ALEGRA_TOKEN' });
  }
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const PAGE_SIZE = 30;
  let start = 0;
  let totalFetched = 0;
  const contacts = [];

  try {
    // 1) Bajar TODOS los contactos tipo proveedor
    while (true) {
      const url = `https://api.alegra.com/api/v1/contacts?type=provider&start=${start}&limit=${PAGE_SIZE}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
      });

      if (!resp.ok) {
        const err = await resp.json();
        return res.status(resp.status).json({ ok: false, step: 'fetch_contacts', start, error: err });
      }

      const page = await resp.json();
      if (!Array.isArray(page) || page.length === 0) break;

      for (const c of page) {
        if (c.identification && c.id) {
          contacts.push({
            alegra_id: c.id,
            cedula: String(c.identification).trim(),
            name: c.name || null
          });
        }
      }
      totalFetched += page.length;
      if (page.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
      if (start > 2000) break;
    }

    const alegraByCedula = {};
    contacts.forEach(c => { alegraByCedula[c.cedula] = c; });

    // 2) Traer provider_mapping actual
    const { data: existingMap, error: mapErr } = await supabase
      .from('provider_mapping')
      .select('supplier_id, supplier_name, alegra_contact_id');

    if (mapErr) {
      return res.status(500).json({ ok: false, step: 'read_mapping', error: mapErr.message });
    }

    // 3) Solo UPDATE de filas existentes
    let matched = 0;
    let alreadySet = 0;
    let notFoundInAlegra = 0;
    const notFoundList = [];

    for (const row of (existingMap || [])) {
      const alegraContact = alegraByCedula[row.supplier_id];
      if (!alegraContact) {
        notFoundInAlegra++;
        if (notFoundList.length < 20) {
          notFoundList.push({ cedula: row.supplier_id, name: row.supplier_name });
        }
        continue;
      }
      if (row.alegra_contact_id === alegraContact.alegra_id) {
        alreadySet++;
        continue;
      }
      const { error: updErr } = await supabase
        .from('provider_mapping')
        .update({ alegra_contact_id: alegraContact.alegra_id })
        .eq('supplier_id', row.supplier_id);
      if (updErr) {
        return res.status(500).json({
          ok: false, step: 'update', cedula: row.supplier_id, error: updErr.message
        });
      }
      matched++;
    }

    // 4) Info: cuantos en Alegra no estan en mapping
    const existingCedulas = new Set((existingMap || []).map(m => m.supplier_id));
    const alegraOnlyCount = contacts.filter(c => !existingCedulas.has(c.cedula)).length;

    return res.status(200).json({
      ok: true,
      summary: {
        alegra_contacts_fetched: totalFetched,
        alegra_contacts_with_cedula: contacts.length,
        mapping_rows_existing: existingMap?.length || 0,
        updated_with_contact_id: matched,
        already_correct_skipped: alreadySet,
        in_mapping_but_not_in_alegra: notFoundInAlegra,
        in_alegra_but_not_in_mapping: alegraOnlyCount
      },
      orphans_sample_mapping_not_in_alegra: notFoundList
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
