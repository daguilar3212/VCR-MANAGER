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
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ============================================================
// TC: helpers para obtener y guardar tipos de cambio
// Fuentes:
//   'bccr' -> tipodecambio.paginasweb.cr (TC oficial BCCR, público)
//   'bac'  -> web service BCCR indicadores 1314/1315 (requiere BCCR_EMAIL y BCCR_TOKEN)
// Tabla destino: tc_historico (fecha, fuente, tc_compra, tc_venta, fetched_at)
// PK compuesta: (fecha, fuente)
// ============================================================
function todayCR() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

function ymdToDMY(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

async function fetchTcBccr(fechaYMD) {
  try {
    const resp = await fetch(`https://tipodecambio.paginasweb.cr/api/${ymdToDMY(fechaYMD)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    const compra = parseFloat(data.compra);
    const venta = parseFloat(data.venta);
    if (!venta || venta <= 0) return { ok: false, error: 'venta inválida' };
    return { ok: true, tc_compra: compra || null, tc_venta: venta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Scrapear la página pública del BCCR que lista los TCs de ventanilla
// de todos los bancos. Extraer específicamente la fila del BAC San José.
// URL: https://gee.bccr.fi.cr/IndicadoresEconomicos/Cuadros/frmConsultaTCVentanilla.aspx
// Esta página muestra los TCs VIGENTES (no históricos). Por eso el BAC solo
// se guarda para la fecha "hoy" cuando el cron corre.
async function fetchTcBac(fechaYMD) {
  try {
    const resp = await fetch('https://gee.bccr.fi.cr/IndicadoresEconomicos/Cuadros/frmConsultaTCVentanilla.aspx', {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; VCRManager/1.0)',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const html = await resp.text();

    // La fila del BAC aparece como:
    //   <td ...>Banco BAC San José S.A.</td>
    //   <td ...>448,00</td>  <- compra
    //   <td ...>462,00</td>  <- venta
    //   <td ...>14,00</td>   <- diferencial
    //   <td ...>21/04/2026    01:04 p.m.</td>
    //
    // Regex busca "BAC San Jos" (sin acento para ser robusto a encoding),
    // luego salta el cierre </td>, y captura los dos siguientes números.
    const bacRegex = /BAC San Jos[^<]*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>/i;
    const match = html.match(bacRegex);

    if (!match) {
      return { ok: false, error: 'No se encontró fila BAC San José en la página' };
    }

    // Formato CR: "448,00" -> parsear como 448.00
    const parseNum = (s) => parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
    const compra = parseNum(match[1]);
    const venta = parseNum(match[2]);

    if (!compra || !venta || compra <= 0 || venta <= 0) {
      return { ok: false, error: `Valores inválidos: compra=${match[1]}, venta=${match[2]}` };
    }
    if (compra >= venta) {
      // Si compra >= venta, lo leímos al revés (defensa contra cambio de orden de columnas)
      return { ok: false, error: `Orden inesperado: compra=${compra} venta=${venta}` };
    }

    return { ok: true, tc_compra: compra, tc_venta: venta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function guardarTc(supabase, fecha, fuente, tc_compra, tc_venta) {
  const { error } = await supabase
    .from('tc_historico')
    .upsert({
      fecha, fuente,
      tc_compra: tc_compra || null,
      tc_venta,
      fetched_at: new Date().toISOString(),
    }, { onConflict: 'fecha,fuente' });
  if (error) throw new Error(`upsert ${fuente}: ${error.message}`);
}

async function limpiarTcAntiguos(supabase) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffYMD = cutoff.toISOString().split('T')[0];
  const { error, count } = await supabase
    .from('tc_historico')
    .delete({ count: 'exact' })
    .lt('fecha', cutoffYMD);
  if (error) return { ok: false, error: error.message };
  return { ok: true, deleted: count || 0 };
}

async function sincronizarTC(supabase) {
  const fecha = todayCR();
  const result = { fecha, bccr: null, bac: null, cleanup: null };

  // BCCR
  const bccr = await fetchTcBccr(fecha);
  if (bccr.ok) {
    try {
      await guardarTc(supabase, fecha, 'bccr', bccr.tc_compra, bccr.tc_venta);
      result.bccr = { ok: true, tc_compra: bccr.tc_compra, tc_venta: bccr.tc_venta };
    } catch (err) {
      result.bccr = { ok: false, error: err.message };
    }
  } else {
    result.bccr = { ok: false, error: bccr.error };
  }

  // BAC
  const bac = await fetchTcBac(fecha);
  if (bac.ok) {
    try {
      await guardarTc(supabase, fecha, 'bac', bac.tc_compra, bac.tc_venta);
      result.bac = { ok: true, tc_compra: bac.tc_compra, tc_venta: bac.tc_venta };
    } catch (err) {
      result.bac = { ok: false, error: err.message };
    }
  } else {
    result.bac = { ok: false, error: bac.error };
  }

  // Limpieza >365 días
  result.cleanup = await limpiarTcAntiguos(supabase);
  return result;
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

// ============================================================
// BACKUP A GOOGLE SHEETS
// Reusa GOOGLE_DRIVE_REFRESH_TOKEN. Require env BACKUP_SHEET_ID.
// Corre a las 6am y 11pm CR (configurado en vercel.json).
// Sobrescribe todas las pestañas cada corrida.
// ============================================================

async function bkGetAccessToken() {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('OAuth error: ' + JSON.stringify(data));
  return data.access_token;
}

async function bkGetSheetMeta(accessToken, sheetId) {
  const resp = await fetch(`${SHEETS_API}/${sheetId}?fields=sheets(properties(sheetId,title))`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`getSheetMeta: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function bkEnsureTabs(accessToken, sheetId, tabNames) {
  const meta = await bkGetSheetMeta(accessToken, sheetId);
  const existing = {};
  (meta.sheets || []).forEach(s => { existing[s.properties.title] = s.properties.sheetId; });
  const toCreate = tabNames.filter(t => !(t in existing));
  if (toCreate.length === 0) return existing;
  const requests = toCreate.map(title => ({ addSheet: { properties: { title } } }));
  const resp = await fetch(`${SHEETS_API}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!resp.ok) throw new Error(`ensureTabs: ${resp.status} ${await resp.text()}`);
  const result = await resp.json();
  (result.replies || []).forEach((r, i) => {
    const newSheetId = r.addSheet?.properties?.sheetId;
    if (newSheetId != null) existing[toCreate[i]] = newSheetId;
  });
  return existing;
}

async function bkClearTab(accessToken, sheetId, tabName) {
  const range = `'${tabName}'`;
  const resp = await fetch(`${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!resp.ok) throw new Error(`clearTab ${tabName}: ${resp.status} ${await resp.text()}`);
}

async function bkWriteRows(accessToken, sheetId, tabName, rows) {
  if (!rows || rows.length === 0) return;
  const range = `'${tabName}'!A1`;
  const resp = await fetch(
    `${SHEETS_API}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!resp.ok) throw new Error(`writeRows ${tabName}: ${resp.status} ${await resp.text()}`);
}

async function bkFormatHeader(accessToken, sheetId, tabGid) {
  const requests = [
    {
      repeatCell: {
        range: { sheetId: tabGid, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.8, green: 0, blue: 0.2 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            horizontalAlignment: 'LEFT',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: tabGid, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ];
  const resp = await fetch(`${SHEETS_API}/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!resp.ok) throw new Error(`formatHeader: ${resp.status} ${await resp.text()}`);
}

// Helpers de conversión/formato
function bkToBoth(amount, currency, tcItem, defaultTc) {
  const a = parseFloat(amount) || 0;
  const tc = parseFloat(tcItem) || parseFloat(defaultTc) || 0;
  if (currency === 'USD') return { crc: tc > 0 ? a * tc : 0, usd: a, tc };
  return { crc: a, usd: tc > 0 ? a / tc : 0, tc };
}
function bkFmtNum(n) {
  if (n == null || isNaN(n)) return 0;
  return Math.round(Number(n) * 100) / 100;
}
function bkFmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; }
}
function bkFmtDateTime(d) {
  if (!d) return '';
  try { return new Date(d).toISOString().replace('T', ' ').slice(0, 19); } catch { return ''; }
}

// Builders de filas por pestaña
async function bkBuildTCs(supabase) {
  const { data } = await supabase.from('tc_historico').select('*').order('fecha', { ascending: false });
  const rows = [['Fecha', 'Fuente', 'TC Compra', 'TC Venta', 'Fetched At']];
  (data || []).forEach(r => {
    rows.push([r.fecha, r.fuente, bkFmtNum(r.tc_compra), bkFmtNum(r.tc_venta), bkFmtDateTime(r.fetched_at)]);
  });
  return rows;
}

async function bkBuildFacturas(supabase, bccrVenta) {
  const { data } = await supabase.from('invoices').select('*').order('emission_date', { ascending: false });
  const rows = [[
    'Consecutivo', 'Fecha Emisión', 'Proveedor', 'Cédula Prov.', 'Descripción',
    'Placa', 'Moneda', 'Total Original', 'TC', 'Total CRC', 'Total USD',
    'Estado Pago', 'Tipo (Costo/Gasto)', 'Categoría', 'CABYS', 'Método Pago',
    'Vencimiento', 'Actividad Econ.',
  ]];
  (data || []).forEach(inv => {
    const { crc, usd, tc } = bkToBoth(inv.total, inv.currency || 'CRC', inv.exchange_rate, bccrVenta);
    rows.push([
      inv.consecutive || '', bkFmtDate(inv.emission_date),
      inv.supplier_name || '', inv.supplier_id || '',
      (inv.description || '').slice(0, 200),
      inv.plate || '', inv.currency || 'CRC',
      bkFmtNum(inv.total), bkFmtNum(tc), bkFmtNum(crc), bkFmtNum(usd),
      inv.pay_status || '', inv.cost_type || '',
      inv.cabys_label || '', inv.cabys_code || '',
      inv.payment_method || '', bkFmtDate(inv.due_date), inv.activity_code || '',
    ]);
  });
  return rows;
}

async function bkBuildShowroom(supabase, bacVenta, bacCompra) {
  const { data } = await supabase.from('showroom_vehicles').select('*').order('estado').order('brand');
  const rows = [[
    'Estado', 'Placa', 'Marca', 'Modelo', 'Año', 'Color', 'Km',
    'Combustible', 'Transmisión', 'Motor (CC)', 'Estilo',
    'Moneda Precio', 'Precio Original', 'Precio CRC (BAC)', 'Precio USD (BAC)',
    'Vendido', 'Fecha Venta', 'Cliente',
  ]];
  (data || []).forEach(v => {
    const price = parseFloat(v.price) || 0;
    const cur = v.currency || 'USD';
    let priceCRC = 0, priceUSD = 0;
    if (cur === 'USD') {
      priceCRC = bacVenta > 0 ? price * bacVenta : 0;
      priceUSD = price;
    } else {
      priceCRC = price;
      priceUSD = bacCompra > 0 ? price / bacCompra : 0;
    }
    rows.push([
      v.estado || 'DISPONIBLE', v.plate || '',
      v.brand || '', v.model || '', v.year || '',
      v.color || '', v.km || 0,
      v.fuel || '', v.transmission || '', v.engine_cc || '', v.style || '',
      cur, bkFmtNum(price), bkFmtNum(priceCRC), bkFmtNum(priceUSD),
      v.estado === 'VENDIDO' ? 'Sí' : 'No',
      bkFmtDateTime(v.sold_at), v.sold_client_name || '',
    ]);
  });
  return rows;
}

async function bkBuildVendidos(supabase, bccrVenta) {
  const { data } = await supabase.from('showroom_vehicles').select('*').eq('estado', 'VENDIDO').order('sold_at', { ascending: false });
  const rows = [[
    'Fecha Venta', 'Placa', 'Marca', 'Modelo', 'Año', 'Cliente',
    'Tipo Venta', 'Moneda', 'Precio Original', 'TC Venta',
    'Precio CRC', 'Precio USD', 'Comisión Vendedor',
    'Moneda Comisión', 'Ganancia Neta Negocio',
  ]];
  (data || []).forEach(v => {
    const price = parseFloat(v.sold_price_original) || 0;
    const cur = v.sold_price_currency || 'USD';
    const tc = parseFloat(v.sold_exchange_rate) || bccrVenta;
    const priceCRC = cur === 'USD' ? price * tc : price;
    const priceUSD = cur === 'USD' ? price : (tc > 0 ? price / tc : 0);
    const saleType = v.sold_sale_type || 'propio';
    let gananciaNeta = 0;
    if (saleType === 'consignacion_grupo') gananciaNeta = priceCRC * 0.01;
    else if (saleType === 'consignacion_externa') gananciaNeta = priceCRC * 0.04;
    rows.push([
      bkFmtDate(v.sold_at), v.plate || '', v.brand || '', v.model || '', v.year || '',
      v.sold_client_name || '', saleType, cur,
      bkFmtNum(price), bkFmtNum(tc), bkFmtNum(priceCRC), bkFmtNum(priceUSD),
      bkFmtNum(v.sold_commission_amount), v.sold_commission_currency || cur,
      bkFmtNum(gananciaNeta),
    ]);
  });
  return rows;
}

async function bkBuildVentas(supabase) {
  const { data } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
  const rows = [[
    'Nº Plan', 'Fecha Creación', 'Fecha Aprobación', 'Estado',
    'Cliente', 'Cédula', 'Teléfono', 'Email',
    'Placa', 'Vehículo', 'Tipo Venta', 'Moneda', 'Precio Venta', 'TC',
    'Trade-in', 'Prima', 'Señal', 'Saldo',
    'Método Pago', 'Comisión %', 'Comisión Monto', 'Observaciones',
  ]];
  (data || []).forEach(s => {
    rows.push([
      s.sale_number || '', bkFmtDateTime(s.created_at), bkFmtDateTime(s.approved_at), s.status || '',
      s.client_name || '', s.client_cedula || '', s.client_phone1 || '', s.client_email || '',
      s.vehicle_plate || '',
      `${s.vehicle_brand || ''} ${s.vehicle_model || ''} ${s.vehicle_year || ''}`.trim(),
      s.sale_type || '', s.sale_currency || 'USD',
      bkFmtNum(s.sale_price), bkFmtNum(s.sale_exchange_rate),
      bkFmtNum(s.tradein_amount), bkFmtNum(s.down_payment),
      bkFmtNum(s.deposit_signal), bkFmtNum(s.total_balance),
      s.payment_method || '', bkFmtNum(s.commission_pct), bkFmtNum(s.commission_amount),
      (s.observations || '').slice(0, 300),
    ]);
  });
  return rows;
}

async function bkBuildCostos(supabase, bccrVenta, bccrCompra) {
  const { data: purchases } = await supabase.from('showroom_vehicle_costs').select('*');
  const { data: manuals } = await supabase.from('vehicle_manual_costs').select('*').order('cost_date');
  const rows = [[
    'Placa', 'Tipo Costo', 'Concepto', 'Fecha',
    'Moneda Original', 'Monto Original', 'TC Histórico',
    'Monto CRC', 'Monto USD', 'Descripción',
  ]];
  (purchases || []).forEach(p => {
    const { crc, usd, tc } = bkToBoth(p.purchase_cost_amount, p.purchase_cost_currency || 'USD', p.purchase_cost_tc, bccrVenta);
    rows.push([
      p.plate || '', 'Compra', 'Costo de compra',
      bkFmtDate(p.purchase_cost_date),
      p.purchase_cost_currency || 'USD', bkFmtNum(p.purchase_cost_amount),
      bkFmtNum(tc), bkFmtNum(crc), bkFmtNum(usd), '',
    ]);
  });
  (manuals || []).forEach(m => {
    const defaultTc = m.currency === 'USD' ? bccrVenta : bccrCompra;
    const { crc, usd, tc } = bkToBoth(m.amount, m.currency || 'CRC', m.tc, defaultTc);
    rows.push([
      m.plate || '', 'Manual', m.concept || '',
      bkFmtDate(m.cost_date),
      m.currency || 'CRC', bkFmtNum(m.amount),
      bkFmtNum(tc), bkFmtNum(crc), bkFmtNum(usd),
      m.description || '',
    ]);
  });
  return rows;
}

async function bkBuildClientes(supabase) {
  const { data } = await supabase
    .from('sales')
    .select('client_name, client_cedula, client_phone1, client_email, client_address, client_id_type, created_at')
    .not('client_name', 'is', null)
    .order('created_at', { ascending: false });
  const seen = {};
  const rows = [['Nombre', 'Tipo ID', 'Cédula/ID', 'Teléfono', 'Email', 'Dirección', 'Primera venta']];
  (data || []).forEach(s => {
    const key = (s.client_cedula || s.client_name || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    rows.push([
      s.client_name || '', s.client_id_type || '', s.client_cedula || '',
      s.client_phone1 || '', s.client_email || '', s.client_address || '',
      bkFmtDate(s.created_at),
    ]);
  });
  return rows;
}

async function bkBuildPlanillas(supabase) {
  try {
    const { data, error } = await supabase.from('payrolls').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const rows = [[
      'ID', 'Nombre', 'Período Inicio', 'Período Fin', 'Tipo',
      'Total Bruto CRC', 'Total CCSS', 'Total Neto CRC', 'Estado', 'Creada',
    ]];
    (data || []).forEach(p => {
      rows.push([
        p.id || '', p.name || '',
        bkFmtDate(p.period_start), bkFmtDate(p.period_end), p.period_type || '',
        bkFmtNum(p.total_gross), bkFmtNum(p.total_ccss), bkFmtNum(p.total_net),
        p.status || '', bkFmtDateTime(p.created_at),
      ]);
    });
    return rows;
  } catch (e) {
    return [['ID', 'Nombre', 'Período Inicio', 'Período Fin', 'Tipo', 'Total Bruto', 'Total CCSS', 'Total Neto', 'Estado', 'Creada']];
  }
}

async function bkBuildLiquid(supabase) {
  try {
    const { data, error } = await supabase.from('liquidations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const rows = [[
      'ID', 'Fecha', 'Agente', 'Venta #', 'Placa',
      'Moneda', 'Monto Original', 'Monto CRC', 'Estado', 'Notas',
    ]];
    (data || []).forEach(l => {
      rows.push([
        l.id || '', bkFmtDate(l.liquidation_date || l.created_at),
        l.agent_name || '', l.sale_number || '', l.vehicle_plate || '',
        l.currency || '', bkFmtNum(l.amount), bkFmtNum(l.amount_crc),
        l.status || '', l.notes || '',
      ]);
    });
    return rows;
  } catch (e) {
    return [['ID', 'Fecha', 'Agente', 'Venta #', 'Placa', 'Moneda', 'Monto', 'Monto CRC', 'Estado', 'Notas']];
  }
}

function bkBuildResumen(counts, bccr, bac) {
  const fechaStr = new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });
  return [
    ['VCR Manager - Backup Google Sheets'],
    [''],
    ['Última actualización', fechaStr],
    [''],
    ['Tipos de Cambio del día'],
    ['BCCR Compra', bccr?.tc_compra || '—'],
    ['BCCR Venta', bccr?.tc_venta || '—'],
    ['BAC Compra', bac?.tc_compra || '—'],
    ['BAC Venta', bac?.tc_venta || '—'],
    [''],
    ['Resumen de tablas'],
    ['Facturas', counts.facturas],
    ['Showroom (total)', counts.showroom],
    ['Vendidos', counts.vendidos],
    ['Planes de venta', counts.ventas],
    ['Costos registrados', counts.costos],
    ['Clientes únicos', counts.clientes],
    ['Planillas', counts.planillas],
    ['Liquidaciones', counts.liquidaciones],
    ['TCs históricos', counts.tcs],
  ];
}

async function runBackup(supabase) {
  if (!process.env.BACKUP_SHEET_ID) {
    return { ok: false, error: 'BACKUP_SHEET_ID no configurado' };
  }
  const sheetId = process.env.BACKUP_SHEET_ID;
  const accessToken = await bkGetAccessToken();

  const { data: tcToday } = await supabase
    .from('tc_historico').select('*').order('fecha', { ascending: false }).limit(10);
  const bccr = (tcToday || []).find(r => r.fuente === 'bccr');
  const bac = (tcToday || []).find(r => r.fuente === 'bac');
  const bccrVenta = parseFloat(bccr?.tc_venta) || 0;
  const bccrCompra = parseFloat(bccr?.tc_compra) || 0;
  const bacVenta = parseFloat(bac?.tc_venta) || bccrVenta;
  const bacCompra = parseFloat(bac?.tc_compra) || bccrCompra;

  const tabOrder = [
    '_Resumen', 'Tipos_de_Cambio', 'Facturas', 'Showroom', 'Vendidos',
    'Ventas_Planes', 'Costos_Vehiculos', 'Clientes', 'Planillas', 'Liquidaciones',
  ];

  const tabGids = await bkEnsureTabs(accessToken, sheetId, tabOrder);

  const [tcsRows, facturasRows, showroomRows, vendidosRows, ventasRows, costosRows, clientesRows, planillasRows, liquidRows] = await Promise.all([
    bkBuildTCs(supabase),
    bkBuildFacturas(supabase, bccrVenta),
    bkBuildShowroom(supabase, bacVenta, bacCompra),
    bkBuildVendidos(supabase, bccrVenta),
    bkBuildVentas(supabase),
    bkBuildCostos(supabase, bccrVenta, bccrCompra),
    bkBuildClientes(supabase),
    bkBuildPlanillas(supabase),
    bkBuildLiquid(supabase),
  ]);

  const counts = {
    tcs: tcsRows.length - 1,
    facturas: facturasRows.length - 1,
    showroom: showroomRows.length - 1,
    vendidos: vendidosRows.length - 1,
    ventas: ventasRows.length - 1,
    costos: costosRows.length - 1,
    clientes: clientesRows.length - 1,
    planillas: planillasRows.length - 1,
    liquidaciones: liquidRows.length - 1,
  };

  const pages = {
    '_Resumen': bkBuildResumen(counts, bccr, bac),
    'Tipos_de_Cambio': tcsRows,
    'Facturas': facturasRows,
    'Showroom': showroomRows,
    'Vendidos': vendidosRows,
    'Ventas_Planes': ventasRows,
    'Costos_Vehiculos': costosRows,
    'Clientes': clientesRows,
    'Planillas': planillasRows,
    'Liquidaciones': liquidRows,
  };

  const results = {};
  for (const tab of tabOrder) {
    try {
      await bkClearTab(accessToken, sheetId, tab);
      await bkWriteRows(accessToken, sheetId, tab, pages[tab]);
      if (tab !== '_Resumen' && pages[tab].length > 0) {
        try { await bkFormatHeader(accessToken, sheetId, tabGids[tab]); } catch (_) {}
      }
      results[tab] = pages[tab].length - 1;
    } catch (err) {
      results[tab] = `error: ${err.message}`;
    }
  }
  return { ok: true, timestamp: new Date().toISOString(), counts, results };
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

    // Sincronización de tipos de cambio (BCCR + BAC)
    // No bloqueante: si falla, el cron de vehículos igual responde ok
    let tcResult = null;
    try {
      tcResult = await sincronizarTC(supabase);
    } catch (tcErr) {
      tcResult = { ok: false, error: tcErr.message };
    }

    // Backup a Google Sheets (no bloqueante)
    // Se puede saltar con ?skip_backup=1
    let backupResult = null;
    if (req.query.skip_backup !== '1') {
      try {
        backupResult = await runBackup(supabase);
      } catch (bkErr) {
        backupResult = { ok: false, error: bkErr.message };
      }
    } else {
      backupResult = { skipped: true };
    }

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      stats,
      tc: tcResult,
      backup: backupResult,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stats });
  }
}
