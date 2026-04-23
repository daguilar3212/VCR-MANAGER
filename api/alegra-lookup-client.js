// Busca un cliente en Alegra Y consulta Hacienda en paralelo.
// POST /api/alegra-lookup-client
// Body: { cedula: "123456789" }
//
// Response:
// {
//   ok: true,
//   found: true/false,              // si se encontro en Alegra
//   client: {...mapeado de Alegra...} | null,
//   hacienda: {                      // datos oficiales del contribuyente (Hacienda)
//     found: true/false,
//     nombre: "JUAN PEREZ MORA",
//     tipo_identificacion: "01",     // 01=fisica 02=juridica 03=dimex 04=nite
//     regimen: "...",
//     estado: "Inscrito",
//     moroso: "NO",
//     omiso: "NO",
//     actividades: [...]
//   }
// }

import { createClient } from '@supabase/supabase-js';

const HACIENDA_URL = 'https://api.hacienda.go.cr/fe/ae';
const CACHE_TTL_DAYS = 30;

async function consultarHacienda(cedulaLimpia, supabase) {
  // 1. Buscar en cache
  if (supabase) {
    try {
      const { data: cached } = await supabase
        .from('cedula_cache')
        .select('*')
        .eq('identificacion', cedulaLimpia)
        .maybeSingle();

      if (cached) {
        const cacheAge = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60 * 24);
        if (cacheAge < CACHE_TTL_DAYS) {
          if (!cached.found) return { found: false, from_cache: true };
          return {
            found: true,
            from_cache: true,
            nombre: cached.nombre,
            tipo_identificacion: cached.tipo_identificacion,
            regimen: cached.regimen_descripcion,
            estado: cached.situacion_estado,
            moroso: cached.situacion_moroso,
            omiso: cached.situacion_omiso,
            actividades: cached.actividades || [],
          };
        }
      }
    } catch (_) { /* cache falló, seguimos */ }
  }

  // 2. Consultar Hacienda
  let resp;
  try {
    resp = await fetch(
      `${HACIENDA_URL}?identificacion=${encodeURIComponent(cedulaLimpia)}`,
      { method: 'GET', headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
    );
  } catch (err) {
    return { found: false, error: 'Hacienda no disponible' };
  }

  if (resp.status === 404) {
    // Guardamos not found en caché
    if (supabase) {
      try {
        await supabase.from('cedula_cache').upsert({
          identificacion: cedulaLimpia,
          found: false,
          cached_at: new Date().toISOString(),
        }, { onConflict: 'identificacion' });
      } catch (_) {}
    }
    return { found: false };
  }

  if (!resp.ok) return { found: false, error: `Hacienda respondió ${resp.status}` };

  let data;
  try { data = await resp.json(); } catch { return { found: false, error: 'Hacienda JSON inválido' }; }

  // 3. Guardar en caché
  if (supabase) {
    try {
      await supabase.from('cedula_cache').upsert({
        identificacion: cedulaLimpia,
        nombre: data.nombre || null,
        tipo_identificacion: data.tipoIdentificacion || null,
        regimen_codigo: data.regimen?.codigo || null,
        regimen_descripcion: data.regimen?.descripcion || null,
        situacion_moroso: data.situacion?.moroso || null,
        situacion_omiso: data.situacion?.omiso || null,
        situacion_estado: data.situacion?.estado || null,
        administracion_tributaria: data.situacion?.administracionTributaria || null,
        actividades: data.actividades || [],
        found: true,
        cached_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'identificacion' });
    } catch (_) {}
  }

  return {
    found: true,
    from_cache: false,
    nombre: data.nombre,
    tipo_identificacion: data.tipoIdentificacion,
    regimen: data.regimen?.descripcion,
    estado: data.situacion?.estado,
    moroso: data.situacion?.moroso,
    omiso: data.situacion?.omiso,
    actividades: data.actividades || [],
  };
}

// ============================================================
// TC HISTÓRICO DEL BCCR (con caché en Supabase)
// ============================================================
// Usa tipodecambio.paginasweb.cr que acepta fechas pasadas.
// Formato de fecha de entrada: YYYY-MM-DD
// Formato que pide el API: DD/MM/YYYY
// ============================================================
async function consultarTC(fechaYMD, supabase) {
  // 1. Buscar en cache (fuente BCCR específicamente)
  if (supabase) {
    try {
      const { data: cached } = await supabase
        .from('tc_historico')
        .select('*')
        .eq('fecha', fechaYMD)
        .eq('fuente', 'bccr')
        .maybeSingle();

      if (cached && cached.tc_venta) {
        return {
          found: true,
          fecha: fechaYMD,
          tc_compra: parseFloat(cached.tc_compra) || null,
          tc_venta: parseFloat(cached.tc_venta),
          fuente: cached.fuente || 'bccr',
          from_cache: true,
        };
      }
    } catch (_) { /* cache falló, seguimos al BCCR */ }
  }

  // 2. Consultar BCCR (via tipodecambio.paginasweb.cr)
  // Formato requerido: DD/MM/YYYY
  const [y, m, d] = fechaYMD.split('-');
  const fechaBCCR = `${d}/${m}/${y}`;

  let resp;
  try {
    resp = await fetch(`https://tipodecambio.paginasweb.cr/api/${fechaBCCR}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    // BCCR no responde → devolver último TC conocido
    return await ultimoTcConocido(supabase, fechaYMD);
  }

  if (!resp.ok) {
    return await ultimoTcConocido(supabase, fechaYMD);
  }

  let data;
  try { data = await resp.json(); } catch { 
    return await ultimoTcConocido(supabase, fechaYMD);
  }

  const compra = parseFloat(data.compra);
  const venta = parseFloat(data.venta);

  if (!venta || venta <= 0) {
    return await ultimoTcConocido(supabase, fechaYMD);
  }

  // 3. Guardar en caché (PK compuesta fecha,fuente)
  if (supabase) {
    try {
      await supabase.from('tc_historico').upsert({
        fecha: fechaYMD,
        fuente: 'bccr',
        tc_compra: compra || null,
        tc_venta: venta,
        fetched_at: new Date().toISOString(),
      }, { onConflict: 'fecha,fuente' });
    } catch (_) {}
  }

  return {
    found: true,
    fecha: fechaYMD,
    tc_compra: compra || null,
    tc_venta: venta,
    fuente: 'bccr',
    from_cache: false,
  };
}

// Fallback: si BCCR falla, devolver el último TC BCCR conocido en caché
async function ultimoTcConocido(supabase, fechaBuscada) {
  if (!supabase) {
    return { found: false, error: 'BCCR no disponible y no hay caché' };
  }
  try {
    const { data } = await supabase
      .from('tc_historico')
      .select('*')
      .eq('fuente', 'bccr')
      .lte('fecha', fechaBuscada)
      .order('fecha', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && data.tc_venta) {
      return {
        found: true,
        fecha: data.fecha,
        tc_compra: parseFloat(data.tc_compra) || null,
        tc_venta: parseFloat(data.tc_venta),
        fuente: data.fuente || 'bccr',
        from_cache: true,
        warning: `BCCR no disponible. Usando último TC conocido del ${data.fecha}`,
      };
    }
    return { found: false, error: 'BCCR no disponible y no hay TC en caché' };
  } catch (err) {
    return { found: false, error: err.message };
  }
}


async function consultarAlegra(cleanCedula) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  if (!email || !token) return { found: false, error: 'Faltan credenciales Alegra' };

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const url = `https://api.alegra.com/api/v1/contacts?identification=${encodeURIComponent(cleanCedula)}&limit=10`;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    return { found: false, error: 'Alegra no disponible' };
  }

  if (!resp.ok) return { found: false, error: 'Error consultando Alegra' };

  const contacts = await resp.json();
  if (!Array.isArray(contacts) || contacts.length === 0) return { found: false };

  const clients = contacts.filter(c => {
    if (!c.type) return true;
    if (Array.isArray(c.type)) return c.type.includes('client');
    return c.type === 'client';
  });

  const match = clients.length > 0 ? clients[0] : contacts[0];

  const idTypeMap = { '01': 'fisica', '02': 'juridica', '03': 'dimex', '04': 'extranjero' };
  const alegraIdType = match.identificationObject?.type || '01';
  const vcrIdType = idTypeMap[alegraIdType] || 'fisica';

  let address = '';
  if (match.address) {
    if (typeof match.address === 'string') address = match.address;
    else {
      const parts = [match.address.address, match.address.city, match.address.department, match.address.country].filter(Boolean);
      address = parts.join(', ');
    }
  }

  const phone1 = match.mobile || match.phonePrimary || '';
  const phone2 = (match.mobile && match.phonePrimary && match.mobile !== match.phonePrimary)
    ? match.phonePrimary : (match.phoneSecondary || '');

  return {
    found: true,
    client: {
      alegra_contact_id: match.id,
      client_id_type: vcrIdType,
      cedula: match.identification || cleanCedula,
      name: (match.name || '').toUpperCase(),
      phone1, phone2,
      email: (match.email || '').toLowerCase(),
      address,
      workplace: '', occupation: '', civil_status: '',
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Supabase (compartido por ambas acciones)
  let supabase = null;
  try {
    if (process.env.VITE_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      supabase = createClient(
        process.env.VITE_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY,
        { auth: { persistSession: false } }
      );
    }
  } catch (_) {}

  // ============================================================
  // ACCIÓN: Consultar TC histórico
  // Body: { action: 'tc', fecha: 'YYYY-MM-DD' }
  // Si no se pasa fecha, usa hoy.
  // ============================================================
  if (body.action === 'tc') {
    const fechaYMD = body.fecha || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaYMD)) {
      return res.status(400).json({ ok: false, error: 'fecha debe ser YYYY-MM-DD' });
    }
    const tc = await consultarTC(fechaYMD, supabase);
    return res.status(tc.found ? 200 : 404).json({ ok: tc.found, ...tc });
  }

  // ============================================================
  // ACCIÓN DEFAULT: Buscar cliente por cédula (Alegra + Hacienda)
  // ============================================================
  const { cedula } = body;
  if (!cedula || String(cedula).trim() === "") {
    return res.status(400).json({ ok: false, error: 'Falta cedula' });
  }

  const cleanCedula = String(cedula).replace(/[\s-]/g, "").trim();

  // Consultamos Hacienda y Alegra EN PARALELO (más rápido)
  const [hacienda, alegra] = await Promise.all([
    consultarHacienda(cleanCedula, supabase),
    consultarAlegra(cleanCedula),
  ]);

  return res.status(200).json({
    ok: true,
    found: alegra.found,
    client: alegra.found ? alegra.client : null,
    alegra_error: alegra.error || null,
    hacienda,
  });
}
