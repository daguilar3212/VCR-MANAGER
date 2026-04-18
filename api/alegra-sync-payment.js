// Sincroniza el pago de una factura VCR hacia Alegra.
// POST /api/alegra-sync-payment
// Body: { invoice_id: "uuid" }
//
// Prerequisitos (validados):
// - La factura tiene alegra_bill_id (ya esta creada la bill en Alegra)
// - La factura esta marcada como pagada (pay_status='paid')
// - Tiene paid_bank_id seleccionado
// - NO tiene alegra_payment_id todavia (idempotencia)
//
// Flujo:
// 1. Lee factura y valida prerequisitos
// 2. Lee la cuenta bancaria de bank_accounts (para saber payment_method)
// 3. POST /payments a Alegra con el bill vinculado
// 4. Guarda alegra_payment_id en Supabase

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { invoice_id } = req.body || {};
  if (!invoice_id) {
    return res.status(400).json({ ok: false, error: 'Falta invoice_id' });
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
    // Idempotencia: si ya tiene payment_id, no duplicar
    if (invoice.alegra_payment_id) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        message: 'El pago ya fue sincronizado',
        alegra_payment_id: invoice.alegra_payment_id
      });
    }

    // 2) Leer la cuenta bancaria para saber el payment_method
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

    // Validar que la cuenta tenga el campo alegra_payment_method
    // (cash / transfer / creditCard)
    const paymentMethod = bank.alegra_payment_method || 'transfer';

    // IMPORTANTE: bank.id es UUID de Supabase. El ID real de la cuenta en Alegra
    // esta en bank.alegra_account_id (1-9).
    if (!bank.alegra_account_id) {
      return res.status(400).json({
        ok: false,
        error: 'La cuenta bancaria no tiene alegra_account_id configurado'
      });
    }

    // 3) Fecha: usar paid_date si existe, sino hoy
    const toDateOnly = (d) => {
      if (!d) return null;
      const s = String(d);
      return s.length > 10 ? s.slice(0, 10) : s;
    };
    const paidDate = toDateOnly(invoice.paid_date) || new Date().toISOString().slice(0, 10);

    // 4) Armar payload del pago
    // Observaciones: "TR <referencia>" como hace la contadora
    const observations = invoice.paid_reference ? `TR ${invoice.paid_reference}` : '';

    const paymentPayload = {
      type: 'out',  // 'out' = pago a proveedor (egreso)
      date: paidDate,
      amount: parseFloat(invoice.total),
      paymentMethod: paymentMethod,
      bankAccount: { id: String(bank.alegra_account_id) },  // ID numerico de Alegra, NO el UUID
      observations,
      anotation: observations,
      bills: [
        {
          id: parseInt(invoice.alegra_bill_id),
          amount: parseFloat(invoice.total)
        }
      ]
    };

    // Si moneda no es CRC, agregar currency
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
      // Guardar error para mostrarlo
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

    // 6) Guardar alegra_payment_id en Supabase
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
