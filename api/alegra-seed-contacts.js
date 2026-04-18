// Semilla inicial de contactos proveedores desde Alegra hacia Supabase.
// Lee TODOS los contactos tipo "provider" en Alegra (paginado) y rellena
// provider_mapping.alegra_contact_id buscando por cedula (identification).
//
// Uso: GET /api/alegra-seed-contacts
// Correr UNA SOLA VEZ despues de agregar la columna alegra_contact_id.
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

  // Alegra pagina con start (offset) y limit. Max limit por request = 30.
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
      if (page.length < PAGE_SIZE) break; // ultima pagina
      start += PAGE_SIZE;

      // Proteccion: si hay mas de 2000 proveedores algo esta raro
      if (start > 2000) break;
    }

    // 2) Traer provider_mapping actual (solo cedulas + contact_id si existe)
    const { data: existingMap, error: mapErr } = await supabase
      .from('provider_mapping')
      .select('supplier_id, supplier_name, alegra_contact_id');

    if (mapErr) {
      return res.status(500).json({ ok: false, step: 'read_mapping', error: mapErr.message });
    }

    const mapByCedula = {};
    (existingMap || []).forEach(m => { mapByCedula[m.supplier_id] = m; });

    // 3) Clasificar: matched (actualizar), new_insert (crear), already_set (skip)
    let matched = 0;
    let newInsert = 0;
    let alreadySet = 0;
    const rowsToUpsert = [];
    const matchedCedulas = new Set();

    for (const c of contacts) {
      const existing = mapByCedula[c.cedula];
      if (existing) {
        matchedCedulas.add(c.cedula);
        if (existing.alegra_contact_id === c.alegra_id) {
          alreadySet++;
        } else {
          rowsToUpsert.push({
            supplier_id: c.cedula,
            supplier_name: existing.supplier_name || c.name,
            alegra_contact_id: c.alegra_id
          });
          matched++;
        }
      } else {
        // Proveedor que existe en Alegra pero no en provider_mapping (nunca facturo por Gmail)
        rowsToUpsert.push({
          supplier_id: c.cedula,
          supplier_name: c.name,
          alegra_contact_id: c.alegra_id
        });
        newInsert++;
      }
    }

    // 4) Upsert en lotes de 100
    const BATCH = 100;
    let upserted = 0;
    for (let i = 0; i < rowsToUpsert.length; i += BATCH) {
      const chunk = rowsToUpsert.slice(i, i + BATCH);
      const { error: upErr } = await supabase
        .from('provider_mapping')
        .upsert(chunk, { onConflict: 'supplier_id' });
      if (upErr) {
        return res.status(500).json({
          ok: false, step: 'upsert', batch_start: i, error: upErr.message
        });
      }
      upserted += chunk.length;
    }

    // 5) Detectar cedulas en provider_mapping que NO estan en Alegra (revision manual)
    const orphanCedulas = (existingMap || [])
      .filter(m => !matchedCedulas.has(m.supplier_id) && !m.alegra_contact_id)
      .map(m => ({ cedula: m.supplier_id, name: m.supplier_name }));

    return res.status(200).json({
      ok: true,
      summary: {
        alegra_contacts_fetched: totalFetched,
        alegra_contacts_with_cedula: contacts.length,
        mapping_rows_existing: existingMap?.length || 0,
        matched_updated: matched,
        new_rows_created: newInsert,
        already_correct_skipped: alreadySet,
        total_upserted: upserted,
        orphans_in_mapping_not_in_alegra: orphanCedulas.length
      },
      orphans_sample: orphanCedulas.slice(0, 10)
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
