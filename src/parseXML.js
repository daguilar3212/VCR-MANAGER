const GROUPS = [
  {id:"costos_ventas",l:"Costos de Ventas y Operación"},
  {id:"costos_merc",l:"Costos de la Mercancía Vendida"},
  {id:"gastos_personal",l:"Gastos de Personal"},
  {id:"gastos_generales",l:"Gastos Generales"},
  {id:"gastos_financieros",l:"Gastos Financieros"},
  {id:"otros_gastos",l:"Otros Gastos"},
];

const CATS = [
  {id:"rep_vehiculos",g:"costos_ventas",l:"Reparaciones de Vehículos"},
  {id:"combustible",g:"costos_ventas",l:"Combustibles y Lubricantes"},
  {id:"lavado",g:"costos_ventas",l:"Lavado de Vehículos"},
  {id:"herramientas",g:"costos_ventas",l:"Herramientas y Suministros"},
  {id:"traspaso",g:"costos_ventas",l:"Inscripción y Traspaso"},
  {id:"marchamo",g:"costos_ventas",l:"Derechos de Circulación"},
  {id:"costo_inv",g:"costos_merc",l:"Costos del Inventario"},
  {id:"ajuste_inv",g:"costos_merc",l:"Ajustes al Inventario"},
  {id:"sueldos",g:"gastos_personal",l:"Sueldos"},
  {id:"cargas_sociales",g:"gastos_personal",l:"Cargas Sociales"},
  {id:"comisiones_p",g:"gastos_personal",l:"Comisiones"},
  {id:"aguinaldos",g:"gastos_personal",l:"Aguinaldos"},
  {id:"viaticos_emp",g:"gastos_generales",l:"Viáticos a Empleados"},
  {id:"atencion_cli",g:"gastos_generales",l:"Atención a Clientes"},
  {id:"seguros",g:"gastos_generales",l:"Seguro de Vehículos"},
  {id:"alquiler",g:"gastos_generales",l:"Alquiler de Local"},
  {id:"serv_publicos",g:"gastos_generales",l:"Servicios Públicos"},
  {id:"oficina",g:"gastos_generales",l:"Gastos de Oficina"},
  {id:"serv_prof",g:"gastos_generales",l:"Servicios Profesionales"},
  {id:"mantenimiento",g:"gastos_generales",l:"Mantenimiento y Conservación"},
  {id:"cuotas_susc",g:"gastos_generales",l:"Cuotas y Suscripciones"},
  {id:"impuestos_pat",g:"gastos_generales",l:"Impuestos y Patentes"},
  {id:"representacion",g:"gastos_generales",l:"Gastos de Representación"},
  {id:"com_bancarias",g:"gastos_financieros",l:"Comisiones Bancarias"},
  {id:"intereses",g:"gastos_financieros",l:"Intereses Financieros"},
  {id:"otro",g:"otros_gastos",l:"Otro"},
];

function autoCat(cabys) {
  if (!cabys) return "otro";
  if (cabys.startsWith("19") || cabys.startsWith("23")) return "combustible";
  if (/^(871|872|873|452)/.test(cabys)) return "rep_vehiculos";
  if (/^(633|634|561|562|563)/.test(cabys)) return "viaticos_emp";
  if (/^(851|852)/.test(cabys)) return "seguros";
  if (/^(681|682)/.test(cabys)) return "alquiler";
  if (/^(353|354)/.test(cabys)) return "serv_publicos";
  if (/^(812|813)/.test(cabys)) return "lavado";
  return "otro";
}

function autoGroup(catId) {
  const cat = CATS.find(c => c.id === catId);
  return cat ? cat.g : "otros_gastos";
}

const plateRx = /\b([A-Z]{2,3}[-\s]?\d{3,6})\b/i;

export function parseXML(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");
  const ns = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica";
  
  const g = (el, t) => {
    const n = el.getElementsByTagNameNS(ns, t)[0] || el.getElementsByTagName(t)[0];
    return n ? n.textContent.trim() : "";
  };
  const ga = (el, t) => {
    const r = el.getElementsByTagNameNS(ns, t);
    return r.length ? r : el.getElementsByTagName(t);
  };

  const em = ga(doc, "Emisor")[0];
  const rs = ga(doc, "ResumenFactura")[0];
  const con = g(doc, "NumeroConsecutivo");
  const lns = ga(doc, "LineaDetalle");
  const oc = ga(doc, "OtrosCargos")[0];
  const mp = rs ? ga(rs, "MedioPago")[0] : null;
  
  const payMap = {"01":"Efectivo","02":"Tarjeta","03":"Cheque","04":"Transferencia","05":"Recaudado terceros","99":"Otros"};
  const pCode = mp ? g(mp, "TipoMedioPago") : "";

  let detectedPlate = null;
  const lines = [];
  
  for (let i = 0; i < lns.length; i++) {
    const l = lns[i];
    const detail = g(l, "Detalle");
    const pm = detail.match(plateRx);
    if (pm && !detectedPlate) detectedPlate = pm[1].toUpperCase().replace(/\s+/g, "-");
    const imp = ga(l, "Impuesto")[0];
    lines.push({
      line_number: parseInt(g(l, "NumeroLinea")),
      cabys_code: g(l, "CodigoCABYS"),
      description: detail,
      quantity: parseFloat(g(l, "Cantidad") || "1"),
      unit: g(l, "UnidadMedida"),
      unit_price: parseFloat(g(l, "PrecioUnitario") || "0"),
      subtotal: parseFloat(g(l, "SubTotal") || "0"),
      tax_code: imp ? g(imp, "Codigo") : "",
      tax_rate: imp ? parseFloat(g(imp, "Tarifa") || "0") : 0,
      tax_amount: imp ? parseFloat(g(imp, "Monto") || "0") : 0,
      line_total: parseFloat(g(l, "MontoTotalLinea") || "0"),
    });
  }

  const catId = autoCat(lines[0]?.cabys_code || "");
  const groupId = autoGroup(catId);
  const curNode = rs ? ga(rs, "CodigoTipoMoneda")[0] : null;

  return {
    xml_key: g(doc, "Clave"),
    consecutive: con,
    last_four: con.slice(-4),
    emission_date: g(doc, "FechaEmision"),
    supplier_name: em ? g(em, "Nombre") : "",
    supplier_commercial_name: em ? g(em, "NombreComercial") : "",
    supplier_id: em ? g(ga(em, "Identificacion")[0] || em, "Numero") : "",
    supplier_id_type: em ? g(ga(em, "Identificacion")[0] || em, "Tipo") : "",
    supplier_email: em ? g(em, "CorreoElectronico") : "",
    supplier_phone: em ? (() => { const tel = ga(em, "Telefono")[0]; return tel ? g(tel, "NumTelefono") : ""; })() : "",
    currency: curNode ? g(curNode, "CodigoMoneda") : "CRC",
    exchange_rate: curNode ? parseFloat(g(curNode, "TipoCambio") || "1") : 1,
    subtotal: rs ? parseFloat(g(rs, "TotalVentaNeta") || "0") : 0,
    discount_total: rs ? parseFloat(g(rs, "TotalDescuentos") || "0") : 0,
    tax_total: rs ? parseFloat(g(rs, "TotalImpuesto") || "0") : 0,
    other_charges: rs ? parseFloat(g(rs, "TotalOtrosCargos") || "0") : 0,
    other_charges_detail: oc ? g(oc, "Detalle") : "",
    total: rs ? parseFloat(g(rs, "TotalComprobante") || "0") : 0,
    payment_method_code: pCode,
    payment_method_label: payMap[pCode] || pCode,
    is_credit_card: pCode === "02",
    credit_days: parseInt(g(doc, "PlazoCredito") || "0"),
    detected_plate: detectedPlate,
    category_id: catId,
    group_id: groupId,
    lines,
  };
}

export { GROUPS, CATS, autoCat, autoGroup };
