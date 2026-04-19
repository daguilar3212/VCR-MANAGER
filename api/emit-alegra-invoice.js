// emit-alegra-invoice.js
// Emite factura o tiquete en Alegra como BORRADOR
//
// POST /api/emit-alegra-invoice
// Body: { sale_id: "uuid" }
//
// Flujo:
// 1. Trae la venta de Supabase
// 2. Busca o crea el cliente en Alegra (por cedula)
// 3. Crea el item del vehiculo en Alegra (con CABYS, descripcion detallada)
// 4. Crea la factura como BORRADOR (stamp=false) en Alegra
// 5. Guarda alegra_invoice_id en Supabase

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';
const VCR_ACTIVITY_CODE = '4510.0'; // Actividad economica VCR

// Numeraciones en Alegra (vistos desde facturas reales)
// 14 = Factura electronica (para clientes con actividad economica)
// 17 = Tiquete electronico (para clientes sin actividad economica)
const NUMBER_TEMPLATE_INVOICE = '14'; // Factura de venta
const NUMBER_TEMPLATE_TICKET = '17';  // Tiquete

// Tax IDs de Alegra CR:
// 1 = IVA 13%
// 2 = IVA exento (0%)
// 4 = IVA 1%
// 6 = IVA 4%
// 16 = Tarifa 0% Art 32
function getTaxIdForRate(rate) {
  if (rate === 0 || !rate) return 2;  // exento
  if (rate === 1) return 4;
  if (rate === 4) return 6;
  if (rate === 13) return 1;
  // fallback: exento
  return 2;
}

// Mapeo de tipo ID VCR -> Alegra (codigos de Hacienda CR)
// CF = Cedula Fisica, CJ = Cedula Juridica, DIMEX = residente extranjero, NITE = no residente
const idTypeMap = {
  fisica: 'CF',
  juridica: 'CJ',
  dimex: 'DIMEX',
  extranjero: 'NITE',
};

async function alegraFetch(endpoint, method = 'GET', body = null) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const opts = {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(`${ALEGRA_BASE}${endpoint}`, opts);
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Alegra ${endpoint}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Busca cliente por identificacion o lo crea
async function findOrCreateClient(sale) {
  const cedula = (sale.client_cedula || '').replace(/[\s-]/g, '').trim();

  // Buscar por identificacion
  const existing = await alegraFetch(`/contacts?identification=${encodeURIComponent(cedula)}&limit=5`);
  if (Array.isArray(existing) && existing.length > 0) {
    const match = existing.find(c => {
      if (!c.type) return true;
      if (Array.isArray(c.type)) return c.type.includes('client');
      return c.type === 'client';
    }) || existing[0];
    return match.id;
  }

  // No existe -> crear
  const payload = {
    name: (sale.client_name || '').toUpperCase(),
    identification: cedula,
    identificationObject: {
      type: idTypeMap[sale.client_id_type] || 'CF',
      number: cedula,
    },
    type: ['client'],
    email: sale.client_email || undefined,
    mobile: sale.client_phone1 || undefined,
    phonePrimary: sale.client_phone2 || undefined,
  };

  // Si es contribuyente con actividad economica, agregarla
  if (sale.client_has_activity && sale.client_activity_code) {
    payload.economicActivities = [{
      code: sale.client_activity_code,
      isMain: true,
    }];
  }

  // Direccion basica
  if (sale.client_address) {
    payload.address = {
      address: sale.client_address,
    };
  }

  const created = await alegraFetch('/contacts', 'POST', payload);
  return created.id;
}

// Crea el item (producto) del vehiculo en Alegra
// Nombre: "MARCA MODELO AÑO PLACA"
// Descripcion: detalles tecnicos del vehiculo
async function createVehicleItem(sale) {
  const marca = (sale.vehicle_brand || '').toUpperCase();
  const modelo = (sale.vehicle_model || '').toUpperCase();
  const anio = sale.vehicle_year || '';

  // Placa: usar el formato ya guardado en la DB (ya viene bien desde formatPlate)
  // BSS530, BXR237 (sin guion) o CL-5136416 (con guion)
  const placa = (sale.vehicle_plate || '').toUpperCase();

  const itemName = `${marca} ${modelo} ${anio} ${placa}`.trim().replace(/\s+/g, ' ');

  // Descripcion detallada
  const parts = [];
  if (sale.vehicle_brand && sale.vehicle_model) parts.push(`${sale.vehicle_brand} ${sale.vehicle_model}`);
  if (sale.vehicle_style) parts.push(sale.vehicle_style);
  if (sale.vehicle_year) parts.push(`AÑO ${sale.vehicle_year}`);
  if (sale.vehicle_color) parts.push(`COLOR ${sale.vehicle_color}`);
  if (sale.vehicle_engine_cc) parts.push(`${sale.vehicle_engine_cc} CC`);
  if (sale.vehicle_drive) parts.push(sale.vehicle_drive);
  if (sale.vehicle_fuel) parts.push(sale.vehicle_fuel);
  if (sale.vehicle_plate) parts.push(`PLACA ${sale.vehicle_plate}`);
  if (sale.vehicle_km) parts.push(`${Number(sale.vehicle_km).toLocaleString('es-CR')} KM`);
  const description = parts.join(', ');

  const taxId = getTaxIdForRate(sale.iva_exceptional ? parseFloat(sale.iva_rate) : 0);

  const payload = {
    name: itemName,
    description,
    price: [{ idPriceList: 1, price: parseFloat(sale.sale_price) || 0 }],
    inventory: {
      unit: 'unit',
      unitCost: parseFloat(sale.sale_price) || 0,
      initialQuantity: 1,
    },
    tax: [{ id: taxId }],
    productKey: sale.vehicle_cabys || undefined,
    reference: (sale.vehicle_plate || '').toUpperCase(),
  };

  const created = await alegraFetch('/items', 'POST', payload);
  return created.id;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { sale_id } = req.body || {};
  if (!sale_id) return res.status(400).json({ ok: false, error: 'Falta sale_id' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Traer venta
    const { data: sale, error: saleErr } = await supabase.from('sales').select('*').eq('id', sale_id).single();
    if (saleErr || !sale) return res.status(404).json({ ok: false, error: 'Venta no encontrada' });

    // Si ya se emitio antes, avisar
    if (sale.alegra_invoice_id) {
      return res.status(200).json({
        ok: true,
        already_emitted: true,
        alegra_invoice_id: sale.alegra_invoice_id,
        message: 'Esta venta ya tiene factura emitida en Alegra.',
      });
    }

    // Cargar depositos para construir notas/anotacion
    const { data: deposits } = await supabase.from('sale_deposits').select('*').eq('sale_id', sale_id).order('deposit_date');

    // 2. Cliente en Alegra
    let clientAlegraId;
    try {
      clientAlegraId = await findOrCreateClient(sale);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        step: 'client',
        error: e.message,
        hint: 'Error al crear/buscar cliente en Alegra. Revisar si el tipo de identificación es válido (CF, CJ, DIMEX, NITE).',
      });
    }

    // 3. Item del vehiculo: reusar si ya existe (por vehicle_id -> alegra_item_id), si no crear
    let itemAlegraId;
    try {
      // Buscar el vehiculo correspondiente para ver si ya tiene alegra_item_id
      let existingItemId = null;
      if (sale.vehicle_id) {
        const { data: veh } = await supabase.from('vehicles').select('alegra_item_id').eq('id', sale.vehicle_id).single();
        if (veh && veh.alegra_item_id) existingItemId = veh.alegra_item_id;
      }

      if (existingItemId) {
        // Ya existe en Alegra, reusar
        itemAlegraId = existingItemId;
      } else {
        // Crear nuevo
        itemAlegraId = await createVehicleItem(sale);
        // Guardar el alegra_item_id en la tabla vehicles para futuras ventas del mismo carro
        if (sale.vehicle_id) {
          await supabase.from('vehicles').update({ alegra_item_id: String(itemAlegraId) }).eq('id', sale.vehicle_id);
        }
      }
    } catch (e) {
      return res.status(500).json({ ok: false, step: 'item', error: e.message });
    }

    // 4. Datos para la factura
    const isCredit = sale.payment_method === 'Financiamiento' || sale.payment_method === 'Mixto';
    const today = new Date();
    const dueDate = new Date(today);
    if (isCredit && sale.financing_term_months) {
      dueDate.setDate(dueDate.getDate() + (parseInt(sale.financing_term_months) * 30));
    }
    const toISODate = (d) => d.toISOString().slice(0, 10);

    // Tipo documento (solo informativo para el response, Alegra lo decide segun el cliente)
    const documentType = sale.client_has_activity ? 'invoice' : 'ticket';

    const price = parseFloat(sale.sale_price) || 0;

    // Construir texto de notas con desglose de depositos
    // Formato similar al tiquete manual:
    // "VENTA DE CONTADO. DEPOSITO EN BANCO X NUMERO Y POR Z. SEÑAL DE TRATO W."
    const curSymbol = sale.sale_currency === 'USD' ? '$' : '₡';
    const fmtMoney = (n) => {
      const v = parseFloat(n) || 0;
      return curSymbol + v.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const notasParts = [];
    notasParts.push(isCredit ? 'VENTA EN FINANCIAMIENTO.' : 'VENTA DE CONTADO.');

    if (deposits && deposits.length > 0) {
      for (const d of deposits) {
        if (!d.amount) continue;
        const bankPart = d.bank ? ` EN ${String(d.bank).toUpperCase()}` : '';
        const refPart = d.reference ? ` NUMERO ${d.reference}` : '';
        notasParts.push(`DEPOSITO${bankPart}${refPart} POR ${fmtMoney(d.amount)}.`);
      }
    }

    if (sale.deposit_signal && parseFloat(sale.deposit_signal) > 0) {
      notasParts.push(`SEÑAL DE TRATO POR ${fmtMoney(sale.deposit_signal)}.`);
    }

    if (sale.down_payment && parseFloat(sale.down_payment) > 0 && isCredit) {
      notasParts.push(`PRIMA ${fmtMoney(sale.down_payment)}.`);
    }

    if (sale.has_tradein && sale.tradein_value) {
      const tradeinInfo = [];
      if (sale.tradein_brand) tradeinInfo.push(sale.tradein_brand);
      if (sale.tradein_model) tradeinInfo.push(sale.tradein_model);
      if (sale.tradein_year) tradeinInfo.push(sale.tradein_year);
      if (sale.tradein_plate) tradeinInfo.push(`PLACA ${sale.tradein_plate}`);
      notasParts.push(`TRADE-IN: ${tradeinInfo.join(' ')} POR ${fmtMoney(sale.tradein_value)}.`);
    }

    if (sale.observations) {
      notasParts.push(String(sale.observations));
    }

    const notasFinal = notasParts.join(' ').slice(0, 500);

    // 5. Payload factura con los campos CORRECTOS de Alegra Costa Rica
    // Nombres y valores verificados contra facturas reales timbradas
    const invoicePayload = {
      date: toISODate(today),
      dueDate: toISODate(dueDate),
      client: clientAlegraId,
      status: 'draft',
      // Numeracion: 14 = factura, 17 = tiquete
      numberTemplate: {
        id: sale.client_has_activity ? NUMBER_TEMPLATE_INVOICE : NUMBER_TEMPLATE_TICKET,
      },
      items: [{
        id: itemAlegraId,
        price,
        quantity: 1,
        description: sale.vehicle_plate ? `Placa: ${sale.vehicle_plate}` : undefined,
        // Tax IVA exento (vehiculos son exentos)
        tax: [{ id: 2 }],
      }],
      // Condicion de venta: CASH o CREDIT (MAYUSCULAS)
      saleCondition: isCredit ? 'CREDIT' : 'CASH',
      // Actividad economica de VCR
      economicActivity: VCR_ACTIVITY_CODE,
    };

    // Medio de pago - segun el primer deposito / banco (MAYUSCULAS)
    // Valores validos vistos en facturas reales: TRANSFER, CASH, CARD, CHECK
    const firstDeposit = (deposits && deposits.length > 0) ? deposits[0] : null;
    if (firstDeposit && firstDeposit.bank) {
      const b = String(firstDeposit.bank).toLowerCase();
      if (b.includes('efectivo')) invoicePayload.paymentMethod = 'CASH';
      else if (b.includes('tarjeta')) invoicePayload.paymentMethod = 'CARD';
      else if (b.includes('cheque')) invoicePayload.paymentMethod = 'CHECK';
      else invoicePayload.paymentMethod = 'TRANSFER';
    } else {
      invoicePayload.paymentMethod = 'TRANSFER';
    }

    // Notas (visibles en PDF)
    if (notasFinal) {
      invoicePayload.anotation = notasFinal;
    }

    // Moneda
    if (sale.sale_currency === 'USD' && sale.sale_exchange_rate) {
      invoicePayload.currency = {
        code: 'USD',
        exchangeRate: parseFloat(sale.sale_exchange_rate),
      };
    }

    // Si es factura (no tiquete), Alegra usa la actividad del cliente tambien
    // Eso ya esta en el payload del contacto que creamos

    // 6. Crear factura
    let invoice;
    try {
      invoice = await alegraFetch('/invoices', 'POST', invoicePayload);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        step: 'invoice',
        error: e.message,
        debug_payload: invoicePayload,
      });
    }

    // 7. Guardar en Supabase
    await supabase.from('sales').update({
      alegra_invoice_id: String(invoice.id),
      alegra_invoice_number: invoice.numberTemplate?.fullNumber || invoice.number || null,
      alegra_client_id: String(clientAlegraId),
      alegra_item_id: String(itemAlegraId),
    }).eq('id', sale_id);

    return res.status(200).json({
      ok: true,
      document_type: documentType,
      alegra_invoice_id: invoice.id,
      alegra_invoice_number: invoice.numberTemplate?.fullNumber || invoice.number || null,
      alegra_client_id: clientAlegraId,
      alegra_item_id: itemAlegraId,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
