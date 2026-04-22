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

function formatPlate(plate) {
  if (!plate) return '';
  const cleaned = String(plate).trim().toUpperCase().replace(/[-\s]/g, '');
  if (cleaned.startsWith('CL')) return `CL-${cleaned.slice(2)}`;
  return cleaned;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST.' });
  }

  const { invoice_id, vehicle_id, payroll_id } = req.body || {};
  const type = req.query.type || 'bill'; // 'bill' | 'payment' | 'vehicle' | 'journal' | 'list-accounts'

  if (type === 'vehicle') {
    if (!vehicle_id) return res.status(400).json({ ok: false, error: 'Falta vehicle_id en el body' });
  } else if (type === 'journal') {
    if (!payroll_id) return res.status(400).json({ ok: false, error: 'Falta payroll_id en el body' });
  } else if (type === 'list-accounts') {
    // no requiere body
  } else {
    if (!invoice_id) return res.status(400).json({ ok: false, error: 'Falta invoice_id en el body' });
  }

  if (type !== 'bill' && type !== 'payment' && type !== 'vehicle' && type !== 'journal' && type !== 'list-accounts') {
    return res.status(400).json({ ok: false, error: 'type debe ser "bill", "payment", "vehicle", "journal" o "list-accounts"' });
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

  // ============================================================
  // VEHICLE: Sincronizar vehiculo de Supabase hacia Alegra como item
  // ============================================================
  if (type === 'vehicle') {
    try {
      const { data: vehicle, error: vErr } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicle_id)
        .single();

      if (vErr || !vehicle) {
        return res.status(404).json({ ok: false, error: 'Vehiculo no encontrado' });
      }

      // Idempotencia
      if (vehicle.alegra_item_id) {
        return res.status(200).json({
          ok: true,
          already_synced: true,
          alegra_item_id: vehicle.alegra_item_id,
          message: 'Vehiculo ya sincronizado con Alegra',
        });
      }

      // Calcular precio en CRC (moneda por default de Alegra CR)
      const tc = parseFloat(vehicle.exchange_rate) || 500;
      let priceCRC = 0;
      if (vehicle.price_crc && parseFloat(vehicle.price_crc) > 0) {
        priceCRC = Math.round(parseFloat(vehicle.price_crc));
      } else if (vehicle.price_usd && parseFloat(vehicle.price_usd) > 0) {
        priceCRC = Math.round(parseFloat(vehicle.price_usd) * tc);
      }

      let costCRC = 0;
      if (vehicle.purchase_cost) {
        costCRC = Math.round(parseFloat(vehicle.purchase_cost));
      }

      // Armar item
      const plateFormatted = formatPlate(vehicle.plate);
      const marca = (vehicle.brand || '').toUpperCase();
      const modelo = (vehicle.model || '').toUpperCase();
      const anio = vehicle.year || '';
      const itemName = `${marca} ${modelo} ${anio} ${plateFormatted}`.trim().replace(/\s+/g, ' ').slice(0, 100);

      const parts = [];
      if (vehicle.brand && vehicle.model) parts.push(`${vehicle.brand} ${vehicle.model}`);
      if (vehicle.style) parts.push(vehicle.style);
      if (vehicle.year) parts.push(`AÑO ${vehicle.year}`);
      if (vehicle.color) parts.push(`COLOR ${vehicle.color}`);
      if (vehicle.engine_cc) parts.push(`${vehicle.engine_cc} CC`);
      if (vehicle.drivetrain) parts.push(vehicle.drivetrain);
      if (vehicle.fuel) parts.push(vehicle.fuel);
      if (plateFormatted) parts.push(`PLACA ${plateFormatted}`);
      if (vehicle.chassis) parts.push(`SERIE ${vehicle.chassis}`);
      if (vehicle.km) parts.push(`${Number(vehicle.km).toLocaleString('es-CR')} KM`);
      const description = parts.join(', ').slice(0, 500);

      const PRICE_LIST_ID = '01983f21-0f79-737f-85df-988548dcbc02';
      const CATEGORY_ID = 5135;

      const payload = {
        name: itemName,
        description,
        category: { id: CATEGORY_ID },
        price: [{ idPriceList: PRICE_LIST_ID, price: priceCRC }],
        inventory: {
          unit: 'unit',
          unitCost: costCRC,
          initialQuantity: 1,
          warehouses: [{ id: 1, initialQuantity: 1 }],
        },
        productKey: vehicle.cabys_code || '4911404000000',
        type: 'product',
        status: 'active',
      };

      const createRes = await alegraFetch('/items', { method: 'POST', body: JSON.stringify(payload) });
      if (!createRes.ok) {
        return res.status(502).json({ ok: false, step: 'create_item', error: createRes.data, payload });
      }

      await supabase
        .from('vehicles')
        .update({ alegra_item_id: String(createRes.data.id) })
        .eq('id', vehicle_id);

      return res.status(200).json({
        ok: true,
        alegra_item_id: createRes.data.id,
        plate: plateFormatted,
        message: 'Vehiculo sincronizado con Alegra',
      });

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ============================================================
  // JOURNAL: Crear asiento contable desde una planilla
  // POST /api/alegra-sync?type=journal
  // Body: { payroll_id: "uuid" }
  // ============================================================
  if (type === 'journal') {
    try {
      // 1) Leer planilla
      const { data: payroll, error: pErr } = await supabase
        .from('payrolls')
        .select('*')
        .eq('id', payroll_id)
        .single();

      if (pErr || !payroll) {
        return res.status(404).json({ ok: false, error: 'Planilla no encontrada' });
      }

      if (payroll.alegra_journal_id) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          message: 'Asiento ya fue enviado a Alegra',
          alegra_journal_id: payroll.alegra_journal_id,
        });
      }

      if (payroll.status !== 'confirmed' && payroll.status !== 'paid') {
        return res.status(400).json({ ok: false, error: 'La planilla debe estar confirmada o pagada' });
      }

      if (payroll.period_type !== 'mensual') {
        return res.status(400).json({
          ok: false,
          error: 'Solo las planillas mensuales generan asiento contable',
          hint: 'Las quincenales pagan a empleados pero el asiento se genera al cierre mensual'
        });
      }

      // 2) Leer lineas
      const { data: lines, error: lErr } = await supabase
        .from('payroll_lines')
        .select('*')
        .eq('payroll_id', payroll_id);

      if (lErr || !lines || lines.length === 0) {
        return res.status(400).json({ ok: false, error: 'Planilla sin lineas de empleados' });
      }

      // 2b) Leer agents para mapear agent_id -> alegra_contact_id
      const { data: agentsData } = await supabase
        .from('agents')
        .select('id, name, alegra_contact_id');
      const agentContactMap = {};
      (agentsData || []).forEach(a => {
        if (a.alegra_contact_id) agentContactMap[a.id] = a.alegra_contact_id;
      });

      // 3) Leer accounting_config (mapeo conceptos -> alegra account id)
      const { data: accounts, error: aErr } = await supabase
        .from('accounting_config')
        .select('*');

      if (aErr || !accounts) {
        return res.status(500).json({ ok: false, error: 'No se pudo leer accounting_config' });
      }

      const accMap = {};
      accounts.forEach(a => { accMap[a.concept] = a.alegra_account_id; });

      // Validar que todas las cuentas requeridas esten mapeadas
      const requiredConcepts = [
        'sueldos_gasto', 'comisiones_gasto', 'cargas_sociales_gasto', 'aguinaldos_gasto',
        'sueldos_por_pagar', 'cargas_sociales_por_pagar', 'retencion_isr_empleados',
        'aguinaldos_por_pagar'
      ];
      if (parseFloat(payroll.total_dietas || 0) > 0) {
        requiredConcepts.push('dietas_gasto', 'dietas_por_pagar', 'retencion_dietas_por_pagar');
      }

      const missing = requiredConcepts.filter(c => !accMap[c]);
      if (missing.length > 0) {
        return res.status(400).json({
          ok: false,
          error: 'Faltan cuentas contables por configurar en Settings',
          missing_concepts: missing,
          hint: 'Ir a Settings -> Cuentas Contables y completar los IDs de Alegra'
        });
      }

      // 4) Calcular totales por concepto
      const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

      // Por empleado: CONSOLIDAR todas las líneas del mismo agent_id en una sola
      // (si una planilla tiene 2 quincenas para el mismo empleado, se suman)
      const agentSummary = {};
      for (const l of lines) {
        const key = l.agent_id;
        if (!agentSummary[key]) {
          agentSummary[key] = {
            agent_id: l.agent_id,
            name: l.agent_name,
            salary: 0,
            commissions: 0,
            aguinaldo: 0,
            net_pay: 0,
            rent: 0,
            ccss_obrero: 0,
            alegra_contact_id: agentContactMap[l.agent_id] || null,
          };
        }
        agentSummary[key].salary += parseFloat(l.salary || 0);
        agentSummary[key].commissions += parseFloat(l.commissions || 0);
        agentSummary[key].aguinaldo += parseFloat(l.aguinaldo_amount || 0);
        agentSummary[key].net_pay += parseFloat(l.net_pay || 0);
        agentSummary[key].rent += parseFloat(l.rent_amount || 0);
        agentSummary[key].ccss_obrero += parseFloat(l.ccss_amount || 0);
      }
      const empleadosData = Object.values(agentSummary);

      const totalCCSSObrero = lines.reduce((s, l) => s + parseFloat(l.ccss_amount || 0), 0);
      const totalCCSSPatronal = lines.reduce((s, l) => s + parseFloat(l.employer_charges_amount || 0), 0);
      const totalCCSSTotal = totalCCSSObrero + totalCCSSPatronal;
      const totalDietas = parseFloat(payroll.total_dietas || 0);
      const totalDietasRet = parseFloat(payroll.total_dietas_retencion || 0);
      // Desglose dietas por director (del snapshot guardado al confirmar)
      const directorsSnapshot = Array.isArray(payroll.directors_snapshot) ? payroll.directors_snapshot : [];

      // Helper para agregar contacto/tercero a la entry.
      // Alegra acepta el campo 'client' a nivel entry. Mando también 'thirdParty' por compatibilidad.
      const withThirdParty = (contactId) => {
        if (!contactId) return {};
        return {
          client: contactId,
          thirdParty: { id: contactId }
        };
      };

      // 5) Armar entries del asiento
      const entries = [];

      // ============ DEBITOS ============
      // Sueldos desglosados por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.salary > 0) {
          entries.push({
            account: { id: accMap.sueldos_gasto },
            type: 'debit',
            amount: r2(emp.salary),
            observations: `Sueldo ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // Comisiones desglosadas por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.commissions > 0) {
          entries.push({
            account: { id: accMap.comisiones_gasto },
            type: 'debit',
            amount: r2(emp.commissions),
            observations: `Comisión ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // Dietas desglosadas por director (con tercero)
      for (const d of directorsSnapshot) {
        const amount = parseFloat(d.dieta_monthly || 0);
        if (amount > 0) {
          entries.push({
            account: { id: accMap.dietas_gasto },
            type: 'debit',
            amount: r2(amount),
            observations: `Dieta ${d.name} - ${payroll.name}`,
            ...withThirdParty(d.alegra_contact_id)
          });
        }
      }

      // Cargas Sociales: SOLO lo patronal (el obrero es retención del empleado, no gasto)
      // Sin tercero porque es un gasto global de la empresa
      if (totalCCSSPatronal > 0) {
        entries.push({
          account: { id: accMap.cargas_sociales_gasto },
          type: 'debit',
          amount: r2(totalCCSSPatronal),
          observations: 'Cargas sociales patronales ' + payroll.name
        });
      }

      // Aguinaldo desglosado por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.aguinaldo > 0) {
          entries.push({
            account: { id: accMap.aguinaldos_gasto },
            type: 'debit',
            amount: r2(emp.aguinaldo),
            observations: `Aguinaldo ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // ============ CREDITOS ============
      // Sueldos por Pagar desglosados por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.net_pay > 0) {
          entries.push({
            account: { id: accMap.sueldos_por_pagar },
            type: 'credit',
            amount: r2(emp.net_pay),
            observations: `Sueldo por pagar ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // CCSS por pagar: obrero + patronal juntos (sin tercero)
      if (totalCCSSTotal > 0) {
        entries.push({
          account: { id: accMap.cargas_sociales_por_pagar },
          type: 'credit',
          amount: r2(totalCCSSTotal),
          observations: 'Cargas sociales por pagar ' + payroll.name
        });
      }

      // Retención ISR desglosada por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.rent > 0) {
          entries.push({
            account: { id: accMap.retencion_isr_empleados },
            type: 'credit',
            amount: r2(emp.rent),
            observations: `Retención ISR ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // Dietas por Pagar desglosadas por director (neto = dieta - retención)
      const dietaRetPct = parseFloat(payroll.total_dietas_retencion || 0) / (totalDietas || 1);
      for (const d of directorsSnapshot) {
        const dietaAmount = parseFloat(d.dieta_monthly || 0);
        if (dietaAmount > 0) {
          const dietaNet = r2(dietaAmount * (1 - dietaRetPct));
          entries.push({
            account: { id: accMap.dietas_por_pagar },
            type: 'credit',
            amount: dietaNet,
            observations: `Dieta por pagar ${d.name} - ${payroll.name}`,
            ...withThirdParty(d.alegra_contact_id)
          });
        }
      }

      // Retención DIETAS: total (sin tercero - es retención a Hacienda)
      if (totalDietasRet > 0) {
        entries.push({
          account: { id: accMap.retencion_dietas_por_pagar },
          type: 'credit',
          amount: r2(totalDietasRet),
          observations: 'Retención dietas ' + payroll.name
        });
      }

      // Aguinaldo por pagar desglosado por empleado (con tercero)
      for (const emp of empleadosData) {
        if (emp.aguinaldo > 0) {
          entries.push({
            account: { id: accMap.aguinaldos_por_pagar },
            type: 'credit',
            amount: r2(emp.aguinaldo),
            observations: `Aguinaldo por pagar ${emp.name} - ${payroll.name}`,
            ...withThirdParty(emp.alegra_contact_id)
          });
        }
      }

      // 6) Validar balance
      const totalDebit = entries.filter(e => e.type === 'debit').reduce((s, e) => s + e.amount, 0);
      const totalCredit = entries.filter(e => e.type === 'credit').reduce((s, e) => s + e.amount, 0);
      if (Math.abs(r2(totalDebit) - r2(totalCredit)) > 0.02) {
        return res.status(400).json({
          ok: false,
          error: 'Asiento descuadrado',
          total_debit: r2(totalDebit),
          total_credit: r2(totalCredit),
          diferencia: r2(totalDebit - totalCredit),
        });
      }

      // 7) POST a Alegra
      // Formato correcto de Alegra para journals:
      // { date, observations, entries: [{ id, debit, credit, observations, thirdParty }] }
      // donde 'id' es el account id (no accountId)
      const today = new Date().toISOString().slice(0, 10);
      const entriesForAlegra = entries.map(e => {
        const entry = {
          id: e.account.id,
          observations: e.observations || '',
        };
        if (e.type === 'debit') entry.debit = e.amount;
        else entry.credit = e.amount;
        // Alegra acepta 'client' (ID directo) por entry para poblar la columna Contacto
        if (e.client) entry.client = e.client;
        // También mandamos thirdParty por compatibilidad con formato alternativo
        if (e.thirdParty) entry.thirdParty = e.thirdParty;
        return entry;
      });

      const journalPayload = {
        date: today,
        observations: `Planilla ${payroll.name} - VCR Manager`,
        entries: entriesForAlegra,
        // Sin numberTemplate: Alegra usará la numeración default configurada en la cuenta
      };

      const journalRes = await alegraFetch('/journals', {
        method: 'POST',
        body: JSON.stringify(journalPayload),
      });

      if (!journalRes.ok) {
        return res.status(502).json({
          ok: false,
          error: 'Error creando journal en Alegra',
          alegra_response: journalRes.data,
          payload_sent: journalPayload,
        });
      }

      const alegraJournalId = journalRes.data.id;

      // 8) Guardar referencia
      await supabase
        .from('payrolls')
        .update({
          alegra_journal_id: alegraJournalId,
          alegra_journal_at: new Date().toISOString(),
        })
        .eq('id', payroll_id);

      return res.status(200).json({
        ok: true,
        alegra_journal_id: alegraJournalId,
        total_debit: r2(totalDebit),
        total_credit: r2(totalCredit),
        entries_count: entries.length,
      });

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // ============================================================
  // LIST-ACCOUNTS: Busca cuentas contables en Alegra por nombre
  // y sugiere mapeo con accounting_config
  // POST /api/alegra-sync?type=list-accounts
  // Retorna { matches: [{ concept, suggestions: [{id, name}] }] }
  // ============================================================
  if (type === 'list-accounts') {
    try {
      // Leer TODAS las cuentas contables de Alegra (paginadas)
      const allAccounts = [];
      let start = 0;
      const limit = 30;

      while (true) {
        const res = await alegraFetch(`/categories/accounting?start=${start}&limit=${limit}`);
        if (!res.ok) {
          return res.status(502).json({
            ok: false,
            error: 'Error obteniendo cuentas de Alegra',
            alegra_response: res.data
          });
        }
        const batch = Array.isArray(res.data) ? res.data : (res.data.data || []);
        if (batch.length === 0) break;
        allAccounts.push(...batch);
        if (batch.length < limit) break;
        start += limit;
        if (start > 5000) break; // seguridad para no hacer loop infinito
      }

      // Aplanar la jerarquia (las cuentas tienen subaccounts)
      const flatAccounts = [];
      function flatten(accounts) {
        for (const a of accounts) {
          flatAccounts.push({ id: a.id, name: a.name, type: a.type, parentId: a.parentId });
          if (Array.isArray(a.children) && a.children.length > 0) flatten(a.children);
          if (Array.isArray(a.subaccounts) && a.subaccounts.length > 0) flatten(a.subaccounts);
        }
      }
      flatten(allAccounts);

      // Leer conceptos de accounting_config
      const { data: config, error: cErr } = await supabase
        .from('accounting_config')
        .select('*')
        .order('id');

      if (cErr) {
        return res.status(500).json({ ok: false, error: 'Error leyendo accounting_config' });
      }

      // Para cada concepto, buscar coincidencias por nombre
      const normalize = (s) => (s || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
        .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

      // Keywords por cada concepto (en orden de prioridad)
      const conceptKeywords = {
        'sueldos_gasto': ['sueldos', 'salarios'],
        'comisiones_gasto': ['comisiones'],
        'dietas_gasto': ['dietas directores', 'dietas a directores', 'dietas'],
        'cargas_sociales_gasto': ['cargas sociales'],
        'aguinaldos_gasto': ['aguinaldos', 'aguinaldo'],
        'sueldos_por_pagar': ['sueldos por pagar'],
        'cargas_sociales_por_pagar': ['cargas sociales por pagar'],
        'retencion_isr_empleados': ['retencion isr', 'retencion de isr', 'retencion renta empleados', 'retencion isr empleados'],
        'dietas_por_pagar': ['dietas por pagar'],
        'retencion_dietas_por_pagar': ['retencion dietas', 'retencion de dietas'],
        'aguinaldos_por_pagar': ['aguinaldos por pagar']
      };

      const matches = (config || []).map(c => {
        const keywords = conceptKeywords[c.concept] || [c.account_name];
        const candidates = [];

        for (const kw of keywords) {
          const kwNorm = normalize(kw);
          for (const acc of flatAccounts) {
            const accNorm = normalize(acc.name);
            if (accNorm.includes(kwNorm)) {
              // Evitar duplicados
              if (!candidates.find(x => x.id === acc.id)) {
                candidates.push({
                  id: acc.id,
                  name: acc.name,
                  score: kwNorm.length / accNorm.length // score por similitud
                });
              }
            }
          }
          if (candidates.length > 0) break; // con el primer keyword que matchee ya basta
        }

        // Ordenar por score (mejor match primero)
        candidates.sort((a, b) => b.score - a.score);

        return {
          concept: c.concept,
          account_name: c.account_name,
          current_alegra_id: c.alegra_account_id,
          suggestions: candidates.slice(0, 5).map(({id, name}) => ({id, name})),
        };
      });

      return res.status(200).json({
        ok: true,
        total_alegra_accounts: flatAccounts.length,
        matches,
      });

    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
}
