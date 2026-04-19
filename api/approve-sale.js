// approve-sale.js
// Aprueba un plan de ventas, genera el PDF y lo sube a Google Drive
//
// POST /api/approve-sale
// Body: { sale_id: "uuid" }
//
// Flujo:
// 1. Marca la venta como aprobada en Supabase
// 2. Trae todos los datos (sale + deposits + agents)
// 3. Genera PDF con pdf-lib
// 4. Sube el PDF a Google Drive en carpeta "PLANES DE VENTA"
// 5. Guarda pdf_url en Supabase

import { createClient } from '@supabase/supabase-js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// === CONFIGURACION ===
const FOLDER_NAME = 'PLAN DE VENTAS DIGITAL';
const COMPANY_NAME = 'Vehículos de Costa Rica S.A.';
const COMPANY_CEDULA = '3-101-124464';
const COMPANY_ADDRESS = 'Diagonal a la Plywood, Colima de Tibás';
const COMPANY_PHONE = '2240-8082';
const COMPANY_EMAIL = 'ventas@vehiculosdecr.com';

// Colores (rojo VCR)
const COLOR_PRIMARY = rgb(0.8, 0, 0.09);       // rojo
const COLOR_TEXT = rgb(0.07, 0.07, 0.11);      // casi negro
const COLOR_MUTED = rgb(0.55, 0.56, 0.64);     // gris
const COLOR_SEP = rgb(0.9, 0.9, 0.92);         // gris claro separador

// === HELPERS ===
const fmt = (n, cur) => {
  const num = parseFloat(n) || 0;
  const sym = cur === 'USD' ? '$' : '₡';
  return `${sym}${num.toLocaleString('es-CR', { maximumFractionDigits: 0 })}`;
};

const idTypeLabel = (t) => {
  const map = { fisica: 'Cédula Física', juridica: 'Cédula Jurídica', dimex: 'DIMEX', extranjero: 'Extranjero/Pasaporte' };
  return map[t] || 'Cédula Física';
};

// Obtener access token fresco usando el refresh token
async function getDriveAccessToken() {
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
  if (!data.access_token) throw new Error('No se pudo obtener access token de Drive: ' + JSON.stringify(data));
  return data.access_token;
}

// Buscar o crear la carpeta PLANES DE VENTA
async function getOrCreateFolder(accessToken) {
  // Si ya tenemos el folder ID guardado, usarlo
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    return process.env.GOOGLE_DRIVE_FOLDER_ID;
  }

  // Buscar carpeta existente
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id,name)`;
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchResp.json();

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // No existe, crearla
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const createData = await createResp.json();
  if (!createData.id) throw new Error('No se pudo crear carpeta Drive: ' + JSON.stringify(createData));
  return createData.id;
}

// Subir PDF a Drive con multipart upload
async function uploadToDrive(accessToken, folderId, fileName, pdfBytes) {
  const boundary = '-------boundary' + Date.now();
  const metadata = { name: fileName, parents: [folderId] };
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const endPart = `\r\n--${boundary}--`;

  const metaBuf = new TextEncoder().encode(metaPart);
  const fileHeaderBuf = new TextEncoder().encode(filePart);
  const endBuf = new TextEncoder().encode(endPart);

  const bodyLen = metaBuf.length + fileHeaderBuf.length + pdfBytes.length + endBuf.length;
  const body = new Uint8Array(bodyLen);
  let off = 0;
  body.set(metaBuf, off); off += metaBuf.length;
  body.set(fileHeaderBuf, off); off += fileHeaderBuf.length;
  body.set(pdfBytes, off); off += pdfBytes.length;
  body.set(endBuf, off);

  const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const data = await resp.json();
  if (!data.id) throw new Error('Error subiendo a Drive: ' + JSON.stringify(data));
  return data;
}

// === GENERAR PDF ===
async function generatePDF(sale, deposits, agents) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([595, 842]); // A4 portrait
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  let y = pageHeight - 40;

  // === HEADER ===
  // Empresa a la izquierda (no usamos logo por complejidad - texto grande rojo)
  page.drawText(COMPANY_NAME.toUpperCase(), {
    x: 40, y: y - 10, size: 14, font: fontBold, color: COLOR_PRIMARY,
  });
  page.drawText(`Cédula Jurídica ${COMPANY_CEDULA}`, {
    x: 40, y: y - 26, size: 9, font, color: COLOR_MUTED,
  });
  page.drawText(COMPANY_ADDRESS, {
    x: 40, y: y - 38, size: 9, font, color: COLOR_MUTED,
  });
  page.drawText(`Tel: ${COMPANY_PHONE}  ·  ${COMPANY_EMAIL}`, {
    x: 40, y: y - 50, size: 9, font, color: COLOR_MUTED,
  });

  // Numero de plan a la derecha
  const planNumber = sale.sale_number || sale.id.slice(0, 8).toUpperCase();
  const planNumText = `PLAN #${planNumber}`;
  page.drawText(planNumText, {
    x: pageWidth - 40 - font.widthOfTextAtSize(planNumText, 16),
    y: y - 10, size: 16, font: fontBold, color: COLOR_TEXT,
  });
  const dateText = `Fecha: ${new Date(sale.sale_date || sale.created_at).toLocaleDateString('es-CR')}`;
  page.drawText(dateText, {
    x: pageWidth - 40 - font.widthOfTextAtSize(dateText, 10),
    y: y - 28, size: 10, font, color: COLOR_MUTED,
  });

  y -= 70;
  // Linea separadora
  page.drawRectangle({ x: 40, y, width: pageWidth - 80, height: 2, color: COLOR_PRIMARY });
  y -= 20;

  // === TITULO ===
  page.drawText('PLAN DE VENTAS', {
    x: 40, y, size: 20, font: fontBold, color: COLOR_TEXT,
  });
  y -= 30;

  // === Helper para seccion ===
  const drawSectionTitle = (text) => {
    page.drawText(text.toUpperCase(), {
      x: 40, y, size: 11, font: fontBold, color: COLOR_PRIMARY,
    });
    y -= 4;
    page.drawLine({
      start: { x: 40, y },
      end: { x: pageWidth - 40, y },
      thickness: 0.5, color: COLOR_SEP,
    });
    y -= 14;
  };

  const drawField = (label, value, x, width) => {
    page.drawText(label, { x, y, size: 8, font, color: COLOR_MUTED });
    page.drawText(value || '-', {
      x, y: y - 11, size: 10, font: fontBold, color: COLOR_TEXT,
      maxWidth: width,
    });
  };

  const drawRow = (fields) => {
    const colWidth = (pageWidth - 80) / fields.length;
    fields.forEach((f, i) => {
      drawField(f[0], f[1], 40 + i * colWidth, colWidth - 10);
    });
    y -= 30;
  };

  const checkPageBreak = (needed = 80) => {
    if (y < needed) {
      page = pdfDoc.addPage([595, 842]);
      y = pageHeight - 40;
    }
  };

  // === CLIENTE ===
  drawSectionTitle('Datos del Cliente');
  drawRow([
    [idTypeLabel(sale.client_id_type), sale.client_cedula || ''],
    ['Nombre', (sale.client_name || '').toUpperCase()],
  ]);
  drawRow([
    ['Teléfono 1', sale.client_phone1 || ''],
    ['Teléfono 2', sale.client_phone2 || ''],
  ]);
  drawRow([
    ['Email', sale.client_email || ''],
    ['Estado civil', sale.client_civil_status || ''],
  ]);
  drawRow([
    ['Lugar de trabajo', sale.client_workplace || ''],
    ['Oficio', sale.client_occupation || ''],
  ]);
  if (sale.client_address) {
    page.drawText('DIRECCIÓN', { x: 40, y, size: 8, font, color: COLOR_MUTED });
    page.drawText(sale.client_address, {
      x: 40, y: y - 11, size: 10, font: fontBold, color: COLOR_TEXT, maxWidth: pageWidth - 80,
    });
    y -= 30;
  }

  checkPageBreak(180);

  // === VEHICULO ===
  drawSectionTitle('Vehículo que Compra');
  drawRow([
    ['Placa', sale.vehicle_plate || ''],
    ['Marca', (sale.vehicle_brand || '').toUpperCase()],
    ['Modelo', (sale.vehicle_model || '').toUpperCase()],
  ]);
  drawRow([
    ['Estilo', sale.vehicle_style || ''],
    ['Año', String(sale.vehicle_year || '')],
    ['Color', (sale.vehicle_color || '').toUpperCase()],
  ]);
  drawRow([
    ['Kilometraje', sale.vehicle_km ? Number(sale.vehicle_km).toLocaleString('es-CR') + ' km' : ''],
    ['Cilindrada', sale.vehicle_engine_cc ? sale.vehicle_engine_cc + ' cc' : ''],
    ['Combustible', sale.vehicle_fuel || ''],
  ]);
  drawRow([
    ['Tracción', sale.vehicle_drive || ''],
    ['', ''],
    ['', ''],
  ]);

  // === TRADE-IN ===
  if (sale.has_tradein) {
    checkPageBreak(180);
    drawSectionTitle('Vehículo Recibido (Trade-in)');
    drawRow([
      ['Placa', sale.tradein_plate || ''],
      ['Marca', (sale.tradein_brand || '').toUpperCase()],
      ['Modelo', (sale.tradein_model || '').toUpperCase()],
    ]);
    drawRow([
      ['Año', String(sale.tradein_year || '')],
      ['Color', (sale.tradein_color || '').toUpperCase()],
      ['Kilometraje', sale.tradein_km ? Number(sale.tradein_km).toLocaleString('es-CR') + ' km' : ''],
    ]);
    drawRow([
      ['Tracción', sale.tradein_drive || ''],
      ['Combustible', sale.tradein_fuel || ''],
      ['Valor aplicado', fmt(sale.tradein_value, sale.sale_currency)],
    ]);
  }

  // === CONDICIONES ===
  checkPageBreak(200);
  drawSectionTitle('Condiciones de Venta');
  const saleTypeLabel = {
    propio: 'Venta Propia',
    consignacion_grupo: 'Consignación Grupo (1%)',
    consignacion_externa: 'Consignación Externa (5%)',
  }[sale.sale_type] || sale.sale_type;

  drawRow([
    ['Tipo de venta', saleTypeLabel],
    ['Moneda', sale.sale_currency === 'CRC' ? 'Colones (₡)' : 'Dólares ($)'],
  ]);
  drawRow([
    ['Precio de venta', fmt(sale.sale_price, sale.sale_currency)],
    ['Tipo de cambio (ref.)', sale.sale_exchange_rate ? `₡${sale.sale_exchange_rate}` : '-'],
  ]);
  drawRow([
    ['Vehículo recibido', fmt(sale.tradein_amount, sale.sale_currency)],
    ['Prima', fmt(sale.down_payment, sale.sale_currency)],
    ['Señal', fmt(sale.deposit_signal, sale.sale_currency)],
  ]);
  drawRow([
    ['Depósitos totales', fmt(sale.deposits_total, sale.sale_currency)],
    ['Saldo', fmt(sale.total_balance, sale.sale_currency)],
  ]);

  // === FORMA DE PAGO ===
  if (sale.payment_method) {
    checkPageBreak(100);
    drawSectionTitle('Forma de Pago');
    drawRow([
      ['Forma de pago', sale.payment_method],
      ['Plazo (meses)', String(sale.financing_term_months || '-')],
      ['Interés (%)', String(sale.financing_interest_pct || '-')],
    ]);
    if (sale.financing_amount) {
      drawRow([
        ['Monto financiado', fmt(sale.financing_amount, sale.sale_currency)],
        ['', ''],
        ['', ''],
      ]);
    }
  }

  // === DEPOSITOS ===
  if (deposits && deposits.length > 0) {
    checkPageBreak(60 + deposits.length * 20);
    drawSectionTitle('Depósitos Registrados');
    // Header
    const colX = [40, 160, 300, 400];
    ['Banco', 'Referencia', 'Fecha', 'Monto'].forEach((h, i) => {
      page.drawText(h, { x: colX[i], y, size: 9, font: fontBold, color: COLOR_MUTED });
    });
    y -= 14;
    page.drawLine({ start: { x: 40, y: y + 4 }, end: { x: pageWidth - 40, y: y + 4 }, thickness: 0.3, color: COLOR_SEP });
    deposits.forEach((d) => {
      page.drawText((d.bank || '-').slice(0, 25), { x: colX[0], y, size: 9, font, color: COLOR_TEXT });
      page.drawText((d.reference || '-').slice(0, 20), { x: colX[1], y, size: 9, font, color: COLOR_TEXT });
      page.drawText(d.deposit_date ? new Date(d.deposit_date + 'T12:00:00').toLocaleDateString('es-CR') : '-',
        { x: colX[2], y, size: 9, font, color: COLOR_TEXT });
      page.drawText(fmt(d.amount, sale.sale_currency), { x: colX[3], y, size: 9, font: fontBold, color: COLOR_TEXT });
      y -= 14;
    });
    y -= 10;
  }

  // === OBSERVACIONES ===
  if (sale.observations) {
    checkPageBreak(80);
    drawSectionTitle('Observaciones');
    const words = sale.observations.split(' ');
    let line = '';
    const maxWidth = pageWidth - 80;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, 9) > maxWidth) {
        page.drawText(line, { x: 40, y, size: 9, font, color: COLOR_TEXT });
        y -= 12;
        line = w;
        checkPageBreak(30);
      } else {
        line = test;
      }
    }
    if (line) {
      page.drawText(line, { x: 40, y, size: 9, font, color: COLOR_TEXT });
      y -= 16;
    }
  }

  // === FIRMA ===
  if (sale.client_signature) {
    checkPageBreak(140);
    drawSectionTitle('Firma del Cliente');
    try {
      // client_signature viene como "data:image/png;base64,XXXX..."
      const base64 = sale.client_signature.split(',')[1];
      const sigBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const sigImage = await pdfDoc.embedPng(sigBytes);
      const sigDims = sigImage.scale(0.35);
      const maxW = 240;
      const scale = sigDims.width > maxW ? maxW / sigDims.width : 1;
      const w = sigDims.width * scale;
      const h = sigDims.height * scale;
      page.drawImage(sigImage, { x: 40, y: y - h, width: w, height: h });
      if (sale.signed_at) {
        page.drawText(`Firmado el ${new Date(sale.signed_at).toLocaleDateString('es-CR')} ${new Date(sale.signed_at).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}`, {
          x: 40, y: y - h - 12, size: 8, font, color: COLOR_MUTED,
        });
      }
      y -= h + 30;
    } catch (e) {
      page.drawText('(Error al embeber firma)', { x: 40, y, size: 9, font, color: COLOR_MUTED });
      y -= 20;
    }
  }

  // === PIE ===
  const allPages = pdfDoc.getPages();
  allPages.forEach((p, i) => {
    const footerY = 30;
    p.drawLine({
      start: { x: 40, y: footerY + 10 },
      end: { x: pageWidth - 40, y: footerY + 10 },
      thickness: 0.3, color: COLOR_SEP,
    });
    p.drawText(`Generado por VCR Manager · ${new Date().toLocaleString('es-CR')}`, {
      x: 40, y: footerY, size: 8, font, color: COLOR_MUTED,
    });
    p.drawText(`Página ${i + 1} de ${allPages.length}`, {
      x: pageWidth - 40 - font.widthOfTextAtSize(`Página ${i + 1} de ${allPages.length}`, 8),
      y: footerY, size: 8, font, color: COLOR_MUTED,
    });
  });

  return await pdfDoc.save();
}

// === HANDLER ===
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { sale_id } = req.body || {};
  if (!sale_id) return res.status(400).json({ ok: false, error: 'Falta sale_id' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    // 1. Marcar aprobada
    const { error: updErr } = await supabase.from('sales').update({
      status: 'aprobada',
      approved_by: 'admin',
      approved_at: new Date().toISOString(),
    }).eq('id', sale_id);

    if (updErr) return res.status(500).json({ ok: false, step: 'approve', error: updErr.message });

    // 2. Traer datos completos
    const { data: sale, error: saleErr } = await supabase.from('sales').select('*').eq('id', sale_id).single();
    if (saleErr || !sale) return res.status(404).json({ ok: false, step: 'load', error: 'Venta no encontrada' });

    const { data: deposits } = await supabase.from('sale_deposits').select('*').eq('sale_id', sale_id).order('deposit_date');
    const { data: saleAgents } = await supabase.from('sale_agents').select('*').eq('sale_id', sale_id);

    // 3. Generar PDF
    let pdfBytes;
    try {
      pdfBytes = await generatePDF(sale, deposits || [], saleAgents || []);
    } catch (e) {
      return res.status(200).json({
        ok: true,
        approved: true,
        pdf_generated: false,
        error: 'Venta aprobada pero el PDF falló: ' + e.message,
      });
    }

    // 4. Subir a Drive (si falla, la venta queda aprobada igual)
    try {
      const accessToken = await getDriveAccessToken();
      const folderId = await getOrCreateFolder(accessToken);

      // Nombre del archivo: Plan #NNNN - NOMBRE CLIENTE - YYYY-MM-DD.pdf
      const cleanName = (sale.client_name || 'CLIENTE').toUpperCase().replace(/[^\w\s-]/g, '').trim();
      const planNum = sale.sale_number ? `#${String(sale.sale_number).padStart(4, '0')}` : `#${sale_id.slice(0, 8).toUpperCase()}`;
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `Plan ${planNum} - ${cleanName} - ${dateStr}.pdf`;

      const uploadData = await uploadToDrive(accessToken, folderId, fileName, pdfBytes);

      // 5. Guardar URL en Supabase
      await supabase.from('sales').update({
        pdf_url: uploadData.webViewLink,
        pdf_drive_file_id: uploadData.id,
      }).eq('id', sale_id);

      return res.status(200).json({
        ok: true,
        approved: true,
        pdf_generated: true,
        pdf_url: uploadData.webViewLink,
        file_name: fileName,
      });
    } catch (e) {
      return res.status(200).json({
        ok: true,
        approved: true,
        pdf_generated: true,
        pdf_uploaded: false,
        error: 'Venta aprobada y PDF generado pero upload a Drive falló: ' + e.message,
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
