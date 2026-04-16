import { useState, useMemo, useEffect } from "react";
import { supabase } from './supabase.js';

const cars = [
  {p:"BVQ934",b:"Hyundai",m:"Tucson",y:2022,co:"Blanco",km:60000,f:"Gasolina",dr:"4x4",st:"SUV",usd:27900,crc:13172000,s:"disponible"},
  {p:"CL306089",b:"Toyota",m:"Hilux",y:2018,co:"Blanco",km:116000,f:"Diesel",dr:"4x4",st:"PICK UP",usd:32000,crc:15108000,s:"disponible"},
  {p:"BYH-390",b:"Mitsubishi",m:"Montero Sport",y:2023,co:"Gris",km:51900,f:"Diesel",dr:"4x4",st:"SUV",usd:48500,crc:22898000,s:"disponible"},
  {p:"BWX-020",b:"Toyota",m:"Yaris",y:2022,co:"Gris",km:50000,f:"Gasolina",dr:"4x2",st:"SEDAN",usd:18000,crc:8498000,s:"reservado"},
  {p:"MJW-999",b:"Porsche",m:"Cayenne",y:2018,co:"Negro",km:115000,f:"Diesel",dr:"4x4",st:"SUV",usd:56000,crc:26439000,s:"disponible"},
  {p:"BYD-440",b:"Toyota",m:"Prado TX-L",y:2023,co:"Blanco",km:56000,f:"Diesel",dr:"4x4",st:"SUV",usd:61000,crc:28800000,s:"disponible"},
  {p:"CONSIGNA",b:"Ford",m:"Ranger Wildtrak",y:2022,co:"Gris",km:32000,f:"Diesel",dr:"4x4",st:"PICK UP",usd:47900,crc:22615000,s:"disponible"},
  {p:"BNK-915",b:"BMW",m:"X6",y:2017,co:"Blanco",km:99000,f:"Diesel",dr:"4x4",st:"SUV",usd:45500,crc:21482000,s:"disponible"},
  {p:"DEM-003",b:"Jeep",m:"Wrangler",y:2020,co:"Verde",km:58000,f:"Gasolina",dr:"4x4",st:"SUV",usd:45000,crc:21240000,s:"reservado"},
  {p:"DEM-004",b:"Honda",m:"Civic",y:2023,co:"Azul",km:25000,f:"Gasolina",dr:"4x2",st:"SEDAN",usd:26000,crc:12272000,s:"disponible"},
  {p:"CBP-424",b:"Toyota",m:"RAV4",y:2024,co:"Blanco",km:44900,f:"Gasolina",dr:"4x4",st:"SUV",usd:34000,crc:16052000,s:"disponible"},
  {p:"GCR-909",b:"Kia",m:"Sportage",y:2016,co:"Azul",km:117000,f:"Gasolina",dr:"4x2",st:"SUV",usd:15000,crc:6850000,s:"disponible"},
];

const GROUPS = [
  {id:"costos_ventas",l:"Costos de Ventas y Operación",t:"costo"},
  {id:"costos_merc",l:"Costos de la Mercancía Vendida",t:"costo"},
  {id:"gastos_personal",l:"Gastos de Personal",t:"gasto"},
  {id:"gastos_generales",l:"Gastos Generales",t:"gasto"},
  {id:"gastos_financieros",l:"Gastos Financieros",t:"gasto"},
  {id:"otros_gastos",l:"Otros Gastos",t:"gasto"},
];

const CATS = [
  // COSTOS - Ventas y Operación
  {id:"herramientas",g:"costos_ventas",l:"Herramientas y Suministros",a:"Herramientas y Suministros Menores"},
  {id:"lavado",g:"costos_ventas",l:"Lavado de Vehículos",a:"Lavado de Vehiculos"},
  {id:"combustible",g:"costos_ventas",l:"Combustibles y Lubricantes",a:"Combustibles y Lubricantes"},
  {id:"rep_vehiculos",g:"costos_ventas",l:"Reparaciones de Vehículos",a:"Reparaciones de Vehículos"},
  {id:"traspaso",g:"costos_ventas",l:"Gastos de Inscripción y Traspaso",a:"Gastos de Inscripcion y Traspaso"},
  {id:"marchamo",g:"costos_ventas",l:"Derechos de Circulación",a:"Derechos de Circulacion"},
  // COSTOS - Mercancía vendida
  {id:"costo_inv",g:"costos_merc",l:"Costos del Inventario",a:"Costos del inventario"},
  {id:"ajuste_inv",g:"costos_merc",l:"Ajustes al Inventario",a:"Ajustes al inventario"},
  // GASTOS - Personal
  {id:"sueldos",g:"gastos_personal",l:"Sueldos",a:"Sueldos"},
  {id:"cargas_sociales",g:"gastos_personal",l:"Cargas Sociales",a:"Cargas Sociales"},
  {id:"comisiones_p",g:"gastos_personal",l:"Comisiones",a:"Comisiones"},
  {id:"aguinaldos",g:"gastos_personal",l:"Aguinaldos",a:"Aguinaldos"},
  // GASTOS - Generales > Representación
  {id:"atencion_cli",g:"gastos_generales",l:"Atención a Clientes",a:"Atencion a Clientes"},
  {id:"viaticos_emp",g:"gastos_generales",l:"Viáticos a Empleados",a:"Viaticos a Empleados"},
  // GASTOS - Generales > Oficina
  {id:"aseo",g:"gastos_generales",l:"Aseo y Limpieza",a:"Aseo y Limpieza"},
  {id:"mensajeria",g:"gastos_generales",l:"Mensajería",a:"Mensajeria"},
  {id:"oficina",g:"gastos_generales",l:"Papelería y Suministros de Oficina",a:"Papeleria y Suministos de Oficina"},
  // GASTOS - Generales > Seguros
  {id:"seguros",g:"gastos_generales",l:"Seguro de Vehículos",a:"Seguro de Vehiculos"},
  // GASTOS - Generales > Mantenimiento
  {id:"mantenimiento",g:"gastos_generales",l:"Mantenimiento Propiedades Arrendadas",a:"Mantenimiento Propiedades Arrendadas"},
  // GASTOS - Generales > Cuotas
  {id:"cuotas_susc",g:"gastos_generales",l:"Cuotas y Suscripciones",a:"Cuotas y Suscripciones"},
  // GASTOS - Generales > Impuestos
  {id:"impuestos_pat",g:"gastos_generales",l:"Impuestos y Patentes",a:"Impuestos y Patentes"},
  // GASTOS - Generales > Servicios Profesionales
  {id:"serv_prof",g:"gastos_generales",l:"Servicios Profesionales",a:"Servicios Profesionales"},
  // GASTOS - Generales > Alquileres
  {id:"alquiler",g:"gastos_generales",l:"Alquiler de Local",a:"Alquiler de Local"},
  // GASTOS - Generales > Servicios Públicos
  {id:"serv_publicos",g:"gastos_generales",l:"Servicios Públicos (Tel/Agua/Luz)",a:"Telefonos"},
  // GASTOS - Generales > Publicidad
  {id:"representacion",g:"gastos_generales",l:"Publicidad y Mercadeo",a:"Anuncios en Medios"},
  // GASTOS - Financieros
  {id:"com_bancarias",g:"gastos_financieros",l:"Comisiones Bancarias",a:"Comisiones Bancarias"},
  {id:"intereses",g:"gastos_financieros",l:"Intereses Financieros",a:"Gastos por Intereses financieros"},
  // OTROS
  {id:"otro",g:"otros_gastos",l:"Otro",a:"Otros Gastos"},
];

const fmt = (n, c) => {
  if (n == null || isNaN(n)) return "-";
  return (c === "USD" ? "$" : "₡") + Number(n).toLocaleString("es-CR", {minimumFractionDigits:0, maximumFractionDigits:0});
};
const fK = (n) => Number(n).toLocaleString("es-CR") + " km";
const tabs = ["Dashboard","Inventario","Facturas","Costos","Clientes","Ventas","Pagos","Planillas","Reportes"];

const S = {
  card: {background:"#181a23",borderRadius:14,border:"1px solid #2a2d3d",overflow:"hidden"},
  badge: (c) => ({fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:20,color:c,background:c+"18",whiteSpace:"nowrap"}),
  modal: {position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16},
  mbox: {background:"#0f1117",borderRadius:20,maxWidth:600,width:"100%",maxHeight:"85vh",overflow:"auto",padding:"22px 26px"},
  inp: {background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:8,padding:"8px 12px",color:"#e8eaf0",fontSize:13,fontFamily:"inherit",outline:"none"},
  sel: {background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:8,padding:"8px 12px",color:"#e8eaf0",fontSize:13,fontFamily:"inherit",outline:"none",cursor:"pointer"},
  g2: {display:"grid",gridTemplateColumns:"1fr 1fr",gap:1,background:"#2a2d3d",borderRadius:12,overflow:"hidden",marginBottom:16},
  gc: {background:"#181a23",padding:"8px 14px"},
  gl: {fontSize:9,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:.4,marginBottom:1},
  gv: {fontSize:13,fontWeight:600,color:"#e8eaf0"},
};

const catLabel = (id) => CATS.find(c => c.id === id)?.l || "Otro";
const catGroupId = (id) => CATS.find(c => c.id === id)?.g || "otros_gastos";
const catGroupLabel = (id) => { const gid = CATS.find(c => c.id === id)?.g; return GROUPS.find(g => g.id === gid)?.l || "Otros"; };
const catType = (id) => { const gid = CATS.find(c => c.id === id)?.g; return GROUPS.find(g => g.id === gid)?.t || "gasto"; };
const supDisplay = (inv) => inv.supComm && inv.supComm !== "NoAplica" ? inv.supComm : inv.supName;

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [pickedInv, setPickedInv] = useState(null);
  const [fCat, setFCat] = useState("all");
  const [fPay, setFPay] = useState("all");
  const [fAssign, setFAssign] = useState("all");
  const [fType, setFType] = useState("all");
  const [selectedInvs, setSelectedInvs] = useState(new Set());
  const [costView, setCostView] = useState("vehicles");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [rejectedInvs, setRejectedInvs] = useState([]);
  const [showRejected, setShowRejected] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [vehicleForm, setVehicleForm] = useState(null);

  // Sales state
  const [sales, setSales] = useState([]);
  const [agents, setAgents] = useState([]);
  const [salesView, setSalesView] = useState("list"); // list, form, preview
  const [saleForm, setSaleForm] = useState(null);
  const [pickedSale, setPickedSale] = useState(null);
  const [saleFilter, setSaleFilter] = useState("all");
  const [printSale, setPrintSale] = useState(null);

  // Load data on mount
  useEffect(() => { loadInvoices(); loadSyncStatus(); loadSales(); loadAgents(); }, []);

  const loadInvoices = async () => {
    const { data } = await supabase.from('invoices').select('*').order('emission_date', { ascending: false });
    if (data) {
      setInvoices(data.map(inv => ({
        key: inv.xml_key, last4: inv.last_four, date: inv.emission_date,
        supName: inv.supplier_name, supComm: inv.supplier_commercial_name, supId: inv.supplier_id,
        sub: inv.subtotal, tax: inv.tax_total, other: inv.other_charges, total: inv.total,
        currency: inv.currency || 'CRC',
        payCode: inv.payment_method_code, payLabel: inv.payment_method_label, isTC: inv.is_credit_card,
        plate: inv.plate, warnPlate: inv.assign_status === 'warning' ? inv.detected_plate : null,
        catId: inv.category_id || 'otro', assignStatus: inv.assign_status || 'unassigned',
        payStatus: inv.pay_status || 'pending', paidBank: inv.paid_bank || '', paidRef: inv.paid_reference || '',
        isVehicle: inv.is_vehicle_purchase || false, vehicleStatus: inv.vehicle_purchase_status || null,
        lines: [], dbId: inv.id,
      })));
    }
  };

  const loadSyncStatus = async () => {
    try {
      const res = await fetch('/api/gmail-status');
      const data = await res.json();
      if (data.lastSync) setLastSync(new Date(data.lastSync));
    } catch(e) {}
  };

  const syncGmail = async () => {
    setSyncing(true); setSyncMsg(null); setRejectedInvs([]);
    try {
      const res = await fetch('/api/fetch-gmail-invoices', { headers: { 'Authorization': 'Bearer vcr2026cron' } });
      const data = await res.json();
      let msg = "Procesadas: " + (data.processed || 0) + ", Omitidas: " + (data.skipped || 0);
      if (data.rejected > 0) msg += ", Rechazadas: " + data.rejected;
      setSyncMsg(msg);
      if (data.rejectedList) setRejectedInvs(data.rejectedList);
      if (data.processed > 0) await loadInvoices();
      loadSyncStatus();
    } catch(e) { setSyncMsg('Error: ' + e.message); }
    setSyncing(false);
  };

  const openInvoice = async (inv) => {
    setPickedInv(inv);
    setShowDelete(false);
    setDeletePin("");
    setDeleteErr("");
    if (!inv.lines || inv.lines.length === 0) {
      const { data: dbInv } = await supabase.from('invoices').select('id').eq('xml_key', inv.key).single();
      if (dbInv) {
        const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', dbInv.id).order('line_number');
        if (lines) {
          const mapped = lines.map(l => ({ desc: l.description, cabys: l.cabys_code, price: l.unit_price, taxRate: l.tax_rate, taxAmt: l.tax_amount, total: l.line_total }));
          setPickedInv(prev => prev ? { ...prev, lines: mapped } : null);
        }
      }
    }
  };

  const updateInv = async (key, updates) => {
    // If changing to a gasto category, auto-set as operational
    if ('catId' in updates) {
      const newType = catType(updates.catId);
      if (newType === "gasto") {
        updates.assignStatus = "operational";
        updates.plate = null;
      }
    }
    setInvoices(prev => prev.map(x => x.key === key ? { ...x, ...updates } : x));
    const dbUpdates = {};
    if ('catId' in updates) dbUpdates.category_id = updates.catId;
    if ('assignStatus' in updates) dbUpdates.assign_status = updates.assignStatus;
    if ('plate' in updates) dbUpdates.plate = updates.plate;
    if ('payStatus' in updates) dbUpdates.pay_status = updates.payStatus;
    if ('paidBank' in updates) dbUpdates.paid_bank = updates.paidBank;
    if ('paidRef' in updates) dbUpdates.paid_reference = updates.paidRef;
    if ('catId' in updates) {
      const cat = CATS.find(c => c.id === updates.catId);
      if (cat) {
        dbUpdates.group_id = cat.g;
        dbUpdates.alegra_category = cat.a || cat.l;
      }
      // Save to cabys_mapping for future auto-classification
      const inv = invoices.find(x => x.key === key);
      if (inv && inv.lines && inv.lines.length > 0 && inv.lines[0].cabys) {
        await supabase.from('cabys_mapping').upsert({
          cabys_code: inv.lines[0].cabys, category_id: updates.catId,
          group_id: cat ? cat.g : 'otros_gastos', source: 'manual'
        }, { onConflict: 'cabys_code' });
      }
      // Update provider_mapping so future invoices from same provider auto-classify
      if (inv && inv.supId) {
        await supabase.from('provider_mapping').upsert({
          supplier_id: inv.supId, supplier_name: inv.supName,
          default_category_id: updates.catId,
          default_alegra_category: cat ? (cat.a || cat.l) : 'Otros Gastos',
          times_used: 1,
        }, { onConflict: 'supplier_id' });
      }
    }
    await supabase.from('invoices').update(dbUpdates).eq('xml_key', key);
  };

  const deleteInvoice = async (key) => {
    if (deletePin !== "1234") { setDeleteErr("PIN incorrecto"); return; }
    const inv = invoices.find(x => x.key === key);
    if (inv && inv.dbId) {
      await supabase.from('invoice_lines').delete().eq('invoice_id', inv.dbId);
      await supabase.from('invoices').delete().eq('id', inv.dbId);
    } else {
      await supabase.from('invoices').delete().eq('xml_key', key);
    }
    setInvoices(prev => prev.filter(x => x.key !== key));
    setPickedInv(null);
    setShowDelete(false);
    setDeletePin("");
    setDeleteErr("");
  };

  // ======= VEHICLE FROM INVOICE =======
  const saveVehicleFromInvoice = async () => {
    if (!vehicleForm || !vehicleForm.plate) { alert("La placa es requerida"); return; }
    const inv = pickedInv;
    const { data: veh, error } = await supabase.from('vehicles').insert({
      plate: vehicleForm.plate.toUpperCase().replace(/\s+/g, '-'),
      brand: vehicleForm.brand || null,
      model: vehicleForm.model || null,
      year: parseInt(vehicleForm.year) || null,
      color: vehicleForm.color || null,
      km: parseFloat(vehicleForm.km) || null,
      drive: vehicleForm.drive || null,
      fuel: vehicleForm.fuel || null,
      style: vehicleForm.style || null,
      price_usd: parseFloat(vehicleForm.price_usd) || null,
      price_crc: parseFloat(vehicleForm.price_crc) || null,
      purchase_price: inv.total,
      purchase_currency: inv.currency || 'CRC',
      purchase_date: inv.date,
      purchase_invoice_id: inv.dbId,
      purchase_supplier: supDisplay(inv),
      status: 'disponible',
      consignment: vehicleForm.consignment || false,
      consignment_owner: vehicleForm.consignment_owner || null,
    }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    // Update invoice
    await supabase.from('invoices').update({ 
      vehicle_purchase_status: 'completed',
      plate: vehicleForm.plate.toUpperCase().replace(/\s+/g, '-'),
      assign_status: 'assigned',
    }).eq('xml_key', inv.key);
    setInvoices(prev => prev.map(x => x.key === inv.key ? { ...x, vehicleStatus: 'completed', plate: vehicleForm.plate.toUpperCase() } : x));
    setPickedInv(prev => prev ? { ...prev, vehicleStatus: 'completed' } : null);
    setVehicleForm(null);
    alert("Vehículo agregado al inventario: " + vehicleForm.plate.toUpperCase());
  };

  const dismissVehicle = async () => {
    await supabase.from('invoices').update({ vehicle_purchase_status: 'dismissed' }).eq('xml_key', pickedInv.key);
    setInvoices(prev => prev.map(x => x.key === pickedInv.key ? { ...x, vehicleStatus: 'dismissed' } : x));
    setPickedInv(prev => prev ? { ...prev, vehicleStatus: 'dismissed' } : null);
    setVehicleForm(null);
  };

  // ======= EXPORT & BULK ACTIONS =======
  const toggleSelect = (key) => {
    setSelectedInvs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = (fList) => {
    if (selectedInvs.size === fList.length) {
      setSelectedInvs(new Set());
    } else {
      setSelectedInvs(new Set(fList.map(x => x.key)));
    }
  };

  const exportSelected = async () => {
    const selected = invoices.filter(x => selectedInvs.has(x.key));
    if (selected.length === 0) return;
    // Load lines for each selected invoice
    const rows = [];
    for (const inv of selected) {
      const { data: dbInv } = await supabase.from('invoices').select('*').eq('xml_key', inv.key).single();
      if (!dbInv) continue;
      const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', dbInv.id).order('line_number');
      const cat = CATS.find(c => c.id === inv.catId);
      const alegraName = cat?.a || dbInv.alegra_category || 'Otros Gastos';
      const idTypeMap = {"01":"Cédula Física","02":"Cédula Jurídica","03":"DIMEX","04":"NITE"};
      const idTypeLabel = idTypeMap[dbInv.supplier_id_type] || dbInv.supplier_id_type || '';
      if (lines && lines.length > 0) {
        for (const line of lines) {
          rows.push({
            "FECHA DE EMISIÓN": dbInv.emission_date ? new Date(dbInv.emission_date).toLocaleDateString("es-CR") : '',
            "CÓDIGO": dbInv.consecutive || '',
            "ESTADO": dbInv.pay_status === 'paid' ? 'Pagado' : 'Por pagar',
            "ESTADO LEGAL": '',
            "BODEGA": 'Principal',
            "CENTRO DE COSTO": '',
            "ÓRDENES DE COMPRA ASOCIADAS": '',
            "PROVEEDOR - NOMBRE": dbInv.supplier_name || '',
            "PROVEEDOR - TIPO DE IDENTIFICACIÓN": idTypeLabel,
            "PROVEEDOR - IDENTIFICACIÓN": dbInv.supplier_id || '',
            "PROVEEDOR - OTRAS SEÑAS": dbInv.supplier_address || '',
            "PROVEEDOR - TELÉFONO": dbInv.supplier_phone || '',
            "PROVEEDOR - CANTÓN": dbInv.supplier_canton || '',
            "VENCIMIENTO": dbInv.due_date ? new Date(dbInv.due_date).toLocaleDateString("es-CR") : '',
            "MONEDA": dbInv.currency || 'CRC',
            "TASA DE CAMBIO": dbInv.exchange_rate || 1,
            "ÍTEM - NOMBRE": alegraName,
            "ÍTEM - OBSERVACIONES": line.description || '',
            "ÍTEM - REFERENCIA": '',
            "ÍTEM - CANTIDAD": line.quantity || 1,
            "ÍTEM - PRECIO": line.unit_price || 0,
            "ÍTEM - DESCUENTO (%)": line.discount_pct || 0,
            "ÍTEM - IMPUESTO": line.tax_code === '01' ? 'IVA' : '',
            "ÍTEM - IMPUESTO (%)": line.tax_rate || 0,
            "ÍTEM - IMPUESTO (VALOR)": line.tax_amount || 0,
            "ÍTEM - TOTAL": line.line_total || 0,
            "ÍTEM - SUBTOTAL": line.subtotal || 0,
            "TOTAL - FACTURA DE VENTA": dbInv.total || 0,
          });
        }
      } else {
        rows.push({
          "FECHA DE EMISIÓN": dbInv.emission_date ? new Date(dbInv.emission_date).toLocaleDateString("es-CR") : '',
          "CÓDIGO": dbInv.consecutive || '',
          "ESTADO": dbInv.pay_status === 'paid' ? 'Pagado' : 'Por pagar',
          "ESTADO LEGAL": '', "BODEGA": 'Principal', "CENTRO DE COSTO": '', "ÓRDENES DE COMPRA ASOCIADAS": '',
          "PROVEEDOR - NOMBRE": dbInv.supplier_name || '',
          "PROVEEDOR - TIPO DE IDENTIFICACIÓN": idTypeLabel,
          "PROVEEDOR - IDENTIFICACIÓN": dbInv.supplier_id || '',
          "PROVEEDOR - OTRAS SEÑAS": dbInv.supplier_address || '',
          "PROVEEDOR - TELÉFONO": dbInv.supplier_phone || '',
          "PROVEEDOR - CANTÓN": dbInv.supplier_canton || '',
          "VENCIMIENTO": dbInv.due_date || '',
          "MONEDA": dbInv.currency || 'CRC',
          "TASA DE CAMBIO": dbInv.exchange_rate || 1,
          "ÍTEM - NOMBRE": alegraName,
          "ÍTEM - OBSERVACIONES": '', "ÍTEM - REFERENCIA": '',
          "ÍTEM - CANTIDAD": 1, "ÍTEM - PRECIO": dbInv.subtotal || 0,
          "ÍTEM - DESCUENTO (%)": 0, "ÍTEM - IMPUESTO": 'IVA',
          "ÍTEM - IMPUESTO (%)": 13, "ÍTEM - IMPUESTO (VALOR)": dbInv.tax_total || 0,
          "ÍTEM - TOTAL": dbInv.total || 0, "ÍTEM - SUBTOTAL": dbInv.subtotal || 0,
          "TOTAL - FACTURA DE VENTA": dbInv.total || 0,
        });
      }
    }
    // Generate CSV
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => {
      let v = r[h] ?? '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'facturas_alegra_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click(); URL.revokeObjectURL(url);
    setSelectedInvs(new Set());
  };

  const bulkDelete = async () => {
    const pin = prompt("Ingrese PIN para eliminar " + selectedInvs.size + " facturas:");
    if (pin !== "1234") { alert("PIN incorrecto"); return; }
    for (const key of selectedInvs) {
      const inv = invoices.find(x => x.key === key);
      if (inv && inv.dbId) {
        await supabase.from('invoice_lines').delete().eq('invoice_id', inv.dbId);
        await supabase.from('invoices').delete().eq('id', inv.dbId);
      }
    }
    setInvoices(prev => prev.filter(x => !selectedInvs.has(x.key)));
    setSelectedInvs(new Set());
  };

  // ======= SALES FUNCTIONS =======
  const loadSales = async () => {
    const { data } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
    if (data) {
      const ids = data.map(s => s.id);
      const { data: deps } = ids.length > 0 ? await supabase.from('sale_deposits').select('*').in('sale_id', ids).order('deposit_date') : { data: [] };
      const { data: sAgents } = ids.length > 0 ? await supabase.from('sale_agents').select('*').in('sale_id', ids) : { data: [] };
      const depMap = {};
      (deps || []).forEach(d => { if (!depMap[d.sale_id]) depMap[d.sale_id] = []; depMap[d.sale_id].push(d); });
      const agMap = {};
      (sAgents || []).forEach(a => { if (!agMap[a.sale_id]) agMap[a.sale_id] = []; agMap[a.sale_id].push(a); });
      setSales(data.map(s => ({ ...s, deposits: depMap[s.id] || [], sale_agents: agMap[s.id] || [] })));
    }
  };

  const loadAgents = async () => {
    const { data } = await supabase.from('agents').select('*').eq('active', true).order('name');
    if (data) setAgents(data);
  };

  const emptySaleForm = () => ({
    sale_date: new Date().toISOString().split('T')[0],
    client_name: "", client_cedula: "", client_phone1: "", client_phone2: "",
    client_email: "", client_address: "", client_workplace: "", client_occupation: "", client_civil_status: "",
    vehicle_plate: "", vehicle_brand: "", vehicle_model: "", vehicle_year: "", vehicle_color: "",
    vehicle_km: "", vehicle_engine: "", vehicle_drive: "", vehicle_fuel: "",
    has_tradein: false,
    tradein_plate: "", tradein_brand: "", tradein_model: "", tradein_year: "", tradein_color: "",
    tradein_km: "", tradein_engine: "", tradein_drive: "", tradein_fuel: "", tradein_value: 0,
    sale_type: "propio", sale_price: "", tradein_amount: 0, down_payment: 0, deposit_signal: 0, total_balance: 0,
    payment_method: "", financing_term_months: "", financing_interest_pct: "", financing_amount: "",
    deposits: [{ bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }],
    transfer_included: false, transfer_in_price: false, transfer_in_financing: false,
    has_insurance: false, insurance_months: "",
    observations: "",
    agent1_id: "", agent2_id: "",
  });

  const selectVehicleForSale = (plate) => {
    const car = cars.find(c => c.p === plate);
    if (!car) return;
    setSaleForm(prev => ({ ...prev,
      vehicle_plate: car.p, vehicle_brand: car.b, vehicle_model: car.m, vehicle_year: car.y,
      vehicle_color: car.co, vehicle_km: car.km, vehicle_drive: car.dr, vehicle_fuel: car.f,
      sale_price: car.usd,
    }));
  };

  const calcBalance = (form) => {
    const price = parseFloat(form.sale_price) || 0;
    const tradein = parseFloat(form.tradein_amount) || 0;
    const down = parseFloat(form.down_payment) || 0;
    const signal = parseFloat(form.deposit_signal) || 0;
    const depositsTotal = (form.deposits || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    return Math.max(0, price - tradein - down - signal - depositsTotal);
  };

  const depositsTotal = (form) => (form.deposits || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  const generateObservations = (form) => {
    const brand = form.vehicle_brand || "";
    const model = form.vehicle_model || "";
    const year = form.vehicle_year || "";
    const plate = form.vehicle_plate || "";
    const vehicle = `${brand} ${model} ${year} ${plate}`.trim();

    const deps = (form.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0);
    let depText = "";
    if (deps.length > 0) {
      depText = deps.map(d => {
        const parts = [];
        if (d.reference) parts.push(`#${d.reference}`);
        if (d.bank) parts.push(`de ${d.bank}`);
        if (d.date) parts.push(`fecha ${new Date(d.date + "T12:00:00").toLocaleDateString("es-CR")}`);
        if (d.amount) parts.push(`por ${fmt(parseFloat(d.amount), "USD")}`);
        return parts.join(" ");
      }).join("; ");
    }

    let tradeVeh = "";
    if (form.has_tradein) {
      const tBrand = form.tradein_brand || "";
      const tModel = form.tradein_model || "";
      const tYear = form.tradein_year || "";
      const tPlate = form.tradein_plate || "";
      tradeVeh = `${tBrand} ${tModel} ${tPlate} ${tYear}`.trim();
    }

    const isFinanced = form.payment_method === "Financiamiento" || form.payment_method === "Mixto";
    const primaTotal = (parseFloat(form.down_payment) || 0) + depositsTotal(form);
    const plazo = form.financing_term_months || "";

    if (isFinanced) {
      // FINANCIADO
      let obs = "";
      if (form.has_tradein) {
        obs = `VENTA FINANCIADA. Se vende ${vehicle} y se recibe ${tradeVeh} como parte de pago.`;
      } else {
        obs = `VENTA FINANCIADA de ${vehicle}.`;
      }
      if (primaTotal > 0) {
        obs += ` Cliente aporta prima de ${fmt(primaTotal, "USD")}`;
        if (depText) obs += ` en deposito(s) ${depText}`;
        obs += ".";
      }
      if (plazo) {
        obs += ` El saldo pendiente debe cancelarse en un plazo de ${plazo} meses a mas tardar.`;
      }
      return obs;
    } else {
      // CONTADO
      if (form.has_tradein) {
        let obs = `VENTA DE CONTADO. Se vende ${vehicle} y se recibe ${tradeVeh} como parte de pago.`;
        if (depText) obs += ` Saldo restante cancelado mediante deposito(s) ${depText}.`;
        return obs;
      } else {
        let obs = `VENTA DE CONTADO de ${vehicle}.`;
        if (depText) obs += ` Cancelado mediante deposito(s) ${depText}.`;
        return obs;
      }
    }
  };

  const saveSale = async () => {
    if (!saleForm.client_name || !saleForm.sale_price) { alert("Nombre del cliente y precio son requeridos"); return; }
    const balance = calcBalance(saleForm);
    const saleType = saleForm.sale_type;
    const commPct = saleType === "consignacion_grupo" ? 1 : saleType === "consignacion_externa" ? 5 : 0;
    const commAmt = saleType !== "propio" ? (parseFloat(saleForm.sale_price) || 0) * commPct / 100 : 0;

    const row = {
      sale_date: saleForm.sale_date, status: "pending",
      client_name: saleForm.client_name, client_cedula: saleForm.client_cedula,
      client_phone1: saleForm.client_phone1, client_phone2: saleForm.client_phone2,
      client_email: saleForm.client_email, client_address: saleForm.client_address,
      client_workplace: saleForm.client_workplace, client_occupation: saleForm.client_occupation,
      client_civil_status: saleForm.client_civil_status,
      vehicle_plate: saleForm.vehicle_plate, vehicle_brand: saleForm.vehicle_brand,
      vehicle_model: saleForm.vehicle_model, vehicle_year: parseInt(saleForm.vehicle_year) || null,
      vehicle_color: saleForm.vehicle_color, vehicle_km: parseFloat(saleForm.vehicle_km) || null,
      vehicle_engine: saleForm.vehicle_engine, vehicle_drive: saleForm.vehicle_drive, vehicle_fuel: saleForm.vehicle_fuel,
      has_tradein: saleForm.has_tradein,
      tradein_plate: saleForm.has_tradein ? saleForm.tradein_plate : null,
      tradein_brand: saleForm.has_tradein ? saleForm.tradein_brand : null,
      tradein_model: saleForm.has_tradein ? saleForm.tradein_model : null,
      tradein_year: saleForm.has_tradein ? (parseInt(saleForm.tradein_year) || null) : null,
      tradein_color: saleForm.has_tradein ? saleForm.tradein_color : null,
      tradein_km: saleForm.has_tradein ? (parseFloat(saleForm.tradein_km) || null) : null,
      tradein_engine: saleForm.has_tradein ? saleForm.tradein_engine : null,
      tradein_drive: saleForm.has_tradein ? saleForm.tradein_drive : null,
      tradein_fuel: saleForm.has_tradein ? saleForm.tradein_fuel : null,
      tradein_value: saleForm.has_tradein ? (parseFloat(saleForm.tradein_value) || 0) : 0,
      sale_type: saleType, commission_pct: commPct, commission_amount: commAmt,
      sale_price: parseFloat(saleForm.sale_price) || 0,
      tradein_amount: parseFloat(saleForm.tradein_amount) || 0,
      down_payment: parseFloat(saleForm.down_payment) || 0,
      deposit_signal: parseFloat(saleForm.deposit_signal) || 0,
      deposits_total: depositsTotal(saleForm),
      total_balance: balance,
      payment_method: saleForm.payment_method,
      financing_term_months: parseInt(saleForm.financing_term_months) || null,
      financing_interest_pct: parseFloat(saleForm.financing_interest_pct) || null,
      financing_amount: parseFloat(saleForm.financing_amount) || null,
      transfer_included: saleForm.transfer_included, transfer_in_price: saleForm.transfer_in_price,
      transfer_in_financing: saleForm.transfer_in_financing,
      has_insurance: saleForm.has_insurance,
      insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || generateObservations(saleForm),
    };

    const { data, error } = await supabase.from('sales').insert(row).select().single();
    if (error) { alert("Error: " + error.message); return; }

    // Save deposits
    const depRows = (saleForm.deposits || [])
      .filter(d => d.amount && parseFloat(d.amount) > 0)
      .map(d => ({
        sale_id: data.id,
        bank: d.bank || null,
        reference: d.reference || null,
        deposit_date: d.date || null,
        amount: parseFloat(d.amount) || 0,
      }));
    if (depRows.length > 0) await supabase.from('sale_deposits').insert(depRows);

    // Save agents - 1% total commission, split if 2 agents
    const agentRows = [];
    const salePrice = parseFloat(saleForm.sale_price) || 0;
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== saleForm.agent1_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * (hasAgent2 ? 0.5 : 1);
    if (saleForm.agent1_id) {
      const ag = agents.find(a => a.id === saleForm.agent1_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent1_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt });
    }
    if (hasAgent2) {
      const ag = agents.find(a => a.id === saleForm.agent2_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent2_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt });
    }
    if (agentRows.length > 0) await supabase.from('sale_agents').insert(agentRows);

    await loadSales();
    setSalesView("list");
    setSaleForm(null);
  };

  const approveSale = async (id) => {
    await supabase.from('sales').update({ status: "approved", approved_by: "admin", approved_at: new Date().toISOString() }).eq('id', id);
    await loadSales();
    setPickedSale(prev => prev ? { ...prev, status: "approved" } : null);
  };

  const rejectSale = async (id, reason) => {
    await supabase.from('sales').update({ status: "rejected", rejected_reason: reason || "Rechazada" }).eq('id', id);
    await loadSales();
    setPickedSale(prev => prev ? { ...prev, status: "rejected" } : null);
  };

  const filtered = cars.filter(v => { const s = q.toLowerCase(); return !q || [v.p,v.b,v.m,v.co,String(v.y)].some(x => x.toLowerCase().includes(s)); });

  const costsByPlate = useMemo(() => {
    const map = {};
    invoices.filter(i => i.assignStatus === "assigned" && i.plate).forEach(i => {
      if (!map[i.plate]) map[i.plate] = { items: [], total: 0 };
      map[i.plate].items.push(i);
      map[i.plate].total += i.total;
    });
    return map;
  }, [invoices]);

  const opCosts = useMemo(() => invoices.filter(i => i.assignStatus === "operational"), [invoices]);
  const unassigned = useMemo(() => invoices.filter(i => i.assignStatus === "unassigned" || i.assignStatus === "warning"), [invoices]);

  const clients = [
    {n:"Carlos Jiménez Mora",ce:"1-0987-0456",ph:"8845-2301",em:"cjimenez@gmail.com",jo:"Ingeniero",ci:"Casado",ad:"Escazú",bu:[{d:"2026-01-15",v:"Suzuki Vitara 2023",pr:"$22,500"}]},
    {n:"María Fernanda Solís",ce:"3-0456-0789",ph:"7012-8834",em:"mfsolis@hotmail.com",jo:"Contadora",ci:"Soltera",ad:"Heredia",bu:[{d:"2026-02-12",v:"Chery Tiggo 7 2026",pr:"$23,000"},{d:"2025-11-27",v:"Montero Sport 2023",pr:"$49,500"}]},
    {n:"Roberto Araya Vindas",ce:"1-1234-0567",ph:"6098-4412",em:"raraya@outlook.com",jo:"Empresario",ci:"Casado",ad:"Cartago",bu:[{d:"2026-03-18",v:"BMW X6 2020",pr:"$78,000"}]},
    {n:"Ana Lucía Bermúdez",ce:"2-0678-0123",ph:"8534-7790",em:"albermudez@gmail.com",jo:"Médica",ci:"Divorciada",ad:"Alajuela",bu:[]},
    {n:"José Pablo Quesada",ce:"1-1567-0890",ph:"7123-5567",em:"jpquesada@icloud.com",jo:"Abogado",ci:"Casado",ad:"Santa Ana",bu:[{d:"2026-04-08",v:"Nissan Kicks 2021",pr:"₡9,950,000"}]},
  ];

  // ======= RENDER FUNCTIONS =======

  const renderDash = () => (
    <div>
      <h1 style={{fontSize:26,fontWeight:800,marginBottom:20}}>Dashboard</h1>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:24}}>
        {[[cars.length,"Vehículos","#6366f1"],[cars.filter(c=>c.s==="disponible").length,"Disponibles","#10b981"],[invoices.length,"Facturas","#8b5cf6"],[invoices.filter(i=>i.payStatus==="pending").length,"Por pagar","#f59e0b"],[clients.length,"Clientes","#f97316"]].map(([v,l,c])=>(
          <div key={l} style={{flex:"1 1 130px",...S.card,padding:"14px 18px"}}>
            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:3,textTransform:"uppercase",letterSpacing:.4}}>{l}</div>
            <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
        <div style={S.card}>
          <div style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",fontWeight:700,fontSize:14}}>Vehículos</div>
          {cars.slice(0,5).map((v,i)=>(<div key={i} style={{padding:"10px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{v.b} {v.m} {v.y}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{v.p==="CONSIGNA"?"Consignación":v.p}</div></div><span style={{fontSize:14,fontWeight:700,color:"#4f8cff"}}>{fmt(v.usd,"USD")}</span></div>))}
        </div>
        <div style={S.card}>
          <div style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",fontWeight:700,fontSize:14}}>Últimas facturas</div>
          {invoices.length===0?<div style={{padding:"20px 18px",fontSize:13,color:"#8b8fa4"}}>Sin facturas cargadas</div>:invoices.slice(0,5).map((x,i)=>(<div key={i} style={{padding:"10px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{supDisplay(x)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{catLabel(x.catId)}</div></div><span style={{fontSize:14,fontWeight:700,color:x.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(x.total,x.currency==="USD"?"USD":undefined)}</span></div>))}
        </div>
      </div>
    </div>
  );

  const renderInv = () => (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Inventario</h1>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar placa, marca, modelo..." style={{...S.inp,width:"100%",maxWidth:400,marginBottom:16}} />
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
        {filtered.map((v,i)=>(
          <div key={i} onClick={()=>setPicked(v)} style={{...S.card,cursor:"pointer"}}>
            <div style={{height:4,background:v.s==="reservado"?"#f59e0b":v.p==="CONSIGNA"?"#8b5cf6":"#10b981"}}/>
            <div style={{padding:"14px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <div><div style={{fontSize:16,fontWeight:800}}>{v.b} {v.m}</div><div style={{fontSize:12,color:"#8b8fa4"}}>{v.y} · {v.co}</div></div>
                <span style={S.badge(v.s==="reservado"?"#f59e0b":"#10b981")}>{v.s==="reservado"?"Reservado":"Disponible"}</span>
              </div>
              <div style={{display:"flex",gap:14,marginBottom:10,fontSize:11,color:"#8b8fa4"}}><span>{v.p}</span><span>{fK(v.km)}</span><span>{v.f}</span><span>{v.dr}</span></div>
              <span style={{fontSize:19,fontWeight:800,color:"#4f8cff"}}>{fmt(v.usd,"USD")}</span>
              <span style={{fontSize:11,color:"#8b8fa4",marginLeft:8}}>{fmt(v.crc)}</span>
              {costsByPlate[v.p]&&<div style={{marginTop:8,fontSize:11,color:"#f59e0b"}}>Costos: {fmt(costsByPlate[v.p].total)} ({costsByPlate[v.p].items.length} fact.)</div>}
            </div>
          </div>
        ))}
      </div>
      {picked&&<div style={S.modal} onClick={()=>setPicked(null)}><div style={{...S.mbox,maxWidth:500}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><div><h2 style={{fontSize:20,fontWeight:800,margin:0}}>{picked.b} {picked.m}</h2><p style={{fontSize:13,color:"#8b8fa4",margin:"4px 0 0"}}>{picked.y} · {picked.p}</p></div><button onClick={()=>setPicked(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:20}}>✕</button></div>
        <div style={{background:"#1e2130",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:10,color:"#8b8fa4"}}>PRECIO</div><div style={{fontSize:24,fontWeight:800,color:"#4f8cff"}}>{fmt(picked.usd,"USD")}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#8b8fa4"}}>COLONES</div><div style={{fontSize:16,fontWeight:700}}>{fmt(picked.crc)}</div></div></div>
        <div style={S.g2}>{[["Color",picked.co],["Km",fK(picked.km)],["Combustible",picked.f],["Tracción",picked.dr],["Estilo",picked.st],["Estado",picked.s]].map(([l,v],i)=><div key={i} style={S.gc}><div style={S.gl}>{l}</div><div style={S.gv}>{v}</div></div>)}</div>
        {costsByPlate[picked.p]?<div><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Costos ({fmt(costsByPlate[picked.p].total)})</div>{costsByPlate[picked.p].items.map((inv,i)=><div key={i} style={{padding:"8px 14px",background:"#1e2130",borderRadius:8,marginBottom:6,display:"flex",justifyContent:"space-between",fontSize:12}}><div><div style={{fontWeight:600}}>{supDisplay(inv)}</div><div style={{color:"#8b8fa4",fontSize:11}}>{catLabel(inv.catId)}</div></div><span style={{fontWeight:700,color:"#4f8cff"}}>{fmt(inv.total)}</span></div>)}</div>:<div style={{fontSize:12,color:"#8b8fa4"}}>Sin costos asignados</div>}
      </div></div>}
    </div>
  );

  const renderFac = () => {
    const fList = invoices.filter(x => (fType==="all"||catType(x.catId)===fType)&&(fCat==="all"||x.catId===fCat)&&(fPay==="all"||x.payStatus===fPay)&&(fAssign==="all"||x.assignStatus===fAssign));
    return (
      <div>
        <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Facturas</h1>
        <div style={{display:"flex",gap:12,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={syncGmail} disabled={syncing} style={{...S.sel,background:syncing?"#1e2130":"#4f8cff18",color:syncing?"#8b8fa4":"#4f8cff",fontWeight:600,padding:"10px 20px"}}>
            {syncing?"Sincronizando...":"Sincronizar Gmail"}
          </button>
          {rejectedInvs.length>0&&<button onClick={()=>setShowRejected(true)} style={{...S.sel,background:"#e11d4810",color:"#e11d48",fontWeight:600,padding:"10px 16px"}}>
            {rejectedInvs.length} rechazada{rejectedInvs.length!==1?"s":""}
          </button>}
          {syncMsg&&<span style={{fontSize:12,color:"#10b981"}}>{syncMsg}</span>}
          {lastSync&&<span style={{fontSize:11,color:"#8b8fa4"}}>Última sync: {lastSync.toLocaleString("es-CR")}</span>}
        </div>

        {/* Rejected invoices modal */}
        {showRejected&&<div style={S.modal} onClick={()=>setShowRejected(false)}>
          <div style={{...S.mbox,maxWidth:620}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <h3 style={{fontSize:17,fontWeight:700,margin:0,color:"#e11d48"}}>Facturas Rechazadas</h3>
              <button onClick={()=>setShowRejected(false)} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:18}}>✕</button>
            </div>
            <p style={{fontSize:12,color:"#8b8fa4",marginBottom:12}}>Estas facturas no fueron procesadas porque el receptor no es Vehículos de Costa Rica (3-101-124464)</p>
            <div style={S.card}>
              {rejectedInvs.map((r,i)=>(
                <div key={i} style={{padding:"12px 16px",borderBottom:"1px solid #2a2d3d"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13}}>{r.emisor}</div>
                      <div style={{fontSize:11,color:"#8b8fa4"}}>Cédula emisor: {r.emisor_id}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontWeight:700,color:"#4f8cff"}}>{fmt(r.total)}</div>
                      <div style={{fontSize:11,color:"#8b8fa4"}}>{r.fecha?new Date(r.fecha).toLocaleDateString("es-CR"):""}</div>
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"#e11d48",marginBottom:4}}>{r.razon}</div>
                  <div style={{fontSize:11,color:"#8b8fa4"}}>
                    Receptor: {r.receptor} ({r.receptor_id}) · Consecutivo: ...{(r.consecutivo||"").slice(-8)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>}

        {/* Vehicle purchase alerts */}
        {invoices.filter(x => x.isVehicle && x.vehicleStatus === 'detected').length > 0 && (
          <div style={{background:"#f59e0b10",border:"1px solid #f59e0b30",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:13,color:"#f59e0b",marginBottom:6}}>
              🚗 {invoices.filter(x => x.isVehicle && x.vehicleStatus === 'detected').length} compra{invoices.filter(x => x.isVehicle && x.vehicleStatus === 'detected').length !== 1 ? "s" : ""} de vehículo detectada{invoices.filter(x => x.isVehicle && x.vehicleStatus === 'detected').length !== 1 ? "s" : ""}
            </div>
            {invoices.filter(x => x.isVehicle && x.vehicleStatus === 'detected').map((x, i) => (
              <div key={i} onClick={() => openInvoice(x)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",cursor:"pointer",borderBottom:i < invoices.filter(v => v.isVehicle && v.vehicleStatus === 'detected').length - 1 ? "1px solid #f59e0b20" : "none"}}>
                <div>
                  <span style={{fontSize:12,fontWeight:600}}>{supDisplay(x)}</span>
                  <span style={{fontSize:11,color:"#8b8fa4",marginLeft:8}}>{new Date(x.date).toLocaleDateString("es-CR")}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontWeight:700,fontSize:13,color:x.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(x.total,x.currency==="USD"?"USD":undefined)}</span>
                  <span style={{fontSize:11,color:"#f59e0b",fontWeight:600}}>Completar →</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {invoices.length>0&&<>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <select value={fType} onChange={e=>setFType(e.target.value)} style={S.sel}><option value="all">Tipo</option><option value="costo">Costos</option><option value="gasto">Gastos</option></select>
            <select value={fCat} onChange={e=>setFCat(e.target.value)} style={S.sel}><option value="all">Categoría</option>{CATS.map(c=><option key={c.id} value={c.id}>{c.l}</option>)}</select>
            <select value={fPay} onChange={e=>setFPay(e.target.value)} style={S.sel}><option value="all">Pago</option><option value="pending">Pendiente</option><option value="paid">Pagada</option></select>
            <select value={fAssign} onChange={e=>setFAssign(e.target.value)} style={S.sel}><option value="all">Asignación</option><option value="assigned">Asignada</option><option value="unassigned">Sin asignar</option><option value="operational">Operativo</option></select>
          </div>
          <div style={{fontSize:13,color:"#8b8fa4",marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={fList.length>0&&selectedInvs.size===fList.length} onChange={()=>toggleSelectAll(fList)} style={{cursor:"pointer"}} />
              <span>{fList.length} factura{fList.length!==1?"s":""}</span>
            </div>
            {selectedInvs.size>0&&(
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:600,color:"#4f8cff"}}>{selectedInvs.size} seleccionada{selectedInvs.size!==1?"s":""}</span>
                <button onClick={exportSelected} style={{...S.sel,fontSize:11,padding:"6px 12px",background:"#10b98118",color:"#10b981",fontWeight:600}}>Exportar CSV</button>
                <button onClick={bulkDelete} style={{...S.sel,fontSize:11,padding:"6px 12px",background:"#e11d4810",color:"#e11d48",fontWeight:600}}>Eliminar</button>
              </div>
            )}
          </div>
          <div style={S.card}>
            {fList.map((x,i)=>(
              <div key={i} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",cursor:"pointer",display:"flex",gap:10,alignItems:"flex-start",background:selectedInvs.has(x.key)?"#4f8cff08":"transparent"}}>
                <input type="checkbox" checked={selectedInvs.has(x.key)} onChange={()=>toggleSelect(x.key)} onClick={e=>e.stopPropagation()} style={{marginTop:4,cursor:"pointer",flexShrink:0}} />
                <div style={{flex:1}} onClick={()=>openInvoice(x)}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div><div style={{fontWeight:600,fontSize:13}}>{supDisplay(x)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{x.supId} · ...{x.last4} · {new Date(x.date).toLocaleDateString("es-CR")}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontWeight:700,color:x.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(x.total,x.currency==="USD"?"USD":undefined)}</div>{x.currency==="USD"&&<div style={{fontSize:10,color:"#10b981"}}>USD</div>}</div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <span style={S.badge(catType(x.catId)==="costo"?"#f97316":"#6366f1")}>{catType(x.catId)==="costo"?"Costo":"Gasto"}</span>
                  <span style={S.badge("#64748b")}>{catGroupLabel(x.catId)}</span>
                  <span style={S.badge("#0ea5e9")}>{catLabel(x.catId)}</span>
                  <span style={S.badge(x.isTC?"#e11d48":"#64748b")}>{x.payLabel}</span>
                  <span style={S.badge(x.payStatus==="paid"?"#10b981":"#f59e0b")}>{x.payStatus==="paid"?"Pagada":"Pendiente"}</span>
                  {x.assignStatus==="assigned"&&<span style={S.badge("#10b981")}>Placa: {x.plate}</span>}
                  {x.assignStatus==="unassigned"&&catType(x.catId)==="costo"&&<span style={S.badge("#f59e0b")}>Sin asignar</span>}
                  {(x.assignStatus==="operational"||catType(x.catId)==="gasto")&&<span style={S.badge("#8b5cf6")}>Operativo</span>}
                  {x.warnPlate&&<span style={S.badge("#e11d48")}>⚠ {x.warnPlate} no en inv.</span>}
                  {x.currency==="USD"&&<span style={S.badge("#10b981")}>USD</span>}
                  {x.isVehicle&&x.vehicleStatus==="detected"&&<span style={S.badge("#f59e0b")}>🚗 Completar</span>}
                </div>
                </div>
              </div>
            ))}
          </div>
        </>}
        {invoices.length===0&&<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay facturas. Presione "Sincronizar Gmail" para cargar.</div>}
      </div>
    );
  };

  const renderCostos = () => {
    const plates = Object.keys(costsByPlate);
    return (
      <div>
        <h1 style={{fontSize:24,fontWeight:800,marginBottom:4}}>Costos</h1>
        <p style={{fontSize:13,color:"#8b8fa4",marginBottom:16}}>Facturas asignadas a vehículos y costos operativos</p>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[["vehicles","Por vehículo",plates.length],["operational","Operativos",opCosts.length],["unassigned","Sin asignar",unassigned.length]].map(([id,l,n])=>(
            <button key={id} onClick={()=>setCostView(id)} style={{...S.sel,background:costView===id?"#4f8cff20":"#1e2130",color:costView===id?"#4f8cff":"#8b8fa4",fontWeight:costView===id?600:400}}>{l} ({n})</button>
          ))}
        </div>
        {costView==="vehicles"&&(plates.length===0?<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay facturas asignadas a vehículos</div>:plates.map(plate=>{
          const car=cars.find(c=>c.p===plate);const data=costsByPlate[plate];
          return <div key={plate} style={{...S.card,marginBottom:12}}>
            <div style={{padding:"14px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{car?car.b+" "+car.m+" "+car.y:plate}</div><div style={{fontSize:12,color:"#8b8fa4"}}>{plate} · {data.items.length} factura{data.items.length!==1?"s":""}</div></div>
              <div style={{fontSize:20,fontWeight:800,color:"#e11d48"}}>{fmt(data.total)}</div>
            </div>
            {data.items.map((inv,i)=><div key={i} onClick={()=>openInvoice(inv)} style={{padding:"10px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",fontSize:12,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
              <div><div style={{fontWeight:600}}>{supDisplay(inv)}</div><div style={{color:"#8b8fa4",fontSize:11}}>{catGroupLabel(inv.catId)} → {catLabel(inv.catId)} · {new Date(inv.date).toLocaleDateString("es-CR")}</div></div>
              <div style={{display:"flex",alignItems:"center",gap:8}}><div><div style={{fontWeight:700}}>{fmt(inv.total)}</div><span style={S.badge(inv.payStatus==="paid"?"#10b981":"#f59e0b")}>{inv.payStatus==="paid"?"Pagada":"Pendiente"}</span></div><span style={{color:"#8b8fa4",fontSize:11}}>editar</span></div>
            </div>)}
          </div>;
        }))}
        {costView==="operational"&&(opCosts.length===0?<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay costos operativos</div>:<div style={S.card}>{opCosts.map((inv,i)=><div key={i} onClick={()=>openInvoice(inv)} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
          <div><div style={{fontWeight:600,fontSize:13}}>{supDisplay(inv)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{catGroupLabel(inv.catId)} → {catLabel(inv.catId)} · {new Date(inv.date).toLocaleDateString("es-CR")}</div></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{fontWeight:700,color:"#4f8cff"}}>{fmt(inv.total)}</div><span style={{color:"#8b8fa4",fontSize:11}}>editar</span></div>
        </div>)}</div>)}
        {costView==="unassigned"&&(unassigned.length===0?<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>Todas las facturas están asignadas</div>:<div style={S.card}>{unassigned.map((inv,i)=><div key={i} onClick={()=>openInvoice(inv)} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
          <div><div style={{fontWeight:600,fontSize:13}}>{supDisplay(inv)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{catGroupLabel(inv.catId)} → {catLabel(inv.catId)} · {fmt(inv.total)}{inv.warnPlate?" · ⚠ Placa "+inv.warnPlate+" no en inventario":""}</div></div>
          <span style={{color:"#8b8fa4",fontSize:11}}>editar</span>
        </div>)}</div>)}
      </div>
    );
  };

  const renderCli = () => (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Clientes</h1>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
        {clients.map((c,i)=><div key={i} style={{...S.card,padding:"16px 20px",cursor:"pointer"}}><div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{c.n}</div><div style={{fontSize:12,color:"#8b8fa4"}}>{c.ce} · {c.ph}</div>{c.bu.length>0&&<div style={{marginTop:8,...S.badge("#10b981")}}>{c.bu.length} compra{c.bu.length>1?"s":""}</div>}</div>)}
      </div>
    </div>
  );

  const PH = ({t}) => <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"55vh"}}><h2 style={{fontSize:22,fontWeight:700,marginBottom:6}}>{t}</h2><p style={{fontSize:13,color:"#8b8fa4"}}>En desarrollo</p></div>;

  // ======= SALES RENDER =======
  const renderSales = () => {
    const F = saleForm || {};
    const uf = (k, v) => setSaleForm(prev => ({ ...prev, [k]: v }));
    const fld = (label, key, opts = {}) => (
      <div style={{ marginBottom: 10, ...(opts.full ? { gridColumn: "1/3" } : {}) }}>
        <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>{label}</div>
        {opts.type === "select" ? (
          <select value={F[key] || ""} onChange={e => { uf(key, e.target.value); if (opts.onChange) opts.onChange(e.target.value); }} style={{ ...S.sel, width: "100%" }}>
            <option value="">Seleccionar</option>
            {(opts.options || []).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        ) : (
          <input value={F[key] || ""} onChange={e => uf(key, e.target.value)} placeholder={opts.ph || ""} type={opts.inputType || "text"} style={{ ...S.inp, width: "100%" }} />
        )}
      </div>
    );

    // LIST VIEW
    if (salesView === "list") {
      const filteredSales = sales.filter(s => saleFilter === "all" || s.status === saleFilter);
      return (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>Ventas</h1>
            <button onClick={() => { setSaleForm(emptySaleForm()); setSalesView("form"); }} style={{ ...S.sel, background: "#4f8cff18", color: "#4f8cff", fontWeight: 600, padding: "10px 20px" }}>
              + Nuevo Plan de Ventas
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["all", "Todas"], ["pending", "Pendientes"], ["approved", "Aprobadas"], ["rejected", "Rechazadas"]].map(([v, l]) => (
              <button key={v} onClick={() => setSaleFilter(v)} style={{ ...S.sel, background: saleFilter === v ? "#4f8cff20" : "#1e2130", color: saleFilter === v ? "#4f8cff" : "#8b8fa4", fontWeight: saleFilter === v ? 600 : 400 }}>
                {l} ({sales.filter(s => v === "all" || s.status === v).length})
              </button>
            ))}
          </div>
          {filteredSales.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#8b8fa4", fontSize: 13 }}>No hay ventas{saleFilter !== "all" ? " con este filtro" : ". Cree un nuevo plan de ventas."}</div>
          ) : (
            <div style={S.card}>
              {filteredSales.map((s, i) => (
                <div key={i} onClick={() => setPickedSale(s)} style={{ padding: "14px 18px", borderBottom: "1px solid #2a2d3d", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#1e2130"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.client_name}</div>
                    <div style={{ fontSize: 12, color: "#8b8fa4" }}>
                      {s.vehicle_brand} {s.vehicle_model} {s.vehicle_year} · {s.vehicle_plate || "Sin placa"}
                      {" · "}{new Date(s.sale_date).toLocaleDateString("es-CR")}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <span style={S.badge(s.status === "approved" ? "#10b981" : s.status === "rejected" ? "#e11d48" : "#f59e0b")}>
                        {s.status === "approved" ? "Aprobada" : s.status === "rejected" ? "Rechazada" : "Pendiente"}
                      </span>
                      <span style={S.badge(s.sale_type === "propio" ? "#6366f1" : s.sale_type === "consignacion_grupo" ? "#8b5cf6" : "#f97316")}>
                        {s.sale_type === "propio" ? "Propio" : s.sale_type === "consignacion_grupo" ? "Consig. Grupo 1%" : "Consig. Externa 5%"}
                      </span>
                      {s.has_tradein && <span style={S.badge("#0ea5e9")}>Trade-in</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#4f8cff" }}>{fmt(s.sale_price, "USD")}</div>
                    {s.sale_type !== "propio" && <div style={{ fontSize: 11, color: "#10b981" }}>Comisión: {fmt(s.commission_amount, "USD")}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // FORM VIEW
    if (salesView === "form") {
      const balance = calcBalance(F);
      return (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>Nuevo Plan de Ventas</h1>
            <button onClick={() => { setSalesView("list"); setSaleForm(null); }} style={{ ...S.sel, color: "#8b8fa4" }}>Cancelar</button>
          </div>

          {/* CLIENT INFO */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Datos del Cliente</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Nombre del cliente *", "client_name", { full: true })}
              {fld("Cédula", "client_cedula")}
              {fld("Teléfono 1", "client_phone1")}
              {fld("Teléfono 2", "client_phone2")}
              {fld("Email", "client_email")}
              {fld("Lugar de trabajo", "client_workplace")}
              {fld("Oficio", "client_occupation")}
              {fld("Estado civil", "client_civil_status", { type: "select", options: [{ v: "Soltero/a", l: "Soltero/a" }, { v: "Casado/a", l: "Casado/a" }, { v: "Divorciado/a", l: "Divorciado/a" }, { v: "Viudo/a", l: "Viudo/a" }, { v: "Unión libre", l: "Unión libre" }] })}
              {fld("Dirección exacta", "client_address", { full: true })}
            </div>
          </div>

          {/* VEHICLE BEING SOLD */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Vehículo que Compra</div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Seleccionar del inventario</div>
              <select value={F.vehicle_plate || ""} onChange={e => selectVehicleForSale(e.target.value)} style={{ ...S.sel, width: "100%" }}>
                <option value="">Seleccionar vehículo</option>
                {cars.filter(c => c.s === "disponible").map(c => <option key={c.p} value={c.p}>{c.p} - {c.b} {c.m} {c.y} - {fmt(c.usd, "USD")}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Placa", "vehicle_plate")}
              {fld("Marca", "vehicle_brand")}
              {fld("Estilo / Modelo", "vehicle_model")}
              {fld("Año", "vehicle_year", { inputType: "number" })}
              {fld("Color", "vehicle_color")}
              {fld("Kilometraje", "vehicle_km", { inputType: "number" })}
              {fld("Tracción", "vehicle_drive")}
              {fld("Combustible", "vehicle_fuel")}
            </div>
          </div>

          {/* SALE TYPE */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Tipo de Venta</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {[["propio", "Propio"], ["consignacion_grupo", "Consig. Grupo (1%)"], ["consignacion_externa", "Consig. Externa (5%)"]].map(([v, l]) => (
                <button key={v} onClick={() => uf("sale_type", v)} style={{
                  ...S.sel, flex: 1, textAlign: "center",
                  background: F.sale_type === v ? (v === "propio" ? "#6366f120" : v === "consignacion_grupo" ? "#8b5cf620" : "#f9731620") : "#1e2130",
                  color: F.sale_type === v ? (v === "propio" ? "#6366f1" : v === "consignacion_grupo" ? "#8b5cf6" : "#f97316") : "#8b8fa4",
                  fontWeight: F.sale_type === v ? 600 : 400,
                }}>{l}</button>
              ))}
            </div>
            {F.sale_type !== "propio" && (
              <div style={{ fontSize: 12, color: "#10b981", background: "#10b98110", padding: "8px 12px", borderRadius: 8 }}>
                Ingreso por comisión: {F.sale_type === "consignacion_grupo" ? "1%" : "5%"} = {fmt((parseFloat(F.sale_price) || 0) * (F.sale_type === "consignacion_grupo" ? 0.01 : 0.05), "USD")}
              </div>
            )}
          </div>

          {/* TRADE-IN */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#4f8cff" }}>Vehículo que Recibe (Trade-in)</div>
              <button onClick={() => uf("has_tradein", !F.has_tradein)} style={{ ...S.sel, fontSize: 12, background: F.has_tradein ? "#f59e0b20" : "#1e2130", color: F.has_tradein ? "#f59e0b" : "#8b8fa4", fontWeight: 600 }}>
                {F.has_tradein ? "Sí recibe" : "No recibe"}
              </button>
            </div>
            {F.has_tradein && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
                {fld("Placa", "tradein_plate")}
                {fld("Marca", "tradein_brand")}
                {fld("Estilo / Modelo", "tradein_model")}
                {fld("Año", "tradein_year", { inputType: "number" })}
                {fld("Color", "tradein_color")}
                {fld("Kilometraje", "tradein_km", { inputType: "number" })}
                {fld("Tracción", "tradein_drive")}
                {fld("Combustible", "tradein_fuel")}
                {fld("Valor del trade-in ($)", "tradein_value", { inputType: "number" })}
              </div>
            )}
          </div>

          {/* CONDITIONS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Condiciones de Venta</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Precio de venta ($) *", "sale_price", { inputType: "number" })}
              {fld("Vehículo recibido ($)", "tradein_amount", { inputType: "number" })}
              {fld("Prima ($)", "down_payment", { inputType: "number" })}
              {fld("Señal de trato ($)", "deposit_signal", { inputType: "number" })}
            </div>
            <div style={{ background: "#1e2130", borderRadius: 10, padding: "12px 16px", marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#8b8fa4" }}>Saldo total:</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#4f8cff" }}>{fmt(balance, "USD")}</span>
            </div>
          </div>

          {/* PAYMENT + DEPOSITS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Forma de Pago</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Forma de pago", "payment_method", { type: "select", options: [{ v: "Contado", l: "Contado" }, { v: "Financiamiento", l: "Financiamiento" }, { v: "Mixto", l: "Mixto" }] })}
              {fld("Plazo (meses)", "financing_term_months", { inputType: "number" })}
              {fld("Interés (%)", "financing_interest_pct", { inputType: "number" })}
              {fld("Monto financiado ($)", "financing_amount", { inputType: "number" })}
            </div>

            <div style={{ marginTop: 14, borderTop: "1px solid #2a2d3d", paddingTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Depósitos</div>
                <button onClick={() => setSaleForm(prev => ({ ...prev, deposits: [...(prev.deposits || []), { bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }] }))}
                  style={{ ...S.sel, fontSize: 11, color: "#10b981", background: "#10b98110", padding: "5px 12px" }}>+ Agregar depósito</button>
              </div>
              {(F.deposits || []).map((dep, di) => (
                <div key={di} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Banco</div>
                    <input value={dep.bank} onChange={e => { const d = [...F.deposits]; d[di] = { ...d[di], bank: e.target.value }; uf("deposits", d); }} style={{ ...S.inp, width: "100%" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}># Referencia</div>
                    <input value={dep.reference} onChange={e => { const d = [...F.deposits]; d[di] = { ...d[di], reference: e.target.value }; uf("deposits", d); }} style={{ ...S.inp, width: "100%" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Fecha</div>
                    <input type="date" value={dep.date} onChange={e => { const d = [...F.deposits]; d[di] = { ...d[di], date: e.target.value }; uf("deposits", d); }} style={{ ...S.inp, width: "100%" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Monto ($)</div>
                    <input type="number" value={dep.amount} onChange={e => { const d = [...F.deposits]; d[di] = { ...d[di], amount: e.target.value }; uf("deposits", d); }} style={{ ...S.inp, width: "100%" }} />
                  </div>
                  {F.deposits.length > 1 && (
                    <button onClick={() => { const d = F.deposits.filter((_, j) => j !== di); uf("deposits", d); }}
                      style={{ background: "none", border: "none", color: "#e11d48", cursor: "pointer", fontSize: 16, padding: "6px", marginBottom: 2 }}>✕</button>
                  )}
                </div>
              ))}
              {depositsTotal(F) > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 13, color: "#10b981", fontWeight: 600, marginTop: 4 }}>
                  Total depósitos: {fmt(depositsTotal(F), "USD")}
                </div>
              )}
            </div>
          </div>

          {/* TRANSFER + INSURANCE */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Gastos de Traspaso y Seguro</div>
            <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.transfer_included} onChange={e => uf("transfer_included", e.target.checked)} /> Traspaso incluido
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.transfer_in_price} onChange={e => uf("transfer_in_price", e.target.checked)} /> En precio
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.transfer_in_financing} onChange={e => uf("transfer_in_financing", e.target.checked)} /> En financiamiento
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.has_insurance} onChange={e => uf("has_insurance", e.target.checked)} /> Incluye seguro
              </label>
              {F.has_insurance && (
                <div style={{ width: 120 }}>{fld("Meses", "insurance_months", { inputType: "number" })}</div>
              )}
            </div>
          </div>

          {/* AGENTS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Vendedores (1% comisión total)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Vendedor 1", "agent1_id", { type: "select", options: agents.map(a => ({ v: a.id, l: a.name })) })}
              {fld("Vendedor 2 (opcional)", "agent2_id", { type: "select", options: [{ v: "", l: "Ninguno" }, ...agents.map(a => ({ v: a.id, l: a.name }))] })}
            </div>
            {F.agent1_id && (() => {
              const has2 = F.agent2_id && F.agent2_id !== F.agent1_id;
              const totalComm = (parseFloat(F.sale_price) || 0) * 0.01;
              const each = has2 ? totalComm / 2 : totalComm;
              return (
                <div style={{ fontSize: 12, color: "#8b8fa4", marginTop: 4 }}>
                  Comisión total: {fmt(totalComm, "USD")}
                  {has2 ? ` (${fmt(each, "USD")} por vendedor)` : ""}
                </div>
              );
            })()}
          </div>

          {/* OBSERVATIONS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#4f8cff" }}>Observaciones</div>
              <button onClick={() => uf("observations", generateObservations(F))}
                style={{ ...S.sel, fontSize: 11, color: "#f59e0b", background: "#f59e0b10", padding: "5px 12px" }}>
                Auto-generar
              </button>
            </div>
            <textarea value={F.observations || ""} onChange={e => uf("observations", e.target.value)} rows={4}
              style={{ ...S.inp, width: "100%", resize: "vertical", fontFamily: "inherit" }} placeholder="Haga clic en 'Auto-generar' o escriba manualmente..." />
          </div>

          {/* SUBMIT */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button onClick={() => { setSalesView("list"); setSaleForm(null); }} style={{ ...S.sel, color: "#8b8fa4", padding: "12px 24px" }}>Cancelar</button>
            <button onClick={saveSale} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
              Enviar para Aprobación
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderPage = () => {
    if (tab==="Dashboard") return renderDash();
    if (tab==="Inventario") return renderInv();
    if (tab==="Facturas") return renderFac();
    if (tab==="Costos") return renderCostos();
    if (tab==="Clientes") return renderCli();
    if (tab==="Ventas") return renderSales();
    return <PH t={tab}/>;
  };

  // ======= MAIN RENDER =======
  return (
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",background:"#0f1117",color:"#e8eaf0",minHeight:"100vh"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{margin:0;padding:0;box-sizing:border-box}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#2a2d3d;border-radius:3px}select{appearance:auto}@media print{body{background:#fff!important}body>*{display:none!important}#plan-de-ventas-print{display:block!important;position:fixed;inset:0;z-index:99999;background:#fff;padding:30px 40px;overflow:visible}.no-print{display:none!important}}`}</style>
      <div style={{display:"flex",height:"100vh",overflow:"hidden"}}>
        <div style={{width:200,background:"#181a23",borderRight:"1px solid #2a2d3d",padding:"20px 8px",flexShrink:0,overflowY:"auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"0 10px 20px",borderBottom:"1px solid #2a2d3d",marginBottom:12}}>
            <div style={{width:30,height:30,borderRadius:8,background:"linear-gradient(135deg,#e11d48,#f97316)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:800,fontSize:14}}>V</div>
            <div><div style={{fontSize:13,fontWeight:800}}>VCR Manager</div><div style={{fontSize:9,color:"#8b8fa4",letterSpacing:.5}}>VEHÍCULOS DE CR</div></div>
          </div>
          {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{width:"100%",textAlign:"left",padding:"9px 12px",borderRadius:8,border:"none",cursor:"pointer",background:tab===t?"#4f8cff14":"transparent",color:tab===t?"#4f8cff":"#8b8fa4",fontWeight:tab===t?600:400,fontSize:13,fontFamily:"inherit",marginBottom:2}}>{t}</button>)}
        </div>
        <main style={{flex:1,overflow:"auto",padding:22}}>
          {renderPage()}

          {/* ======= GLOBAL INVOICE MODAL ======= */}
          {pickedInv && (
            <div style={S.modal} onClick={() => setPickedInv(null)}>
              <div style={S.mbox} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <h3 style={{fontSize:17,fontWeight:700,margin:0}}>{supDisplay(pickedInv)}</h3>
                    <p style={{fontSize:12,color:"#8b8fa4"}}>Cédula: {pickedInv.supId} · {new Date(pickedInv.date).toLocaleDateString("es-CR")}</p>
                  </div>
                  <button onClick={() => setPickedInv(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:18}}>✕</button>
                </div>

                {/* Totals */}
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {[["Subtotal",fmt(pickedInv.sub,pickedInv.currency==="USD"?"USD":undefined)],["IVA",fmt(pickedInv.tax,pickedInv.currency==="USD"?"USD":undefined)],["Total",fmt(pickedInv.total,pickedInv.currency==="USD"?"USD":undefined)]].map(([l,v])=>(
                    <div key={l} style={{flex:1,background:"#1e2130",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:"#8b8fa4"}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:700}}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Category selectors */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Cuenta contable</div>
                  <select value={catGroupId(pickedInv.catId)} onChange={e => {
                    const gid = e.target.value;
                    const firstCat = CATS.find(c => c.g === gid);
                    if (firstCat) { updateInv(pickedInv.key, {catId:firstCat.id}); setPickedInv({...pickedInv,catId:firstCat.id}); }
                  }} style={{...S.sel,width:"100%",marginBottom:8}}>
                    {GROUPS.map(g => <option key={g.id} value={g.id}>{g.l}</option>)}
                  </select>
                  <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Categoría del gasto</div>
                  <select value={pickedInv.catId} onChange={e => {
                    updateInv(pickedInv.key, {catId:e.target.value});
                    setPickedInv({...pickedInv,catId:e.target.value});
                  }} style={{...S.sel,width:"100%"}}>
                    {CATS.filter(c => c.g === catGroupId(pickedInv.catId)).map(c => <option key={c.id} value={c.id}>{c.l}</option>)}
                  </select>
                </div>

                {/* Plate assignment - only for Costos */}
                <div style={{marginBottom:14}}>
                  {catType(pickedInv.catId) === "costo" ? (<>
                    <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Asignar a placa</div>
                    <div style={{display:"flex",gap:8}}>
                      <select value={pickedInv.plate||""} onChange={e => {
                        const pl = e.target.value;
                        const st = pl ? "assigned" : "unassigned";
                        updateInv(pickedInv.key, {plate:pl||null,assignStatus:st});
                        setPickedInv({...pickedInv,plate:pl||null,assignStatus:st});
                      }} style={{...S.sel,flex:1}}>
                        <option value="">Sin asignar</option>
                        {cars.filter(c=>c.p!=="CONSIGNA").map(c=><option key={c.p} value={c.p}>{c.p} - {c.b} {c.m}</option>)}
                      </select>
                      <button onClick={() => {
                        updateInv(pickedInv.key, {assignStatus:"operational",plate:null});
                        setPickedInv({...pickedInv,assignStatus:"operational",plate:null});
                      }} style={{...S.sel,background:pickedInv.assignStatus==="operational"?"#8b5cf620":"#1e2130",color:pickedInv.assignStatus==="operational"?"#8b5cf6":"#8b8fa4",fontWeight:600}}>Operativo</button>
                    </div>
                  </>) : (
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{...S.badge("#8b5cf6"),fontSize:12}}>Gasto operativo</span>
                      <span style={{fontSize:11,color:"#8b8fa4"}}>Los gastos no se asignan a vehículos</span>
                    </div>
                  )}
                </div>

                {/* Payment status */}
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Estado de pago</div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={() => {
                      const ns = pickedInv.payStatus==="paid"?"pending":"paid";
                      updateInv(pickedInv.key, {payStatus:ns});
                      setPickedInv({...pickedInv,payStatus:ns});
                    }} style={{...S.sel,flex:"0 0 auto",background:pickedInv.payStatus==="paid"?"#10b98120":"#1e2130",color:pickedInv.payStatus==="paid"?"#10b981":"#8b8fa4",fontWeight:600}}>
                      {pickedInv.payStatus==="paid"?"✓ Pagada":"Marcar pagada"}
                    </button>
                    {pickedInv.payStatus==="paid"&&<>
                      <input placeholder="Banco" value={pickedInv.paidBank||""} onChange={e=>{updateInv(pickedInv.key,{paidBank:e.target.value});setPickedInv({...pickedInv,paidBank:e.target.value});}} style={{...S.inp,flex:1}} />
                      <input placeholder="# depósito" value={pickedInv.paidRef||""} onChange={e=>{updateInv(pickedInv.key,{paidRef:e.target.value});setPickedInv({...pickedInv,paidRef:e.target.value});}} style={{...S.inp,flex:1}} />
                    </>}
                  </div>
                </div>

                {/* Line detail */}
                <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Detalle</div>
                {pickedInv.lines && pickedInv.lines.length > 0 ? (
                  <div style={S.card}>
                    {pickedInv.lines.map((l,i) => (
                      <div key={i} style={{padding:"8px 14px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",fontSize:12}}>
                        <span style={{flex:1}}>{l.desc}</span>
                        <span style={{color:"#8b8fa4",marginLeft:12}}>{l.taxRate}%</span>
                        <span style={{fontWeight:600,marginLeft:12}}>{fmt(l.total,pickedInv.currency==="USD"?"USD":undefined)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{padding:"12px",fontSize:12,color:"#8b8fa4"}}>Cargando detalle...</div>
                )}

                {/* Vehicle purchase form */}
                {pickedInv.isVehicle && pickedInv.vehicleStatus === 'detected' && (
                  <div style={{marginTop:16,background:"#f59e0b10",border:"1px solid #f59e0b30",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#f59e0b",marginBottom:10}}>🚗 Compra de vehículo detectada</div>
                    {!vehicleForm ? (
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={() => setVehicleForm({plate:"",brand:"",model:"",year:"",color:"",km:"",drive:"",fuel:"",style:"",price_usd:"",price_crc:"",consignment:false,consignment_owner:""})} style={{...S.sel,background:"#f59e0b",color:"#fff",fontWeight:600,flex:1,border:"none"}}>
                          Completar datos del vehículo
                        </button>
                        <button onClick={dismissVehicle} style={{...S.sel,color:"#8b8fa4"}}>No es un vehículo</button>
                      </div>
                    ) : (
                      <div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 12px"}}>
                          {[["Placa *","plate"],["Marca","brand"],["Modelo","model"],["Año","year"],["Color","color"],["Kilometraje","km"],["Tracción","drive"],["Combustible","fuel"],["Estilo","style"],["Precio venta USD","price_usd"],["Precio venta CRC","price_crc"]].map(([l,k])=>(
                            <div key={k}>
                              <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>{l}</div>
                              <input value={vehicleForm[k]||""} onChange={e=>setVehicleForm(prev=>({...prev,[k]:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                            </div>
                          ))}
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Consignación</div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>setVehicleForm(prev=>({...prev,consignment:!prev.consignment}))} style={{...S.sel,fontSize:11,background:vehicleForm.consignment?"#8b5cf620":"#1e2130",color:vehicleForm.consignment?"#8b5cf6":"#8b8fa4"}}>
                                {vehicleForm.consignment?"Sí":"No"}
                              </button>
                              {vehicleForm.consignment&&<input placeholder="Dueño" value={vehicleForm.consignment_owner||""} onChange={e=>setVehicleForm(prev=>({...prev,consignment_owner:e.target.value}))} style={{...S.inp,flex:1,fontSize:12}} />}
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"flex-end"}}>
                          <button onClick={()=>setVehicleForm(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                          <button onClick={saveVehicleFromInvoice} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none"}}>
                            Confirmar y agregar al inventario
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {pickedInv.isVehicle && pickedInv.vehicleStatus === 'completed' && (
                  <div style={{marginTop:16,background:"#10b98110",borderRadius:12,padding:"10px 14px",fontSize:12,color:"#10b981",fontWeight:600}}>
                    ✓ Vehículo agregado al inventario
                  </div>
                )}

                {/* DELETE BUTTON */}
                <div style={{marginTop:16,borderTop:"1px solid #2a2d3d",paddingTop:14}}>
                  {!showDelete ? (
                    <button onClick={() => {setShowDelete(true);setDeletePin("");setDeleteErr("");}} style={{...S.sel,color:"#e11d48",background:"#e11d4810",fontWeight:600,width:"100%"}}>
                      Eliminar factura
                    </button>
                  ) : (
                    <div>
                      <div style={{fontSize:12,color:"#e11d48",marginBottom:6,fontWeight:600}}>Ingrese PIN para confirmar:</div>
                      <div style={{display:"flex",gap:8}}>
                        <input type="password" maxLength={4} placeholder="PIN" value={deletePin} onChange={e=>{setDeletePin(e.target.value);setDeleteErr("");}} style={{...S.inp,flex:1}} />
                        <button onClick={() => deleteInvoice(pickedInv.key)} style={{...S.sel,color:"#fff",background:"#e11d48",fontWeight:600}}>Confirmar</button>
                        <button onClick={() => {setShowDelete(false);setDeletePin("");setDeleteErr("");}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                      </div>
                      {deleteErr && <div style={{fontSize:11,color:"#e11d48",marginTop:4}}>{deleteErr}</div>}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}
          {/* ======= SALE PREVIEW MODAL ======= */}
          {pickedSale && (
            <div style={S.modal} onClick={() => setPickedSale(null)}>
              <div style={{ ...S.mbox, maxWidth: 650 }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>Plan de Ventas #{pickedSale.sale_number}</h3>
                    <p style={{ fontSize: 12, color: "#8b8fa4" }}>{new Date(pickedSale.sale_date).toLocaleDateString("es-CR")}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={S.badge(pickedSale.status === "approved" ? "#10b981" : pickedSale.status === "rejected" ? "#e11d48" : "#f59e0b")}>
                      {pickedSale.status === "approved" ? "Aprobada" : pickedSale.status === "rejected" ? "Rechazada" : "Pendiente"}
                    </span>
                    <button onClick={() => setPickedSale(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#8b8fa4", fontSize: 18 }}>✕</button>
                  </div>
                </div>

                {/* Client */}
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Cliente</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#2a2d3d" }}>
                    {[["Nombre", pickedSale.client_name], ["Cédula", pickedSale.client_cedula], ["Tel 1", pickedSale.client_phone1], ["Tel 2", pickedSale.client_phone2],
                      ["Email", pickedSale.client_email], ["Trabajo", pickedSale.client_workplace], ["Oficio", pickedSale.client_occupation], ["Estado civil", pickedSale.client_civil_status],
                    ].filter(([, v]) => v).map(([l, v], i) => (
                      <div key={i} style={{ background: "#181a23", padding: "6px 14px" }}>
                        <div style={{ fontSize: 9, color: "#8b8fa4", textTransform: "uppercase" }}>{l}</div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {pickedSale.client_address && <div style={{ padding: "6px 14px", fontSize: 12 }}><span style={{ color: "#8b8fa4", fontSize: 9, textTransform: "uppercase" }}>Dirección: </span>{pickedSale.client_address}</div>}
                </div>

                {/* Vehicles side by side */}
                <div style={{ display: "grid", gridTemplateColumns: pickedSale.has_tradein ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 12 }}>
                  <div style={S.card}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Vehículo que Compra</div>
                    <div style={{ padding: "10px 16px" }}>
                      {[["Placa", pickedSale.vehicle_plate], ["Marca", pickedSale.vehicle_brand], ["Modelo", pickedSale.vehicle_model],
                        ["Año", pickedSale.vehicle_year], ["Color", pickedSale.vehicle_color], ["Km", pickedSale.vehicle_km ? fK(pickedSale.vehicle_km) : null],
                        ["Tracción", pickedSale.vehicle_drive], ["Combustible", pickedSale.vehicle_fuel],
                      ].filter(([, v]) => v).map(([l, v], i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid #2a2d3d" }}>
                          <span style={{ color: "#8b8fa4" }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {pickedSale.has_tradein && (
                    <div style={S.card}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#f59e0b" }}>Vehículo que Recibe</div>
                      <div style={{ padding: "10px 16px" }}>
                        {[["Placa", pickedSale.tradein_plate], ["Marca", pickedSale.tradein_brand], ["Modelo", pickedSale.tradein_model],
                          ["Año", pickedSale.tradein_year], ["Color", pickedSale.tradein_color], ["Km", pickedSale.tradein_km ? fK(pickedSale.tradein_km) : null],
                          ["Tracción", pickedSale.tradein_drive], ["Combustible", pickedSale.tradein_fuel],
                          ["Valor", fmt(pickedSale.tradein_value, "USD")],
                        ].filter(([, v]) => v).map(([l, v], i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid #2a2d3d" }}>
                            <span style={{ color: "#8b8fa4" }}>{l}</span><span style={{ fontWeight: 600 }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Conditions */}
                <div style={{ ...S.card, marginBottom: 12 }}>
                  <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Condiciones</div>
                  <div style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}>
                      <span>Precio de venta</span><span style={{ fontWeight: 800, color: "#4f8cff", fontSize: 16 }}>{fmt(pickedSale.sale_price, "USD")}</span>
                    </div>
                    {pickedSale.tradein_amount > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Vehículo recibido</span><span>- {fmt(pickedSale.tradein_amount, "USD")}</span></div>}
                    {pickedSale.down_payment > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Prima</span><span>- {fmt(pickedSale.down_payment, "USD")}</span></div>}
                    {pickedSale.deposit_signal > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Señal de trato</span><span>- {fmt(pickedSale.deposit_signal, "USD")}</span></div>}
                    {(pickedSale.deposits_total > 0 || (pickedSale.deposits && pickedSale.deposits.length > 0)) && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Depósitos ({(pickedSale.deposits || []).length})</span><span>- {fmt(pickedSale.deposits_total || (pickedSale.deposits || []).reduce((s, d) => s + (d.amount || 0), 0), "USD")}</span></div>}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", fontWeight: 700 }}>
                      <span>Saldo total</span><span style={{ color: "#e11d48" }}>{fmt(pickedSale.total_balance, "USD")}</span>
                    </div>
                  </div>
                </div>

                {/* Type + Payment + Deposit */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div style={S.card}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Tipo y Pago</div>
                    <div style={{ padding: "10px 16px", fontSize: 12 }}>
                      <div style={{ marginBottom: 4 }}>
                        <span style={S.badge(pickedSale.sale_type === "propio" ? "#6366f1" : "#f97316")}>
                          {pickedSale.sale_type === "propio" ? "Propio" : pickedSale.sale_type === "consignacion_grupo" ? "Consig. Grupo 1%" : "Consig. Externa 5%"}
                        </span>
                      </div>
                      {pickedSale.sale_type !== "propio" && <div style={{ color: "#10b981", marginBottom: 4 }}>Comisión: {fmt(pickedSale.commission_amount, "USD")}</div>}
                      {pickedSale.payment_method && <div style={{ color: "#8b8fa4" }}>Pago: {pickedSale.payment_method}</div>}
                      {pickedSale.financing_term_months && <div style={{ color: "#8b8fa4" }}>Plazo: {pickedSale.financing_term_months}m al {pickedSale.financing_interest_pct}%</div>}
                      {pickedSale.financing_amount && <div style={{ color: "#8b8fa4" }}>Monto financiado: {fmt(pickedSale.financing_amount, "USD")}</div>}
                    </div>
                  </div>
                  <div style={S.card}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Depósitos</div>
                    <div style={{ padding: "10px 16px", fontSize: 12 }}>
                      {(pickedSale.deposits && pickedSale.deposits.length > 0) ? pickedSale.deposits.map((dep, di) => (
                        <div key={di} style={{ padding: "6px 0", borderBottom: di < pickedSale.deposits.length - 1 ? "1px solid #2a2d3d" : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "#e8eaf0", fontWeight: 600 }}>{fmt(dep.amount, "USD")}</span>
                            <span style={{ color: "#8b8fa4", fontSize: 11 }}>{dep.deposit_date ? new Date(dep.deposit_date + "T12:00:00").toLocaleDateString("es-CR") : ""}</span>
                          </div>
                          <div style={{ color: "#8b8fa4", fontSize: 11 }}>
                            {dep.bank && <span>{dep.bank}</span>}
                            {dep.bank && dep.reference && <span> · </span>}
                            {dep.reference && <span>#{dep.reference}</span>}
                          </div>
                        </div>
                      )) : (
                        <div style={{ color: "#8b8fa4" }}>Sin depósitos registrados</div>
                      )}
                      {pickedSale.deposits && pickedSale.deposits.length > 1 && (
                        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTop: "1px solid #2a2d3d", fontWeight: 700, color: "#10b981" }}>
                          <span>Total</span><span>{fmt(pickedSale.deposits.reduce((s, d) => s + (d.amount || 0), 0), "USD")}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        {pickedSale.transfer_included && <span style={S.badge("#8b5cf6")}>Traspaso incluido</span>}
                        {pickedSale.has_insurance && <span style={{ ...S.badge("#0ea5e9"), marginLeft: 4 }}>Seguro {pickedSale.insurance_months}m</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Observations */}
                {pickedSale.observations && (
                  <div style={{ ...S.card, padding: "10px 16px", marginBottom: 12, fontSize: 12 }}>
                    <span style={{ color: "#8b8fa4" }}>Observaciones: </span>{pickedSale.observations}
                  </div>
                )}

                {/* Approval buttons */}
                {pickedSale.status === "pending" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={() => { const r = prompt("Razón del rechazo (opcional):"); rejectSale(pickedSale.id, r); }}
                      style={{ ...S.sel, color: "#e11d48", background: "#e11d4810", fontWeight: 600, padding: "12px 24px" }}>
                      Rechazar
                    </button>
                    <button onClick={() => approveSale(pickedSale.id)}
                      style={{ ...S.sel, background: "#10b981", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                      Aprobar Venta
                    </button>
                  </div>
                )}
                {pickedSale.status === "approved" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={() => { setPrintSale(pickedSale); setPickedSale(null); }}
                      style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                      Ver Plan de Ventas
                    </button>
                  </div>
                )}
                {pickedSale.status === "rejected" && pickedSale.rejected_reason && (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "#e11d4810", borderRadius: 8, fontSize: 12, color: "#e11d48" }}>
                    Rechazada: {pickedSale.rejected_reason}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======= PRINTABLE PLAN DE VENTAS ======= */}
          {printSale && (() => {
            const s = printSale;
            const deps = s.deposits || [];
            const depsSum = deps.reduce((t, d) => t + (d.amount || 0), 0);
            const sAgents = s.sale_agents || [];
            const P = { page: { background: "#fff", color: "#1a1a2e", padding: "40px 50px", maxWidth: 800, margin: "0 auto", fontFamily: "'DM Sans', system-ui, sans-serif", fontSize: 13, lineHeight: 1.6 }, h: { textAlign: "center", marginBottom: 30 }, logo: { fontSize: 22, fontWeight: 800, color: "#e11d48", letterSpacing: 1 }, sub: { fontSize: 11, color: "#666", marginTop: 2 }, title: { fontSize: 18, fontWeight: 800, color: "#1a1a2e", margin: "20px 0 6px", borderBottom: "2px solid #e11d48", paddingBottom: 6 }, sect: { marginBottom: 20 }, row: { display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid #eee", fontSize: 12 }, lbl: { color: "#666" }, val: { fontWeight: 600 }, tbl: { width: "100%", borderCollapse: "collapse", fontSize: 12, marginTop: 6 }, th: { background: "#f5f5f5", padding: "8px 12px", textAlign: "left", fontWeight: 700, borderBottom: "2px solid #ddd", fontSize: 11, textTransform: "uppercase", color: "#555" }, td: { padding: "6px 12px", borderBottom: "1px solid #eee" }, tdR: { padding: "6px 12px", borderBottom: "1px solid #eee", textAlign: "right", fontWeight: 600 }, total: { background: "#f8f8f8", fontWeight: 800 }, sig: { display: "inline-block", width: "45%", textAlign: "center", marginTop: 60, borderTop: "1px solid #333", paddingTop: 8, fontSize: 11, color: "#666" } };
            const R = (l, v) => v ? <div style={P.row}><span style={P.lbl}>{l}</span><span style={P.val}>{v}</span></div> : null;
            return (
              <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#0f1117ee", overflowY: "auto" }}>
                <div style={{ maxWidth: 850, margin: "20px auto", position: "relative" }}>
                  {/* Action bar */}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginBottom: 10, padding: "0 10px" }} className="no-print">
                    <button onClick={() => window.print()} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 600, padding: "8px 20px", border: "none" }}>Imprimir / PDF</button>
                    <button onClick={() => setPrintSale(null)} style={{ ...S.sel, color: "#8b8fa4", padding: "8px 20px" }}>Cerrar</button>
                  </div>
                  <div id="plan-de-ventas-print" style={P.page}>
                    {/* Header */}
                    <div style={P.h}>
                      <div style={P.logo}>VEHÍCULOS DE COSTA RICA</div>
                      <div style={P.sub}>Cédula Jurídica 3-101-124464</div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginTop: 16, color: "#1a1a2e" }}>PLAN DE VENTAS #{s.sale_number}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>Fecha: {new Date(s.sale_date).toLocaleDateString("es-CR", { day: "numeric", month: "long", year: "numeric" })}</div>
                      <div style={{ marginTop: 6 }}>
                        <span style={{ display: "inline-block", background: s.status === "approved" ? "#10b981" : "#f59e0b", color: "#fff", padding: "3px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                          {s.status === "approved" ? "Aprobada" : s.status === "rejected" ? "Rechazada" : "Pendiente"}
                        </span>
                      </div>
                    </div>

                    {/* Client */}
                    <div style={P.sect}>
                      <div style={P.title}>Datos del Cliente</div>
                      {R("Nombre", s.client_name)}
                      {R("Cédula", s.client_cedula)}
                      {R("Teléfono 1", s.client_phone1)}
                      {R("Teléfono 2", s.client_phone2)}
                      {R("Email", s.client_email)}
                      {R("Dirección", s.client_address)}
                      {R("Lugar de trabajo", s.client_workplace)}
                      {R("Oficio", s.client_occupation)}
                      {R("Estado civil", s.client_civil_status)}
                    </div>

                    {/* Vehicle sold */}
                    <div style={P.sect}>
                      <div style={P.title}>Vehículo que Compra</div>
                      <table style={P.tbl}>
                        <thead><tr>
                          <th style={P.th}>Placa</th><th style={P.th}>Marca</th><th style={P.th}>Modelo</th><th style={P.th}>Año</th><th style={P.th}>Color</th><th style={P.th}>Km</th><th style={P.th}>Tracción</th><th style={P.th}>Combustible</th>
                        </tr></thead>
                        <tbody><tr>
                          <td style={P.td}>{s.vehicle_plate}</td><td style={P.td}>{s.vehicle_brand}</td><td style={P.td}>{s.vehicle_model}</td><td style={P.td}>{s.vehicle_year}</td><td style={P.td}>{s.vehicle_color}</td><td style={P.td}>{s.vehicle_km ? fK(s.vehicle_km) : "-"}</td><td style={P.td}>{s.vehicle_drive}</td><td style={P.td}>{s.vehicle_fuel}</td>
                        </tr></tbody>
                      </table>
                    </div>

                    {/* Trade-in */}
                    {s.has_tradein && (
                      <div style={P.sect}>
                        <div style={P.title}>Vehículo que se Recibe (Trade-in)</div>
                        <table style={P.tbl}>
                          <thead><tr>
                            <th style={P.th}>Placa</th><th style={P.th}>Marca</th><th style={P.th}>Modelo</th><th style={P.th}>Año</th><th style={P.th}>Color</th><th style={P.th}>Km</th><th style={P.th}>Valor</th>
                          </tr></thead>
                          <tbody><tr>
                            <td style={P.td}>{s.tradein_plate}</td><td style={P.td}>{s.tradein_brand}</td><td style={P.td}>{s.tradein_model}</td><td style={P.td}>{s.tradein_year}</td><td style={P.td}>{s.tradein_color}</td><td style={P.td}>{s.tradein_km ? fK(s.tradein_km) : "-"}</td><td style={{ ...P.td, fontWeight: 700 }}>{fmt(s.tradein_value, "USD")}</td>
                          </tr></tbody>
                        </table>
                      </div>
                    )}

                    {/* Conditions */}
                    <div style={P.sect}>
                      <div style={P.title}>Condiciones de Venta</div>
                      <table style={P.tbl}>
                        <tbody>
                          <tr><td style={P.td}>Tipo de venta</td><td style={P.tdR}>
                            {s.sale_type === "propio" ? "Propio" : s.sale_type === "consignacion_grupo" ? "Consignación Grupo (1%)" : "Consignación Externa (5%)"}
                          </td></tr>
                          <tr><td style={P.td}>Precio de venta</td><td style={{ ...P.tdR, fontSize: 15, color: "#1a1a2e" }}>{fmt(s.sale_price, "USD")}</td></tr>
                          {s.tradein_amount > 0 && <tr><td style={P.td}>Vehículo recibido</td><td style={P.tdR}>- {fmt(s.tradein_amount, "USD")}</td></tr>}
                          {s.down_payment > 0 && <tr><td style={P.td}>Prima</td><td style={P.tdR}>- {fmt(s.down_payment, "USD")}</td></tr>}
                          {s.deposit_signal > 0 && <tr><td style={P.td}>Señal de trato</td><td style={P.tdR}>- {fmt(s.deposit_signal, "USD")}</td></tr>}
                          {depsSum > 0 && <tr><td style={P.td}>Depósitos ({deps.length})</td><td style={P.tdR}>- {fmt(depsSum, "USD")}</td></tr>}
                          <tr style={P.total}><td style={{ ...P.td, fontWeight: 800 }}>SALDO PENDIENTE</td><td style={{ ...P.tdR, fontSize: 16, color: "#e11d48" }}>{fmt(s.total_balance, "USD")}</td></tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Deposits detail */}
                    {deps.length > 0 && (
                      <div style={P.sect}>
                        <div style={P.title}>Detalle de Depósitos</div>
                        <table style={P.tbl}>
                          <thead><tr>
                            <th style={P.th}>#</th><th style={P.th}>Banco</th><th style={P.th}>Referencia</th><th style={P.th}>Fecha</th><th style={{ ...P.th, textAlign: "right" }}>Monto</th>
                          </tr></thead>
                          <tbody>
                            {deps.map((d, i) => (
                              <tr key={i}>
                                <td style={P.td}>{i + 1}</td><td style={P.td}>{d.bank || "-"}</td><td style={P.td}>{d.reference || "-"}</td>
                                <td style={P.td}>{d.deposit_date ? new Date(d.deposit_date + "T12:00:00").toLocaleDateString("es-CR") : "-"}</td>
                                <td style={P.tdR}>{fmt(d.amount, "USD")}</td>
                              </tr>
                            ))}
                            {deps.length > 1 && <tr style={P.total}><td style={P.td} colSpan={4}><strong>Total depósitos</strong></td><td style={P.tdR}>{fmt(depsSum, "USD")}</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Payment method */}
                    <div style={P.sect}>
                      <div style={P.title}>Forma de Pago</div>
                      {R("Método", s.payment_method)}
                      {s.financing_term_months && R("Plazo", `${s.financing_term_months} meses`)}
                      {s.financing_interest_pct && R("Interés", `${s.financing_interest_pct}%`)}
                      {s.financing_amount && R("Monto financiado", fmt(s.financing_amount, "USD"))}
                      {s.transfer_included && R("Traspaso", s.transfer_in_price ? "Incluido en precio" : s.transfer_in_financing ? "Incluido en financiamiento" : "Incluido")}
                      {s.has_insurance && R("Seguro", `${s.insurance_months} meses`)}
                      {s.sale_type !== "propio" && R("Comisión consignación", `${s.commission_pct}% = ${fmt(s.commission_amount, "USD")}`)}
                    </div>

                    {/* Agents */}
                    {sAgents.length > 0 && (
                      <div style={P.sect}>
                        <div style={P.title}>Vendedores</div>
                        <table style={P.tbl}>
                          <thead><tr><th style={P.th}>Nombre</th><th style={{ ...P.th, textAlign: "right" }}>Comisión</th></tr></thead>
                          <tbody>
                            {sAgents.map((a, i) => (
                              <tr key={i}><td style={P.td}>{a.agent_name}</td><td style={P.tdR}>{a.commission_pct}% = {fmt(a.commission_amount, "USD")}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Observations */}
                    {s.observations && (
                      <div style={P.sect}>
                        <div style={P.title}>Observaciones</div>
                        <div style={{ background: "#f8f8f8", padding: "12px 16px", borderRadius: 6, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{s.observations}</div>
                      </div>
                    )}

                    {/* Signatures */}
                    <div style={{ marginTop: 50, display: "flex", justifyContent: "space-around" }}>
                      <div style={P.sig}>Firma del Vendedor</div>
                      <div style={P.sig}>Firma del Cliente</div>
                      <div style={P.sig}>Aprobado por Gerencia</div>
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: 40, textAlign: "center", fontSize: 10, color: "#999", borderTop: "1px solid #ddd", paddingTop: 12 }}>
                      Vehículos de Costa Rica S.R.L. · Cédula Jurídica 3-101-124464 · Documento generado el {new Date().toLocaleDateString("es-CR", { day: "numeric", month: "long", year: "numeric" })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        </main>
      </div>
    </div>
  );
}
