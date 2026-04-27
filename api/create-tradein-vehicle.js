// create-tradein-vehicle.js
// Crea automaticamente un vehiculo cuando se recibe un trade-in
// MODO ESPEJO: crea en Supabase + en Alegra
//
// POST /api/create-tradein-vehicle
// Body: { sale_id: "uuid" }

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

// Normalizar placa a formato estandar VCR
function formatPlate(plate) {
  if (!plate) return '';
  const cleaned = String(plate).trim().toUpperCase().replace(/[-\s]/g, '');
  if (cleaned.startsWith('CL')) {
    const num = cleaned.slice(2);
    return `CL-${num}`;
  }
  return cleaned;
}

// Obtener TC del BCCR (venta = TC que Alegra usa para facturar)
// Fuente: tipodecambio.paginasweb.cr (API publica sin auth)
async function getTipoCambio() {
  try {
    const response = await fetch('https://tipodecambio.paginasweb.cr/api', {
      headers: { 'Accept': 'application/json' },
    });
    const data = await response.json();
    // Respuesta: { venta: "640.50", compra: "632.00", fecha: "..." }
    const venta = parseFloat(data.venta);
    if (venta && venta > 0) return venta;
    throw new Error('TC invalido');
  } catch (err) {
    console.error('Error obteniendo TC:', err.message);
    return null; // Si falla, retorna null y usaremos fallback
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

// Crear item en Alegra con datos del trade-in
// El priceCRC es el precio en colones (tu cuenta de Alegra usa CRC)
async function createAlegraItem(vehicle, priceCRC, costCRC) {
  const marca = (vehicle.brand || '').toUpperCase();
  const modelo = (vehicle.model || '').toUpperCase();
  const anio = vehicle.year || '';
  const placa = (vehicle.plate || '').toUpperCase();

  const itemName = `${marca} ${modelo} ${anio} ${placa}`.trim().replace(/\s+/g, ' ');

  const parts = [];
  if (vehicle.brand && vehicle.model) parts.push(`${vehicle.brand} ${vehicle.model}`);
  if (vehicle.style) parts.push(vehicle.style);
  if (vehicle.year) parts.push(`AÑO ${vehicle.year}`);
  if (vehicle.color) parts.push(`COLOR ${vehicle.color}`);
  if (vehicle.engine_cc) parts.push(`${vehicle.engine_cc} CC`);
  if (vehicle.drivetrain) parts.push(vehicle.drivetrain);
  if (vehicle.fuel) parts.push(vehicle.fuel);
  if (vehicle.plate) parts.push(`PLACA ${vehicle.plate}`);
  if (vehicle.chassis) parts.push(`SERIE ${vehicle.chassis}`);
  if (vehicle.km) parts.push(`${Number(vehicle.km).toLocaleString('es-CR')} KM`);
  const description = parts.join(', ');

  // Constantes de la cuenta Alegra de VCR (obtenidas del item de ejemplo)
  const PRICE_LIST_ID = '01983f21-0f79-737f-85df-988548dcbc02';
  const CATEGORY_ID = 5135; // "Ventas"

  const payload = {
    name: itemName,
    description,
    category: { id: CATEGORY_ID },
    price: [{
      idPriceList: PRICE_LIST_ID,
      price: Math.round(priceCRC) || 0,
    }],
    inventory: {
      unit: 'unit',
      unitCost: Math.round(costCRC) || 0,
      initialQuantity: 1,
      warehouses: [{ id: 1, initialQuantity: 1 }],
    },
    productKey: vehicle.cabys_code || '4911404000000',
    type: 'product',
    status: 'active',
  };

  const created = await alegraFetch('/items', 'POST', payload);
  return created.id;
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

    // 2. Validar que tiene trade-in
    if (!sale.has_tradein) {
      return res.status(200).json({ ok: true, skipped: true, message: 'Esta venta no tiene trade-in' });
    }

    if (!sale.tradein_plate) {
      return res.status(400).json({ ok: false, error: 'Trade-in no tiene placa definida' });
    }

    const plateFormatted = formatPlate(sale.tradein_plate);

    // 3. Verificar si ya existe en Supabase
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, plate, alegra_item_id')
      .eq('plate', plateFormatted)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        ok: true,
        already_exists: true,
        vehicle_id: existing.id,
        plate: plateFormatted,
        alegra_item_id: existing.alegra_item_id,
        message: 'Ya existe un vehiculo con esa placa en inventario',
      });
    }

    // 4. Obtener TC del BCCR (el mismo que usa Alegra al timbrar)
    // Si la API del BCCR falla, caemos al TC del plan de ventas
    let tcFinal = await getTipoCambio();
    if (!tcFinal) {
      tcFinal = parseFloat(sale.sale_exchange_rate) || 0;
    }

    // 5. Calcular costos en colones usando el TC del BCCR
    const priceCurrency = sale.sale_currency || 'USD';
    let purchaseCostCRC = parseFloat(sale.tradein_value) || 0;

    if (sale.sale_currency === 'USD' && tcFinal > 0) {
      purchaseCostCRC = purchaseCostCRC * tcFinal;
    }
    purchaseCostCRC = Math.round(purchaseCostCRC);

    // Precio inicial para Alegra (en CRC, que es la moneda de tu cuenta)
    // Inicialmente 0 porque aun no has definido precio de venta para este trade-in
    const priceForAlegra = 0; // Lo actualizas cuando definas precio de venta

    // 5. Notas descriptivas
    const notesParts = [];
    if (sale.tradein_brand) notesParts.push(String(sale.tradein_brand).toUpperCase());
    if (sale.tradein_model) notesParts.push(String(sale.tradein_model).toUpperCase());
    if (sale.tradein_year) notesParts.push(String(sale.tradein_year));
    if (sale.tradein_color) notesParts.push(String(sale.tradein_color).toUpperCase());
    if (sale.tradein_engine_cc) notesParts.push(`${sale.tradein_engine_cc} CC`);
    if (sale.tradein_drive) notesParts.push(sale.tradein_drive);
    if (sale.tradein_fuel) notesParts.push(sale.tradein_fuel.toUpperCase());
    if (sale.tradein_plate) notesParts.push(`PLACAS# ${plateFormatted}`);
    if (sale.tradein_chassis) notesParts.push(`SERIE# ${String(sale.tradein_chassis).toUpperCase()}`);
    if (sale.tradein_engine) notesParts.push(`MOTOR# ${String(sale.tradein_engine).toUpperCase()}`);
    const notesDesc = notesParts.join(', ');

    const saleRef = sale.sale_number ? `Venta #${sale.sale_number}` : `venta ${sale_id.slice(0,8)}`;
    const clientRef = sale.client_name ? ` - ${sale.client_name}` : '';
    const notes = `${notesDesc}. Recibido como trade-in en ${saleRef}${clientRef}.`;

    // Helper para normalizar color: "BRONCE" -> "Bronce"
    const normalizeColorVD = (s) => {
      if (!s) return null;
      return String(s).trim().toLowerCase()
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    };

    // Helper para parsear km/cantidades grandes que pueden venir con comas/puntos/espacios
    // como separadores de miles. Ej: "484,000" -> 484000, "150.000" -> 150000
    const parseIntSafe = (v) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return Math.round(v);
      // Quitar comas, puntos, espacios (separadores de miles en CR/USA)
      const cleaned = String(v).replace(/[,.\s]/g, '');
      const n = parseInt(cleaned, 10);
      return isNaN(n) ? 0 : n;
    };

    // 6. Datos del vehiculo
    const vehicleData = {
      plate: plateFormatted,
      brand: sale.tradein_brand ? String(sale.tradein_brand).toUpperCase() : null,
      model: sale.tradein_model ? String(sale.tradein_model).toUpperCase() : null,
      year: sale.tradein_year || null,
      color: normalizeColorVD(sale.tradein_color),
      km: parseIntSafe(sale.tradein_km),
      engine: sale.tradein_engine ? String(sale.tradein_engine).toUpperCase() : null,
      engine_cc: sale.tradein_engine_cc || null,
      transmission: sale.tradein_transmission || null,
      drivetrain: sale.tradein_drive || null,
      fuel: sale.tradein_fuel || null,
      cylinders: sale.tradein_cylinders || null,
      origin: sale.tradein_origin || null,
      passengers: sale.tradein_passengers || null,
      style: sale.tradein_style || null,
      chassis: sale.tradein_chassis ? String(sale.tradein_chassis).toUpperCase() : null,
      cabys_code: sale.tradein_cabys || null,
      purchase_cost: purchaseCostCRC || null,
      price_usd: 0,
      price_crc: 0,
      price_currency: priceCurrency,
      status: 'disponible',
      notes: notes.slice(0, 500),
    };

    // 7. Crear en Alegra
    let alegraItemId = null;
    let alegraError = null;
    try {
      // Precio 0, costo = purchaseCostCRC (que ya esta convertido)
      alegraItemId = await createAlegraItem(vehicleData, priceForAlegra, purchaseCostCRC);
      vehicleData.alegra_item_id = String(alegraItemId);
    } catch (e) {
      alegraError = e.message;
      // No fallar, continuamos con Supabase
    }

    // 8. Insertar en Supabase
    const { data: inserted, error: insertErr } = await supabase
      .from('vehicles')
      .insert(vehicleData)
      .select()
      .single();

    if (insertErr) {
      return res.status(500).json({
        ok: false,
        error: 'Error al crear vehiculo en Supabase',
        details: insertErr.message,
        alegra_item_id: alegraItemId,
        alegra_error: alegraError,
      });
    }

    // 9. Agregar al Showroom (Supabase + Sheets) para que aparezca en la vista
    //    publica y en el inventario del agente. Precio 0 para que admin/agente
    //    lo ajuste despues. Estado DISPONIBLE.
    let showroomMsg = null;
    let showroomErr = null;
    try {
      // Primero verificar que no exista ya en showroom_vehicles (por placa)
      const { data: existingShowroom } = await supabase
        .from('showroom_vehicles')
        .select('id, plate')
        .eq('plate', plateFormatted)
        .maybeSingle();

      if (existingShowroom) {
        showroomMsg = `Ya estaba en Showroom`;
      } else {
        // Helper para normalizar color: "BRONCE" -> "Bronce", "rojo oscuro" -> "Rojo Oscuro"
        const normalizeColor = (s) => {
          if (!s) return '';
          return String(s).trim().toLowerCase()
            .split(/\s+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        };

        // Llamar al endpoint sync-showroom con action=add para meterlo al Sheets
        // Y al mismo tiempo se inserta en showroom_vehicles como efecto secundario.
        const baseUrl = process.env.APP_BASE_URL || 'https://vcr-manager.vercel.app';
        const showroomCar = {
          estado: 'DISPONIBLE',
          plate: plateFormatted,
          brand: (sale.tradein_brand || '').toUpperCase(),
          model: (sale.tradein_model || '').toUpperCase(),
          year: String(sale.tradein_year || ''),
          transmission: sale.tradein_transmission || '',
          color: normalizeColor(sale.tradein_color),
          km: sale.tradein_km ? String(sale.tradein_km) : '',
          fuel: sale.tradein_fuel || '',
          engine_cc: sale.tradein_engine_cc ? String(sale.tradein_engine_cc) : '',
          cylinders: sale.tradein_cylinders ? String(sale.tradein_cylinders) : '',
          origin: sale.tradein_origin || '',
          drivetrain: sale.tradein_drive || '',
          passengers: sale.tradein_passengers ? String(sale.tradein_passengers) : '',
          style: sale.tradein_style || '',
          price: '0',
          currency: sale.sale_currency || 'USD',
        };
        const showroomRes = await fetch(`${baseUrl}/api/sync-showroom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', car: showroomCar }),
        });
        const showroomData = await showroomRes.json().catch(() => ({ ok: false }));
        if (showroomData.ok) {
          showroomMsg = `Agregado al Showroom (precio 0 - ajustar manualmente)`;
        } else {
          showroomErr = showroomData.error || 'No se pudo agregar al Showroom';
        }
      }
    } catch (e) {
      showroomErr = e.message;
    }

    return res.status(200).json({
      ok: true,
      vehicle_id: inserted.id,
      plate: inserted.plate,
      purchase_cost: inserted.purchase_cost,
      alegra_item_id: alegraItemId,
      alegra_error: alegraError,
      showroom: showroomMsg,
      showroom_error: showroomErr,
      message: alegraError
        ? 'Creado en inventario local. Fallo en Alegra (se puede sincronizar despues)'
        : 'Creado en inventario local Y en Alegra',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
