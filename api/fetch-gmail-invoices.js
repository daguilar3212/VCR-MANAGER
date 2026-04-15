import { getSupabase, getGmailToken, gmailAPI } from './_gmail-helpers.js';

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
  const lineBlocks = tagAll(xmlStr, 'LineaDetalle');
  const plateRx = /\b([A-Z]{2,3}[-\s]?\d{3,6})\b/i;
  let detectedPlate = null;
  const lines = lineBlocks.map(lb => {
    const desc = tag(lb, 'Detalle');
    const pm = desc.match(plateRx);
    if (pm && !detectedPlate) detectedPlate = pm[1].toUpperCase().replace(/\s+/g, '-');
    const impBlock = tagAll(lb, 'Impuesto')[0] || "";
    return {
      line_number: parseInt(tag(lb, 'NumeroLinea') || '1'),
      cabys_code: tag(lb, 'CodigoCABYS'),
      description: desc,
      quantity: parseFloat(tag(lb, 'Cantidad') || '1'),
      unit: tag(lb, 'UnidadMedida'),
      unit_price: parseFloat(tag(lb, 'PrecioUnitario') || '0'),
      subtotal: parseFloat(tag(lb, 'SubTotal') || '0'),
      tax_code: tag(impBlock, 'Codigo'),
      tax_rate: parseFloat(tag(impBlock, 'Tarifa') || '0'),
      tax_amount: parseFloat(tag(impBlock, 'Monto') || '0'),
      line_total: parseFloat(tag(lb, 'MontoTotalLinea') || '0'),
    };
  });

  const groupMap = {
    rep_vehiculos:"costos_ventas", combustible:"costos_ventas", lavado:"costos_ventas",
    herramientas:"costos_ventas", traspaso:"costos_ventas", marchamo:"costos_ventas",
    costo_inv:"costos_merc", ajuste_inv:"costos_merc",
    viaticos_emp:"gastos_generales", atencion_cli:"gastos_generales", seguros:"gastos_generales",
    alquiler:"gastos_generales", serv_publicos:"gastos_generales", oficina:"gastos_generales",
    serv_prof:"gastos_generales", mantenimiento:"gastos_generales", representacion:"gastos_generales",
    impuestos_pat:"gastos_generales", cuotas_susc:"gastos_generales", mensajeria:"gastos_generales",
    aseo:"gastos_generales",
    com_bancarias:"gastos_financieros", intereses:"gastos_financieros",
    otro:"otros_gastos"
  };

  return {
    xml_key: clave, consecutive: consecutivo, last_four: consecutivo.slice(-4),
    emission_date: fechaEmision, supplier_name: supName, supplier_commercial_name: supComm,
    supplier_id: supId, supplier_id_type: supIdType, supplier_email: supEmail, supplier_phone: supPhone,
    currency, exchange_rate: exchangeRate, subtotal, discount_total: discountTotal,
    tax_total: taxTotal, other_charges: otherCharges, other_charges_detail: otherChargesDetail,
    total, payment_method_code: payCode, payment_method_label: payMap[payCode] || payCode,
    is_credit_card: payCode === "02", credit_days: creditDays, detected_plate: detectedPlate,
    category_id: "otro", group_id: "otros_gastos", groupMap,
    assign_status: "unassigned", pay_status: "pending", lines,
  };
}

// Category ID -> Alegra category name mapping
const ALEGRA_NAMES = {
  rep_vehiculos: "Reparaciones de Vehículos",
  combustible: "Combustibles y Lubricantes",
  lavado: "Lavado de Vehiculos",
  herramientas: "Herramientas y Suministros Menores",
  traspaso: "Inscripción y Traspaso",
  marchamo: "Derechos de Circulacion",
  costo_inv: "Inventarios",
  ajuste_inv: "Ajustes al inventario",
  viaticos_emp: "Viaticos a Empleados",
  atencion_cli: "Atencion a Clientes",
  seguros: "Seguro de Vehiculos",
  alquiler: "Alquiler de Local",
  serv_publicos: "Telefonos",
  oficina: "Papeleria y Suministos de Oficina",
  serv_prof: "Servicios Profesionales",
  mantenimiento: "Mantenimiento Propiedades Arrendadas",
  representacion: "Anuncios en Medios",
  impuestos_pat: "Impuestos y Patentes",
  cuotas_susc: "Cuotas y Suscripciones",
  mensajeria: "Mensajeria",
  aseo: "Aseo y Limpieza",
  com_bancarias: "Comisiones Bancarias",
  intereses: "Intereses",
  otro: "Otros Gastos",
};

function classifyByDescription(desc) {
  const d = (desc || "").toLowerCase();
  if (/gasolina|di[eé]sel|gas[oó]leo|combustible|queroseno|nafta|bunker|fuel|lubricant|aceite.*motor|grasa.*lubric/i.test(d)) return "combustible";
  if (/reparaci[oó]n|mantenimiento.*veh|mantenimiento.*auto|mantenimiento.*moto|taller|mec[aá]nic|mufla|transmisi[oó]n|suspensi[oó]n|alineamiento|balanceo|repuesto|neum[aá]tic|llanta|bater[ií]a|pintura.*auto|latoner[ií]a|enderezad|escape|radiador|embrague|amortiguador|buj[ií]a|filtro.*aceite|filtro.*aire|pastilla.*freno|disco.*freno|remolque|gr[uú]a|servicio.*transporte|c[aá]mara.*revers|parlante/i.test(d)) return "rep_vehiculos";
  if (/lavado|car.*wash|limpieza.*veh|encerado|pulido/i.test(d)) return "lavado";
  if (/ferreter[ií]a|tornillo|clavo|herramienta|llave.*mec|destornillador|broca|sierra|taladro|soldadura/i.test(d)) return "herramientas";
  if (/comida|restaurante|suministro.*comida|servicio.*mesa|cafeter[ií]a|alimento.*preparado|pizza|hamburguesa|pollo.*prepar|sushi|ramen|poke|bebida|cerveza|licor|bar\s|soda\s|gallo.*pinto|casado|carne|mariscos|almuerzo|desayuno|cena/i.test(d)) return "viaticos_emp";
  if (/seguro|p[oó]liza|prima.*seguro|asegurad|reaseguro|riesgo.*trabajo/i.test(d)) return "seguros";
  if (/alquiler|arrendamiento|renta.*inmueble|renta.*local|renta.*oficina|administraci[oó]n.*inmueble/i.test(d)) return "alquiler";
  if (/electricidad|el[eé]ctric|energ[ií]a.*el[eé]ctric/i.test(d)) return "serv_publicos";
  if (/agua.*potable|acueducto|alcantarillado/i.test(d)) return "serv_publicos";
  if (/tel[eé]fono|telefon[ií]a|internet|banda.*ancha|cable.*tv|televisi[oó]n.*cable|celular|l[ií]nea.*m[oó]vil/i.test(d)) return "serv_publicos";
  if (/papel|papeler[ií]a|toner|tinta.*impresor|impresora|sobre.*carta|folder|grapas|l[aá]piz|bol[ií]grafo|cuaderno|tarjeta.*presentaci/i.test(d)) return "oficina";
  if (/abogad|notari|contador|contadora|auditor[ií]a|consultor[ií]a|asesor[ií]a|legal|jur[ií]dic|honorarios.*prof|servicio.*contab/i.test(d)) return "serv_prof";
  if (/mantenimiento.*edifici|plomer[ií]a|fontaner|electricista.*instal|aire.*acondicionado|construcci[oó]n|remodelaci[oó]n|ba[nñ]o|pintura.*pared|pintura.*local/i.test(d)) return "mantenimiento";
  if (/publicidad|marketing|dise[ñn]o.*gr[aá]fico|anuncio|promoci[oó]n|redes.*sociales|impresi[oó]n.*publicit|feria|mercadeo/i.test(d)) return "representacion";
  if (/patente|impuesto.*municipal|marchamo|derecho.*circulaci|riteve|revisi[oó]n.*t[eé]cnica/i.test(d)) return "marchamo";
  if (/traspaso|registro.*nacional|inscripci[oó]n.*veh|derechos.*registro/i.test(d)) return "traspaso";
  if (/comisi[oó]n.*bancari|cargo.*bancari|servicio.*bancari/i.test(d)) return "com_bancarias";
  if (/inter[eé]s.*financier|inter[eé]s.*pr[eé]stamo|inter[eé]s.*cr[eé]dito/i.test(d)) return "intereses";
  if (/mensajer[ií]a|env[ií]o|courier|paqueter[ií]a|encomienda/i.test(d)) return "mensajeria";
  if (/aseo|limpieza.*local|limpieza.*oficina|desinfec|biodegradable/i.test(d)) return "aseo";
  if (/cuota|suscripci[oó]n|membres[ií]a|licencia.*software/i.test(d)) return "cuotas_susc";
  if (/alimento.*animal|mascota|perro|gato|veterinari/i.test(d)) return "otro";
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

    const { data: syncData } = await supabase.from('gmail_sync').select('last_sync_at').limit(1).single();
    const since = syncData?.last_sync_at ? new Date(syncData.last_sync_at) : new Date();
    const sinceEpoch = Math.floor(since.getTime() / 1000);

    const query = `has:attachment filename:xml after:${sinceEpoch}`;
    const searchResult = await gmailAPI(`messages?q=${encodeURIComponent(query)}&maxResults=50`, token);

    if (!searchResult.messages || searchResult.messages.length === 0) {
      return res.json({ processed: 0, message: 'No new emails with XML' });
    }

    // Load provider mappings once for all invoices
    const { data: providerMappings } = await supabase.from('provider_mapping').select('*');
    const provMap = {};
    if (providerMappings) {
      providerMappings.forEach(pm => { provMap[pm.supplier_id] = pm; });
    }

    let processed = 0;
    let skipped = 0;
    const errors = [];

    for (const msg of searchResult.messages) {
      const { data: existing } = await supabase.from('invoices').select('id').eq('gmail_message_id', msg.id).limit(1);
      if (existing && existing.length > 0) { skipped++; continue; }

      const fullMsg = await gmailAPI(`messages/${msg.id}?format=full`, token);

      const allParts = findAttachments(fullMsg.payload?.parts || []);
      if (fullMsg.payload?.filename && fullMsg.payload?.body) {
        allParts.push(fullMsg.payload);
      }

      const xmlParts = allParts.filter(p => p.filename?.toLowerCase().endsWith('.xml'));
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

          const { data: existingInv } = await supabase.from('invoices').select('id').eq('xml_key', parsed.xml_key).limit(1);
          if (existingInv && existingInv.length > 0) continue;

          // === CLASSIFICATION: 4-level strategy ===
          let catId = "otro";
          let groupId = "otros_gastos";
          let alegraCategory = null;

          // Level 0: Provider mapping (from Alegra history)
          if (parsed.supplier_id && provMap[parsed.supplier_id]) {
            const pm = provMap[parsed.supplier_id];
            catId = pm.default_category_id;
            groupId = parsed.groupMap[catId] || "otros_gastos";
            alegraCategory = pm.default_alegra_category;
            supabase.from('provider_mapping').update({ 
              times_used: pm.times_used + 1, 
              updated_at: new Date().toISOString() 
            }).eq('supplier_id', parsed.supplier_id).then(() => {});
          }

          // Level 1: cabys_mapping (user corrections)
          if (catId === "otro") {
            for (const line of parsed.lines) {
              if (!line.cabys_code) continue;
              const { data: exact } = await supabase.from('cabys_mapping').select('category_id,group_id').eq('cabys_code', line.cabys_code).limit(1);
              if (exact && exact.length > 0) {
                catId = exact[0].category_id;
                groupId = exact[0].group_id;
                alegraCategory = ALEGRA_NAMES[catId] || null;
                break;
              }
            }
          }

          // Level 2: CABYS catalog description (check ALL lines)
          if (catId === "otro") {
            for (const line of parsed.lines) {
              if (!line.cabys_code) continue;
              const { data: catalog } = await supabase.from('cabys_catalog').select('description').eq('code', line.cabys_code).limit(1);
              if (catalog && catalog.length > 0) {
                const catalogCat = classifyByDescription(catalog[0].description);
                if (catalogCat !== "otro") {
                  catId = catalogCat;
                  groupId = parsed.groupMap[catalogCat] || "otros_gastos";
                  alegraCategory = ALEGRA_NAMES[catId] || null;
                  break;
                }
              }
            }
          }

          // Level 3: Keywords from line descriptions + supplier name
          if (catId === "otro") {
            const allText = parsed.lines.map(l => l.description).join(' ') + ' ' + parsed.supplier_name + ' ' + parsed.supplier_commercial_name;
            const kwCat = classifyByDescription(allText);
            if (kwCat !== "otro") {
              catId = kwCat;
              groupId = parsed.groupMap[kwCat] || "otros_gastos";
              alegraCategory = ALEGRA_NAMES[catId] || null;
            }
          }

          if (!alegraCategory) alegraCategory = ALEGRA_NAMES[catId] || "Otros Gastos";

          // === PLATE DETECTION (all lines) ===
          let plate = parsed.detected_plate;
          let assignStatus = 'unassigned';
          let vehicleId = null;
          let vehicleObservation = null;

          // Extract plate references from descriptions
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
            const { data: vehicle } = await supabase.from('vehicles').select('id,plate').eq('plate', np).limit(1);
            if (vehicle && vehicle.length > 0) {
              assignStatus = 'assigned';
              vehicleId = vehicle[0].id;
              plate = np;
            } else {
              assignStatus = 'warning';
              plate = np;
            }
          }

          const { data: inv, error: invError } = await supabase.from('invoices').insert({
            xml_key: parsed.xml_key, consecutive: parsed.consecutive, last_four: parsed.last_four,
            emission_date: parsed.emission_date, supplier_name: parsed.supplier_name,
            supplier_commercial_name: parsed.supplier_commercial_name,
            supplier_id: parsed.supplier_id, supplier_id_type: parsed.supplier_id_type,
            supplier_email: parsed.supplier_email, supplier_phone: parsed.supplier_phone,
            currency: parsed.currency, exchange_rate: parsed.exchange_rate,
            subtotal: parsed.subtotal, discount_total: parsed.discount_total,
            tax_total: parsed.tax_total, other_charges: parsed.other_charges,
            other_charges_detail: parsed.other_charges_detail, total: parsed.total,
            payment_method_code: parsed.payment_method_code,
            payment_method_label: parsed.payment_method_label,
            is_credit_card: parsed.is_credit_card, credit_days: parsed.credit_days,
            detected_plate: parsed.detected_plate, plate, vehicle_id: vehicleId,
            assign_status: assignStatus, group_id: groupId,
            category_id: catId, pay_status: 'pending',
            alegra_category: alegraCategory,
            vehicle_observation: vehicleObservation,
            gmail_message_id: msg.id,
            gmail_date: fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate)).toISOString() : null,
            raw_xml: xmlContent,
          }).select().single();

          if (invError) { errors.push(invError.message); continue; }

          if (parsed.lines.length > 0 && inv) {
            const lineRows = parsed.lines.map(l => ({ ...l, invoice_id: inv.id }));
            await supabase.from('invoice_lines').insert(lineRows);
          }

          // Auto-learn: save new provider mapping
          if (catId !== "otro" && parsed.supplier_id && !provMap[parsed.supplier_id]) {
            await supabase.from('provider_mapping').upsert({
              supplier_id: parsed.supplier_id,
              supplier_name: parsed.supplier_name,
              default_category_id: catId,
              default_alegra_category: alegraCategory,
              times_used: 1,
            }, { onConflict: 'supplier_id' }).then(() => {});
          }

          processed++;
        } catch (xmlErr) {
          errors.push(`XML error: ${xmlErr.message}`);
        }
      }
    }

    await supabase.from('gmail_sync').update({ last_sync_at: new Date().toISOString() }).not('id', 'is', null);

    return res.json({ processed, skipped, total: searchResult.messages.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    console.error('Gmail fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
