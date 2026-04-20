// sync-showroom.js
// Lee el Google Sheets publico y sincroniza showroom_vehicles
// POST /api/sync-showroom

import { createClient } from '@supabase/supabase-js';

const SHEET_ID = '1Ig9M0mG_Nk7y0EiTcafdiYAXJoCYuUnJ7nwfnz7zukY';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

// Parsea CSV respetando comillas dobles (campos con comas adentro)
function parseCSV(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      current.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      current.push(field);
      rows.push(current);
      current = [];
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') { i++; continue; }
    field += ch;
    i++;
  }
  if (field !== '' || current.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

// Convierte "27.900,00" o "6.500.000,00" a numero
function parseNumber(s) {
  if (!s) return null;
  const clean = String(s).replace(/[\$₡\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

// Convierte "60.000" a 60000 (kilometraje, sin decimales)
function parseInt2(s) {
  if (!s) return null;
  const clean = String(s).replace(/[\s\.]/g, '').replace(',', '.');
  const n = parseInt(clean);
  return isNaN(n) ? null : n;
}

// Convierte URL Google Drive view -> thumbnail
// https://drive.google.com/file/d/ID/view -> https://drive.google.com/thumbnail?id=ID&sz=w800
function driveViewToThumb(url) {
  if (!url) return url;
  const m = String(url).match(/\/d\/([^\/\?]+)/);
  if (!m) return url;
  return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
}

function processPhotos(s) {
  if (!s) return null;
  const urls = String(s).split(',').map(u => u.trim()).filter(u => u.startsWith('http'));
  const thumbs = urls.map(driveViewToThumb);
  return thumbs.join(',');
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Faltan env vars SUPABASE_URL/SUPABASE_SERVICE_KEY' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Descargar CSV del Sheets
    const csvRes = await fetch(CSV_URL);
    if (!csvRes.ok) {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo descargar el Sheets',
        status: csvRes.status,
        hint: 'Verifica que el Sheets este compartido como "Cualquiera con el enlace puede ver"'
      });
    }
    const csvText = await csvRes.text();
    const rows = parseCSV(csvText);

    if (rows.length < 2) {
      return res.status(400).json({ ok: false, error: 'El Sheets esta vacio o sin datos' });
    }

    // 2. La fila 0 es encabezado, fila 1 es blanco en tu sheet
    // Los carros empiezan en la fila 2 (index 2 en el array 0-based)
    // Estructura (segun tu sheet):
    // [0] Estado, [1] ID/Placa, [2] Marca, [3] Modelo, [4] Año, [5] (vacia),
    // [6] Transmision, [7] Color, [8] Kilometraje, [9] Combustible, [10] Motor,
    // [11] Cilindros, [12] Procedencia, [13] Traccion, [14] Capacidad, [15] Estilo,
    // [16] Precio preferencia, [17] Moneda preferencia,
    // [18] Precio USD calc, [19] Precio CRC calc, ...
    // [26] Fotos (vehiculosdecr), [27] FOTOS LOVABLE

    const records = [];
    const errors = [];
    let skipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) { skipped++; continue; }

      const estado = (row[0] || '').trim().toUpperCase();
      const plate = (row[1] || '').trim();
      const brand = (row[2] || '').trim();
      const model = (row[3] || '').trim();

      // Saltar filas sin datos (plate vacio o sin marca)
      if (!plate || !brand) { skipped++; continue; }

      // Solo procesar filas con estado DISPONIBLE o RESERVADO
      if (estado !== 'DISPONIBLE' && estado !== 'RESERVADO') { skipped++; continue; }

      try {
        const record = {
          estado,
          plate,
          brand,
          model,
          year: parseInt((row[4] || '').trim()) || null,
          transmission: (row[6] || '').trim() || null,
          color: (row[7] || '').trim() || null,
          km: parseInt2(row[8]),
          fuel: (row[9] || '').trim() || null,
          engine_cc: (row[10] || '').trim() || null,
          cylinders: (row[11] || '').trim() || null,
          origin: (row[12] || '').trim() || null,
          drivetrain: (row[13] || '').trim() || null,
          passengers: (row[14] || '').trim() || null,
          style: (row[15] || '').trim() || null,
          price: parseNumber(row[16]),
          currency: (row[17] || '').trim().toUpperCase() || null,
          web_url: (row[26] || '').trim() || null,
          photos: processPhotos(row[27]),
        };
        records.push(record);
      } catch (e) {
        errors.push({ row: i, plate, error: e.message });
      }
    }

    if (records.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se encontraron carros validos en el sheets', skipped, errors });
    }

    // 3. Borrar todo el showroom y volver a cargar
    const { error: delErr } = await supabase.from('showroom_vehicles').delete().gte('id', 0);
    if (delErr) {
      return res.status(500).json({ ok: false, step: 'delete', error: delErr.message });
    }

    // 4. Insertar todos
    const { data: inserted, error: insErr } = await supabase
      .from('showroom_vehicles')
      .insert(records)
      .select();

    if (insErr) {
      return res.status(500).json({ ok: false, step: 'insert', error: insErr.message, records_attempted: records.length });
    }

    return res.status(200).json({
      ok: true,
      synced: inserted?.length || records.length,
      skipped,
      errors,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
