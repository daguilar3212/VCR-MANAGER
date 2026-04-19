// sync-vehicle-alegra.js
// Sincroniza un vehiculo YA EXISTENTE en Supabase hacia Alegra como item
// Se llama despues de:
// 1. Admin agrega carro manual al inventario
// 2. Se detecta/agrega carro desde una factura de compra
//
// POST /api/sync-vehicle-alegra
// Body: { vehicle_id: "uuid" }

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

function formatPlate(plate) {
  if (!plate) return '';
  const cleaned = String(plate).trim().toUpperCase().replace(/[-\s]/g, '');
  if (cleaned.startsWith('CL')) return `CL-${cleaned.slice(2)}`;
  return cleaned;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { vehicle_id } = req.body || {};
  if (!vehicle_id) {
    return res.status(400).json({ ok: false, error: 'vehicle_id es requerido' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  try {
    // 1. Traer el vehiculo
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', vehicle_id)
      .single();

    if (vErr || !vehicle) {
      return res.status(404).json({ ok: false, error: 'Vehiculo no encontrado' });
    }

    // 2. Si ya tiene alegra_item_id, no duplicar
    if (vehicle.alegra_item_id) {
      return res.status(200).json({
        ok: true,
        already_synced: true,
        alegra_item_id: vehicle.alegra_item_id,
        message: 'Vehiculo ya sincronizado con Alegra',
      });
    }

    // 3. Calcular precio para Alegra
    // Alegra usa USD como referencia (la cuenta maneja multi-moneda)
    const tc = parseFloat(vehicle.exchange_rate) || 500; // fallback razonable
    let priceUSD = 0;
    if (vehicle.price_currency === 'USD' && vehicle.price_usd) {
      priceUSD = parseFloat(vehicle.price_usd) || 0;
    } else if (vehicle.price_crc && tc > 0) {
      priceUSD = Math.round(parseFloat(vehicle.price_crc) / tc);
    }

    // Costo del vehiculo: purchase_cost esta en CRC, convertir a USD
    let costUSD = 0;
    if (vehicle.purchase_cost && tc > 0) {
      costUSD = Math.round(parseFloat(vehicle.purchase_cost) / tc);
    }

    // 4. Construir item de Alegra
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

    const payload = {
      name: itemName,
      description,
      price: [{ idPriceList: 1, price: priceUSD || 0 }],
      inventory: {
        unit: 'unit',
        unitCost: costUSD || 0,
        initialQuantity: 1,
      },
      tax: [{ id: 2 }], // IVA exento
      productKey: vehicle.cabys_code || '4911404000000',
      reference: { reference: plateFormatted },
    };

    // 5. Crear en Alegra
    const item = await alegraFetch('/items', 'POST', payload);

    // 6. Guardar alegra_item_id en Supabase
    await supabase
      .from('vehicles')
      .update({ alegra_item_id: String(item.id) })
      .eq('id', vehicle_id);

    return res.status(200).json({
      ok: true,
      alegra_item_id: item.id,
      plate: plateFormatted,
      message: 'Vehiculo sincronizado con Alegra',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
