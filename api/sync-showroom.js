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

// ============================================================
// COTIZADORES Y CÁLCULO DE CAMPOS DERIVADOS PARA EL SHEETS
// Duplicado sintético de la lógica del frontend para generar los
// campos "Precio USD calc", "Precio CRC calc", "Traspaso",
// "Prima Mínima", "Cuota mensual", "Plazo", "Entidad", "Financiable".
// ============================================================

// BAC planes (replicado de src/App.jsx)
const BAC_PLANES = {
  seminuevo: {
    anios: [2023,2024,2025,2026,2027],
    prima_min: 0.20, comision: 0.035,
    usd: { tasa_fija: 0.08, plazo_max: 96 },
    crc: { tasa_fija: 0.0925, plazo_max: 96 },
  },
  usado: {
    anios: [2019,2020,2021,2022],
    prima_min: 0.25, comision: 0.0325,
    usd: { tasa_fija_inicial: 0.0865, plazo_max: 84 },
    crc: { tasa_fija_inicial: 0.0925, plazo_max: 84 },
  },
};

const RAPIMAX_POL = {
  2027:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,plazo_max:96,comision:0.05},
  2026:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,plazo_max:96,comision:0.05},
  2025:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,plazo_max:96,comision:0.05},
  2024:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,plazo_max:96,comision:0.05},
  2023:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,plazo_max:96,comision:0.05},
  2022:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,plazo_max:84,comision:0.05},
  2021:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,plazo_max:84,comision:0.05},
  2020:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,plazo_max:84,comision:0.05},
  2019:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,plazo_max:60,comision:0.05},
  2018:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,plazo_max:60,comision:0.05},
  2017:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,plazo_max:60,comision:0.05},
  2016:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,plazo_max:60,comision:0.05},
};

function cuotaAmort(P, tasaAnual, n) {
  const r = tasaAnual / 12;
  if (r === 0) return P / n;
  return P * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
}

// Obtener tipos de cambio BCCR y BAC del día (los más recientes)
async function getTCsDelDia(supabase) {
  const { data } = await supabase
    .from('tc_historico')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(10);
  const bccr = (data || []).find(r => r.fuente === 'bccr');
  const bac = (data || []).find(r => r.fuente === 'bac');
  return {
    bccr: bccr ? { compra: parseFloat(bccr.tc_compra), venta: parseFloat(bccr.tc_venta) } : null,
    bac: bac ? { compra: parseFloat(bac.tc_compra), venta: parseFloat(bac.tc_venta) } : null,
  };
}

// Convertir precio a USD y CRC usando TCs con spread BAC
function convertirPrecios(precio, currency, tcRates) {
  const p = parseFloat(precio) || 0;
  const bacCompra = tcRates?.bac?.compra || tcRates?.bccr?.compra || 500;
  const bacVenta = tcRates?.bac?.venta || tcRates?.bccr?.venta || 510;
  if (currency === 'USD') {
    // Precio en USD: directo. CRC usa BAC venta (cuando uno vende al cliente)
    return { usd: p, crc: p * bacVenta };
  }
  // Precio en CRC: directo. USD usa BAC compra (cuando uno compra dólares)
  return { usd: bacCompra > 0 ? p / bacCompra : 0, crc: p };
}

// Calcular traspaso en CRC (base imponible en CRC)
function calcularTraspasoCRC(baseCRC, honorarios = 120000) {
  const base = Math.max(0, parseFloat(baseCRC) || 0);
  const impuesto = base * 0.025;
  const timbres = base > 0 ? (base * 0.0077 + 3026.80) : 0;
  return impuesto + timbres + honorarios;
}

// Elegir banco por prioridad: BAC > RAPIMAX > CP
function elegirBanco(anio) {
  if (anio >= 2019 && anio <= 2027) return 'BAC';
  if (anio >= 2016 && anio <= 2018) return 'RAPIMAX';
  return 'CP';
}

// Obtener prima mínima y plazo máximo del banco elegido
function getParamsBanco(banco, anio) {
  if (banco === 'BAC') {
    const plan = anio >= 2023 ? BAC_PLANES.seminuevo : (anio >= 2019 ? BAC_PLANES.usado : null);
    if (!plan) return null;
    return {
      primaMin: plan.prima_min,
      plazoMax: plan.usd.plazo_max,
      tasa: plan.usd.tasa_fija ?? plan.usd.tasa_fija_inicial,
      comision: plan.comision,
    };
  }
  if (banco === 'RAPIMAX') {
    const pol = RAPIMAX_POL[anio];
    if (!pol) return null;
    return {
      primaMin: pol.prima,
      plazoMax: pol.plazo_max,
      tasa: pol.tasa_usd,
      comision: pol.comision,
    };
  }
  return null;
}

// Calcular cuota mensual (mes 1) con prima mínima del banco en USD
function calcularCuotaUSD(precioUSD, banco, anio) {
  const params = getParamsBanco(banco, anio);
  if (!params) return 0;
  // Traspaso en USD: aproximamos convirtiendo base CRC a USD con BCCR venta
  // Para simplificar usamos 3.5% del precio USD (suficiente para cotización inicial)
  const traspasoUSD = precioUSD * 0.035;
  const precioTotal = precioUSD + traspasoUSD;
  const prima = precioTotal * params.primaMin;
  const comision = precioTotal * params.comision;
  const montoFinanciar = precioTotal - prima + comision;
  if (montoFinanciar <= 0) return 0;
  return cuotaAmort(montoFinanciar, params.tasa, params.plazoMax);
}

// Calcular TODOS los campos derivados que escribimos al Sheets
async function calcularCamposDerivados(car, supabase) {
  const tcRates = await getTCsDelDia(supabase);
  const anio = parseInt(car.year) || 0;
  const { usd: precioUSD, crc: precioCRC } = convertirPrecios(car.price, car.currency, tcRates);
  const traspaso = calcularTraspasoCRC(precioCRC);
  const banco = elegirBanco(anio);
  const params = getParamsBanco(banco, anio);

  let primaMin = '';
  let cuotaMensual = '';
  let plazo = '';
  let entidad = '';
  let financiable = '';

  if (banco === 'CP') {
    primaMin = 'N/A';
    cuotaMensual = '';
    plazo = '';
    entidad = 'Crédito Personal';
    financiable = 'Solo asalariado (préstamo personal)';
  } else if (params) {
    const primaUSD = precioUSD * params.primaMin;
    const cuotaUSD = calcularCuotaUSD(precioUSD, banco, anio);
    primaMin = Math.round(primaUSD * 100) / 100; // USD
    cuotaMensual = Math.round(cuotaUSD * 100) / 100;
    plazo = params.plazoMax;
    entidad = banco;
    financiable = 'Asalariado / Independiente';
  }

  return {
    precio_usd_calc: Math.round(precioUSD * 100) / 100,
    precio_crc_calc: Math.round(precioCRC),
    traspaso: Math.round(traspaso),
    prima_minima: primaMin,
    cuota_mensual: cuotaMensual,
    plazo: plazo,
    entidad: entidad,
    financiable: financiable,
  };
}

// ============================================================

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

  // Detectar accion: agregar/editar/borrar carro al Sheets
  const body = req.body || {};
  if (body.action === 'add' && body.car) {
    return await handleAddCar(req, res, supabase, body.car);
  }
  if (body.action === 'edit' && body.car) {
    return await handleEditCar(req, res, supabase, body.car);
  }
  if (body.action === 'delete' && body.plate) {
    return await handleDeleteCar(req, res, supabase, body.plate);
  }
  // Acción para recalcular derivados de TODOS los carros (usado por el cron diario)
  if (body.action === 'recalc_all' || (req.query && req.query.action === 'recalc_all')) {
    return await handleRecalcAll(req, res, supabase);
  }

  // Caso default: sync desde Sheets

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

// Obtiene un access token usando el refresh token guardado en Supabase (tabla gmail_sync)
async function getGoogleAccessToken(supabase) {
  // Leer refresh token de Supabase
  const { data, error } = await supabase.from('gmail_sync').select('refresh_token').limit(1).single();
  if (error || !data?.refresh_token) {
    throw new Error('No hay refresh token de Google. Reautoriza desde /api/auth-gmail');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) {
    throw new Error(`Error refrescando token: ${tokens.error_description || tokens.error}`);
  }
  return tokens.access_token;
}

// Agrega un carro al Sheets como nueva fila y luego sincroniza con Supabase
async function handleAddCar(req, res, supabase, car) {
  try {
    // Validar campos obligatorios
    const requiredFields = ['estado', 'plate', 'brand', 'model', 'year', 'price', 'currency'];
    for (const f of requiredFields) {
      if (car[f] == null || car[f] === '') {
        return res.status(400).json({ ok: false, error: `Campo obligatorio: ${f}` });
      }
    }

    // Obtener access token
    let accessToken;
    try {
      accessToken = await getGoogleAccessToken(supabase);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    // Leer encabezados del Sheets para saber orden de columnas
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/A1:AZ1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo leer encabezados del Sheets', detail: metaJson });
    }

    const headers = (metaJson.values?.[0] || []).map(h => (h || '').trim().toLowerCase());
    if (headers.length === 0) {
      return res.status(400).json({ ok: false, error: 'El Sheets no tiene encabezados en la fila 1' });
    }

    // Encontrar indices columna estado y placa
    const findHeader = (...names) => {
      const lowerNames = names.map(n => n.toLowerCase());
      for (const n of lowerNames) {
        const idx = headers.findIndex(h => h === n);
        if (idx !== -1) return idx;
      }
      for (const n of lowerNames) {
        const idx = headers.findIndex(h => h.includes(n));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const colMap = {
      estado: findHeader('estado'),
      plate: findHeader('id / placa', 'id/placa', 'placa'),
      brand: findHeader('marca'),
      model: findHeader('modelo'),
      year: findHeader('año', 'ano'),
      transmission: findHeader('transmisión', 'transmision'),
      color: findHeader('color'),
      km: findHeader('kilometraje', 'km'),
      fuel: findHeader('combustible'),
      engine_cc: findHeader('motor'),
      cylinders: findHeader('cilindros'),
      origin: findHeader('procedencia'),
      drivetrain: findHeader('tracción', 'traccion'),
      passengers: findHeader('capacidad'),
      style: findHeader('estilo'),
      price: findHeader('precio preferencia', 'precio pref'),
      currency: findHeader('moneda preferencia', 'moneda pref'),
      // Campos derivados (calculados por el endpoint)
      precio_usd_calc: findHeader('precio usd calc', 'precio usd'),
      precio_crc_calc: findHeader('precio crc calc', 'precio crc'),
      traspaso: findHeader('traspaso'),
      prima_minima: findHeader('prima mínima', 'prima minima'),
      cuota_mensual: findHeader('cuota mensual', 'cuota'),
      plazo: findHeader('plazo (meses)', 'plazo'),
      entidad: findHeader('entidad'),
      financiable: findHeader('financiable'),
    };

    // Leer columna estado y placa para encontrar la ultima fila con carro real
    // Usamos pestaña Inventario explicitamente para evitar ambiguedades
    const colLetter = (idx) => {
      let s = '';
      let n = idx;
      while (n >= 0) {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
      }
      return s;
    };

    const plateCol = colLetter(colMap.plate);
    const modelCol = colLetter(colMap.model);

    // Leer columnas placa Y modelo para detectar filas con carro real
    // Modelo es texto libre (no dropdown), así que las filas vacías con fórmulas arrastradas no tienen modelo
    const firstCol = colMap.plate < colMap.model ? colMap.plate : colMap.model;
    const lastCol = colMap.plate < colMap.model ? colMap.model : colMap.plate;
    const readRange = `Inventario!${colLetter(firstCol)}2:${colLetter(lastCol)}1000`;
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(readRange)}?majorDimension=ROWS`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const readJson = await readRes.json();
    if (!readRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo leer Sheets para buscar fin de datos', detail: readJson });
    }

    // Una fila es REAL si tiene placa Y modelo no vacios (modelo es texto libre)
    const plateIdxInArr = colMap.plate - firstCol;
    const modelIdxInArr = colMap.model - firstCol;

    const dataRows = readJson.values || [];
    let lastRealRow = -1;
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i] || [];
      const plateVal = (row[plateIdxInArr] || '').trim();
      const modelVal = (row[modelIdxInArr] || '').trim();
      // Fila real: tiene placa y modelo (ambos con contenido)
      if (plateVal && modelVal) {
        lastRealRow = i;
      }
    }

    // Fila donde escribir: lastRealRow es 0-based dentro de dataRows (que empieza en fila 2 del Sheets)
    const targetRow = lastRealRow === -1 ? 2 : lastRealRow + 3;

    // Verificar que el Sheets tenga suficientes filas; si no, agregar las que faltan
    const spreadsheetInfoRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const spreadsheetInfo = await spreadsheetInfoRes.json();
    if (!spreadsheetInfoRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo leer info del Sheets', detail: spreadsheetInfo });
    }

    const inventarioSheet = spreadsheetInfo.sheets?.find(s => s.properties?.title === 'Inventario');
    if (!inventarioSheet) {
      return res.status(500).json({ ok: false, error: 'No se encontró pestaña Inventario' });
    }
    const sheetIdNum = inventarioSheet.properties.sheetId;
    const currentRowCount = inventarioSheet.properties.gridProperties.rowCount;

    // Si targetRow excede el tamaño de la grilla, agregar filas
    if (targetRow > currentRowCount) {
      const rowsToAdd = targetRow - currentRowCount + 10; // 10 de margen
      const appendDimensionRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              appendDimension: {
                sheetId: sheetIdNum,
                dimension: 'ROWS',
                length: rowsToAdd,
              },
            }],
          }),
        }
      );
      if (!appendDimensionRes.ok) {
        const errDetail = await appendDimensionRes.json();
        return res.status(502).json({ ok: false, error: 'No se pudo expandir el Sheets', detail: errDetail });
      }
    }

    // Calcular campos derivados (Precio USD/CRC calc, Traspaso, Prima, Cuota, etc.)
    // antes de construir la fila, para que se escriban al Sheets.
    try {
      const derivados = await calcularCamposDerivados(car, supabase);
      Object.assign(car, derivados);
    } catch (e) {
      console.warn('No se pudieron calcular derivados:', e.message);
    }

    // Construir la fila: array del tamaño total de headers
    const row = new Array(headers.length).fill('');
    for (const [field, idx] of Object.entries(colMap)) {
      if (idx !== -1 && car[field] != null && car[field] !== '') {
        row[idx] = String(car[field]);
      }
    }

    // Escribir con UPDATE en la fila exacta (no append)
    const writeRange = `Inventario!A${targetRow}:${colLetter(headers.length - 1)}${targetRow}`;
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
      }
    );
    const writeJson = await writeRes.json();
    if (!writeRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo escribir al Sheets', detail: writeJson });
    }

    // Insertar tambien en Supabase directamente
    const supabaseRecord = {
      estado: car.estado,
      plate: car.plate,
      brand: car.brand,
      model: car.model,
      year: parseInt(car.year) || null,
      transmission: car.transmission || null,
      color: car.color || null,
      km: car.km != null ? parseInt(String(car.km).replace(/[^\d]/g, '')) : null,
      fuel: car.fuel || null,
      engine_cc: car.engine_cc || null,
      cylinders: car.cylinders || null,
      origin: car.origin || null,
      drivetrain: car.drivetrain || null,
      passengers: car.passengers || null,
      style: car.style || null,
      price: parseFloat(car.price) || null,
      currency: (car.currency || '').toUpperCase() || null,
    };
    const { error: supErr } = await supabase.from('showroom_vehicles').insert(supabaseRecord);
    if (supErr) {
      return res.status(200).json({
        ok: true,
        written_to_sheets: true,
        sheet_row: targetRow,
        warning: `Escrito al Sheets pero error en Supabase: ${supErr.message}. Sincroniza manualmente.`,
      });
    }

    return res.status(200).json({
      ok: true,
      written_to_sheets: true,
      written_to_supabase: true,
      sheet_row: targetRow,
      updated_range: writeJson.updatedRange,
      plate: car.plate,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// =====================================================
// EDIT: busca la fila por placa y actualiza los campos
// =====================================================
async function handleEditCar(req, res, supabase, car) {
  try {
    if (!car.plate) return res.status(400).json({ ok: false, error: 'Falta placa' });

    let accessToken;
    try {
      accessToken = await getGoogleAccessToken(supabase);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    // Leer encabezados
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Inventario!A1:AZ1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) return res.status(502).json({ ok: false, error: 'No se pudo leer headers', detail: metaJson });
    const headers = (metaJson.values?.[0] || []).map(h => (h || '').trim().toLowerCase());

    const findHeader = (...names) => {
      const lowerNames = names.map(n => n.toLowerCase());
      for (const n of lowerNames) { const idx = headers.findIndex(h => h === n); if (idx !== -1) return idx; }
      for (const n of lowerNames) { const idx = headers.findIndex(h => h.includes(n)); if (idx !== -1) return idx; }
      return -1;
    };

    const colMap = {
      estado: findHeader('estado'),
      plate: findHeader('id / placa', 'id/placa', 'placa'),
      brand: findHeader('marca'),
      model: findHeader('modelo'),
      year: findHeader('año', 'ano'),
      transmission: findHeader('transmisión', 'transmision'),
      color: findHeader('color'),
      km: findHeader('kilometraje', 'km'),
      fuel: findHeader('combustible'),
      engine_cc: findHeader('motor'),
      cylinders: findHeader('cilindros'),
      origin: findHeader('procedencia'),
      drivetrain: findHeader('tracción', 'traccion'),
      passengers: findHeader('capacidad'),
      style: findHeader('estilo'),
      price: findHeader('precio preferencia', 'precio pref'),
      currency: findHeader('moneda preferencia', 'moneda pref'),
      // Campos derivados (calculados por el endpoint)
      precio_usd_calc: findHeader('precio usd calc', 'precio usd'),
      precio_crc_calc: findHeader('precio crc calc', 'precio crc'),
      traspaso: findHeader('traspaso'),
      prima_minima: findHeader('prima mínima', 'prima minima'),
      cuota_mensual: findHeader('cuota mensual', 'cuota'),
      plazo: findHeader('plazo (meses)', 'plazo'),
      entidad: findHeader('entidad'),
      financiable: findHeader('financiable'),
    };

    const colLetter = (idx) => {
      let s = ''; let n = idx;
      while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
      return s;
    };

    // Leer columna placa para encontrar la fila
    const plateColL = colLetter(colMap.plate);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`Inventario!${plateColL}2:${plateColL}1000`)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const readJson = await readRes.json();
    if (!readRes.ok) return res.status(502).json({ ok: false, error: 'No se pudo leer columna placa', detail: readJson });

    const plateNormalizado = car.plate.trim().toUpperCase();
    const plates = readJson.values || [];
    let rowIdx = -1;
    for (let i = 0; i < plates.length; i++) {
      if ((plates[i][0] || '').trim().toUpperCase() === plateNormalizado) {
        rowIdx = i + 2; // fila en Sheets
        break;
      }
    }

    if (rowIdx === -1) {
      return res.status(404).json({ ok: false, error: `Placa ${plateNormalizado} no encontrada en Sheets` });
    }

    // Leer fila existente completa para no pisar columnas que no editamos (fotos, etc)
    const existingRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`Inventario!A${rowIdx}:${colLetter(headers.length - 1)}${rowIdx}`)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const existingJson = await existingRes.json();
    const existingRow = (existingJson.values?.[0] || []);

    // Calcular campos derivados (Precio USD/CRC calc, Traspaso, Prima, Cuota, etc.)
    // antes de construir la fila, para que se escriban al Sheets.
    try {
      const derivados = await calcularCamposDerivados(car, supabase);
      Object.assign(car, derivados);
    } catch (e) {
      console.warn('No se pudieron calcular derivados:', e.message);
    }

    // Construir la nueva fila: preservar valores existentes, solo sobrescribir los que edit maneja
    const row = new Array(headers.length).fill('').map((_, i) => existingRow[i] || '');
    for (const [field, idx] of Object.entries(colMap)) {
      if (idx !== -1 && car[field] != null && car[field] !== '') {
        row[idx] = String(car[field]);
      }
    }

    const writeRange = `Inventario!A${rowIdx}:${colLetter(headers.length - 1)}${rowIdx}`;
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] }),
      }
    );
    const writeJson = await writeRes.json();
    if (!writeRes.ok) return res.status(502).json({ ok: false, error: 'Error escribiendo Sheets', detail: writeJson });

    // FORZAR RECALCULO: obtener sheetId numerico y hacer batchUpdate
    // Esto dispara el recalculo de fórmulas que dependen de esta fila
    try {
      const infoRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      const info = await infoRes.json();
      const invSheet = info.sheets?.find(s => s.properties?.title === 'Inventario');
      if (invSheet) {
        const sheetIdNum = invSheet.properties.sheetId;
        // Truco: usar updateCells con userEnteredValue para la celda estado
        // Esto fuerza recalculo de fórmulas dependientes (equivalente a edicion manual)
        const estadoColIdx = colMap.estado;
        await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: [{
                updateCells: {
                  range: {
                    sheetId: sheetIdNum,
                    startRowIndex: rowIdx - 1,
                    endRowIndex: rowIdx,
                    startColumnIndex: estadoColIdx,
                    endColumnIndex: estadoColIdx + 1,
                  },
                  rows: [{
                    values: [{
                      userEnteredValue: { stringValue: car.estado || '' }
                    }]
                  }],
                  fields: 'userEnteredValue',
                }
              }]
            }),
          }
        );
      }
    } catch (trigErr) {
      // Si falla el trigger, seguimos adelante. El dato ya se escribio.
      console.error('Trigger recalculo falló (no bloqueante):', trigErr.message);
    }

    // Update en Supabase
    const supabaseRecord = {
      estado: car.estado,
      brand: car.brand,
      model: car.model,
      year: parseInt(car.year) || null,
      transmission: car.transmission || null,
      color: car.color || null,
      km: car.km != null && car.km !== '' ? parseInt(String(car.km).replace(/[^\d]/g, '')) : null,
      fuel: car.fuel || null,
      engine_cc: car.engine_cc || null,
      cylinders: car.cylinders || null,
      origin: car.origin || null,
      drivetrain: car.drivetrain || null,
      passengers: car.passengers || null,
      style: car.style || null,
      price: parseFloat(car.price) || null,
      currency: (car.currency || '').toUpperCase() || null,
    };
    await supabase.from('showroom_vehicles').update(supabaseRecord).eq('plate', plateNormalizado);

    return res.status(200).json({ ok: true, plate: plateNormalizado, sheet_row: rowIdx });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// =====================================================
// DELETE: borra la fila del Sheets y de Supabase
// =====================================================
async function handleDeleteCar(req, res, supabase, plate) {
  try {
    if (!plate) return res.status(400).json({ ok: false, error: 'Falta placa' });
    const plateNormalizado = plate.trim().toUpperCase();

    let accessToken;
    try {
      accessToken = await getGoogleAccessToken(supabase);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    // Leer headers para encontrar columna placa
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Inventario!A1:AZ1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) return res.status(502).json({ ok: false, error: 'No se pudo leer headers', detail: metaJson });
    const headers = (metaJson.values?.[0] || []).map(h => (h || '').trim().toLowerCase());

    const findHeader = (...names) => {
      const lowerNames = names.map(n => n.toLowerCase());
      for (const n of lowerNames) { const idx = headers.findIndex(h => h === n); if (idx !== -1) return idx; }
      for (const n of lowerNames) { const idx = headers.findIndex(h => h.includes(n)); if (idx !== -1) return idx; }
      return -1;
    };

    const plateColIdx = findHeader('id / placa', 'id/placa', 'placa');
    const colLetter = (idx) => {
      let s = ''; let n = idx;
      while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
      return s;
    };
    const plateColL = colLetter(plateColIdx);

    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`Inventario!${plateColL}2:${plateColL}1000`)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const readJson = await readRes.json();
    if (!readRes.ok) return res.status(502).json({ ok: false, error: 'No se pudo leer placas', detail: readJson });

    const plates = readJson.values || [];
    let rowIdx = -1;
    for (let i = 0; i < plates.length; i++) {
      if ((plates[i][0] || '').trim().toUpperCase() === plateNormalizado) {
        rowIdx = i + 2;
        break;
      }
    }

    if (rowIdx === -1) {
      // No estaba en Sheets, borrar solo de Supabase
      await supabase.from('showroom_vehicles').delete().eq('plate', plateNormalizado);
      return res.status(200).json({ ok: true, deleted_from: 'supabase_only', note: 'No estaba en Sheets' });
    }

    // Obtener sheet_id (numerico) de la pestaña "Inventario" para poder usar deleteDimension
    const spreadsheetInfoRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const spreadsheetInfo = await spreadsheetInfoRes.json();
    if (!spreadsheetInfoRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo leer info del Sheets', detail: spreadsheetInfo });
    }

    const inventarioSheet = spreadsheetInfo.sheets?.find(s => s.properties?.title === 'Inventario');
    if (!inventarioSheet) {
      return res.status(500).json({ ok: false, error: 'No se encontró pestaña Inventario' });
    }
    const sheetId = inventarioSheet.properties.sheetId;

    // Borrar la fila entera usando batchUpdate
    const deleteRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIdx - 1,  // 0-based
                endIndex: rowIdx,         // exclusivo
              },
            },
          }],
        }),
      }
    );
    const deleteJson = await deleteRes.json();
    if (!deleteRes.ok) return res.status(502).json({ ok: false, error: 'Error borrando fila', detail: deleteJson });

    // Borrar en Supabase
    await supabase.from('showroom_vehicles').delete().eq('plate', plateNormalizado);

    return res.status(200).json({ ok: true, deleted_row: rowIdx, plate: plateNormalizado });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ============================================================
// RECALCULAR DERIVADOS DE TODOS LOS CARROS DEL SHEETS
// Se usa desde el cron diario (6am y 11pm) para mantener actualizados
// los campos Precio USD/CRC calc, Prima Mínima, Cuota mensual, etc.
// cuando el TC del BCCR/BAC cambia.
// ============================================================
async function handleRecalcAll(req, res, supabase) {
  try {
    let accessToken;
    try {
      accessToken = await getGoogleAccessToken(supabase);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    // 1. Leer headers
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Inventario!A1:AZ1`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok) return res.status(502).json({ ok: false, error: 'No se pudo leer headers', detail: metaJson });
    const headers = (metaJson.values?.[0] || []).map(h => (h || '').trim().toLowerCase());

    const findHeader = (...names) => {
      const lowerNames = names.map(n => n.toLowerCase());
      for (const n of lowerNames) { const idx = headers.findIndex(h => h === n); if (idx !== -1) return idx; }
      for (const n of lowerNames) { const idx = headers.findIndex(h => h.includes(n)); if (idx !== -1) return idx; }
      return -1;
    };

    const colMap = {
      plate: findHeader('id / placa', 'id/placa', 'placa'),
      year: findHeader('año', 'ano'),
      price: findHeader('precio preferencia', 'precio pref'),
      currency: findHeader('moneda preferencia', 'moneda pref'),
      precio_usd_calc: findHeader('precio usd calc', 'precio usd'),
      precio_crc_calc: findHeader('precio crc calc', 'precio crc'),
      traspaso: findHeader('traspaso'),
      prima_minima: findHeader('prima mínima', 'prima minima'),
      cuota_mensual: findHeader('cuota mensual', 'cuota'),
      plazo: findHeader('plazo (meses)', 'plazo'),
      entidad: findHeader('entidad'),
      financiable: findHeader('financiable'),
    };

    if (colMap.plate === -1 || colMap.price === -1) {
      return res.status(400).json({ ok: false, error: 'Faltan columnas clave (Placa o Precio preferencia) en el Sheets' });
    }

    // 2. Leer TODAS las filas (fila 2 en adelante, hasta 1000)
    const colLetter = (idx) => {
      let s = ''; let n = idx;
      while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
      return s;
    };
    const lastCol = colLetter(headers.length - 1);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`Inventario!A2:${lastCol}1000`)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    const readJson = await readRes.json();
    if (!readRes.ok) return res.status(502).json({ ok: false, error: 'No se pudieron leer datos', detail: readJson });

    const allRows = readJson.values || [];
    const stats = { total: 0, recalculated: 0, skipped: 0, errors: [] };

    // 3. Procesar cada fila y calcular derivados
    const dataUpdates = []; // [{ range, values }] para batch update
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      const plate = (r[colMap.plate] || '').trim();
      const priceRaw = r[colMap.price] || '';
      const currency = (r[colMap.currency] || '').trim().toUpperCase();
      const year = parseInt(r[colMap.year] || '', 10);

      // Saltar filas vacías
      if (!plate || !priceRaw) { stats.skipped++; continue; }
      stats.total++;

      // Normalizar precio y moneda para el car object
      const price = parseNumber(priceRaw);
      if (!price || !year || !['USD', 'CRC'].includes(currency)) {
        stats.skipped++;
        stats.errors.push({ plate, reason: `Precio/moneda/año inválidos (price=${price}, currency=${currency}, year=${year})` });
        continue;
      }

      try {
        const derivados = await calcularCamposDerivados(
          { price, currency, year },
          supabase
        );

        // Armar una fila completa de solo las columnas derivadas
        const rowNum = i + 2; // header es fila 1, datos desde fila 2
        const fieldsToUpdate = ['precio_usd_calc', 'precio_crc_calc', 'traspaso', 'prima_minima', 'cuota_mensual', 'plazo', 'entidad', 'financiable'];
        for (const field of fieldsToUpdate) {
          const idx = colMap[field];
          if (idx === -1) continue;
          const val = derivados[field];
          if (val == null) continue;
          dataUpdates.push({
            range: `Inventario!${colLetter(idx)}${rowNum}`,
            values: [[String(val)]],
          });
        }
        stats.recalculated++;
      } catch (err) {
        stats.errors.push({ plate, reason: err.message });
      }
    }

    // 4. Escribir en batches para no saturar la API (50 por batch)
    if (dataUpdates.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < dataUpdates.length; i += BATCH_SIZE) {
        const batch = dataUpdates.slice(i, i + BATCH_SIZE);
        const batchRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              valueInputOption: 'USER_ENTERED',
              data: batch,
            }),
          }
        );
        if (!batchRes.ok) {
          const err = await batchRes.json();
          stats.errors.push({ batch: i, reason: JSON.stringify(err).slice(0, 200) });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      stats,
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
