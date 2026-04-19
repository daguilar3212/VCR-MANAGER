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

    // Calcular precio en CRC (moneda por default de tu cuenta de Alegra)
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

    // Price list ID (UUID de la cuenta CR)
    const PRICE_LIST_ID = '01983f21-0f79-737f-85df-988548dcbc02';
    const CATEGORY_ID = 5135; // "Ventas"

    const payload = {
      name: itemName,
      description,
      category: { id: CATEGORY_ID },
      price: [{
        idPriceList: PRICE_LIST_ID,
        price: priceCRC,
      }],
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
