// alegra-sync.js
// Endpoint unificado que sincroniza:
// - Facturas de compra (bills): POST /api/alegra-sync?type=bill
// - Pagos de facturas (payments): POST /api/alegra-sync?type=payment
//
// Body: { invoice_id: "uuid-de-la-factura-en-supabase" }
//
// Fusiona alegra-sync-bill.js + alegra-sync-payment.js

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

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

function toDateOnly(d) {
  if (!d) return null;
  const s = String(d);
  return s.length > 10 ? s.slice(0, 10) : s;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  const { invoice_id } = req.body || {};
  const type = req.query.type || 'bill'; // 'bill' o 'payment'

  if (!invoice_id) {
    return res.status(400).json({ ok: false, error: 'Falta invoice_id en el body' });
  }

  if (type !== 'bill' && type !== 'payment') {
    return res.status(400).json({ ok: false, error: 'type debe ser "bill" o "payment"' });
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

  // ============================================================
  // BILL: Sincronizar factura de compra
  // ============================================================
  if (type === 'bill') {
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

        if (providerRow) {
          await supabase.from('provider_mapping')
            .update({ alegra_contact_id: contactId })
            .eq('supplier_id', invoice.supplier_id);
        }
      }

      // 4) Consolidar lineas por tarifa de IVA
      const groups = {};
      if (lines && lines.length > 0) {
        for (const l of lines) {
          const rate = Math.round((l.tax_rate || 0) * 100) / 100;
          if (!groups[rate]) groups[rate] = { subtotal: 0, tax_rate: rate };
          groups[rate].subtotal += (l.subtotal || 0);
        }
      } else {
        groups[13] = { subtotal: invoice.subtotal || invoice.total || 0, tax_rate: 13 };
      }

      // Armar categories array
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
          cat.tax = [];
        }
        categories.push(cat);
      }

      // OtrosCargos como linea adicional
      if (invoice.other_charges && parseFloat(invoice.other_charges) > 0) {
        const serviceDesc = invoice.other_charges_detail || 'Servicio';
        categories.push({
          id: String(invoice.alegra_account_id),
          price: Math.round(parseFloat(invoice.other_charges) * 100) / 100,
          quantity: 1,
          observations: serviceDesc.length > 80 ? serviceDesc.slice(0, 80) : serviceDesc,
          tax: []
        });
      }

      // 5) Observations
      const plateStr = invoice.detected_plate ? ` | ${invoice.detected_plate}` : '';
      const observations = `VCR #${invoice.consecutive || invoice.last_four}${plateStr}`;

      // 6) Payload del bill
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

      // 8) Actualizar factura en Supabase
      await supabase.from('invoices')
        .update({
          alegra_bill_id: alegraBillId,
          alegra_sync_status: 'synced',
          alegra_sync_error: null,
          alegra_synced_at: new Date().toISOString()
        })
        .eq('id', invoice_id);

      // 9) Subir PDF a Alegra (si existe)
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
            const buf = Buffer.from(await fileBlob.arrayBuffer());
            const filename = invoice.pdf_storage_path.split('/').pop() || 'factura.pdf';

            if (buf.length > 2 * 1024 * 1024) {
              pdfError = `PDF supera 2MB (${Math.round(buf.length / 1024)}KB). Alegra no lo acepta.`;
              await supabase.from('invoices')
                .update({ alegra_sync_status: 'synced_no_pdf' })
                .eq('id', invoice_id);
            } else {
              const formData = new FormData();
              const blob = new Blob([buf], { type: 'application/pdf' });
              formData.append('file', blob, filename);

              const attachResp = await fetch(`${ALEGRA_BASE}/bills/${alegraBillId}/attachment`, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${auth}`,
                  'Accept': 'application/json'
                },
                body: formData
              });

              const attachData = await attachResp.json().catch(() => ({}));

              if (attachResp.ok) {
                pdfUploaded = true;
              } else {
                pdfError = `Alegra attachment error: ${JSON.stringify(attachData).slice(0, 300)}`;
                await supabase.from('invoices')
                  .update({ alegra_sync_status: 'synced_no_pdf' })
                  .eq('id', invoice_id);
              }
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

  // ============================================================
  // PAYMENT: Sincronizar pago de factura
  // ============================================================
  if (type === 'payment') {
    try {
      // 1) Leer factura
      const { data: invoice, error: invErr } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', invoice_id)
        .single();

      if (invErr || !invoice) {
        return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
      }

      // Validar prerequisitos
      if (!invoice.alegra_bill_id) {
        return res.status(400).json({
          ok: false,
          error: 'La factura no tiene bill en Alegra. Sincronizala primero con "→ Alegra".'
        });
      }
      if (invoice.pay_status !== 'paid') {
        return res.status(400).json({
          ok: false,
          error: 'La factura no esta marcada como pagada.'
        });
      }
      if (!invoice.paid_bank_id) {
        return res.status(400).json({
          ok: false,
          error: 'Falta seleccionar cuenta bancaria.'
        });
      }
      // Idempotencia
      if (invoice.alegra_payment_id) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          message: 'El pago ya fue sincronizado',
          alegra_payment_id: invoice.alegra_payment_id
        });
      }

      // 2) Leer la cuenta bancaria
      const { data: bank, error: bankErr } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('id', invoice.paid_bank_id)
        .single();

      if (bankErr || !bank) {
        return res.status(400).json({
          ok: false,
          error: 'Cuenta bancaria no encontrada en bank_accounts'
        });
      }

      const paymentMethod = bank.alegra_payment_method || 'transfer';

      if (!bank.alegra_account_id) {
        return res.status(400).json({
          ok: false,
          error: 'La cuenta bancaria no tiene alegra_account_id configurado'
        });
      }

      // 3) Fecha
      const paidDate = toDateOnly(invoice.paid_date) || new Date().toISOString().slice(0, 10);

      // 4) Armar payload
      const observations = invoice.paid_reference ? `TR ${invoice.paid_reference}` : '';

      const paymentPayload = {
        type: 'out',
        date: paidDate,
        amount: parseFloat(invoice.total),
        paymentMethod: paymentMethod,
        bankAccount: { id: String(bank.alegra_account_id) },
        observations,
        anotation: observations,
        bills: [
          {
            id: parseInt(invoice.alegra_bill_id),
            amount: parseFloat(invoice.total)
          }
        ]
      };

      if (invoice.currency && invoice.currency !== 'CRC') {
        const rate = invoice.exchange_rate && parseFloat(invoice.exchange_rate) > 0
          ? parseFloat(invoice.exchange_rate)
          : 1;
        paymentPayload.currency = {
          code: invoice.currency,
          exchangeRate: rate
        };
      }

      // 5) POST /payments a Alegra
      const resp = await fetch(`${ALEGRA_BASE}/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentPayload)
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        await supabase.from('invoices')
          .update({
            alegra_sync_error: JSON.stringify(data).slice(0, 500)
          })
          .eq('id', invoice_id);

        return res.status(502).json({
          ok: false,
          step: 'create_payment',
          error: data,
          payload: paymentPayload
        });
      }

      // 6) Guardar alegra_payment_id
      await supabase.from('invoices')
        .update({
          alegra_payment_id: data.id,
          alegra_payment_synced_at: new Date().toISOString(),
          alegra_sync_error: null
        })
        .eq('id', invoice_id);

      return res.status(200).json({
        ok: true,
        alegra_payment_id: data.id,
        alegra_bill_id: invoice.alegra_bill_id,
        bank_used: bank.name,
        payment_method: paymentMethod,
        amount: invoice.total,
        sent_payload: paymentPayload
      });

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}
