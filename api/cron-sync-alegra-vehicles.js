// cron-sync-alegra-vehicles.js
// Cron diario que sincroniza vehiculos de Alegra hacia el app
// Solo trae items con CABYS 4911xxxxx (vehiculos)
//
// Si la placa ya existe en Supabase -> actualiza con datos de Alegra
// Si no existe -> crea nuevo vehiculo
//
// Se dispara via Vercel cron (definido en vercel.json)
// Tambien se puede llamar manualmente: GET /api/cron-sync-alegra-vehicles

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

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
  if (!res.ok) throw new Error(`Alegra ${endpoint}: ${JSON.stringify(data)}`);
  return data;
}

// Extraer placa del nombre del item en Alegra
// El formato que usa el app es: "MARCA MODELO AÑO PLACA"
// Ejemplos: "TOYOTA RAV4 2013 BDH737", "NISSAN KICKS 2021 YCY501"
function extractPlateFromName(name) {
  if (!name) return null;
  // La ultima palabra del nombre suele ser la placa
  const parts = String(name).trim().split(/\s+/);
  const lastPart = parts[parts.length - 1].toUpperCase();

  // Validar que parece placa costarricense
  // Placas CR: 3 letras + 3 numeros (ej: BDH737) o CL-XXXXX
  if (/^[A-Z]{3}\d{3,4}$/.test(lastPart)) return lastPart;
  if (/^CL-?\d{4,6}$/.test(lastPart)) return lastPart.replace(/^CL-?/, 'CL-');
  if (/^\d{3,6}$/.test(lastPart) && parts.length >= 3) {
    // Si los ultimos 2 partes son cosas como "RAV4 2013 BDH 737" con espacio
    const prev = parts[parts.length - 2].toUpperCase();
    if (/^[A-Z]{3}$/.test(prev)) return prev + lastPart;
  }
  return null;
}

// Parsear la descripcion del item para extraer datos del vehiculo
// Formato tipico: "TOYOTA RAV4, SUV, AÑO 2013, COLOR BLANCO, 2400 CC, 4X4, GASOLINA, PLACA BDH737, SERIE JTDBE32K703xxx, 170,000 KM"
function parseVehicleFromDescription(description, itemName) {
  const vehicle = {};
  if (!description) return vehicle;

  const desc = String(description).toUpperCase();

  // Año
  const yearMatch = desc.match(/AÑO\s*(\d{4})/);
  if (yearMatch) vehicle.year = parseInt(yearMatch[1]);

  // Color
  const colorMatch = desc.match(/COLOR\s+([A-ZÑÁÉÍÓÚ]+)/);
  if (colorMatch) vehicle.color = colorMatch[1];

  // CC
  const ccMatch = desc.match(/(\d{3,5})\s*CC/);
  if (ccMatch) vehicle.engine_cc = parseInt(ccMatch[1]);

  // Traccion (4X4, 4X2, AWD)
  const driveMatch = desc.match(/\b(4X4|4X2|4WD|AWD|2WD|FWD|RWD)\b/);
  if (driveMatch) vehicle.drivetrain = driveMatch[1];

  // Combustible
  if (desc.includes('GASOLINA')) vehicle.fuel = 'GASOLINA';
  else if (desc.includes('DIESEL') || desc.includes('DIÉSEL')) vehicle.fuel = 'DIESEL';
  else if (desc.includes('HIBRIDO') || desc.includes('HÍBRIDO')) vehicle.fuel = 'HIBRIDO';
  else if (desc.includes('ELECTRICO') || desc.includes('ELÉCTRICO')) vehicle.fuel = 'ELECTRICO';

  // Estilo
  const styleOptions = ['SUV', 'SEDAN', 'HATCHBACK', 'TODOTERRENO', 'PICK UP', 'PICKUP', 'MICROBUS'];
  for (const style of styleOptions) {
    if (desc.includes(style)) {
      vehicle.style = style === 'PICKUP' ? 'PICK UP' : style;
      break;
    }
  }

  // Chasis/Serie
  const chassisMatch = desc.match(/SERIE[:#\s]*([A-Z0-9]{10,20})/);
  if (chassisMatch) vehicle.chassis = chassisMatch[1];

  // Motor
  const engineMatch = desc.match(/MOTOR[:#\s]*([A-Z0-9]{5,20})/);
  if (engineMatch) vehicle.engine = engineMatch[1];

  // KM
  const kmMatch = desc.match(/([\d,\.]+)\s*KM/);
  if (kmMatch) vehicle.km = parseInt(kmMatch[1].replace(/[,\.]/g, ''));

  // Marca y modelo del nombre del item
  if (itemName) {
    const nameParts = String(itemName).trim().split(/\s+/);
    if (nameParts.length >= 2) {
      vehicle.brand = nameParts[0].toUpperCase();
      // Tomar desde la segunda palabra hasta antes del año
      const modelParts = [];
      for (let i = 1; i < nameParts.length; i++) {
        if (/^\d{4}$/.test(nameParts[i])) break;
        modelParts.push(nameParts[i]);
      }
      if (modelParts.length > 0) vehicle.model = modelParts.join(' ').toUpperCase();
    }
  }

  return vehicle;
}

export default async function handler(req, res) {
  // Verificar autenticacion del cron (si esta disponible)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${cronSecret}`) {
      // Permitir llamada manual sin auth si viene con ?manual=1
      if (req.query.manual !== '1') {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
    }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const stats = {
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Paginar por todos los items de Alegra (max 30 por request)
    let start = 0;
    const limit = 30;
    let allItems = [];
    let hasMore = true;

    while (hasMore) {
      const items = await alegraFetch(`/items?start=${start}&limit=${limit}`);
      if (!Array.isArray(items) || items.length === 0) {
        hasMore = false;
        break;
      }
      allItems = allItems.concat(items);
      start += limit;
      if (items.length < limit) hasMore = false;
      // Safety: no traer mas de 500 items en un solo run
      if (allItems.length >= 500) hasMore = false;
    }

    stats.scanned = allItems.length;

    // Filtrar solo los que son vehiculos (CABYS 4911xxxxx)
    const vehicleItems = allItems.filter(item => {
      const cabys = String(item.productKey || '').trim();
      return cabys.startsWith('4911');
    });

    // Procesar cada vehiculo
    for (const item of vehicleItems) {
      try {
        // Extraer placa del nombre
        const plate = extractPlateFromName(item.name);
        if (!plate) {
          stats.errors.push({ item_id: item.id, item_name: item.name, error: 'No se pudo extraer placa' });
          continue;
        }

        // Parsear datos de la descripcion
        const vehicleData = parseVehicleFromDescription(item.description || '', item.name);

        // Obtener precio y costo en CRC
        const priceCRC = item.price?.[0]?.price || 0;
        const costCRC = item.inventory?.unitCost || 0;

        // Datos base
        const vehiclePayload = {
          plate: plate,
          cabys_code: item.productKey,
          alegra_item_id: String(item.id),
          price_crc: Math.round(priceCRC) || 0,
          price_currency: 'CRC',
          status: 'disponible',
          ...vehicleData,
        };

        // Solo poner purchase_cost si existe en Alegra
        if (costCRC > 0) {
          vehiclePayload.purchase_cost = Math.round(costCRC);
        }

        // Verificar si existe en Supabase
        const { data: existing } = await supabase
          .from('vehicles')
          .select('id, plate')
          .eq('plate', plate)
          .maybeSingle();

        if (existing) {
          // Actualizar
          const { error: updErr } = await supabase
            .from('vehicles')
            .update(vehiclePayload)
            .eq('id', existing.id);
          if (updErr) {
            stats.errors.push({ plate, action: 'update', error: updErr.message });
          } else {
            stats.updated++;
          }
        } else {
          // Crear nuevo
          const notes = `Creado via sincronizacion desde Alegra. Item ID: ${item.id}. ${item.description || ''}`.slice(0, 500);
          vehiclePayload.notes = notes;

          const { error: insErr } = await supabase
            .from('vehicles')
            .insert(vehiclePayload);
          if (insErr) {
            stats.errors.push({ plate, action: 'insert', error: insErr.message });
          } else {
            stats.created++;
          }
        }
      } catch (itemErr) {
        stats.errors.push({ item_id: item.id, error: itemErr.message });
      }
    }

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      stats,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stats });
  }
}
