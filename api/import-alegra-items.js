// import-alegra-items.js
// Importa todos los items de Alegra a la tabla vehicles
// Se corre UNA sola vez visitando en navegador: /api/import-alegra-items?confirm=yes
//
// Estrategia:
// - Trae todos los items de Alegra paginados (limit=30 por pagina)
// - Para cada item:
//    * Extrae placa del "reference" o del nombre
//    * Parsea la descripcion para sacar marca/modelo/año/color/etc
//    * Inserta en vehicles con alegra_item_id + legacy_plate_format=true
// - Devuelve HTML con el resumen del import

import { createClient } from '@supabase/supabase-js';

const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

async function alegraFetch(endpoint) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const resp = await fetch(`${ALEGRA_BASE}${endpoint}`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(JSON.stringify(data));
  return data;
}

// Helper: buscar un patron en un texto
function extractMatch(text, patterns) {
  if (!text) return null;
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

// Parsea el nombre y descripcion para sacar datos estructurados
function parseVehicleData(alegraItem) {
  const name = String(alegraItem.name || '').toUpperCase();
  const desc = String(alegraItem.description || '').toUpperCase();
  const ref = String(alegraItem.reference || '').toUpperCase();
  const combo = `${name} ${desc}`;

  // Placa: priorizar reference, luego buscar en nombre
  // Patrones validos CR: 3 letras + 3 digitos, 2 letras + 3 digitos, 6 digitos solos
  let plate = ref || extractMatch(name, [
    /\b([A-Z]{3}[\s-]?\d{3,4})\b/,     // BXR237, BXR-237, BXR 237
    /\b([A-Z]{2,3}\d{3,6})\b/,          // BSS530 o similar
    /PLACA[S#:\s]*(\w+)/,               // "PLACA 353821"
    /\b(\d{6})\b/,                      // 353821 (6 digitos solos, mas riesgoso)
  ]);

  // Año: 4 digitos entre 1950 y 2030
  const year = extractMatch(combo, [
    /\b(19[5-9]\d|20[0-3]\d)\b/,
    /AÑO\s*(\d{4})/,
  ]);

  // Cilindrada (CC)
  const cc = extractMatch(combo, [
    /(\d{3,5})\s*CC\b/,
    /MOTOR.{0,30}(\d{3,5})/,
  ]);

  // Color
  const colorMatch = combo.match(/\bCOLOR\s+([A-ZÁÉÍÓÚÑ]+)/);
  const color = colorMatch ? colorMatch[1] : null;

  // Serie/VIN
  const serie = extractMatch(combo, [
    /SERIE[#:\s]+(\w+)/,
    /VIN[#:\s]+(\w+)/,
    /CHASIS[#:\s]+(\w+)/,
  ]);

  // Combustible
  let fuel = null;
  if (/DIESEL|DIÉSEL/i.test(combo)) fuel = 'Diesel';
  else if (/GASOLINA/i.test(combo)) fuel = 'Gasolina';
  else if (/HIBRIDO|HÍBRIDO|HYBRID/i.test(combo)) fuel = 'Hibrido';
  else if (/ELECTRICO|ELÉCTRICO|ELECTRIC/i.test(combo)) fuel = 'Electrico';

  // Traccion
  let drive = null;
  if (/4\s*X\s*4|4X4|4WD|AWD/i.test(combo)) drive = '4x4';
  else if (/4\s*X\s*2|4X2|2WD|FWD|RWD/i.test(combo)) drive = '4x2';

  // Estilo
  let style = null;
  if (/TODO\s*TERRENO/i.test(combo)) style = 'TODOTERRENO';
  else if (/PICK[\s-]?UP|CAMIONETA/i.test(combo)) style = 'PICK UP';
  else if (/SUV/i.test(combo)) style = 'SUV';
  else if (/SEDAN|SEDÁN/i.test(combo)) style = 'SEDAN';
  else if (/HATCHBACK/i.test(combo)) style = 'HATCHBACK';
  else if (/COUPE|COUPÉ/i.test(combo)) style = 'COUPE';
  else if (/MICROBUS|MICROBÚS|VAN/i.test(combo)) style = 'MICROBUS';

  // Marca y modelo: primeras palabras del nombre
  // "TOYOTA RUSH 2020 BSS530" -> brand=TOYOTA, model=RUSH
  const parts = name.split(/\s+/).filter(Boolean);
  const brand = parts[0] || null;
  let model = parts[1] || null;
  // Si model es un año (4 digitos) o la placa, tomar la siguiente
  if (model && (/^\d{4}$/.test(model) || model === plate?.toUpperCase())) {
    model = parts[2] || null;
  }

  return {
    brand,
    model,
    plate: plate || null,
    year: year ? parseInt(year) : null,
    engine_cc: cc ? parseInt(cc) : null,
    color,
    fuel,
    drive,
    style,
    serie,
  };
}

export default async function handler(req, res) {
  // Requiere ?confirm=yes para evitar ejecuciones accidentales
  if (req.query.confirm !== 'yes') {
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:700px;margin:auto">
        <h2>Importación de Inventario desde Alegra</h2>
        <p>Este endpoint va a:</p>
        <ol>
          <li><strong>Borrar TODOS los registros</strong> de la tabla <code>vehicles</code> en Supabase</li>
          <li>Traer todos los ítems de Alegra</li>
          <li>Parsear lo que pueda de cada ítem (marca, modelo, placa, año, etc.)</li>
          <li>Insertarlos en <code>vehicles</code> marcados como <code>legacy_plate_format=true</code></li>
        </ol>
        <p><strong>Esta acción es irreversible.</strong> Solo hacelo si estás seguro.</p>
        <a href="?confirm=yes"
           style="display:inline-block;background:#e11d48;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:20px">
          Sí, proceder con la importación
        </a>
      </body></html>
    `);
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 0. Borrar inventario actual
    const { error: delErr } = await supabase.from('vehicles').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delErr) {
      return res.status(500).send(`<pre>Error borrando: ${delErr.message}</pre>`);
    }

    // 1. Paginar items de Alegra
    const allItems = [];
    let start = 0;
    const limit = 30;
    while (true) {
      const batch = await alegraFetch(`/items?start=${start}&limit=${limit}`);
      if (!Array.isArray(batch) || batch.length === 0) break;
      allItems.push(...batch);
      if (batch.length < limit) break;
      start += limit;
      if (start > 3000) break; // safety cap
    }

    // 2. Parsear e insertar
    const results = { total: allItems.length, inserted: 0, skipped: 0, failed: 0, warnings: [] };
    const rows = [];
    const seenPlates = new Set();

    for (const item of allItems) {
      const itemName = String(item.name || '').toUpperCase();

      // Filtrar lo que claramente NO es un vehiculo con placa CR
      const nonVehicleKeywords = ['CARRITO DE GOLF', 'INTERESES', 'SERVICIO', 'COMISIÓN', 'COMISION', 'GASTOS', 'MANTENIMIENTO'];
      const isNonVehicle = nonVehicleKeywords.some(kw => itemName.includes(kw));
      if (isNonVehicle) {
        results.skipped++;
        continue;
      }

      const parsed = parseVehicleData(item);

      // Si no tiene placa detectable, saltar (no es vehiculo facturable estandar)
      if (!parsed.plate) {
        results.skipped++;
        results.warnings.push(`Saltado "${item.name}" (sin placa detectable)`);
        continue;
      }

      // Normalizar placa con la misma regla del app
      const plateClean = String(parsed.plate).toUpperCase().replace(/[\s-]/g, '');
      const clMatch = plateClean.match(/^CL(\d+)$/);
      const normalizedPlate = clMatch ? `CL-${clMatch[1]}` : plateClean;

      // Evitar duplicados
      if (seenPlates.has(normalizedPlate)) {
        results.skipped++;
        results.warnings.push(`Saltado "${item.name}" (placa duplicada: ${normalizedPlate})`);
        continue;
      }
      seenPlates.add(normalizedPlate);

      const price = Array.isArray(item.price) && item.price[0] ? parseFloat(item.price[0].price) : 0;

      const row = {
        alegra_item_id: String(item.id),
        plate: normalizedPlate,
        brand: parsed.brand,
        model: parsed.model,
        year: parsed.year,
        color: parsed.color,
        engine_cc: parsed.engine_cc,
        fuel: parsed.fuel,
        drivetrain: parsed.drive,
        style: parsed.style,
        chassis: parsed.serie,
        cabys_code: item.productKey || null,
        price_usd: price,
        notes: item.description || null,
        status: 'disponible',
      };

      rows.push(row);

      // Warnings no bloqueantes
      if (!parsed.year) results.warnings.push(`"${item.name}" sin año detectable`);
    }

    // 3. Insertar en batches
    if (rows.length > 0) {
      // insertamos en chunks de 50 por si acaso
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const { error: insErr } = await supabase.from('vehicles').insert(chunk);
        if (insErr) {
          results.failed += chunk.length;
          results.warnings.push(`Error al insertar chunk ${i}: ${insErr.message}`);
        } else {
          results.inserted += chunk.length;
        }
      }
    }

    // 4. HTML de reporte
    const warningsHtml = results.warnings.slice(0, 30).map(w => `<li>${w}</li>`).join('');
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:800px;margin:auto">
        <h2>✓ Importación completada</h2>
        <table style="border-collapse:collapse;margin:20px 0">
          <tr><td style="padding:6px 12px;border:1px solid #ddd">Total de ítems en Alegra</td><td style="padding:6px 12px;border:1px solid #ddd"><strong>${results.total}</strong></td></tr>
          <tr><td style="padding:6px 12px;border:1px solid #ddd">Insertados en VCR</td><td style="padding:6px 12px;border:1px solid #ddd;color:#10b981"><strong>${results.inserted}</strong></td></tr>
          <tr><td style="padding:6px 12px;border:1px solid #ddd">Saltados (no-vehículos, sin placa, duplicados)</td><td style="padding:6px 12px;border:1px solid #ddd;color:#f59e0b"><strong>${results.skipped}</strong></td></tr>
          <tr><td style="padding:6px 12px;border:1px solid #ddd">Fallidos (error de DB)</td><td style="padding:6px 12px;border:1px solid #ddd;color:${results.failed > 0 ? '#e11d48' : '#888'}"><strong>${results.failed}</strong></td></tr>
        </table>
        ${results.warnings.length > 0 ? `
          <h3>Warnings (${results.warnings.length}):</h3>
          <ul style="font-size:13px;color:#666">${warningsHtml}</ul>
          ${results.warnings.length > 30 ? `<p style="color:#888">...y ${results.warnings.length - 30} más</p>` : ''}
        ` : ''}
        <p style="margin-top:30px">Podés volver a tu app: <a href="/">Abrir VCR Manager</a></p>
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send(`<pre>Error: ${err.message}\n${err.stack || ''}</pre>`);
  }
}
