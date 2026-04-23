import { createClient } from '@supabase/supabase-js';

// Helpers de Gmail (antes en _gmail-helpers.js, fusionado aqui)
function getSupabase() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getGmailToken() {
  const supabase = getSupabase();
  const { data } = await supabase.from('gmail_sync').select('*').limit(1).single();
  if (!data) throw new Error('Gmail not connected');

  // Check if token expired
  if (new Date(data.token_expiry) < new Date()) {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: data.refresh_token,
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });
    const newTokens = await refreshRes.json();
    if (newTokens.error) throw new Error('Token refresh failed: ' + newTokens.error);

    await supabase.from('gmail_sync').update({
      access_token: newTokens.access_token,
      token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    }).eq('id', data.id);

    return newTokens.access_token;
  }

  return data.access_token;
}

async function gmailAPI(path, token) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status}`);
  return res.json();
}

function parseXMLServer(xmlStr) {
  const tag = (str, t) => {
    const rx = new RegExp(`<(?:[\\w]+:)?${t}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${t}>`, 'i');
    const m = str.match(rx);
    return m ? m[1].trim() : "";
  };
  const tagAll = (str, t) => {
    const rx = new RegExp(`<(?:[\\w]+:)?${t}[^>]*>[\\s\\S]*?<\\/(?:[\\w]+:)?${t}>`, 'gi');
    return str.match(rx) || [];
  };

  const clave = tag(xmlStr, 'Clave');
  const consecutivo = tag(xmlStr, 'NumeroConsecutivo');
  const fechaEmision = tag(xmlStr, 'FechaEmision');
  const emisorBlock = tagAll(xmlStr, 'Emisor')[0] || "";
  const supName = tag(emisorBlock, 'Nombre');
  const supComm = tag(emisorBlock, 'NombreComercial');
  const idBlock = tagAll(emisorBlock, 'Identificacion')[0] || "";
  const supId = tag(idBlock, 'Numero');
  const supIdType = tag(idBlock, 'Tipo');
  const supEmail = tag(emisorBlock, 'CorreoElectronico');
  const telBlock = tagAll(emisorBlock, 'Telefono')[0] || "";
  const supPhone = tag(telBlock, 'NumTelefono');
  const ubicacionBlock = tagAll(emisorBlock, 'Ubicacion')[0] || "";
  const supCanton = tag(ubicacionBlock, 'Canton') || tag(ubicacionBlock, 'NombreCanton');
  const supAddress = tag(emisorBlock, 'OtrasSenas');
  const resumenBlock = tagAll(xmlStr, 'ResumenFactura')[0] || "";
  const monedaBlock = tagAll(resumenBlock, 'CodigoTipoMoneda')[0] || "";
  const currency = tag(monedaBlock, 'CodigoMoneda') || 'CRC';
  const exchangeRate = parseFloat(tag(monedaBlock, 'TipoCambio') || '1');
  const subtotal = parseFloat(tag(resumenBlock, 'TotalVentaNeta') || '0');
  const discountTotal = parseFloat(tag(resumenBlock, 'TotalDescuentos') || '0');
  const taxTotal = parseFloat(tag(resumenBlock, 'TotalImpuesto') || '0');
  const otherCharges = parseFloat(tag(resumenBlock, 'TotalOtrosCargos') || '0');
  const total = parseFloat(tag(resumenBlock, 'TotalComprobante') || '0');
  const medioPagoBlock = tagAll(resumenBlock, 'MedioPago')[0] || "";
  const payCode = tag(medioPagoBlock, 'TipoMedioPago') || tag(resumenBlock, 'MedioPago');
  const payMap = {"01":"Efectivo","02":"Tarjeta","03":"Cheque","04":"Transferencia","05":"Recaudado terceros","99":"Otros"};
  const otrosCargosBlock = tagAll(xmlStr, 'OtrosCargos')[0] || "";
  const otherChargesDetail = tag(otrosCargosBlock, 'Detalle');
  const creditDays = parseInt(tag(xmlStr, 'PlazoCredito') || '0');
  let dueDate = null;
  if (fechaEmision && creditDays > 0) {
    const d = new Date(fechaEmision);
    d.setDate(d.getDate() + creditDays);
    dueDate = d.toISOString().split('T')[0];
  } else if (fechaEmision) {
    dueDate = fechaEmision.split('T')[0];
  }
  const idTypeMap = {"01":"Cédula Física","02":"Cédula Jurídica","03":"DIMEX","04":"NITE"};
  const supIdTypeLabel = idTypeMap[supIdType] || supIdType;
  const lineBlocks = tagAll(xmlStr, 'LineaDetalle');
  const plateRx = /\b([A-Z]{2,3}[-\s]?\d{3,6})\b/i;
  let detectedPlate = null;
  const lines = lineBlocks.map(lb => {
    const desc = tag(lb, 'Detalle');
    const pm = desc.match(plateRx);
    if (pm && !detectedPlate) detectedPlate = pm[1].toUpperCase().replace(/\s+/g, '-');
    const impBlock = tagAll(lb, 'Impuesto')[0] || "";
    const descuentoBlock = tagAll(lb, 'Descuento')[0] || "";
    const discPct = parseFloat(tag(descuentoBlock, 'NaturalezaDescuento') ? tag(lb, 'MontoDescuento') : '0');
    const lineSubtotal = parseFloat(tag(lb, 'SubTotal') || '0');
    const montoDesc = parseFloat(tag(lb, 'MontoDescuento') || '0');
    const discountPct = lineSubtotal > 0 && montoDesc > 0 ? (montoDesc / lineSubtotal * 100) : 0;
    return {
      line_number: parseInt(tag(lb, 'NumeroLinea') || '1'),
      cabys_code: tag(lb, 'CodigoCABYS'),
      description: desc,
      observation: desc,
      quantity: parseFloat(tag(lb, 'Cantidad') || '1'),
      unit: tag(lb, 'UnidadMedida'),
      unit_price: parseFloat(tag(lb, 'PrecioUnitario') || '0'),
      subtotal: lineSubtotal,
      discount_pct: Math.round(discountPct * 100) / 100,
      discount_amount: montoDesc,
      tax_code: tag(impBlock, 'Codigo'),
      tax_rate: parseFloat(tag(impBlock, 'Tarifa') || '0'),
      tax_amount: parseFloat(tag(impBlock, 'Monto') || '0'),
      line_total: parseFloat(tag(lb, 'MontoTotalLinea') || '0'),
    };
  });

  const groupMap = {
    herramientas:"costos_ventas", lavado:"costos_ventas", combustible:"costos_ventas",
    rep_vehiculos:"costos_ventas", traspaso:"costos_ventas", marchamo:"costos_ventas",
    costo_inv:"costos_merc", ajuste_inv:"costos_merc",
    sueldos:"gastos_personal", cargas_sociales:"gastos_personal", comisiones_p:"gastos_personal",
    aguinaldos:"gastos_personal", riesgos_trabajo:"gastos_personal",
    atencion_cli:"gastos_generales", viaticos_emp:"gastos_generales",
    gastos_viaje:"gastos_generales", uniformes:"gastos_generales",
    aseo:"gastos_generales", mensajeria:"gastos_generales", oficina:"gastos_generales",
    seguros:"gastos_generales", seguro_licencias:"gastos_generales",
    mantenimiento:"gastos_generales", mant_maquinaria:"gastos_generales",
    cuotas_susc:"gastos_generales",
    patentes_mun:"gastos_generales", imp_territoriales:"gastos_generales",
    timbre_edu:"gastos_generales", imp_pers_jur:"gastos_generales", iva_soportado:"gastos_generales",
    serv_prof:"gastos_generales", alquiler:"gastos_generales",
    serv_publicos:"gastos_generales", agua:"gastos_generales",
    electricidad:"gastos_generales", internet_cable:"gastos_generales",
    representacion:"gastos_generales", ferias:"gastos_generales",
    com_bancarias:"gastos_financieros", intereses:"gastos_financieros",
    intereses_daniel:"gastos_financieros", intereses_sonia:"gastos_financieros",
    gastos_no_ded:"otros_gastos", contrib_parafisc:"otros_gastos",
    otro:"otros_gastos"
  };

  return {
    xml_key: clave, consecutive: consecutivo, last_four: consecutivo.slice(-4),
    emission_date: fechaEmision, supplier_name: supName, supplier_commercial_name: supComm,
    supplier_id: supId, supplier_id_type: supIdType, supplier_id_type_label: supIdTypeLabel,
    supplier_email: supEmail, supplier_phone: supPhone,
    supplier_address: supAddress, supplier_canton: supCanton,
    currency, exchange_rate: exchangeRate, subtotal, discount_total: discountTotal,
    tax_total: taxTotal, other_charges: otherCharges, other_charges_detail: otherChargesDetail,
    total, payment_method_code: payCode, payment_method_label: payMap[payCode] || payCode,
    is_credit_card: payCode === "02", credit_days: creditDays, due_date: dueDate,
    detected_plate: detectedPlate,
    category_id: "otro", group_id: "otros_gastos", groupMap,
    assign_status: "unassigned", pay_status: "pending", lines,
  };
}

const ALEGRA_MAP = {
  herramientas:      {name:"Herramientas y Suministros Menores",    aid:"5319"},
  lavado:            {name:"Lavado de Vehiculos",                    aid:"5292"},
  combustible:       {name:"Combustibles y Lubricantes",             aid:"5291"},
  rep_vehiculos:     {name:"Reparaciones de Vehículos",              aid:"5290"},
  traspaso:          {name:"Gastos de Inscripcion y Traspaso",       aid:"5289"},
  marchamo:          {name:"Derechos de Circulacion",                aid:"5288"},
  costo_inv:         {name:"Costos del inventario",                  aid:"5147"},
  ajuste_inv:        {name:"Ajustes al inventario",                  aid:"5148"},
  sueldos:           {name:"Sueldos",                                aid:"5155"},
  cargas_sociales:   {name:"Cargas Sociales",                        aid:"5157"},
  comisiones_p:      {name:"Comisiones",                             aid:"5158"},
  aguinaldos:        {name:"Aguinaldos",                             aid:"5160"},
  riesgos_trabajo:   {name:"Poliza de Riesgos del Trabajo",          aid:"5159"},
  atencion_cli:      {name:"Atencion a Clientes",                    aid:"5327"},
  viaticos_emp:      {name:"Viaticos a Empleados",                   aid:"5326"},
  gastos_viaje:      {name:"Gastos de Viaje",                        aid:"5325"},
  uniformes:         {name:"Uniformes para el Personal",             aid:"5324"},
  aseo:              {name:"Aseo y Limpieza",                        aid:"5329"},
  mensajeria:        {name:"Mensajeria",                             aid:"5328"},
  oficina:           {name:"Papeleria y Suministos de Oficina",      aid:"5193"},
  seguros:           {name:"Seguro de Vehiculos",                    aid:"5202"},
  seguro_licencias:  {name:"Seguro de Licencias",                    aid:"5201"},
  mantenimiento:     {name:"Mantenimiento Propiedades Arrendadas",   aid:"5213"},
  mant_maquinaria:   {name:"Mantenimiento de Maquinaria y Herramientas", aid:"5339"},
  cuotas_susc:       {name:"Cuotas y Suscripciones",                 aid:"5331"},
  patentes_mun:      {name:"Patentes Municipales",                   aid:"5335"},
  imp_territoriales: {name:"Impuestos Municipales y Territoriales",  aid:"5333"},
  timbre_edu:        {name:"Timbre de Educacion y Cultura",          aid:"5334"},
  imp_pers_jur:      {name:"Impuesto a las Personas Juridicas",      aid:"5340"},
  iva_soportado:     {name:"Gasto por IVA Soportado",                aid:"5336"},
  serv_prof:         {name:"Servicios Profesionales",                aid:"5341"},
  alquiler:          {name:"Alquiler de Local",                      aid:"5179"},
  serv_publicos:     {name:"Telefonos",                              aid:"5185"},
  agua:              {name:"Agua",                                   aid:"5183"},
  electricidad:      {name:"Energia Electrica",                      aid:"5184"},
  internet_cable:    {name:"Internet y Cable",                       aid:"5186"},
  representacion:    {name:"Anuncios en Medios",                     aid:"5337"},
  ferias:            {name:"Ferias y Otros de Mercadeo",             aid:"5338"},
  com_bancarias:     {name:"Comisiones Bancarias",                   aid:"5308"},
  intereses:         {name:"Gastos por Intereses financieros",       aid:"5227"},
  intereses_daniel:  {name:"Intereses Daniel Aguilar Akerman",       aid:"5304"},
  intereses_sonia:   {name:"Intereses Sonia Azofeifa Villalobos",    aid:"5305"},
  gastos_no_ded:     {name:"Gastos no Deducibles de ISR",            aid:"5311"},
  contrib_parafisc:  {name:"Contribuciones Parafiscales",            aid:"5312"},
  otro:              {name:null, aid:null},
};

const SUPPLIER_ID_CATEGORY = {
  "4000042138": "agua",
  "3101000046": "electricidad",
  "116050012":  "intereses_daniel",
  "400880609":  "intereses_sonia",
  "3101412271": "gastos_viaje",
  "3101460251": "uniformes",
  "3101708345": "ferias",
};

function classifyINS(desc) {
  const d = (desc || "").toLowerCase();
  if (/licencia/i.test(d)) return "seguro_licencias";
  if (/riesgo.*trabajo|riesgos.*laborales/i.test(d)) return "riesgos_trabajo";
  return "seguros";
}

function classifyImpuestos(desc) {
  const d = (desc || "").toLowerCase();
  if (/patente.*municipal|licencia.*comercial/i.test(d)) return "patentes_mun";
  if (/bienes.*inmuebles|impuesto.*territorial|impuesto.*bienes/i.test(d)) return "imp_territoriales";
  if (/timbre.*educaci|educaci[oó]n.*cultura/i.test(d)) return "timbre_edu";
  if (/personas.*jur[ií]dicas|impuesto.*persona.*jur/i.test(d)) return "imp_pers_jur";
  if (/iva.*soportado|iva.*soportada/i.test(d)) return "iva_soportado";
  return null;
}

function classifyByDescription(desc) {
  const d = (desc || "").toLowerCase();
  if (/gasolina|di[eé]sel|gas[oó]leo|combustible|queroseno|nafta|bunker|fuel|lubricant|aceite.*motor|grasa.*lubric/i.test(d)) return "combustible";
  if (/reparaci[oó]n|mantenimiento.*veh|mantenimiento.*auto|mantenimiento.*moto|taller|mec[aá]nic|mufla|transmisi[oó]n|suspensi[oó]n|alineamiento|balanceo|repuesto|neum[aá]tic|llanta|bater[ií]a|pintura.*auto|latoner[ií]a|enderezad|escape|radiador|embrague|amortiguador|buj[ií]a|filtro.*aceite|filtro.*aire|pastilla.*freno|disco.*freno|remolque|gr[uú]a|servicio.*transporte|c[aá]mara.*revers|parlante/i.test(d)) return "rep_vehiculos";
  if (/lavado|car.*wash|limpieza.*veh|encerado|pulido/i.test(d)) return "lavado";
  if (/ferreter[ií]a|tornillo|clavo|herramienta|llave.*mec|destornillador|broca|sierra|taladro|soldadura/i.test(d)) return "herramientas";
  if (/comida|restaurante|suministro.*comida|servicio.*mesa|cafeter[ií]a|alimento.*preparado|pizza|hamburguesa|pollo.*prepar|sushi|ramen|poke|bebida|cerveza|licor|bar\s|soda\s|gallo.*pinto|casado|carne|mariscos|almuerzo|desayuno|cena/i.test(d)) return "viaticos_emp";
  if (/hotel|hospedaje|alojamiento|hostal|posada/i.test(d)) return "gastos_viaje";
  if (/uniforme|camisa.*empresa|camiseta.*logo|gorra.*empresa/i.test(d)) return "uniformes";
  if (/seguro.*licencia/i.test(d)) return "seguro_licencias";
  if (/riesgo.*trabajo|riesgos.*laborales/i.test(d)) return "riesgos_trabajo";
  if (/seguro|p[oó]liza|prima.*seguro|asegurad|reaseguro/i.test(d)) return "seguros";
  if (/alquiler|arrendamiento|renta.*inmueble|renta.*local|renta.*oficina|administraci[oó]n.*inmueble/i.test(d)) return "alquiler";
  if (/agua.*potable|acueducto|alcantarillado/i.test(d)) return "agua";
  if (/electricidad|el[eé]ctric|energ[ií]a.*el[eé]ctric/i.test(d)) return "electricidad";
  if (/internet|banda.*ancha|cable.*tv|televisi[oó]n.*cable|fibra.*[oó]ptica/i.test(d)) return "internet_cable";
  if (/tel[eé]fono|telefon[ií]a|celular|l[ií]nea.*m[oó]vil/i.test(d)) return "serv_publicos";
  if (/papel|papeler[ií]a|toner|tinta.*impresor|impresora|sobre.*carta|folder|grapas|l[aá]piz|bol[ií]grafo|cuaderno|tarjeta.*presentaci/i.test(d)) return "oficina";
  if (/abogad|notari|contador|contadora|auditor[ií]a|consultor[ií]a|asesor[ií]a|legal|jur[ií]dic|honorarios.*prof|servicio.*contab/i.test(d)) return "serv_prof";
  if (/mantenimiento.*edifici|plomer[ií]a|fontaner|electricista.*instal|aire.*acondicionado|construcci[oó]n|remodelaci[oó]n|ba[nñ]o|pintura.*pared|pintura.*local/i.test(d)) return "mantenimiento";
  if (/mantenimiento.*maquinaria|mantenimiento.*equipo.*pesado|reparaci[oó]n.*maquinaria/i.test(d)) return "mant_maquinaria";
  if (/feria|exhibici[oó]n|mercadeo.*evento|stand.*publicit/i.test(d)) return "ferias";
  if (/publicidad|marketing|dise[ñn]o.*gr[aá]fico|anuncio|promoci[oó]n|redes.*sociales|impresi[oó]n.*publicit/i.test(d)) return "representacion";
  const impSub = classifyImpuestos(d);
  if (impSub) return impSub;
  if (/marchamo|derecho.*circulaci|riteve|revisi[oó]n.*t[eé]cnica/i.test(d)) return "marchamo";
  if (/traspaso|registro.*nacional|inscripci[oó]n.*veh|derechos.*registro/i.test(d)) return "traspaso";
  if (/comisi[oó]n.*bancari|cargo.*bancari|servicio.*bancari/i.test(d)) return "com_bancarias";
  if (/inter[eé]s.*financier|inter[eé]s.*pr[eé]stamo|inter[eé]s.*cr[eé]dito/i.test(d)) return "intereses";
  if (/mensajer[ií]a|env[ií]o|courier|paqueter[ií]a|encomienda/i.test(d)) return "mensajeria";
  if (/aseo|limpieza.*local|limpieza.*oficina|desinfec|biodegradable/i.test(d)) return "aseo";
  if (/cuota|suscripci[oó]n|membres[ií]a|licencia.*software/i.test(d)) return "cuotas_susc";
  return "otro";
}

function findAttachments(parts, result = []) {
  if (!parts) return result;
  for (const part of parts) {
    if (part.filename && part.filename.length > 0 && part.body) {
      result.push(part);
    }
    if (part.parts) {
      findAttachments(part.parts, result);
    }
  }
  return result;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const token = await getGmailToken();
    const supabase = getSupabase();

    const customAfter = req.query?.after;
    let sinceEpoch;
    if (customAfter) {
      sinceEpoch = Math.floor(new Date(customAfter).getTime() / 1000);
    } else {
      const { data: syncData } = await supabase.from('gmail_sync').select('last_sync_at').limit(1).single();
      const since = syncData?.last_sync_at ? new Date(syncData.last_sync_at) : new Date();
      sinceEpoch = Math.floor(since.getTime() / 1000);
    }

    const query = `has:attachment filename:xml after:${sinceEpoch}`;
    let allMessages = [];
    let pageToken = null;
    let pageCount = 0;

    do {
      const url = `messages?q=${encodeURIComponent(query)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
      const page = await gmailAPI(url, token);
      if (page.messages) allMessages.push(...page.messages);
      pageToken = page.nextPageToken || null;
      pageCount++;
      if (pageCount > 10) break;
    } while (pageToken);

    if (allMessages.length === 0) {
      return res.json({ processed: 0, skipped: 0, rejected: 0, total: 0, pages: pageCount, message: 'No new emails with XML' });
    }

    const VALID_RECEPTOR_IDS = ['3101124464'];
    const VALID_RECEPTOR_NAMES = ['vehiculos de costa rica', 'vehiculos de cr'];

    const { data: providerMappings } = await supabase.from('provider_mapping').select('*');
    const provMap = {};
    if (providerMappings) {
      providerMappings.forEach(pm => { provMap[pm.supplier_id] = pm; });
    }

    let processed = 0;
    let skipped = 0;
    let rejected = 0;
    let pdfsUploaded = 0;
    const rejectedList = [];
    const errors = [];

    for (const msg of allMessages) {
      const { data: existing } = await supabase.from('invoices').select('id').eq('gmail_message_id', msg.id).limit(1);
      if (existing && existing.length > 0) { skipped++; continue; }

      const fullMsg = await gmailAPI(`messages/${msg.id}?format=full`, token);

      const allParts = findAttachments(fullMsg.payload?.parts || []);
      if (fullMsg.payload?.filename && fullMsg.payload?.body) {
        allParts.push(fullMsg.payload);
      }

      const xmlParts = allParts.filter(p => p.filename?.toLowerCase().endsWith('.xml'));
      const pdfParts = allParts.filter(p => p.filename?.toLowerCase().endsWith('.pdf'));

      if (xmlParts.length === 0) { skipped++; continue; }

      for (const xmlPart of xmlParts) {
        try {
          const attachmentData = await gmailAPI(
            `messages/${msg.id}/attachments/${xmlPart.body.attachmentId}`, token
          );

          const xmlContent = Buffer.from(attachmentData.data, 'base64url').toString('utf-8');

          if (xmlContent.includes('MensajeHacienda') || xmlContent.includes('ConfirmacionComprobante')) continue;
          if (!xmlContent.includes('FacturaElectronica') && !xmlContent.includes('TiqueteElectronico')) continue;

          const parsed = parseXMLServer(xmlContent);
          if (!parsed.xml_key) continue;

          const receptorBlock = (xmlContent.match(/<(?:[\w]+:)?Receptor[\s\S]*?<\/(?:[\w]+:)?Receptor>/i) || [""])[0];
          const recIdBlock = (receptorBlock.match(/<(?:[\w]+:)?Identificacion[\s\S]*?<\/(?:[\w]+:)?Identificacion>/i) || [""])[0];
          const recId = (recIdBlock.match(/<(?:[\w]+:)?Numero[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Numero>/i) || ["",""])[1].trim();
          const recName = (receptorBlock.match(/<(?:[\w]+:)?Nombre[^>]*>([\s\S]*?)<\/(?:[\w]+:)?Nombre>/i) || ["",""])[1].trim().toLowerCase();
          
          const isValidReceptor = VALID_RECEPTOR_IDS.includes(recId) || 
            VALID_RECEPTOR_NAMES.some(n => recName.includes(n));
          
          if (!isValidReceptor) {
            rejected++;
            rejectedList.push({
              emisor: parsed.supplier_name,
              emisor_id: parsed.supplier_id,
              receptor: recName || 'Sin nombre',
              receptor_id: recId || 'Sin cédula',
              consecutivo: parsed.consecutive,
              fecha: parsed.emission_date,
              total: parsed.total,
              razon: !recId ? 'Sin receptor identificado' : `Receptor ${recId} no es VCR (3101124464)`
            });
            continue;
          }

          const { data: existingInv } = await supabase.from('invoices').select('id').eq('xml_key', parsed.xml_key).limit(1);
          if (existingInv && existingInv.length > 0) continue;

          let catId = "otro";
          let groupId = "otros_gastos";
          let alegraCategory = null;
          let alegraAccountId = null;

          if (parsed.supplier_id && SUPPLIER_ID_CATEGORY[parsed.supplier_id]) {
            catId = SUPPLIER_ID_CATEGORY[parsed.supplier_id];
            groupId = parsed.groupMap[catId] || "otros_gastos";
          }

          if (catId === "otro" && parsed.supplier_id === "4000001902") {
            const allText = parsed.lines.map(l => l.description).join(' ');
            catId = classifyINS(allText);
            groupId = parsed.groupMap[catId] || "gastos_generales";
          }

          if (catId === "otro" && parsed.supplier_id && provMap[parsed.supplier_id]) {
            const pm = provMap[parsed.supplier_id];
            catId = pm.default_category_id;
            groupId = parsed.groupMap[catId] || "otros_gastos";
            if (pm.force_payment_method) {
              const payMap = {"01":"Efectivo","02":"Tarjeta","03":"Cheque","04":"Transferencia","05":"Recaudado terceros","99":"Otros"};
              parsed.payment_method_code = pm.force_payment_method;
              parsed.payment_method_label = payMap[pm.force_payment_method] || pm.force_payment_method;
              parsed.is_credit_card = pm.force_payment_method === "02";
            }
            supabase.from('provider_mapping').update({ 
              times_used: (pm.times_used || 0) + 1, 
              updated_at: new Date().toISOString() 
            }).eq('supplier_id', parsed.supplier_id).then(() => {});
          }

          if (catId === "otro") {
            for (const line of parsed.lines) {
              if (!line.cabys_code) continue;
              const { data: exact } = await supabase.from('cabys_mapping').select('category_id,group_id').eq('cabys_code', line.cabys_code).limit(1);
              if (exact && exact.length > 0) {
                catId = exact[0].category_id;
                groupId = exact[0].group_id;
                break;
              }
            }
          }

          if (catId === "otro") {
            for (const line of parsed.lines) {
              if (!line.cabys_code) continue;
              const { data: catalog } = await supabase.from('cabys_catalog').select('description').eq('code', line.cabys_code).limit(1);
              if (catalog && catalog.length > 0) {
                const catalogCat = classifyByDescription(catalog[0].description);
                if (catalogCat !== "otro") {
                  catId = catalogCat;
                  groupId = parsed.groupMap[catalogCat] || "otros_gastos";
                  break;
                }
              }
            }
          }

          if (catId === "otro") {
            const allText = parsed.lines.map(l => l.description).join(' ') + ' ' + parsed.supplier_name + ' ' + parsed.supplier_commercial_name;
            const kwCat = classifyByDescription(allText);
            if (kwCat !== "otro") {
              catId = kwCat;
              groupId = parsed.groupMap[kwCat] || "otros_gastos";
            }
          }

          if (ALEGRA_MAP[catId]) {
            alegraCategory = ALEGRA_MAP[catId].name;
            alegraAccountId = ALEGRA_MAP[catId].aid;
          }

          let isVehiclePurchase = false;
          for (const line of parsed.lines) {
            const code = line.cabys_code || "";
            if (code.startsWith('491') || code.startsWith('492')) {
              const lineAmt = line.line_total || 0;
              const isSignificant = (parsed.currency === 'USD' && lineAmt >= 3000) || 
                                    (parsed.currency !== 'USD' && lineAmt >= 2000000);
              if (isSignificant) {
                isVehiclePurchase = true;
                break;
              }
            }
          }
          if (isVehiclePurchase) {
            catId = "costo_inv";
            groupId = "costos_merc";
            alegraCategory = ALEGRA_MAP.costo_inv.name;
            alegraAccountId = ALEGRA_MAP.costo_inv.aid;
            parsed.payment_method_code = "04";
            parsed.payment_method_label = "Transferencia";
            parsed.is_credit_card = false;
          }

          if (catId === "viaticos_emp") {
            parsed.payment_method_code = "02";
            parsed.payment_method_label = "Tarjeta";
            parsed.is_credit_card = true;
          }

          let plate = parsed.detected_plate;
          let assignStatus = 'unassigned';
          let vehicleId = null;
          let vehicleObservation = null;

          const plateRx2 = /\b([A-Z]{2,3}[-\s]?\d{3,6})\b/gi;
          const clRx = /\b(CL[-\s]?\d{5,7})\b/gi;
          const allDescs = parsed.lines.map(l => l.description).join(' ');
          const foundPlates = [...(allDescs.match(plateRx2) || []), ...(allDescs.match(clRx) || [])];
          if (foundPlates.length > 0 && !plate) {
            plate = foundPlates[0].toUpperCase().replace(/\s+/g, '-');
          }
          if (foundPlates.length > 0) {
            vehicleObservation = foundPlates.map(p => p.toUpperCase().replace(/\s+/g, '-')).join(', ');
          }

          if (plate) {
            const np = plate.toUpperCase().replace(/\s+/g, '-');
            // 1. Buscar primero en vehicles (fleet Cartastic - si existe en este proyecto)
            const { data: vehicle } = await supabase.from('vehicles').select('id,plate').eq('plate', np).limit(1);
            if (vehicle && vehicle.length > 0) {
              assignStatus = 'assigned';
              vehicleId = vehicle[0].id;
              plate = np;
            } else {
              // 2. Buscar en showroom_vehicles (dealership VCR)
              const { data: showroomV } = await supabase.from('showroom_vehicles').select('id,plate').eq('plate', np).limit(1);
              if (showroomV && showroomV.length > 0) {
                assignStatus = 'assigned';
                // No guardamos vehicle_id (esa columna apunta a 'vehicles'), pero la placa queda linkeada
                plate = np;
              } else {
                assignStatus = 'warning';
                plate = np;
              }
            }
          }

          // PDF: bajar y subir a Storage con timeout por PDF y limite total
          let pdfStoragePath = null;
          let pdfAttachmentInfo = null;
          if (pdfParts.length > 0) {
            pdfAttachmentInfo = {
              message_id: msg.id,
              attachment_id: pdfParts[0].body.attachmentId,
              filename: pdfParts[0].filename,
            };
            if (pdfsUploaded < 30) {
              try {
                const pdfPromise = (async () => {
                  const pdfPart = pdfParts[0];
                  const pdfData = await gmailAPI(
                    `messages/${msg.id}/attachments/${pdfPart.body.attachmentId}`, token
                  );
                  const pdfBuffer = Buffer.from(pdfData.data, 'base64url');
                  const filename = `${parsed.xml_key}.pdf`;
                  const { error: upErr } = await supabase.storage
                    .from('invoice-pdfs')
                    .upload(filename, pdfBuffer, {
                      contentType: 'application/pdf',
                      upsert: true,
                    });
                  if (upErr) throw new Error(upErr.message);
                  return filename;
                })();
                
                const timeoutPromise = new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('PDF timeout')), 5000)
                );
                
                pdfStoragePath = await Promise.race([pdfPromise, timeoutPromise]);
                if (pdfStoragePath) pdfsUploaded++;
              } catch (pdfErr) {
                errors.push(`PDF ${parsed.xml_key}: ${pdfErr.message}`);
              }
            }
          }

          const { data: inv, error: invError } = await supabase.from('invoices').insert({
            xml_key: parsed.xml_key, consecutive: parsed.consecutive, last_four: parsed.last_four,
            emission_date: parsed.emission_date, supplier_name: parsed.supplier_name,
            supplier_commercial_name: parsed.supplier_commercial_name,
            supplier_id: parsed.supplier_id, supplier_id_type: parsed.supplier_id_type,
            supplier_email: parsed.supplier_email, supplier_phone: parsed.supplier_phone,
            supplier_address: parsed.supplier_address, supplier_canton: parsed.supplier_canton,
            currency: parsed.currency, exchange_rate: parsed.exchange_rate,
            subtotal: parsed.subtotal, discount_total: parsed.discount_total,
            tax_total: parsed.tax_total, other_charges: parsed.other_charges,
            other_charges_detail: parsed.other_charges_detail, total: parsed.total,
            payment_method_code: parsed.payment_method_code,
            payment_method_label: parsed.payment_method_label,
            is_credit_card: parsed.is_credit_card, credit_days: parsed.credit_days,
            due_date: parsed.due_date,
            detected_plate: parsed.detected_plate, plate, vehicle_id: vehicleId,
            assign_status: assignStatus, group_id: groupId,
            category_id: catId, pay_status: 'pending',
            alegra_category: alegraCategory,
            alegra_account_id: alegraAccountId,
            alegra_code: parsed.last_four,
            alegra_bodega: 'Principal',
            alegra_sync_status: 'pending',
            pdf_storage_path: pdfStoragePath,
            pdf_attachment_info: pdfAttachmentInfo,
            vehicle_observation: vehicleObservation,
            is_vehicle_purchase: isVehiclePurchase,
            vehicle_purchase_status: isVehiclePurchase ? 'detected' : null,
            gmail_message_id: msg.id,
            gmail_date: fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate)).toISOString() : null,
            raw_xml: xmlContent,
          }).select().single();

          if (invError) { errors.push(invError.message); continue; }

          if (parsed.lines.length > 0 && inv) {
            const lineRows = parsed.lines.map(l => ({ ...l, invoice_id: inv.id }));
            await supabase.from('invoice_lines').insert(lineRows);
          }

          if (catId !== "otro" && parsed.supplier_id && !provMap[parsed.supplier_id] && !SUPPLIER_ID_CATEGORY[parsed.supplier_id]) {
            await supabase.from('provider_mapping').upsert({
              supplier_id: parsed.supplier_id,
              supplier_name: parsed.supplier_name,
              default_category_id: catId,
              default_alegra_category: alegraCategory,
              alegra_account_id: alegraAccountId,
              times_used: 1,
            }, { onConflict: 'supplier_id' }).then(() => {});
          }

          processed++;
        } catch (xmlErr) {
          errors.push(`XML error: ${xmlErr.message}`);
        }
      }
    }

    if (!customAfter) {
      await supabase.from('gmail_sync').update({ last_sync_at: new Date().toISOString() }).not('id', 'is', null);
    }

    return res.json({ 
      processed, skipped, rejected, pdfsUploaded,
      total: allMessages.length, 
      pages: pageCount,
      rejectedList: rejectedList.length > 0 ? rejectedList : undefined,
      errors: errors.length > 0 ? errors : undefined 
    });
  } catch (err) {
    console.error('Gmail fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
