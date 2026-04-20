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

    // 2. Usar encabezados para mapear dinamicamente (robusto ante columnas vacias)
    const headers = rows[0].map(h => (h || '').trim().toLowerCase());

    // Busca columna: primero match exacto, luego includes
    const findCol = (...names) => {
      const lowerNames = names.map(n => n.toLowerCase());
      // Match exacto primero
      for (const n of lowerNames) {
        const idx = headers.findIndex(h => h === n);
        if (idx !== -1) return idx;
      }
      // Luego includes
      for (const n of lowerNames) {
        const idx = headers.findIndex(h => h.includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    // IMPORTANTE: photos antes que webUrl, para que photos agarre "Fotos Lovable" y
    // webUrl agarre la otra "Fotos" (vehiculosdecr)
    const photosIdx = findCol('fotos lovable', 'lovable');
    const col = {
      estado: findCol('estado'),
      plate: findCol('id / placa', 'id/placa', 'placa'),
      brand: findCol('marca'),
      model: findCol('modelo'),
      year: findCol('año', 'ano'),
      transmission: findCol('transmisión', 'transmision'),
      color: findCol('color'),
      km: findCol('kilometraje', 'km'),
      fuel: findCol('combustible'),
      engine: findCol('motor'),
      cylinders: findCol('cilindros'),
      origin: findCol('procedencia'),
      drivetrain: findCol('traccion', 'tracción'),
      passengers: findCol('capacidad'),
      style: findCol('estilo'),
      price: findCol('precio preferencia', 'precio pref'),
      currency: findCol('moneda preferencia', 'moneda pref'),
      photos: photosIdx,
      // webUrl: primera columna llamada solo "fotos" que NO sea la de lovable
      webUrl: headers.findIndex((h, i) => i !== photosIdx && h === 'fotos'),
    };

    // Validar columnas criticas
    if (col.plate === -1 || col.brand === -1 || col.price === -1) {
      return res.status(400).json({
        ok: false,
        error: 'Encabezados no encontrados en el Sheets',
        detected_headers: headers,
        required: ['ID / Placa', 'Marca', 'Precio preferencia']
      });
    }

    const records = [];
    const errors = [];
    let skipped = 0;

    const getCell = (row, idx) => idx >= 0 && idx < row.length ? row[idx] : '';

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 3) { skipped++; continue; }

      const estado = (getCell(row, col.estado) || '').trim().toUpperCase();
      const plate = (getCell(row, col.plate) || '').trim();
      const brand = (getCell(row, col.brand) || '').trim();
      const model = (getCell(row, col.model) || '').trim();

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
          year: parseInt((getCell(row, col.year) || '').trim()) || null,
          transmission: (getCell(row, col.transmission) || '').trim() || null,
          color: (getCell(row, col.color) || '').trim() || null,
          km: parseInt2(getCell(row, col.km)),
          fuel: (getCell(row, col.fuel) || '').trim() || null,
          engine_cc: (getCell(row, col.engine) || '').trim() || null,
          cylinders: (getCell(row, col.cylinders) || '').trim() || null,
          origin: (getCell(row, col.origin) || '').trim() || null,
          drivetrain: (getCell(row, col.drivetrain) || '').trim() || null,
          passengers: (getCell(row, col.passengers) || '').trim() || null,
          style: (getCell(row, col.style) || '').trim() || null,
          price: parseNumber(getCell(row, col.price)),
          currency: (getCell(row, col.currency) || '').trim().toUpperCase() || null,
          web_url: (getCell(row, col.webUrl) || '').trim() || null,
          photos: processPhotos(getCell(row, col.photos)),
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
      detected_columns: Object.fromEntries(
        Object.entries(col).map(([k, v]) => [k, v === -1 ? 'NO ENCONTRADA' : `col ${v} (${headers[v] || ''})`])
      ),
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
}
