// Sincroniza UNA factura de VCR hacia Alegra como Bill (factura de compra).
// POST /api/alegra-sync-bill
// Body: { invoice_id: "uuid-de-la-factura-en-supabase" }
//
// Flujo:
// 1. Lee la factura + lineas de Supabase
// 2. Verifica que tenga alegra_account_id (categoria contable)
// 3. Resuelve alegra_contact_id del proveedor:
//    - provider_mapping.alegra_contact_id si existe
//    - sino busca en Alegra por cedula
//    - sino crea el contacto en Alegra
// 4. Consolida lineas por tarifa de IVA (ej: todo 13% junto, todo 4% junto)
// 5. POST /bills a Alegra
// 6. Si hay PDF en Storage, lo sube como attachment
// 7. Actualiza invoice.alegra_bill_id y alegra_sync_status='synced'
//
// Idempotente: si la factura ya tiene alegra_bill_id, retorna sin hacer nada.

import { createClient } from '@supabase/supabase-js';

// Mapa tarifa XML (numero) -> ID de impuesto en Alegra
const TAX_RATE_TO_ALEGRA_ID = {
  13: 1,    // IVA 13%
  4: 6,     // IVA reducido 4%
  2: 5,     // IVA reducido 2% (inactivo en Alegra, puede fallar)
  1: 4,     // IVA reducido 1%
  0.5: 3,   // IVA reducido 0.5% (inactivo)
  0: 2      // IVA exento
};

// Mapa tipo identificacion XML -> codigo Alegra Costa Rica
const ID_TYPE_MAP = {
  '01': 'CF',      // Fisica
  '02': 'CJ',      // Juridica
  '03': 'DIMEX',   // Residente
  '04': 'NITE'     // Sin cedula
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  const { invoice_id } = req.body || {};
  if (!invoice_id) {
    return res.status(400).json({ ok: false, error: 'Falta invoice_id en el body' });
  }

  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!email || !token || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Faltan env vars' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

  const alegraFetch = async (path, opts = {}) => {
    const resp = await fetch(`${ALEGRA_BASE}${path}`, {
      ...opts,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: resp.ok, status: resp.status, data };
  };

  try {
    // 1) Leer factura
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoice_id)
      .single();

    if (invErr || !invoice) {
      return res.status(404).json({ ok: false, error: 'Factura no encontrada', detail: invErr?.message });
    }

    // Idempotencia
    if (invoice.alegra_bill_id) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: 'Factura ya sincronizada',
        alegra_bill_id: invoice.alegra_bill_id
      });
    }

    if (!invoice.alegra_account_id) {
      return res.status(400).json({
        ok: false,
        error: 'Factura sin categoria contable (alegra_account_id). Clasificala primero.'
      });
    }

    // 2) Leer lineas
    const { data: lines, error: linesErr } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoice_id);

    if (linesErr) {
      return res.status(500).json({ ok: false, error: 'Error leyendo lineas', detail: linesErr.message });
    }

    // 3) Resolver alegra_contact_id
    let contactId = null;
    let contactSource = 'unknown';

    const { data: providerRow } = await supabase
      .from('provider_mapping')
      .select('alegra_contact_id')
      .eq('supplier_id', invoice.supplier_id)
      .maybeSingle();

    if (providerRow?.alegra_contact_id) {
      contactId = providerRow.alegra_contact_id;
      contactSource = 'supabase_cache';
    } else {
      // Buscar en Alegra por cedula
      const searchRes = await alegraFetch(`/contacts?identification=${encodeURIComponent(invoice.supplier_id)}`);
      if (!searchRes.ok) {
        return res.status(502).json({
          ok: false, step: 'search_contact', error: searchRes.data
        });
      }

      const foundProvider = (Array.isArray(searchRes.data) ? searchRes.data : [])
        .find(c => Array.isArray(c.type) ? c.type.includes('provider') : c.type === 'provider');

      if (foundProvider) {
        contactId = foundProvider.id;
        contactSource = 'alegra_search';
      } else {
        // Crear nuevo contacto en Alegra
        const idTypeCode = ID_TYPE_MAP[invoice.supplier_id_type] || 'CJ';
        const createPayload = {
          name: invoice.supplier_name || `Proveedor ${invoice.supplier_id}`,
          identification: invoice.supplier_id,
          identificationObject: {
            type: idTypeCode,
            number: invoice.supplier_id
          },
          type: ['provider']
        };
        if (invoice.supplier_email) createPayload.email = invoice.supplier_email;
        if (invoice.supplier_phone) createPayload.phonePrimary = invoice.supplier_phone;

        const createRes = await alegraFetch('/contacts', {
          method: 'POST',
          body: JSON.stringify(createPayload)
        });

        if (!createRes.ok) {
          return res.status(502).json({
            ok: false, step: 'create_contact', error: createRes.data, payload: createPayload
          });
        }
        contactId = createRes.data.id;
        contactSource = 'alegra_created';
      }

      // Guardar en cache (upsert manejando el caso de que la fila no exista por NOT NULL)
      if (providerRow) {
        await supabase.from('provider_mapping')
          .update({ alegra_contact_id: contactId })
          .eq('supplier_id', invoice.supplier_id);
      }
      // Si no existe en provider_mapping no lo insertamos ahora (falta default_category_id)
      // El fetcher lo crearia en su proximo pase si hay proxima factura del mismo proveedor
    }

    // 4) Consolidar lineas por tarifa de IVA
    // Agrupamos por tax_rate: sumamos subtotal, identificamos tax_id
    const groups = {};
    if (lines && lines.length > 0) {
      for (const l of lines) {
        const rate = Math.round((l.tax_rate || 0) * 100) / 100;
        if (!groups[rate]) groups[rate] = { subtotal: 0, tax_rate: rate };
        groups[rate].subtotal += (l.subtotal || 0);
      }
    } else {
      // Sin lineas parseadas (raro): una sola categoria con el subtotal total
      groups[13] = { subtotal: invoice.subtotal || invoice.total || 0, tax_rate: 13 };
    }

    // Armar categories array para Alegra (formato Costa Rica)
    // Observado de bills reales:
    // - rate > 0: tax: [{ id: "X" }]
    // - rate = 0 o exento: tax: [] (array vacio, NO poner IVA exento id 2)
    const categories = [];
    for (const rate of Object.keys(groups)) {
      const g = groups[rate];
      const taxAlegraId = TAX_RATE_TO_ALEGRA_ID[parseFloat(rate)];

      const cat = {
        id: String(invoice.alegra_account_id),
        price: Math.round(g.subtotal * 100) / 100,
        quantity: 1,
        observations: invoice.detected_plate || ''
      };
      if (taxAlegraId !== undefined && parseFloat(rate) > 0) {
        cat.tax = [{ id: String(taxAlegraId) }];
      } else {
        cat.tax = [];  // Array vacio para rate 0 / ninguno / exento
      }
      categories.push(cat);
    }

    // 5) Armar observations
    const plateStr = invoice.detected_plate ? ` | ${invoice.detected_plate}` : '';
    const observations = `VCR #${invoice.consecutive || invoice.last_four}${plateStr}`;

    // Alegra espera fechas puras YYYY-MM-DD, no timestamps completos
    const toDateOnly = (d) => {
      if (!d) return null;
      const s = String(d);
      return s.length > 10 ? s.slice(0, 10) : s;
    };

    // 6) Payload del bill
    // Observado de bills reales en Alegra CR:
    // - Moneda base es CRC, NO se manda currency cuando es CRC
    // - Solo para USD (o moneda extranjera) se manda currency como objeto { code, exchangeRate }
    // - decimalPrecision y calculationScale estan siempre presentes
    const billPayload = {
      provider: contactId,
      date: toDateOnly(invoice.emission_date),
      dueDate: toDateOnly(invoice.due_date) || toDateOnly(invoice.emission_date),
      observations,
      warehouse: { id: "1" },
      decimalPrecision: 2,
      calculationScale: 6,
      purchases: {
        categories: categories
      }
    };

    // Solo agregar currency si NO es CRC (moneda base de la cuenta)
    if (invoice.currency && invoice.currency !== 'CRC') {
      const rate = invoice.exchange_rate && parseFloat(invoice.exchange_rate) > 0
        ? parseFloat(invoice.exchange_rate)
        : 1;
      billPayload.currency = {
        code: invoice.currency,
        exchangeRate: rate
      };
    }

    // 7) Crear bill en Alegra
    const billRes = await alegraFetch('/bills', {
      method: 'POST',
      body: JSON.stringify(billPayload)
    });

    if (!billRes.ok) {
      // Guardamos el error + el payload completo para debug
      const errorWithPayload = {
        alegra_error: billRes.data,
        sent_payload: billPayload
      };
      await supabase.from('invoices')
        .update({
          alegra_sync_status: 'error',
          alegra_sync_error: JSON.stringify(errorWithPayload).slice(0, 2000)
        })
        .eq('id', invoice_id);

      return res.status(502).json({
        ok: false, step: 'create_bill', error: billRes.data, payload: billPayload
      });
    }

    const alegraBillId = billRes.data.id;

    // 8) Actualizar factura en Supabase con el bill_id ANTES de subir PDF
    //    (si falla el PDF, el bill ya queda marcado)
    await supabase.from('invoices')
      .update({
        alegra_bill_id: alegraBillId,
        alegra_sync_status: 'synced',
        alegra_sync_error: null,
        alegra_synced_at: new Date().toISOString()
      })
      .eq('id', invoice_id);

    // 9) Subir PDF a Alegra (si existe en Storage)
    let pdfUploaded = false;
    let pdfError = null;
    if (invoice.pdf_storage_path) {
      try {
        const { data: fileBlob, error: dlErr } = await supabase.storage
          .from('invoice-pdfs')
          .download(invoice.pdf_storage_path);

        if (dlErr) {
          pdfError = `Download from storage: ${dlErr.message}`;
        } else {
          // Convertir Blob a base64 para Alegra
          const buf = Buffer.from(await fileBlob.arrayBuffer());
          const base64 = buf.toString('base64');
          const filename = invoice.pdf_storage_path.split('/').pop() || 'factura.pdf';

          const attachRes = await alegraFetch(`/bills/${alegraBillId}/files`, {
            method: 'POST',
            body: JSON.stringify({
              fileName: filename,
              file: base64
            })
          });
          if (attachRes.ok) {
            pdfUploaded = true;
          } else {
            pdfError = JSON.stringify(attachRes.data).slice(0, 300);
            await supabase.from('invoices')
              .update({ alegra_sync_status: 'synced_no_pdf' })
              .eq('id', invoice_id);
          }
        }
      } catch (pdfE) {
        pdfError = pdfE.message;
      }
    }

    return res.status(200).json({
      ok: true,
      alegra_bill_id: alegraBillId,
      contact_id: contactId,
      contact_source: contactSource,
      pdf_uploaded: pdfUploaded,
      pdf_error: pdfError,
      categories_sent: categories.length,
      sent_payload: billPayload
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
