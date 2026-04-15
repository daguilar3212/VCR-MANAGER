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
  const [costView, setCostView] = useState("vehicles");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteErr, setDeleteErr] = useState("");

  // Load data on mount
  useEffect(() => { loadInvoices(); loadSyncStatus(); }, []);

  const loadInvoices = async () => {
    const { data } = await supabase.from('invoices').select('*').order('emission_date', { ascending: false });
    if (data) {
      setInvoices(data.map(inv => ({
        key: inv.xml_key, last4: inv.last_four, date: inv.emission_date,
        supName: inv.supplier_name, supComm: inv.supplier_commercial_name, supId: inv.supplier_id,
        sub: inv.subtotal, tax: inv.tax_total, other: inv.other_charges, total: inv.total,
        payCode: inv.payment_method_code, payLabel: inv.payment_method_label, isTC: inv.is_credit_card,
        plate: inv.plate, warnPlate: inv.assign_status === 'warning' ? inv.detected_plate : null,
        catId: inv.category_id || 'otro', assignStatus: inv.assign_status || 'unassigned',
        payStatus: inv.pay_status || 'pending', paidBank: inv.paid_bank || '', paidRef: inv.paid_reference || '',
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
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch('/api/fetch-gmail-invoices', { headers: { 'Authorization': 'Bearer vcr2026cron' } });
      const data = await res.json();
      setSyncMsg("Procesadas: " + (data.processed || 0) + ", Omitidas: " + (data.skipped || 0));
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
      if (cat) dbUpdates.group_id = cat.g;
      const inv = invoices.find(x => x.key === key);
      if (inv && inv.lines && inv.lines.length > 0 && inv.lines[0].cabys) {
        await supabase.from('cabys_mapping').upsert({
          cabys_code: inv.lines[0].cabys, category_id: updates.catId,
          group_id: cat ? cat.g : 'otros_gastos', source: 'manual'
        }, { onConflict: 'cabys_code' });
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
          {invoices.length===0?<div style={{padding:"20px 18px",fontSize:13,color:"#8b8fa4"}}>Sin facturas cargadas</div>:invoices.slice(0,5).map((x,i)=>(<div key={i} style={{padding:"10px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:13,fontWeight:600}}>{supDisplay(x)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{catLabel(x.catId)}</div></div><span style={{fontSize:14,fontWeight:700,color:"#4f8cff"}}>{fmt(x.total)}</span></div>))}
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
    const fList = invoices.filter(x => (fCat==="all"||x.catId===fCat)&&(fPay==="all"||x.payStatus===fPay)&&(fAssign==="all"||x.assignStatus===fAssign));
    return (
      <div>
        <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Facturas v3</h1>
        <div style={{display:"flex",gap:12,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={syncGmail} disabled={syncing} style={{...S.sel,background:syncing?"#1e2130":"#4f8cff18",color:syncing?"#8b8fa4":"#4f8cff",fontWeight:600,padding:"10px 20px"}}>
            {syncing?"Sincronizando...":"Sincronizar Gmail"}
          </button>
          {syncMsg&&<span style={{fontSize:12,color:"#10b981"}}>{syncMsg}</span>}
          {lastSync&&<span style={{fontSize:11,color:"#8b8fa4"}}>Última sync: {lastSync.toLocaleString("es-CR")}</span>}
        </div>
        {invoices.length>0&&<>
          <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
            <select value={fCat} onChange={e=>setFCat(e.target.value)} style={S.sel}><option value="all">Categoría</option>{CATS.map(c=><option key={c.id} value={c.id}>{c.l}</option>)}</select>
            <select value={fPay} onChange={e=>setFPay(e.target.value)} style={S.sel}><option value="all">Pago</option><option value="pending">Pendiente</option><option value="paid">Pagada</option></select>
            <select value={fAssign} onChange={e=>setFAssign(e.target.value)} style={S.sel}><option value="all">Asignación</option><option value="assigned">Asignada</option><option value="unassigned">Sin asignar</option><option value="operational">Operativo</option></select>
          </div>
          <div style={{fontSize:13,color:"#8b8fa4",marginBottom:10}}>{fList.length} factura{fList.length!==1?"s":""}</div>
          <div style={S.card}>
            {fList.map((x,i)=>(
              <div key={i} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",cursor:"pointer"}} onClick={()=>openInvoice(x)}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div><div style={{fontWeight:600,fontSize:13}}>{supDisplay(x)}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{x.supId} · ...{x.last4} · {new Date(x.date).toLocaleDateString("es-CR")}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontWeight:700,color:"#4f8cff"}}>{fmt(x.total)}</div></div>
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  <span style={S.badge("#64748b")}>{catGroupLabel(x.catId)}</span>
                  <span style={S.badge("#0ea5e9")}>{catLabel(x.catId)}</span>
                  <span style={S.badge(x.isTC?"#e11d48":"#64748b")}>{x.payLabel}</span>
                  <span style={S.badge(x.payStatus==="paid"?"#10b981":"#f59e0b")}>{x.payStatus==="paid"?"Pagada":"Pendiente"}</span>
                  {x.assignStatus==="assigned"&&<span style={S.badge("#10b981")}>Placa: {x.plate}</span>}
                  {x.assignStatus==="unassigned"&&<span style={S.badge("#f59e0b")}>Sin asignar</span>}
                  {x.assignStatus==="operational"&&<span style={S.badge("#8b5cf6")}>Operativo</span>}
                  {x.warnPlate&&<span style={S.badge("#e11d48")}>⚠ {x.warnPlate} no en inv.</span>}
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

  const renderPage = () => {
    if (tab==="Dashboard") return renderDash();
    if (tab==="Inventario") return renderInv();
    if (tab==="Facturas") return renderFac();
    if (tab==="Costos") return renderCostos();
    if (tab==="Clientes") return renderCli();
    return <PH t={tab}/>;
  };

  // ======= MAIN RENDER =======
  return (
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",background:"#0f1117",color:"#e8eaf0",minHeight:"100vh"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{margin:0;padding:0;box-sizing:border-box}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#2a2d3d;border-radius:3px}select{appearance:auto}`}</style>
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
                  {[["Subtotal",fmt(pickedInv.sub)],["IVA",fmt(pickedInv.tax)],["Total",fmt(pickedInv.total)]].map(([l,v])=>(
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

                {/* Plate assignment */}
                <div style={{marginBottom:14}}>
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
                        <span style={{fontWeight:600,marginLeft:12}}>{fmt(l.total)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{padding:"12px",fontSize:12,color:"#8b8fa4"}}>Cargando detalle...</div>
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
        </main>
      </div>
    </div>
  );
}
