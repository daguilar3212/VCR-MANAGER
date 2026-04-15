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
  const payCode = tag(medioPagoBlock, 'TipoMedioPago');
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
  const cabys0 = lines[0]?.cabys_code || "";
  let catId = "otro";
  if (cabys0.startsWith("333")) catId = "combustible";
  else if (/^(871|872|873|452)/.test(cabys0)) catId = "rep_vehiculos";
  else if (/^(633|634|561|562|563)/.test(cabys0)) catId = "viaticos_emp";
  else if (/^(851|852)/.test(cabys0)) catId = "seguros";
  else if (/^(681|682)/.test(cabys0)) catId = "alquiler";
  else if (/^(353|354)/.test(cabys0)) catId = "serv_publicos";
  else if (/^(812|813)/.test(cabys0)) catId = "lavado";
  const groupMap = {rep_vehiculos:"costos_ventas",combustible:"costos_ventas",lavado:"costos_ventas",herramientas:"costos_ventas",traspaso:"costos_ventas",marchamo:"costos_ventas",costo_inv:"costos_merc",viaticos_emp:"gastos_generales",atencion_cli:"gastos_generales",seguros:"gastos_generales",alquiler:"gastos_generales",serv_publicos:"gastos_generales",oficina:"gastos_generales",serv_prof:"gastos_generales",mantenimiento:"gastos_generales",otro:"otros_gastos"};
  return {
    xml_key: clave, consecutive: consecutivo, last_four: consecutivo.slice(-4),
    emission_date: fechaEmision, supplier_name: supName, supplier_commercial_name: supComm,
    supplier_id: supId, supplier_id_type: supIdType, supplier_email: supEmail, supplier_phone: supPhone,
    currency, exchange_rate: exchangeRate, subtotal, discount_total: discountTotal,
    tax_total: taxTotal, other_charges: otherCharges, other_charges_detail: otherChargesDetail,
    total, payment_method_code: payCode, payment_method_label: payMap[payCode] || payCode,
    is_credit_card: payCode === "02", credit_days: creditDays, detected_plate: detectedPlate,
    category_id: catId, group_id: groupMap[catId] || "otros_gastos",
    assign_status: "unassigned", pay_status: "pending", lines,
  };
}

// Recursively find all attachments in a message
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

    let processed = 0;
    let skipped = 0;
    const errors = [];

    for (const msg of searchResult.messages) {
      const { data: existing } = await supabase.from('invoices').select('id').eq('gmail_message_id', msg.id).limit(1);
      if (existing && existing.length > 0) { skipped++; continue; }

      const fullMsg = await gmailAPI(`messages/${msg.id}?format=full`, token);

      // Find ALL attachments recursively
      const allParts = findAttachments(fullMsg.payload?.parts || []);
      // Also check top-level payload
      if (fullMsg.payload?.filename && fullMsg.payload?.body) {
        allParts.push(fullMsg.payload);
      }

      // Find XML files (exclude response XMLs from Hacienda which contain "MensajeHacienda" or "respuesta")
      const xmlParts = allParts.filter(p => p.filename?.toLowerCase().endsWith('.xml'));

      if (xmlParts.length === 0) { skipped++; continue; }

      // Process each XML in the email
      for (const xmlPart of xmlParts) {
        try {
          const attachmentData = await gmailAPI(
            `messages/${msg.id}/attachments/${xmlPart.body.attachmentId}`, token
          );

          const xmlContent = Buffer.from(attachmentData.data, 'base64url').toString('utf-8');

          // Skip Hacienda response XMLs (they contain MensajeHacienda tag)
          if (xmlContent.includes('MensajeHacienda') || xmlContent.includes('ConfirmacionComprobante')) {
            continue;
          }

          // Must be a FacturaElectronica
          if (!xmlContent.includes('FacturaElectronica') && !xmlContent.includes('TiqueteElectronico')) {
            continue;
          }

          const parsed = parseXMLServer(xmlContent);

          if (!parsed.xml_key) continue;

          // Check if already exists
          const { data: existingInv } = await supabase.from('invoices').select('id').eq('xml_key', parsed.xml_key).limit(1);
          if (existingInv && existingInv.length > 0) continue;

          // Lookup CABYS mapping (exact match first, then prefix)
          const cabysLookup = parsed.lines[0]?.cabys_code || "";
          if (cabysLookup) {
            const { data: exact } = await supabase.from('cabys_mapping').select('category_id,group_id').eq('cabys_code', cabysLookup).limit(1);
            if (exact && exact.length > 0) {
              parsed.category_id = exact[0].category_id;
              parsed.group_id = exact[0].group_id;
            } else {
              const prefix = cabysLookup.substring(0, 4);
              const { data: prefixMatch } = await supabase.from('cabys_mapping').select('category_id,group_id').eq('cabys_code', prefix).limit(1);
              if (prefixMatch && prefixMatch.length > 0) {
                parsed.category_id = prefixMatch[0].category_id;
                parsed.group_id = prefixMatch[0].group_id;
              }
            }
          }

          // Match plate against vehicles
          let plate = parsed.detected_plate;
          let assignStatus = 'unassigned';
          let vehicleId = null;

          if (plate) {
            const { data: vehicle } = await supabase.from('vehicles').select('id,plate').eq('plate', plate).limit(1);
            if (vehicle && vehicle.length > 0) {
              assignStatus = 'assigned';
              vehicleId = vehicle[0].id;
            } else {
              assignStatus = 'warning';
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
            assign_status: assignStatus, group_id: parsed.group_id,
            category_id: parsed.category_id, pay_status: 'pending',
            gmail_message_id: msg.id,
            gmail_date: fullMsg.internalDate ? new Date(parseInt(fullMsg.internalDate)).toISOString() : null,
            raw_xml: xmlContent,
          }).select().single();

          if (invError) { errors.push(invError.message); continue; }

          if (parsed.lines.length > 0 && inv) {
            const lineRows = parsed.lines.map(l => ({ ...l, invoice_id: inv.id }));
            await supabase.from('invoice_lines').insert(lineRows);
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
