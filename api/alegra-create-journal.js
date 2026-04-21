// alegra-create-journal.js
// Crea un asiento contable en Alegra para una planilla.
// POST /api/alegra-create-journal
// Body: { payroll_id: "uuid" }
//
// Prerequisitos:
// - La planilla debe estar confirmed o paid
// - La planilla NO debe tener alegra_journal_id todavia (idempotencia)
// - Todas las cuentas contables en accounting_config deben estar mapeadas
//
// Flujo:
// 1. Lee payroll, payroll_lines, accounting_config
// 2. Arma el asiento con debitos y creditos
// 3. Valida que debitos = creditos
// 4. POST /journals en Alegra
// 5. Guarda alegra_journal_id en payrolls

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

async function alegraFetch(path, opts = {}) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
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
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { payroll_id } = req.body || {};
  if (!payroll_id) {
    return res.status(400).json({ ok: false, error: 'Falta payroll_id' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

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

    // 2) Leer lineas
    const { data: lines, error: lErr } = await supabase
      .from('payroll_lines')
      .select('*')
      .eq('payroll_id', payroll_id);

    if (lErr || !lines || lines.length === 0) {
      return res.status(400).json({ ok: false, error: 'Planilla sin lineas de empleados' });
    }

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
    // Dietas solo si hay dietas
    if (payroll.total_dietas > 0) {
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
    const totalSueldos = lines.reduce((s, l) => s + parseFloat(l.salary || 0), 0);
    const totalComisiones = lines.reduce((s, l) => s + parseFloat(l.commissions || 0), 0);
    const totalCargasSociales = lines.reduce((s, l) =>
      s + parseFloat(l.ccss_amount || 0) + parseFloat(l.employer_charges_amount || 0), 0);
    const totalCargasSocialesPagar = totalCargasSociales;
    const totalRetencionISR = lines.reduce((s, l) => s + parseFloat(l.rent_amount || 0), 0);
    const totalSueldosPorPagar = lines.reduce((s, l) => s + parseFloat(l.net_pay || 0), 0);
    const totalAguinaldos = lines.reduce((s, l) => s + parseFloat(l.aguinaldo_amount || 0), 0);
    const totalDietas = parseFloat(payroll.total_dietas || 0);
    const totalDietasRet = parseFloat(payroll.total_dietas_retencion || 0);
    const totalDietasNeto = parseFloat(payroll.total_dietas_neto || 0);

    // 5) Armar entries (lineas del asiento)
    const entries = [];
    const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    // DEBITOS (gastos)
    if (totalSueldos > 0) {
      entries.push({
        account: { id: accMap.sueldos_gasto },
        type: 'debit',
        amount: r2(totalSueldos),
        observations: 'Sueldos planilla ' + payroll.name,
      });
    }
    if (totalComisiones > 0) {
      entries.push({
        account: { id: accMap.comisiones_gasto },
        type: 'debit',
        amount: r2(totalComisiones),
        observations: 'Comisiones planilla ' + payroll.name,
      });
    }
    if (totalDietas > 0) {
      entries.push({
        account: { id: accMap.dietas_gasto },
        type: 'debit',
        amount: r2(totalDietas),
        observations: 'Dietas a Directores ' + payroll.name,
      });
    }
    if (totalCargasSociales > 0) {
      entries.push({
        account: { id: accMap.cargas_sociales_gasto },
        type: 'debit',
        amount: r2(totalCargasSociales),
        observations: 'Cargas sociales (obrero + patronal) ' + payroll.name,
      });
    }
    if (totalAguinaldos > 0) {
      entries.push({
        account: { id: accMap.aguinaldos_gasto },
        type: 'debit',
        amount: r2(totalAguinaldos),
        observations: 'Provisión aguinaldo ' + payroll.name,
      });
    }

    // CREDITOS (pasivos)
    if (totalSueldosPorPagar > 0) {
      entries.push({
        account: { id: accMap.sueldos_por_pagar },
        type: 'credit',
        amount: r2(totalSueldosPorPagar),
        observations: 'Sueldos por pagar ' + payroll.name,
      });
    }
    if (totalCargasSocialesPagar > 0) {
      entries.push({
        account: { id: accMap.cargas_sociales_por_pagar },
        type: 'credit',
        amount: r2(totalCargasSocialesPagar),
        observations: 'Cargas sociales por pagar ' + payroll.name,
      });
    }
    if (totalRetencionISR > 0) {
      entries.push({
        account: { id: accMap.retencion_isr_empleados },
        type: 'credit',
        amount: r2(totalRetencionISR),
        observations: 'Retención ISR empleados ' + payroll.name,
      });
    }
    if (totalDietasNeto > 0) {
      entries.push({
        account: { id: accMap.dietas_por_pagar },
        type: 'credit',
        amount: r2(totalDietasNeto),
        observations: 'Dietas por pagar ' + payroll.name,
      });
    }
    if (totalDietasRet > 0) {
      entries.push({
        account: { id: accMap.retencion_dietas_por_pagar },
        type: 'credit',
        amount: r2(totalDietasRet),
        observations: 'Retención DIETAS ' + payroll.name,
      });
    }
    if (totalAguinaldos > 0) {
      entries.push({
        account: { id: accMap.aguinaldos_por_pagar },
        type: 'credit',
        amount: r2(totalAguinaldos),
        observations: 'Aguinaldos por pagar ' + payroll.name,
      });
    }

    // 6) Validar que debitos = creditos
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
    const today = new Date().toISOString().slice(0, 10);
    const journalPayload = {
      date: today,
      observations: `Planilla ${payroll.name} - VCR Manager`,
      items: entries,
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

    // 8) Guardar referencia en Supabase
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
    console.error('alegra-create-journal error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
