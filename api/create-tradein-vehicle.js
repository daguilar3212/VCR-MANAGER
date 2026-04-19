// create-tradein-vehicle.js
// Crea automaticamente un vehiculo en el inventario cuando se recibe un trade-in
//
// POST /api/create-tradein-vehicle
// Body: { sale_id: "uuid" }
//
// Flujo:
// 1. Trae la venta de Supabase
// 2. Si tiene trade-in (has_tradein=true), crea un vehiculo en tabla vehicles
// 3. Si ya existe un vehiculo con esa placa, lo actualiza (evita duplicados)
// 4. Devuelve el vehicle_id creado

import { createClient } from '@supabase/supabase-js';

// Normalizar placa a formato estandar VCR (igual que formatPlate en frontend)
function formatPlate(plate) {
  if (!plate) return '';
  const cleaned = String(plate).trim().toUpperCase().replace(/[-\s]/g, '');
  if (cleaned.startsWith('CL')) {
    const num = cleaned.slice(2);
    return `CL-${num}`;
  }
  return cleaned;
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

    // 3. Verificar si ya existe en el inventario
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id, plate')
      .eq('plate', plateFormatted)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        ok: true,
        already_exists: true,
        vehicle_id: existing.id,
        plate: plateFormatted,
        message: 'Ya existe un vehiculo con esa placa en inventario',
      });
    }

    // 4. Construir el payload del nuevo vehiculo
    // price_currency hereda de la moneda de la venta donde se recibio
    const priceCurrency = sale.sale_currency || 'USD';

    // Generar notas descriptivas
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

    const vehiclePayload = {
      plate: plateFormatted,
      brand: sale.tradein_brand ? String(sale.tradein_brand).toUpperCase() : null,
      model: sale.tradein_model ? String(sale.tradein_model).toUpperCase() : null,
      year: sale.tradein_year || null,
      color: sale.tradein_color ? String(sale.tradein_color).toUpperCase() : null,
      km: parseInt(sale.tradein_km) || 0,
      engine: sale.tradein_engine ? String(sale.tradein_engine).toUpperCase() : null,
      engine_cc: sale.tradein_engine_cc || null,
      drivetrain: sale.tradein_drive || null,
      fuel: sale.tradein_fuel || null,
      style: sale.tradein_style || null,
      chassis: sale.tradein_chassis ? String(sale.tradein_chassis).toUpperCase() : null,
      cabys_code: sale.tradein_cabys || null,
      purchase_cost: parseFloat(sale.tradein_value) || null,
      price_usd: 0,
      price_crc: 0,
      price_currency: priceCurrency,
      status: 'disponible',
      notes: notes.slice(0, 500),
    };

    // 5. Insertar
    const { data: inserted, error: insertErr } = await supabase
      .from('vehicles')
      .insert(vehiclePayload)
      .select()
      .single();

    if (insertErr) {
      return res.status(500).json({
        ok: false,
        error: 'Error al crear vehiculo en inventario',
        details: insertErr.message,
        payload: vehiclePayload,
      });
    }

    return res.status(200).json({
      ok: true,
      vehicle_id: inserted.id,
      plate: inserted.plate,
      purchase_cost: inserted.purchase_cost,
      message: 'Vehiculo agregado al inventario exitosamente',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
