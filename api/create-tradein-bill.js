// create-tradein-bill.js
// Crea una factura de COMPRA (bill) en Alegra cuando se recibe un trade-in
//
// Flujo:
// 1. Busca/crea al cliente tambien como proveedor en Alegra
// 2. Crea el bill en Alegra con numero CM-XXXX
// 3. Usa como monto: tradein_value × TC_BCCR
//
// POST /api/create-tradein-bill
// Body: { sale_id: "uuid" }

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

// Obtener TC del BCCR (el mismo que Alegra usa)
async function getTipoCambio() {
  try {
    const response = await fetch('https://tipodecambio.paginasweb.cr/api', {
      headers: { 'Accept': 'application/json' },
    });
    const data = await response.json();
    const venta = parseFloat(data.venta);
    if (venta && venta > 0) return venta;
    return null;
  } catch {
    return null;
  }
}

async function alegraFetch(endpoint, method = 'GET', body = null) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${ALEGRA_BASE}${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Alegra ${endpoint}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Formatear placa a VCR
function formatPlate(plate) {
  if (!plate) return '';
  const cleaned = String(plate).trim().toUpperCase().replace(/[-\s]/g, '');
  if (cleaned.startsWith('CL')) return `CL-${cleaned.slice(2)}`;
  return cleaned;
}

// Asegurar que el contact en Alegra es tanto cliente como proveedor
async function ensureContactIsProvider(alegraClientId) {
  if (!alegraClientId) return null;

  // 1. Traer el contact actual
  const contact = await alegraFetch(`/contacts/${alegraClientId}`);

  // 2. Verificar el type actual
  const currentType = contact.type || [];
  const typeArray = Array.isArray(currentType) ? currentType : [currentType];

  // 3. Si ya es proveedor, no hacer nada
  if (typeArray.includes('provider')) {
    return alegraClientId;
  }

  // 4. Agregar 'provider' al type
  // Alegra PUT requiere campos obligatorios completos
  const newType = [...new Set([...typeArray, 'client', 'provider'])];

  const updatePayload = {
    name: contact.name,
    type: newType,
  };

  // Incluir identification si existe
  if (contact.identificationObject) {
    updatePayload.identificationObject = contact.identificationObject;
  } else if (contact.identification) {
    updatePayload.identification = contact.identification;
  }

  await alegraFetch(`/contacts/${alegraClientId}`, 'PUT', updatePayload);

  return alegraClientId;
}

// Extraer los ultimos 4 digitos del numero de factura de venta
function extractLast4(invoiceNumber) {
  if (!invoiceNumber) return null;
  const digits = String(invoiceNumber).replace(/\D/g, '');
  return digits.slice(-4);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sale_id } = req.body || {};
  if (!sale_id) {
    return res.status(400).json({ ok: false, error: 'sale_id es requerido' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // 1. Traer la venta
    const { data: sale, error: saleErr } = await supabase
      .from('sales')
      .select('*')
      .eq('id', sale_id)
      .single();

    if (saleErr || !sale) {
      return res.status(404).json({ ok: false, error: 'Venta no encontrada' });
    }

    // 2. Validar trade-in
    if (!sale.has_tradein) {
      return res.status(200).json({ ok: true, skipped: true, message: 'Sin trade-in, no hay factura de compra' });
    }

    if (!sale.alegra_client_id) {
      return res.status(400).json({ ok: false, error: 'La venta no tiene alegra_client_id. Emiti primero la factura de venta.' });
    }

    if (sale.alegra_bill_id) {
      return res.status(200).json({
        ok: true,
        already_created: true,
        alegra_bill_id: sale.alegra_bill_id,
        message: 'La factura de compra ya fue creada',
      });
    }

    // 3. Obtener TC del BCCR
    let tc = await getTipoCambio();
    if (!tc) {
      tc = parseFloat(sale.sale_exchange_rate) || 0;
    }
    if (!tc || tc <= 0) {
      return res.status(400).json({ ok: false, error: 'No se pudo obtener tipo de cambio' });
    }

    // 4. Asegurar que el cliente sea tambien proveedor
    await ensureContactIsProvider(sale.alegra_client_id);

    // 5. Traer info de la factura de venta para numero CM-XXXX
    let invoiceNumber = null;
    try {
      const invoice = await alegraFetch(`/invoices/${sale.alegra_invoice_id}`);
      // numberTemplate.fullNumber o numberTemplate.number
      invoiceNumber = invoice.numberTemplate?.fullNumber
        || invoice.numberTemplate?.number
        || invoice.number
        || String(sale.alegra_invoice_id);
    } catch (e) {
      invoiceNumber = String(sale.alegra_invoice_id);
    }

    const last4 = extractLast4(invoiceNumber) || String(sale.alegra_invoice_id).slice(-4);
    const billNumber = `CM-${last4}`;

    // 6. Construir datos del item del trade-in para el bill
    const plateFormatted = formatPlate(sale.tradein_plate);
    const marca = (sale.tradein_brand || '').toUpperCase();
    const modelo = (sale.tradein_model || '').toUpperCase();
    const anio = sale.tradein_year || '';
    const itemName = `${marca} ${modelo} ${anio} ${plateFormatted}`.trim().replace(/\s+/g, ' ');

    // Descripcion
    const descParts = [];
    if (sale.tradein_brand && sale.tradein_model) descParts.push(`${sale.tradein_brand} ${sale.tradein_model}`);
    if (sale.tradein_style) descParts.push(sale.tradein_style);
    if (sale.tradein_year) descParts.push(`AÑO ${sale.tradein_year}`);
    if (sale.tradein_color) descParts.push(`COLOR ${sale.tradein_color}`);
    if (sale.tradein_engine_cc) descParts.push(`${sale.tradein_engine_cc} CC`);
    if (sale.tradein_drive) descParts.push(sale.tradein_drive);
    if (sale.tradein_fuel) descParts.push(sale.tradein_fuel);
    if (plateFormatted) descParts.push(`PLACA ${plateFormatted}`);
    if (sale.tradein_chassis) descParts.push(`SERIE ${sale.tradein_chassis}`);
    if (sale.tradein_km) descParts.push(`${Number(sale.tradein_km).toLocaleString('es-CR')} KM`);
    const description = descParts.join(', ').slice(0, 500);

    // 7. Calcular monto: tradein_value × TC (si venta es USD)
    let tradeinPriceCRC = parseFloat(sale.tradein_value) || 0;
    if (sale.sale_currency === 'USD') {
      tradeinPriceCRC = Math.round(tradeinPriceCRC * tc);
    } else {
      tradeinPriceCRC = Math.round(tradeinPriceCRC);
    }

    // 8. Fecha
    const today = new Date().toISOString().split('T')[0];

    // 9. Buscar el alegra_item_id del vehiculo recien creado
    // (create-tradein-vehicle ya lo creo como item en Alegra)
    let alegraItemId = null;
    try {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('alegra_item_id')
        .eq('plate', plateFormatted)
        .maybeSingle();
      alegraItemId = vehicle?.alegra_item_id;
    } catch {}

    // 10. Construir payload del bill
    // Si tenemos alegra_item_id, enlazamos al item. Si no, creamos inline.
    const itemPayload = {
      price: tradeinPriceCRC,
      quantity: 1,
      tax: [], // IVA exento (array vacio)
      observations: description.slice(0, 500),
    };

    if (alegraItemId) {
      // Enlazar al item existente
      itemPayload.id = Number(alegraItemId);
    } else {
      // Fallback: crear item inline en el bill
      itemPayload.name = itemName;
      itemPayload.description = description.slice(0, 500);
      itemPayload.productKey = sale.tradein_cabys || '4911404000000';
    }

    const billPayload = {
      date: today,
      dueDate: today,
      provider: { id: Number(sale.alegra_client_id) },
      billNumber: billNumber,
      observations: `Compra de vehiculo recibido como trade-in. Factura de venta relacionada: ${invoiceNumber}.`,
      stamp: { generateStamp: false }, // NO timbrar (borrador)
      currency: { code: 'CRC', exchangeRate: 1 },
      purchases: {
        items: [itemPayload],
      },
    };

    // 10. Crear el bill
    const bill = await alegraFetch('/bills', 'POST', billPayload);

    // 11. Guardar el bill_id en la venta
    await supabase
      .from('sales')
      .update({
        alegra_bill_id: String(bill.id),
        alegra_bill_number: billNumber,
        tc_alegra_used: tc, // Guardar el TC que se uso
      })
      .eq('id', sale_id);

    return res.status(200).json({
      ok: true,
      alegra_bill_id: bill.id,
      bill_number: billNumber,
      amount_crc: tradeinPriceCRC,
      tc_used: tc,
      invoice_number: invoiceNumber,
      message: `Factura de compra ${billNumber} creada en Alegra`,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
