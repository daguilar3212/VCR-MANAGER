import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthProvider.jsx';

// ============================================================
// REGLA DE PLACA: MAYUSCULA sin guion, excepto CL que si lleva guion
// ============================================================
const formatPlate = (val) => {
  if (!val) return "";
  const clean = String(val).toUpperCase().replace(/[\s-]/g, "");
  if (!clean) return "";
  const clMatch = clean.match(/^CL(\d+)$/);
  if (clMatch) return `CL-${clMatch[1]}`;
  return clean;
};

// ============================================================
// CATALOGO CABYS DE VEHICULOS (Hacienda v4.4, 13 dígitos)
// Las 12 categorías que realmente vende VCR
// ============================================================
const CABYS_VEHICLES = [
  { code: "4911306020100", label: "SUV 4 puertas <= 2000cc" },
  { code: "4911306020200", label: "SUV 4 puertas > 2000cc" },
  { code: "4911307020100", label: "Todoterreno 4 puertas <= 2000cc" },
  { code: "4911307020200", label: "Todoterreno 4 puertas > 2000cc" },
  { code: "4911308050100", label: "Sedán 4 puertas <= 2000cc" },
  { code: "4911308050200", label: "Sedán 4 puertas > 2000cc" },
  { code: "4911308040100", label: "Sedán hatchback 3p <= 2000cc" },
  { code: "4911308040200", label: "Sedán hatchback 3p > 2000cc" },
  { code: "4911404000000", label: "Pick Up (hasta 5t)" },
  { code: "4911200000100", label: "Microbús" },
  { code: "4911315000000", label: "Vehículo eléctrico" },
  { code: "4911316000000", label: "Vehículo híbrido" },
];

// Auto-sugerir CABYS segun estilo, CC y combustible
const suggestCabys = (style, cc, fuel) => {
  // Combustible primero: electrico/hibrido ganan siempre
  if (fuel) {
    const f = String(fuel).toLowerCase();
    if (f.includes("electri")) return "4911315000000";
    if (f.includes("hibrido") || f.includes("híbrido") || f.includes("hybrid")) return "4911316000000";
  }
  if (!style) return null;
  const s = String(style).toUpperCase();
  const ccNum = parseInt(cc, 10);
  const isSmall = !isNaN(ccNum) && ccNum > 0 && ccNum <= 2000;

  if (s.includes("PICK") || s.includes("CAMIONETA")) return "4911404000000";
  if (s.includes("MICROBUS") || s.includes("BUSETA") || s.includes("VAN")) return "4911200000100";
  if (s.includes("SUV")) return isSmall ? "4911306020100" : "4911306020200";
  if (s.includes("TODO") || s.includes("TERRENO")) return isSmall ? "4911307020100" : "4911307020200";
  if (s.includes("HATCHBACK")) return isSmall ? "4911308040100" : "4911308040200";
  if (s.includes("SEDAN") || s.includes("SEDÁN")) return isSmall ? "4911308050100" : "4911308050200";
  return null;
};

// ============================================================
// COMPONENTE DE FIRMA
// ============================================================
const SignaturePad = ({ onSave, onCancel, existingSignature }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(!!existingSignature);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    if (existingSignature) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = existingSignature;
    }
  }, [existingSignature]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => { e.preventDefault(); setIsDrawing(true); const { x, y } = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x, y); };
  const draw = (e) => { if (!isDrawing) return; e.preventDefault(); const { x, y } = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.lineTo(x, y); ctx.stroke(); setHasDrawn(true); };
  const end = () => setIsDrawing(false);
  const clear = () => { const c = canvasRef.current; const ctx = c.getContext("2d"); ctx.clearRect(0, 0, c.width, c.height); setHasDrawn(false); };
  const save = () => {
    if (!hasDrawn) { alert("Por favor firmá antes de guardar."); return; }
    onSave(canvasRef.current.toDataURL("image/png"));
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:16,padding:24,maxWidth:600,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h3 style={{fontSize:18,fontWeight:700,margin:0,color:"#111"}}>Firma del Cliente</h3>
          <button onClick={onCancel} style={{background:"none",border:"none",cursor:"pointer",color:"#666",fontSize:20}}>✕</button>
        </div>
        <p style={{fontSize:12,color:"#666",marginBottom:10}}>Firme en el recuadro con el dedo (móvil) o mouse (computadora).</p>
        <div style={{border:"2px dashed #ccc",borderRadius:10,background:"#fafafa",touchAction:"none"}}>
          <canvas ref={canvasRef} style={{width:"100%",height:220,cursor:"crosshair",display:"block"}}
            onMouseDown={start} onMouseMove={draw} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={draw} onTouchEnd={end} />
        </div>
        <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
          <button onClick={clear} style={{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:13,fontWeight:500}}>Limpiar</button>
          <button onClick={onCancel} style={{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:13,fontWeight:500}}>Cancelar</button>
          <button onClick={save} style={{background:"#10b981",color:"#fff",border:"none",borderRadius:8,padding:"8px 24px",cursor:"pointer",fontSize:13,fontWeight:600}}>Guardar firma</button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// ESTILOS (mismos que App.jsx)
// ============================================================
const S = {
  body: { fontFamily: "system-ui, -apple-system, sans-serif", background: "#f4f4f5", minHeight: "100vh" },
  header: { background: "#18181b", color: "#fff", padding: "1rem 2rem", display: "flex", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: "1.25rem", fontWeight: 700 },
  headerRight: { display: "flex", gap: "1rem", alignItems: "center" },
  headerUser: { fontSize: "0.9rem", color: "#a1a1aa" },
  tab: (active) => ({
    padding: "0.6rem 1.2rem",
    background: active ? "#fff" : "transparent",
    color: active ? "#18181b" : "#71717a",
    border: "none",
    borderBottom: active ? "3px solid #4f8cff" : "3px solid transparent",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.95rem",
  }),
  tabBar: { background: "#fff", padding: "0 2rem", display: "flex", borderBottom: "1px solid #e4e4e7" },
  content: { padding: "2rem", maxWidth: 1400, margin: "0 auto" },
  card: { background: "#fff", borderRadius: 12, padding: "1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", marginBottom: "1.5rem" },
  cardTitle: { fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", color: "#18181b" },
  input: { padding: "0.5rem 0.75rem", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: "0.95rem", width: "100%" },
  sel: { padding: "0.5rem 0.75rem", border: "1px solid #d4d4d8", borderRadius: 6, fontSize: "0.95rem", background: "#fff", cursor: "pointer" },
  btn: { padding: "0.55rem 1.2rem", background: "#4f8cff", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" },
  btnGhost: { padding: "0.55rem 1.2rem", background: "transparent", color: "#71717a", border: "1px solid #d4d4d8", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" },
  btnDanger: { padding: "0.55rem 1.2rem", background: "#e11d48", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.95rem" },
  label: { fontSize: "0.85rem", fontWeight: 600, color: "#52525b", marginBottom: "0.35rem", display: "block" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" },
  grid4: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "1rem" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "0.75rem", textAlign: "left", fontSize: "0.85rem", fontWeight: 700, color: "#52525b", borderBottom: "2px solid #e4e4e7", background: "#fafafa" },
  td: { padding: "0.75rem", borderBottom: "1px solid #f4f4f5", fontSize: "0.9rem", color: "#18181b" },
  badge: (color) => ({ display: "inline-block", background: color, color: "#fff", padding: "3px 10px", borderRadius: 12, fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase" }),
  empty: { textAlign: "center", padding: "3rem", color: "#a1a1aa", fontSize: "0.95rem" },
};

// ============================================================
// HELPERS
// ============================================================
const fmt = (n, currency) => {
  if (n == null || n === "") return "-";
  const num = typeof n === "number" ? n : parseFloat(n);
  if (isNaN(num)) return "-";
  const prefix = currency === "USD" ? "$" : currency === "CRC" ? "₡" : "";
  return prefix + num.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const todayStr = () => new Date().toISOString().split("T")[0];

// Calcula el desglose financiero de una venta
// Fórmula: precio + traspaso (solo si aparte) - trade-in - prima - depósitos = saldo
function computeBreakdown(form) {
  const salePrice = parseFloat(form.sale_price) || 0;
  const tradein = parseFloat(form.tradein_amount) || 0;
  const down = parseFloat(form.down_payment) || 0;
  const depsTotal = (form.deposits || []).reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);

  // Traspaso: solo suma si está incluido pero NO en precio ni en financiamiento (es aparte)
  const transferApart = !!form.transfer_included && !form.transfer_in_price && !form.transfer_in_financing;
  const transferExtra = transferApart ? (parseFloat(form.transfer_amount) || 0) : 0;

  const balance = salePrice + transferExtra - tradein - down - depsTotal;

  return { salePrice, transferExtra, transferApart, tradein, down, depsTotal, balance };
}

const emptyForm = () => ({
  sale_date: todayStr(),
  currency: "USD",
  sale_currency: "USD",
  client_id_type: "fisica",
  client_name: "", client_cedula: "", client_phone1: "", client_phone2: "", client_email: "",
  client_address: "", client_workplace: "", client_occupation: "", client_civil_status: "",
  client_has_activity: false, client_activity_code: "",
  vehicle_id: "", vehicle_plate: "", vehicle_brand: "", vehicle_model: "", vehicle_year: "",
  vehicle_color: "", vehicle_km: "", vehicle_engine: "", vehicle_drive: "", vehicle_fuel: "",
  vehicle_cabys: "", vehicle_style: "", vehicle_engine_cc: "",
  has_tradein: false,
  tradein_plate: "", tradein_brand: "", tradein_model: "", tradein_year: "",
  tradein_color: "", tradein_km: "", tradein_engine: "", tradein_drive: "", tradein_fuel: "",
  tradein_value: "",
  sale_type: "propio",
  sale_price: "", sale_exchange_rate: "", tradein_amount: "", down_payment: "",
  deposit_signal: 0,
  deposits: [{ bank: "", reference: "", date: "", amount: "" }],
  payment_method: "contado",
  financing_term_months: "", financing_interest_pct: "", financing_amount: "",
  transfer_included: false, transfer_in_price: false, transfer_in_financing: false,
  transfer_amount: "",
  has_insurance: false, insurance_months: "",
  iva_exceptional: false, iva_rate: 0,
  observations: "",
  agent2_id: "",
  client_signature: null, signed_at: null,
});

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function AgentPanel() {
  const { profile, signOut } = useAuth();
  const [tab, setTab] = useState("inventario"); // inventario | ventas
  const [view, setView] = useState("list"); // list | form | detail
  const [vehicles, setVehicles] = useState([]);
  const [sales, setSales] = useState([]);
  const [agentsList, setAgentsList] = useState([]);
  const [saleForm, setSaleForm] = useState(null);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [pickedSale, setPickedSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState("disponible");
  const [saleStatusFilter, setSaleStatusFilter] = useState("all");
  const [notif, setNotif] = useState(null); // { type, message } para toast
  const [searchingClient, setSearchingClient] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  // ============================================================
  // CARGAR DATOS
  // ============================================================
  useEffect(() => {
    loadAll();
  }, []);

  // ============================================================
  // REALTIME: suscripciones a cambios en Supabase
  // ============================================================
  useEffect(() => {
    if (!profile?.agent_id) return;

    // Canal 1: inventario (silencioso, solo refresca lista)
    const vehiclesChannel = supabase
      .channel('agent-vehicles-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        loadVehicles();
      })
      .subscribe();

    // Canal 2: mis ventas (con sonido y notificación cuando cambia mi status)
    const salesChannel = supabase
      .channel('agent-sales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, async (payload) => {
        // Recargar ventas siempre
        await loadSales();

        // Solo notificar si es MI venta (RLS ya filtra pero verificamos)
        // El evento UPDATE con cambio de status es lo que más nos interesa
        if (payload.eventType === 'UPDATE' && payload.new && payload.old) {
          const statusChanged = payload.old.status !== payload.new.status;
          if (statusChanged) {
            const newStatus = payload.new.status;
            if (newStatus === 'aprobada') {
              playSound('success');
              showNotif('success', `¡Tu plan de venta #${payload.new.sale_number} fue aprobado!`);
            } else if (newStatus === 'rechazada') {
              playSound('alert');
              showNotif('alert', `Tu plan de venta #${payload.new.sale_number} fue rechazado.`);
            }
          }
        }
      })
      .subscribe();

    // Cleanup al desmontar
    return () => {
      supabase.removeChannel(vehiclesChannel);
      supabase.removeChannel(salesChannel);
    };
  }, [profile?.agent_id]);

  // Reproducir sonido corto
  function playSound(type) {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      if (type === 'success') {
        osc.frequency.value = 880; // La alto
        gain.gain.value = 0.1;
        osc.start();
        setTimeout(() => { osc.frequency.value = 1320; }, 100);
        setTimeout(() => { osc.stop(); audioCtx.close(); }, 250);
      } else {
        osc.frequency.value = 440;
        gain.gain.value = 0.1;
        osc.start();
        setTimeout(() => { osc.frequency.value = 330; }, 120);
        setTimeout(() => { osc.stop(); audioCtx.close(); }, 300);
      }
    } catch (e) {
      console.log('No se pudo reproducir sonido:', e);
    }
  }

  // Mostrar toast que se cierra solo a los 6 segundos
  function showNotif(type, message) {
    setNotif({ type, message });
    setTimeout(() => setNotif(null), 6000);
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadVehicles(), loadSales(), loadAgents()]);
    setLoading(false);
  }

  async function loadVehicles() {
    const { data, error } = await supabase
      .from('vehicles_for_agents')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('Error loading vehicles:', error); return; }
    setVehicles(data || []);
  }

  async function loadSales() {
    // RLS filtra automáticamente: solo ventas del agente logueado
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error('Error loading sales:', error); return; }

    const salesList = data || [];
    const ids = salesList.map(s => s.id);

    if (ids.length > 0) {
      const { data: deps } = await supabase.from('sale_deposits').select('*').in('sale_id', ids).order('deposit_date');
      const { data: sAgents } = await supabase.from('sale_agents').select('*').in('sale_id', ids);

      const depMap = {};
      (deps || []).forEach(d => { (depMap[d.sale_id] = depMap[d.sale_id] || []).push(d); });
      const agMap = {};
      (sAgents || []).forEach(a => { (agMap[a.sale_id] = agMap[a.sale_id] || []).push(a); });

      setSales(salesList.map(s => ({
        ...s,
        deposits: depMap[s.id] || [],
        sale_agents: agMap[s.id] || [],
      })));
    } else {
      setSales([]);
    }
  }

  async function loadAgents() {
    const { data, error } = await supabase
      .from('agents_for_select')
      .select('*')
      .order('name');
    if (error) { console.error('Error loading agents:', error); return; }
    setAgentsList(data || []);
  }

  // ============================================================
  // CREAR / EDITAR VENTA
  // ============================================================
  function openNewSaleForm(vehicle = null) {
    const f = emptyForm();
    if (vehicle) {
      f.vehicle_id = vehicle.id;
      f.vehicle_plate = vehicle.plate || "";
      f.vehicle_brand = vehicle.brand || "";
      f.vehicle_model = vehicle.model || "";
      f.vehicle_year = vehicle.year || "";
      f.vehicle_color = vehicle.color || "";
      f.vehicle_km = vehicle.km || "";
      f.vehicle_engine = vehicle.engine || "";
      f.vehicle_drive = vehicle.drivetrain || "";
      f.vehicle_fuel = vehicle.fuel || "";
      f.vehicle_style = vehicle.style || "";
      f.vehicle_engine_cc = vehicle.engine_cc || "";
      // Si el vehiculo ya tiene CABYS, usarlo; si no, intentar sugerirlo
      f.vehicle_cabys = vehicle.cabys_code || suggestCabys(vehicle.style, vehicle.engine_cc, vehicle.fuel) || "";

      // Detectar moneda automaticamente segun el precio del vehiculo
      const vUsd = parseFloat(vehicle.price_usd) || 0;
      const vCrc = parseFloat(vehicle.price_crc) || 0;
      const vPrice = vUsd || vCrc;
      if (vehicle.price_currency === "CRC" || (!vehicle.price_currency && vPrice > 100000)) {
        f.sale_price = vPrice || "";
        f.sale_currency = "CRC";
        f.currency = "CRC";
      } else if (vehicle.price_currency === "USD") {
        f.sale_price = vUsd || "";
        f.sale_currency = "USD";
        f.currency = "USD";
      } else {
        f.sale_price = vPrice || "";
        f.sale_currency = "USD";
        f.currency = "USD";
      }
    }
    setEditingSaleId(null);
    setSaleForm(f);
    setTab("ventas");
    setView("form");
  }

  function openEditSaleForm(sale) {
    if (sale.status !== "pendiente" && sale.status !== "reservado") {
      alert("Solo podés editar ventas en estado pendiente o reservado.");
      return;
    }
    const f = emptyForm();
    // Copiar todos los campos de la venta al formulario
    Object.keys(f).forEach(k => {
      if (sale[k] !== undefined && sale[k] !== null) f[k] = sale[k];
    });
    // Guardar el status actual para logica condicional de botones
    f.current_status = sale.status;
    // Deposits
    if (sale.deposits && sale.deposits.length > 0) {
      f.deposits = sale.deposits.map(d => ({
        bank: d.bank || "",
        reference: d.reference || "",
        date: d.deposit_date || "",
        amount: d.amount || "",
      }));
    }
    // agent2: buscar un sale_agent diferente al propio usuario
    const otherAgent = (sale.sale_agents || []).find(sa => sa.agent_id !== profile.agent_id);
    f.agent2_id = otherAgent ? otherAgent.agent_id : "";

    setEditingSaleId(sale.id);
    setSaleForm(f);
    setView("form");
  }

  // Busca cliente por cedula: primero en ventas anteriores, despues en Alegra
  async function lookupClientByCedula(cedula) {
    if (!cedula || cedula.trim().length < 3) return false;
    const { data } = await supabase
      .from('sales')
      .select('client_id_type,client_name,client_phone1,client_phone2,client_email,client_address,client_workplace,client_occupation,client_civil_status,client_has_activity,client_activity_code')
      .eq('client_cedula', cedula.trim())
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      const c = data[0];
      setSaleForm(prev => ({
        ...prev,
        client_id_type: c.client_id_type || prev.client_id_type || "fisica",
        client_name: c.client_name || "",
        client_phone1: c.client_phone1 || "",
        client_phone2: c.client_phone2 || "",
        client_email: c.client_email || "",
        client_address: c.client_address || "",
        client_workplace: c.client_workplace || "",
        client_occupation: c.client_occupation || "",
        client_civil_status: c.client_civil_status || "",
        client_has_activity: c.client_has_activity || false,
        client_activity_code: c.client_activity_code || "",
      }));
      return true;
    }
    return false;
  }

  async function searchClient() {
    const cedula = (saleForm?.client_cedula || "").replace(/[\s-]/g, "").trim();
    if (!cedula) { alert("Escribí la cédula primero."); return; }
    setSearchingClient(true);
    try {
      const foundLocal = await lookupClientByCedula(cedula);
      if (foundLocal) { alert("✓ Cliente encontrado en ventas anteriores."); return; }
      const res = await fetch('/api/alegra-lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cedula })
      });
      const data = await res.json();
      if (!data.ok) { alert(`Error buscando en Alegra: ${data.error || 'desconocido'}`); return; }
      if (!data.found) { alert("Cliente no encontrado en Alegra. Llená los datos manualmente."); return; }
      const c = data.client;
      setSaleForm(prev => ({
        ...prev,
        client_id_type: c.client_id_type || prev.client_id_type || "fisica",
        client_name: c.name || "",
        client_phone1: c.phone1 || "",
        client_phone2: c.phone2 || "",
        client_email: c.email || "",
        client_address: c.address || "",
      }));
      alert("✓ Cliente importado de Alegra. Completá los campos restantes.");
    } catch (e) {
      alert(`Error de red: ${e.message}`);
    } finally {
      setSearchingClient(false);
    }
  }

  async function saveSale(targetStatus = "pendiente") {
    // Proteccion: si targetStatus no es string valido (ej: evento pasado por error), defaultear a pendiente
    if (typeof targetStatus !== "string" || !["pendiente", "reservado", "aprobada", "rechazada"].includes(targetStatus)) {
      targetStatus = "pendiente";
    }
    if (!saleForm.client_name || !saleForm.client_cedula) {
      alert("Nombre y cédula del cliente son obligatorios.");
      return;
    }
    if (!saleForm.vehicle_plate) {
      alert("Debés seleccionar un vehículo.");
      return;
    }
    if (!saleForm.sale_price || parseFloat(saleForm.sale_price) <= 0) {
      alert("Precio de venta obligatorio.");
      return;
    }
    if (!saleForm.sale_exchange_rate || parseFloat(saleForm.sale_exchange_rate) <= 0) {
      alert("El tipo de cambio es obligatorio. Sirve como referencia para ver los montos en la otra moneda.");
      return;
    }

    const breakdown = computeBreakdown(saleForm);
    const { salePrice, transferExtra, tradein, down, depsTotal, balance } = breakdown;

    // Validaciones diferentes segun target status
    if (targetStatus === "reservado") {
      // Reserva: solo requiere lo basico, no depositos ni saldo
    } else {
      // Pendiente (envio a aprobacion): validar depositos y saldo
      const validDeposits = (saleForm.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0);
      if (validDeposits.length === 0) {
        alert("Para enviar a aprobación debés agregar al menos un depósito con monto.\n\nSi aún no hay depósitos, usá 'Guardar como Reserva'.");
        return;
      }
      for (const d of validDeposits) {
        if (!d.bank || !d.reference) { alert("Cada depósito debe tener banco y número de referencia."); return; }
      }

      const isCash = (saleForm.payment_method || "contado") === "contado";
      const tolerance = 0.01;
      if (isCash && Math.abs(balance) > tolerance) {
        alert(`El saldo debe ser 0 para ventas de contado.\n\nSaldo actual: ${balance.toFixed(2)}`);
        return;
      }
      if (!isCash && balance < -tolerance) {
        alert(`El saldo no puede ser negativo. Saldo actual: ${balance.toFixed(2)}`);
        return;
      }
    }

    const row = {
      sale_date: saleForm.sale_date,
      status: targetStatus,
      currency: saleForm.sale_currency || saleForm.currency || "USD",
      sale_currency: saleForm.sale_currency || saleForm.currency || "USD",
      client_id_type: saleForm.client_id_type || "fisica",
      client_name: saleForm.client_name,
      client_cedula: saleForm.client_cedula,
      client_phone1: saleForm.client_phone1 || null,
      client_phone2: saleForm.client_phone2 || null,
      client_email: saleForm.client_email || null,
      client_address: saleForm.client_address || null,
      client_workplace: saleForm.client_workplace || null,
      client_occupation: saleForm.client_occupation || null,
      client_civil_status: saleForm.client_civil_status || null,
      client_has_activity: !!saleForm.client_has_activity,
      client_activity_code: saleForm.client_has_activity ? (saleForm.client_activity_code || null) : null,
      vehicle_id: saleForm.vehicle_id || null,
      vehicle_plate: saleForm.vehicle_plate,
      vehicle_brand: saleForm.vehicle_brand || null,
      vehicle_model: saleForm.vehicle_model || null,
      vehicle_year: parseInt(saleForm.vehicle_year) || null,
      vehicle_color: saleForm.vehicle_color || null,
      vehicle_km: parseFloat(saleForm.vehicle_km) || null,
      vehicle_engine: saleForm.vehicle_engine || null,
      vehicle_drive: saleForm.vehicle_drive || null,
      vehicle_fuel: saleForm.vehicle_fuel || null,
      vehicle_cabys: saleForm.vehicle_cabys || null,
      vehicle_style: saleForm.vehicle_style || null,
      vehicle_engine_cc: parseInt(saleForm.vehicle_engine_cc) || null,
      has_tradein: !!saleForm.has_tradein,
      tradein_plate: saleForm.tradein_plate || null,
      tradein_brand: saleForm.tradein_brand || null,
      tradein_model: saleForm.tradein_model || null,
      tradein_year: parseInt(saleForm.tradein_year) || null,
      tradein_color: saleForm.tradein_color || null,
      tradein_km: parseFloat(saleForm.tradein_km) || null,
      tradein_engine: saleForm.tradein_engine || null,
      tradein_drive: saleForm.tradein_drive || null,
      tradein_fuel: saleForm.tradein_fuel || null,
      tradein_value: parseFloat(saleForm.tradein_value) || null,
      sale_type: saleForm.sale_type || "propio",
      sale_price: salePrice,
      sale_exchange_rate: parseFloat(saleForm.sale_exchange_rate) || null,
      tradein_amount: tradein || null,
      down_payment: down || null,
      deposit_signal: parseFloat(saleForm.deposit_signal) || 0,
      total_balance: balance,
      deposits_total: depsTotal,
      payment_method: saleForm.payment_method || null,
      financing_term_months: parseInt(saleForm.financing_term_months) || null,
      financing_interest_pct: parseFloat(saleForm.financing_interest_pct) || null,
      financing_amount: parseFloat(saleForm.financing_amount) || null,
      transfer_included: !!saleForm.transfer_included,
      transfer_in_price: !!saleForm.transfer_in_price,
      transfer_in_financing: !!saleForm.transfer_in_financing,
      transfer_amount: parseFloat(saleForm.transfer_amount) || 0,
      has_insurance: !!saleForm.has_insurance,
      insurance_months: parseInt(saleForm.insurance_months) || null,
      iva_exceptional: !!saleForm.iva_exceptional,
      iva_rate: saleForm.iva_exceptional ? (parseFloat(saleForm.iva_rate) || 0) : 0,
      observations: saleForm.observations || null,
      client_signature: saleForm.client_signature || null,
      signed_at: saleForm.signed_at || null,
    };

    let saleId = editingSaleId;

    if (editingSaleId) {
      const { error } = await supabase.from('sales').update(row).eq('id', editingSaleId);
      if (error) { alert("Error al actualizar: " + error.message); return; }
      await supabase.from('sale_deposits').delete().eq('sale_id', editingSaleId);
      await supabase.from('sale_agents').delete().eq('sale_id', editingSaleId);
    } else {
      const { data, error } = await supabase.from('sales').insert(row).select().single();
      if (error) { alert("Error al crear: " + error.message); return; }
      saleId = data.id;
    }

    const depRows = (saleForm.deposits || [])
      .filter(d => d.amount && parseFloat(d.amount) > 0)
      .map(d => ({ sale_id: saleId, bank: d.bank || null, reference: d.reference || null, deposit_date: d.date || null, amount: parseFloat(d.amount) || 0 }));
    if (depRows.length > 0) {
      const { error } = await supabase.from('sale_deposits').insert(depRows);
      if (error) { alert("Error guardando depósitos: " + error.message); return; }
    }

    const agentRows = [];
    const saleTC = parseFloat(saleForm.sale_exchange_rate) || 0;
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== profile.agent_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * splitPct;
    const splitCrc = Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100;

    const myAgent = agentsList.find(a => a.id === profile.agent_id);
    agentRows.push({
      sale_id: saleId, agent_id: profile.agent_id,
      agent_name: myAgent?.name || profile.full_name || "",
      commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc,
    });

    if (hasAgent2) {
      const ag2 = agentsList.find(a => a.id === saleForm.agent2_id);
      agentRows.push({ sale_id: saleId, agent_id: saleForm.agent2_id, agent_name: ag2?.name || "",
        commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc });
    }

    const { error: agErr } = await supabase.from('sale_agents').insert(agentRows);
    if (agErr) { alert("Error guardando agentes: " + agErr.message); return; }

    // Si se guardo como reserva, generar PDF
    if (targetStatus === "reservado" && !editingSaleId) {
      try {
        const res = await fetch('/api/approve-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: saleId, mode: 'reserve' })
        });
        const pdfData = await res.json();
        if (pdfData.ok && pdfData.pdf_url) {
          alert(`📝 Reserva guardada.\n\nPDF subido a Drive: ${pdfData.file_name}`);
        } else {
          alert(`📝 Reserva guardada pero el PDF tuvo un problema: ${pdfData.error || 'desconocido'}`);
        }
      } catch (e) {
        alert(`📝 Reserva guardada pero falló subir el PDF: ${e.message}`);
      }
    }

    // Si es una reserva que se esta completando (editingSaleId + targetStatus "pendiente" desde reservado)
    if (editingSaleId && saleForm.current_status === "reservado") {
      try {
        await fetch('/api/approve-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: editingSaleId, mode: 'update_reserve' })
        });
      } catch (e) { console.error('Error actualizando PDF:', e.message); }
    }

    await loadSales();
    setView("list");
    setSaleForm(null);
    setEditingSaleId(null);
  }

  async function deleteSale(id) {
    if (!confirm("¿Seguro que querés borrar esta venta? Esta acción no se puede deshacer.")) return;
    // Borrar hijos primero
    await supabase.from('sale_deposits').delete().eq('sale_id', id);
    await supabase.from('sale_agents').delete().eq('sale_id', id);
    const { error } = await supabase.from('sales').delete().eq('id', id);
    if (error) { alert("Error al borrar: " + error.message); return; }
    await loadSales();
    setPickedSale(null);
    setView("list");
  }

  // ============================================================
  // FILTROS Y COMPUTADOS
  // ============================================================
  const filteredVehicles = useMemo(() => {
    if (vehicleFilter === "all") return vehicles;
    return vehicles.filter(v => v.status === vehicleFilter);
  }, [vehicles, vehicleFilter]);

  const filteredSales = useMemo(() => {
    if (saleStatusFilter === "all") return sales;
    return sales.filter(s => s.status === saleStatusFilter);
  }, [sales, saleStatusFilter]);

  // ============================================================
  // RENDER
  // ============================================================
  if (loading) {
    return (
      <div style={{ ...S.body, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "#71717a" }}>Cargando...</div>
      </div>
    );
  }

  return (
    <div style={S.body}>
      {/* HEADER */}
      <div style={S.header}>
        <div style={S.headerTitle}>VCR Manager - Panel Vendedor</div>
        <div style={S.headerRight}>
          <span style={S.headerUser}>{profile.full_name || profile.email}</span>
          <button onClick={signOut} style={{ ...S.btnGhost, color: "#fff", borderColor: "#3f3f46" }}>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* TOAST DE NOTIFICACIÓN */}
      {notif && (
        <div style={{
          position: "fixed",
          top: "1rem",
          right: "1rem",
          zIndex: 9999,
          padding: "1rem 1.5rem",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontWeight: 600,
          color: "#fff",
          background: notif.type === "success" ? "#10b981" : "#e11d48",
          maxWidth: 400,
          cursor: "pointer",
          animation: "slideIn 0.3s ease-out",
        }} onClick={() => setNotif(null)}>
          {notif.message}
          <div style={{ fontSize: "0.75rem", fontWeight: 400, marginTop: "0.25rem", opacity: 0.85 }}>
            Click para cerrar
          </div>
        </div>
      )}

      {/* TABS */}
      <div style={S.tabBar}>
        <button onClick={() => { setTab("inventario"); setView("list"); }} style={S.tab(tab === "inventario")}>
          Inventario ({vehicles.length})
        </button>
        <button onClick={() => { setTab("ventas"); setView("list"); }} style={S.tab(tab === "ventas")}>
          Mis planes de venta ({sales.length})
        </button>
      </div>

      {/* CONTENIDO */}
      <div style={S.content}>
        {tab === "inventario" && <InventarioView
          vehicles={filteredVehicles}
          filter={vehicleFilter}
          setFilter={setVehicleFilter}
          onSellVehicle={openNewSaleForm}
        />}

        {tab === "ventas" && view === "list" && <VentasListView
          sales={filteredSales}
          filter={saleStatusFilter}
          setFilter={setSaleStatusFilter}
          onNew={() => openNewSaleForm()}
          onPick={(s) => { setPickedSale(s); setView("detail"); }}
        />}

        {tab === "ventas" && view === "form" && <VentaFormView
          form={saleForm}
          setForm={setSaleForm}
          vehicles={vehicles.filter(v => v.status === "disponible" || (editingSaleId && v.plate === saleForm?.vehicle_plate))}
          agents={agentsList.filter(a => a.id !== profile.agent_id)}
          editingId={editingSaleId}
          onSave={saveSale}
          onSearchClient={searchClient}
          searching={searchingClient}
          showSignatureModal={showSignatureModal}
          setShowSignatureModal={setShowSignatureModal}
          onCancel={() => { setView("list"); setSaleForm(null); setEditingSaleId(null); }}
        />}

        {tab === "ventas" && view === "detail" && pickedSale && <VentaDetailView
          sale={pickedSale}
          onBack={() => { setPickedSale(null); setView("list"); }}
          onEdit={() => openEditSaleForm(pickedSale)}
          onDelete={() => deleteSale(pickedSale.id)}
        />}
      </div>
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: INVENTARIO
// ============================================================
function InventarioView({ vehicles, filter, setFilter, onSellVehicle }) {
  const statusColor = (st) => {
    if (st === "disponible") return "#10b981";
    if (st === "reservado") return "#f59e0b";
    if (st === "vendido") return "#71717a";
    return "#a1a1aa";
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={S.cardTitle}>Inventario</div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {[["disponible", "Disponibles"], ["reservado", "Reservados"], ["vendido", "Vendidos"], ["all", "Todos"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} style={filter === v ? S.btn : S.btnGhost}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {vehicles.length === 0 ? (
        <div style={S.empty}>No hay vehículos en esta categoría.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Placa</th>
              <th style={S.th}>Vehículo</th>
              <th style={S.th}>Año</th>
              <th style={S.th}>Color</th>
              <th style={S.th}>Km</th>
              <th style={S.th}>Combustible</th>
              <th style={S.th}>Precio</th>
              <th style={S.th}>Estado</th>
              <th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map(v => {
              const isAvailable = v.status === "disponible";
              const rowBg = isAvailable ? "#fff" : "#fafafa";
              return (
                <tr key={v.id} style={{ background: rowBg }}>
                  <td style={S.td}><strong>{v.plate || "-"}</strong></td>
                  <td style={S.td}>{v.brand} {v.model}</td>
                  <td style={S.td}>{v.year || "-"}</td>
                  <td style={S.td}>{v.color || "-"}</td>
                  <td style={S.td}>{v.km ? v.km.toLocaleString() : "-"}</td>
                  <td style={S.td}>{v.fuel || "-"}</td>
                  <td style={S.td}>
                    {(() => {
                      // Deteccion robusta de moneda:
                      // - Si price_currency esta explicitamente seteado, respetarlo
                      // - Si no, usar regla: valor > 100,000 = colones (sin excepcion)
                      const usdVal = parseFloat(v.price_usd) || 0;
                      const crcVal = parseFloat(v.price_crc) || 0;
                      const explicitCur = v.price_currency;

                      if (explicitCur === "USD" && usdVal > 0) return fmt(usdVal, "USD");
                      if (explicitCur === "CRC" && crcVal > 0) return fmt(crcVal, "CRC");

                      // Sin moneda explicita: el valor mas alto gana, pero con regla de monto
                      const val = usdVal || crcVal;
                      if (val === 0) return "-";
                      // Cualquier precio > 100,000 es colones (ningun carro usado cuesta $100K USD)
                      if (val > 100000) return fmt(val, "CRC");
                      return fmt(val, "USD");
                    })()}
                  </td>
                  <td style={S.td}>
                    <span style={S.badge(statusColor(v.status))}>{v.status || "-"}</span>
                  </td>
                  <td style={S.td}>
                    {isAvailable ? (
                      <button onClick={() => onSellVehicle(v)} style={S.btn}>Vender</button>
                    ) : (
                      <span style={{ color: "#a1a1aa", fontSize: "0.8rem", fontStyle: "italic" }}>No disponible</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: LISTA DE VENTAS
// ============================================================
function VentasListView({ sales, filter, setFilter, onNew, onPick }) {
  const statusColor = (st) => {
    if (st === "aprobada") return "#10b981";
    if (st === "rechazada") return "#e11d48";
    return "#f59e0b"; // pendiente
  };
  const statusLabel = (st) => {
    if (st === "aprobada") return "Aprobada";
    if (st === "rechazada") return "Rechazada";
    return "Pendiente";
  };

  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={S.cardTitle}>Mis planes de venta</div>
        <button onClick={onNew} style={S.btn}>+ Nuevo plan de venta</button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {[["all", "Todas"], ["reservado", "Reservadas"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"]].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={filter === v ? S.btn : S.btnGhost}>
            {l} ({sales.filter(s => v === "all" || s.status === v).length})
          </button>
        ))}
      </div>

      {sales.length === 0 ? (
        <div style={S.empty}>No tenés planes de venta todavía. Creá el primero desde el botón de arriba o desde el inventario.</div>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>Fecha</th>
              <th style={S.th}>Cliente</th>
              <th style={S.th}>Vehículo</th>
              <th style={S.th}>Precio</th>
              <th style={S.th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => (
              <tr key={s.id} onClick={() => onPick(s)} style={{ cursor: "pointer" }}>
                <td style={S.td}>{s.sale_number || "-"}</td>
                <td style={S.td}>{s.sale_date || "-"}</td>
                <td style={S.td}>{s.client_name}</td>
                <td style={S.td}>{s.vehicle_brand} {s.vehicle_model} {s.vehicle_year}</td>
                <td style={S.td}>{fmt(s.sale_price, s.sale_currency || s.currency || "USD")}</td>
                <td style={S.td}>
                  <span style={S.badge(statusColor(s.status))}>{statusLabel(s.status)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: FORMULARIO DE VENTA
// ============================================================
function VentaFormView({ form, setForm, vehicles, agents, editingId, onSave, onCancel, onSearchClient, searching, showSignatureModal, setShowSignatureModal }) {
  if (!form) return null;

  const upd = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updDeposit = (idx, k, v) => {
    setForm(prev => {
      const deps = [...(prev.deposits || [])];
      deps[idx] = { ...deps[idx], [k]: v };
      return { ...prev, deposits: deps };
    });
  };
  const addDeposit = () => setForm(prev => ({ ...prev, deposits: [...(prev.deposits || []), { bank: "", reference: "", date: "", amount: "" }] }));
  const removeDeposit = (idx) => setForm(prev => ({ ...prev, deposits: (prev.deposits || []).filter((_, i) => i !== idx) }));

  const onPickVehicle = (id) => {
    const v = vehicles.find(x => x.id === id);
    if (!v) return;
    setForm(prev => {
      // Detectar moneda automaticamente segun el precio del vehiculo
      const vUsd = parseFloat(v.price_usd) || 0;
      const vCrc = parseFloat(v.price_crc) || 0;
      const vPrice = vUsd || vCrc;
      let newCurrency = prev.sale_currency || "USD";
      let newPrice = prev.sale_price;
      if (!prev.sale_price) {
        // Solo auto-setear si el usuario no habia escrito nada
        if (v.price_currency === "CRC" || (!v.price_currency && vPrice > 100000)) {
          newCurrency = "CRC";
          newPrice = vPrice || "";
        } else if (v.price_currency === "USD") {
          newCurrency = "USD";
          newPrice = vUsd || "";
        } else {
          newCurrency = "USD";
          newPrice = vPrice || "";
        }
      }
      return {
        ...prev,
        vehicle_id: v.id,
        vehicle_plate: v.plate || "",
        vehicle_brand: v.brand || "",
        vehicle_model: v.model || "",
        vehicle_year: v.year || "",
        vehicle_color: v.color || "",
        vehicle_km: v.km || "",
        vehicle_engine: v.engine || "",
        vehicle_drive: v.drivetrain || "",
        vehicle_fuel: v.fuel || "",
        vehicle_cabys: v.cabys_code || "",
        sale_price: newPrice,
        sale_currency: newCurrency,
        currency: newCurrency,
      };
    });
  };

  const salePrice = parseFloat(form.sale_price) || 0;
  const saleTC = parseFloat(form.sale_exchange_rate) || 0;
  const hasAgent2 = form.agent2_id && form.agent2_id !== "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{editingId ? "Editar plan de venta" : "Nuevo plan de venta"}</h2>
        <button onClick={onCancel} style={S.btnGhost}>Cancelar</button>
      </div>

      {/* CLIENTE */}
      <div style={S.card}>
        <div style={S.cardTitle}>Datos del cliente</div>
        <div style={S.grid2}>
          <div>
            <label style={S.label}>Tipo de identificación *</label>
            <select style={S.sel} value={form.client_id_type || "fisica"} onChange={e => upd("client_id_type", e.target.value)}>
              <option value="fisica">Cédula Física</option>
              <option value="juridica">Cédula Jurídica</option>
              <option value="dimex">DIMEX</option>
              <option value="extranjero">Extranjero/Pasaporte</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Número de identificación *</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...S.input, flex: 1 }}
                value={form.client_cedula}
                onChange={e => {
                  const clean = e.target.value.replace(/[\s-]/g, "").toUpperCase();
                  upd("client_cedula", clean);
                }}
                placeholder="Sin espacios ni guiones"
              />
              <button
                type="button"
                onClick={onSearchClient}
                disabled={searching}
                title="Buscar en Alegra"
                style={{ ...S.btn, background: searching ? "#9ca3af" : "#4f8cff", whiteSpace: "nowrap", padding: "0.55rem 0.9rem" }}
              >
                {searching ? "⏳" : "🔍 Buscar"}
              </button>
            </div>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={S.label}>Nombre completo *</label>
            <input
              style={S.input}
              value={form.client_name}
              onChange={e => upd("client_name", e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label style={S.label}>Teléfono 1</label>
            <input
              style={S.input}
              value={form.client_phone1}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, "");
                if (digits.length === 8 && !e.target.value.includes("-")) {
                  upd("client_phone1", `${digits.slice(0,4)}-${digits.slice(4)}`);
                } else {
                  upd("client_phone1", e.target.value);
                }
              }}
            />
          </div>
          <div>
            <label style={S.label}>Teléfono 2</label>
            <input
              style={S.input}
              value={form.client_phone2}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, "");
                if (digits.length === 8 && !e.target.value.includes("-")) {
                  upd("client_phone2", `${digits.slice(0,4)}-${digits.slice(4)}`);
                } else {
                  upd("client_phone2", e.target.value);
                }
              }}
            />
          </div>
          <div>
            <label style={S.label}>Email</label>
            <input
              style={S.input}
              value={form.client_email}
              onChange={e => upd("client_email", e.target.value.toLowerCase())}
            />
          </div>
          <div>
            <label style={S.label}>Estado civil</label>
            <select style={S.sel} value={form.client_civil_status} onChange={e => upd("client_civil_status", e.target.value)}>
              <option value="">-</option>
              <option value="soltero">Soltero(a)</option>
              <option value="casado">Casado(a)</option>
              <option value="divorciado">Divorciado(a)</option>
              <option value="viudo">Viudo(a)</option>
              <option value="union_libre">Unión libre</option>
            </select>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label style={S.label}>Dirección exacta</label>
            <input style={S.input} value={form.client_address} onChange={e => upd("client_address", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Lugar de trabajo</label>
            <input style={S.input} value={form.client_workplace} onChange={e => upd("client_workplace", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Oficio / Profesión</label>
            <input style={S.input} value={form.client_occupation} onChange={e => upd("client_occupation", e.target.value)} />
          </div>
          {/* Actividad economica */}
          <div style={{ gridColumn: "span 2", padding: "10px 12px", background: "#fafafa", borderRadius: 8, border: "1px solid #e4e4e7", marginTop: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={!!form.client_has_activity}
                onChange={e => {
                  upd("client_has_activity", e.target.checked);
                  if (!e.target.checked) upd("client_activity_code", "");
                }}
              />
              ¿El cliente tiene actividad económica inscrita en Hacienda?
            </label>
            {form.client_has_activity && (
              <div style={{ marginTop: 10 }}>
                <label style={S.label}>Número de actividad económica (formato Hacienda, ej: 4510.0) *</label>
                <input
                  style={S.input}
                  value={form.client_activity_code || ""}
                  onChange={e => upd("client_activity_code", e.target.value)}
                  placeholder="Ej: 4510.0"
                />
                <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>
                  Si tiene actividad → se emite Factura. Si no → se emite Tiquete.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* VEHICULO */}
      <div style={S.card}>
        <div style={S.cardTitle}>Vehículo a vender</div>
        <div>
          <label style={S.label}>Seleccionar vehículo *</label>
          <select style={S.sel} value={form.vehicle_id} onChange={e => onPickVehicle(e.target.value)}>
            <option value="">-- Elegir vehículo --</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>
                {v.plate} - {v.brand} {v.model} {v.year} ({v.color})
              </option>
            ))}
          </select>
        </div>
        {form.vehicle_plate && (
          <>
            <div style={{ ...S.grid4, marginTop: "1rem" }}>
              <div><label style={S.label}>Placa</label><input style={S.input} value={form.vehicle_plate} readOnly /></div>
              <div><label style={S.label}>Marca</label><input style={S.input} value={form.vehicle_brand} readOnly /></div>
              <div><label style={S.label}>Modelo</label><input style={S.input} value={form.vehicle_model} readOnly /></div>
              <div><label style={S.label}>Año</label><input style={S.input} value={form.vehicle_year} readOnly /></div>
            </div>
            <div style={{ ...S.grid3, marginTop: "0.75rem" }}>
              <div>
                <label style={S.label}>Estilo</label>
                <select
                  style={S.sel}
                  value={form.vehicle_style || ""}
                  onChange={e => {
                    upd("vehicle_style", e.target.value);
                    const sug = suggestCabys(e.target.value, form.vehicle_engine_cc, form.vehicle_fuel);
                    if (sug && !form.vehicle_cabys) upd("vehicle_cabys", sug);
                  }}
                >
                  <option value="">Seleccionar</option>
                  {["SUV","SEDAN","HATCHBACK","TODOTERRENO","PICK UP","MICROBUS"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={S.label}>Cilindrada (CC)</label>
                <input
                  style={S.input}
                  type="number"
                  value={form.vehicle_engine_cc || ""}
                  onChange={e => {
                    upd("vehicle_engine_cc", e.target.value);
                    const sug = suggestCabys(form.vehicle_style, e.target.value, form.vehicle_fuel);
                    if (sug && !form.vehicle_cabys) upd("vehicle_cabys", sug);
                  }}
                />
              </div>
              <div style={{ gridColumn: "span 1" }}>
                <label style={S.label}>Código CABYS</label>
                <select
                  style={S.sel}
                  value={form.vehicle_cabys || ""}
                  onChange={e => upd("vehicle_cabys", e.target.value)}
                >
                  <option value="">Seleccionar</option>
                  {CABYS_VEHICLES.map(c => <option key={c.code} value={c.code}>{c.code} - {c.label}</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      {/* TRADE-IN */}
      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <input type="checkbox" checked={!!form.has_tradein} onChange={e => upd("has_tradein", e.target.checked)} />
          <span style={S.cardTitle}>Incluye trade-in</span>
        </div>
        {form.has_tradein && (
          <div style={S.grid3}>
            <div><label style={S.label}>Placa</label><input style={S.input} value={form.tradein_plate} onChange={e => upd("tradein_plate", e.target.value)} /></div>
            <div><label style={S.label}>Marca</label><input style={S.input} value={form.tradein_brand} onChange={e => upd("tradein_brand", e.target.value)} /></div>
            <div><label style={S.label}>Modelo</label><input style={S.input} value={form.tradein_model} onChange={e => upd("tradein_model", e.target.value)} /></div>
            <div><label style={S.label}>Año</label><input style={S.input} type="number" value={form.tradein_year} onChange={e => upd("tradein_year", e.target.value)} /></div>
            <div><label style={S.label}>Color</label><input style={S.input} value={form.tradein_color} onChange={e => upd("tradein_color", e.target.value)} /></div>
            <div><label style={S.label}>Km</label><input style={S.input} type="number" value={form.tradein_km} onChange={e => upd("tradein_km", e.target.value)} /></div>
            <div><label style={S.label}>Motor</label><input style={S.input} value={form.tradein_engine} onChange={e => upd("tradein_engine", e.target.value)} /></div>
            <div><label style={S.label}>Tracción</label><input style={S.input} value={form.tradein_drive} onChange={e => upd("tradein_drive", e.target.value)} /></div>
            <div><label style={S.label}>Combustible</label><input style={S.input} value={form.tradein_fuel} onChange={e => upd("tradein_fuel", e.target.value)} /></div>
            <div><label style={S.label}>Valor acordado ({form.sale_currency || "USD"})</label><input style={S.input} type="number" value={form.tradein_value} onChange={e => upd("tradein_value", e.target.value)} /></div>
          </div>
        )}
      </div>

      {/* PRECIOS */}
      <div style={S.card}>
        <div style={S.cardTitle}>Precios y condiciones</div>

        {/* Dropdown de moneda global */}
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#eff6ff", borderRadius: 6, border: "1px solid #bfdbfe" }}>
          <label style={{ ...S.label, marginBottom: "0.5rem", color: "#1e40af" }}>
            Moneda de la venta *
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <select
              style={{ ...S.sel, maxWidth: 200 }}
              value={form.sale_currency || "USD"}
              onChange={e => {
                const newCur = e.target.value;
                const oldCur = form.sale_currency || "USD";
                if (newCur !== oldCur && (form.sale_price || form.tradein_value || form.down_payment)) {
                  if (!window.confirm("Al cambiar la moneda se van a limpiar los montos ingresados. ¿Continuar?")) return;
                  setForm(prev => ({
                    ...prev,
                    sale_currency: newCur,
                    currency: newCur,
                    sale_price: "", tradein_value: "", tradein_amount: "",
                    down_payment: "", financing_amount: "", transfer_amount: "",
                    deposits: (prev.deposits || []).map(d => ({ ...d, amount: "" })),
                  }));
                } else {
                  upd("sale_currency", newCur);
                  upd("currency", newCur);
                }
              }}
            >
              <option value="USD">USD (dólares)</option>
              <option value="CRC">CRC (colones)</option>
            </select>
            <span style={{ fontSize: "0.85rem", color: "#52525b" }}>
              Todos los montos de esta venta se expresan en {form.sale_currency === "CRC" ? "colones" : "dólares"}.
            </span>
          </div>
        </div>

        <div style={S.grid3}>
          <div>
            <label style={S.label}>Tipo de venta</label>
            <select style={S.sel} value={form.sale_type} onChange={e => upd("sale_type", e.target.value)}>
              <option value="propio">Propio</option>
              <option value="consignacion_grupo">Consignación Grupo (1%)</option>
              <option value="consignacion_externa">Consignación Externa (5%)</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Precio de venta ({form.sale_currency || "USD"}) *</label>
            <input style={S.input} type="number" value={form.sale_price} onChange={e => upd("sale_price", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Tipo de cambio *</label>
            <input style={S.input} type="number" step="0.01" value={form.sale_exchange_rate} onChange={e => upd("sale_exchange_rate", e.target.value)} placeholder="ej: 510.50" />
            <div style={{ fontSize: "0.75rem", color: "#71717a", marginTop: "0.25rem" }}>
              Siempre requerido. Se guarda como referencia para ver los montos en la otra moneda después.
            </div>
          </div>
          <div>
            <label style={S.label}>Trade-in ({form.sale_currency || "USD"})</label>
            <input style={S.input} type="number" value={form.tradein_amount} onChange={e => upd("tradein_amount", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Prima / Down payment ({form.sale_currency || "USD"})</label>
            <input style={S.input} type="number" value={form.down_payment} onChange={e => upd("down_payment", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Método de pago</label>
            <select style={S.sel} value={form.payment_method} onChange={e => upd("payment_method", e.target.value)}>
              <option value="contado">Contado</option>
              <option value="financiamiento">Financiamiento</option>
              <option value="mixto">Mixto</option>
            </select>
          </div>
        </div>

        {(form.payment_method === "financiamiento" || form.payment_method === "mixto") && (
          <div style={{ ...S.grid3, marginTop: "1rem" }}>
            <div><label style={S.label}>Plazo (meses)</label><input style={S.input} type="number" value={form.financing_term_months} onChange={e => upd("financing_term_months", e.target.value)} /></div>
            <div><label style={S.label}>Interés %</label><input style={S.input} type="number" step="0.01" value={form.financing_interest_pct} onChange={e => upd("financing_interest_pct", e.target.value)} /></div>
            <div><label style={S.label}>Monto financiado ({form.sale_currency || "USD"})</label><input style={S.input} type="number" value={form.financing_amount} onChange={e => upd("financing_amount", e.target.value)} /></div>
          </div>
        )}
      </div>

      {/* DEPOSITOS */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={S.cardTitle}>Depósitos</div>
          <button onClick={addDeposit} style={S.btnGhost}>+ Agregar depósito</button>
        </div>
        {(form.deposits || []).map((d, idx) => (
          <div key={idx} style={{ ...S.grid4, marginBottom: "0.5rem", alignItems: "end" }}>
            <div>
              <label style={S.label}>Cuenta / Método</label>
              <select
                style={S.sel}
                value={d.bank || ""}
                onChange={e => updDeposit(idx, "bank", e.target.value)}
              >
                <option value="">Seleccionar</option>
                <option value="Banco BAC Dólares">Banco BAC Dólares</option>
                <option value="Banco Nacional Dólares">Banco Nacional Dólares</option>
                <option value="Banco de Costa Rica Dólares">Banco de Costa Rica Dólares</option>
                <option value="Banco BAC Colones">Banco BAC Colones</option>
                <option value="Banco Nacional de Costa Rica Colones">Banco Nacional de Costa Rica Colones</option>
                <option value="Banco de Costa Rica Colones">Banco de Costa Rica Colones</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Tarjeta">Tarjeta</option>
              </select>
            </div>
            <div><label style={S.label}>Referencia</label><input style={S.input} value={d.reference} onChange={e => updDeposit(idx, "reference", e.target.value)} /></div>
            <div><label style={S.label}>Fecha</label><input style={S.input} type="date" value={d.date} onChange={e => updDeposit(idx, "date", e.target.value)} /></div>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Monto ({form.sale_currency || "USD"})</label>
                <input style={S.input} type="number" value={d.amount} onChange={e => updDeposit(idx, "amount", e.target.value)} />
              </div>
              {(form.deposits || []).length > 1 && (
                <button onClick={() => removeDeposit(idx)} style={{ ...S.btnDanger, alignSelf: "end" }}>×</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* EXTRAS */}
      <div style={S.card}>
        <div style={S.cardTitle}>Extras</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={!!form.transfer_included} onChange={e => upd("transfer_included", e.target.checked)} />
            Traspaso por aparte
          </label>
          {form.transfer_included && (
            <div style={{ marginLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" checked={!!form.transfer_in_price} onChange={e => upd("transfer_in_price", e.target.checked)} />
                Traspaso incluido
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" checked={!!form.transfer_in_financing} onChange={e => upd("transfer_in_financing", e.target.checked)} />
                En financiamiento
              </label>
              {!form.transfer_in_price && !form.transfer_in_financing && (
                <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6 }}>
                  <label style={S.label}>Monto del traspaso ({form.sale_currency || "USD"}) *</label>
                  <input
                    style={S.input}
                    type="number"
                    value={form.transfer_amount}
                    onChange={e => upd("transfer_amount", e.target.value)}
                    placeholder="0.00"
                  />
                  <div style={{ fontSize: "0.75rem", color: "#92400e", marginTop: "0.25rem" }}>
                    Como el traspaso es aparte, suma al total a cobrar.
                  </div>
                </div>
              )}
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input type="checkbox" checked={!!form.has_insurance} onChange={e => upd("has_insurance", e.target.checked)} />
            Incluye seguro
          </label>
          {form.has_insurance && (
            <div style={{ marginLeft: "1.5rem", maxWidth: 200 }}>
              <label style={S.label}>Meses de seguro</label>
              <input style={S.input} type="number" value={form.insurance_months} onChange={e => upd("insurance_months", e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {/* DESGLOSE EN VIVO */}
      <BreakdownCard form={form} />

      {/* AGENTES */}
      <div style={S.card}>
        <div style={S.cardTitle}>Vendedores</div>
        <div style={{ marginBottom: "0.75rem", color: "#71717a", fontSize: "0.9rem" }}>
          Vos ya estás asociado como vendedor principal. Si otro vendedor te ayudó, podés agregarlo acá.
        </div>
        <div>
          <label style={S.label}>Segundo vendedor (opcional)</label>
          <select style={S.sel} value={form.agent2_id} onChange={e => upd("agent2_id", e.target.value)}>
            <option value="">-- Ninguno --</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      {/* OBSERVACIONES */}
      <div style={S.card}>
        <div style={S.cardTitle}>Observaciones</div>
        <textarea
          style={{ ...S.input, minHeight: 80, resize: "vertical" }}
          value={form.observations}
          onChange={e => upd("observations", e.target.value)}
          placeholder="Cualquier detalle adicional del plan de venta..."
        />
      </div>

      {/* IVA EXCEPCIONAL */}
      <div style={S.card}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: 14, fontWeight: 500, cursor: "pointer", marginBottom: form.iva_exceptional ? 10 : 0 }}>
          <input
            type="checkbox"
            checked={!!form.iva_exceptional}
            onChange={e => {
              upd("iva_exceptional", e.target.checked);
              if (!e.target.checked) upd("iva_rate", 0);
            }}
          />
          Caso de IVA excepcional
        </label>
        {form.iva_exceptional && (
          <div>
            <label style={S.label}>% IVA a aplicar en la factura</label>
            <input
              type="number" step="0.01"
              style={{ ...S.input, width: 120 }}
              value={form.iva_rate || ""}
              onChange={e => upd("iva_rate", e.target.value)}
              placeholder="Ej: 13"
            />
            <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>
              Por defecto IVA exento (0%). Activá esto solo para casos especiales (carros nuevos sin inscribir, eléctricos, etc.).
            </div>
          </div>
        )}
      </div>

      {/* FIRMA DEL CLIENTE */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={S.cardTitle}>Firma del Cliente (opcional)</div>
          {form.client_signature && (
            <span style={S.badge("#10b981")}>✓ Firmado</span>
          )}
        </div>
        {form.client_signature ? (
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ background: "#fff", borderRadius: 8, padding: 8, border: "1px solid #e4e4e7" }}>
              <img src={form.client_signature} alt="Firma" style={{ height: 80, display: "block" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" onClick={() => setShowSignatureModal(true)} style={{ ...S.btnGhost, fontSize: 12 }}>
                ✍️ Volver a firmar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("¿Borrar la firma actual?")) {
                    upd("client_signature", null);
                    upd("signed_at", null);
                  }
                }}
                style={{ ...S.btnDanger, fontSize: 12, background: "transparent", color: "#e11d48", border: "1px solid #e11d48" }}
              >
                Borrar firma
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: "#71717a", marginBottom: 10 }}>
              Pedile al cliente que firme para dejar constancia de que aceptó el plan.
            </p>
            <button type="button" onClick={() => setShowSignatureModal(true)} style={{ ...S.btn, background: "#10b981" }}>
              ✍️ Capturar firma del cliente
            </button>
          </div>
        )}
      </div>

      {/* BOTONES FINAL - dinamicos segun estado */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
        <button onClick={onCancel} style={S.btnGhost}>Cancelar</button>

        {!editingId && (
          <>
            <button onClick={() => onSave("reservado")} style={{ ...S.btn, background: "#f59e0b" }}>
              📝 Guardar como Reserva
            </button>
            <button onClick={() => onSave("pendiente")} style={S.btn}>
              ✓ Enviar para Aprobación
            </button>
          </>
        )}

        {editingId && form.current_status === "reservado" && (
          <>
            <button onClick={() => onSave("reservado")} style={{ ...S.btn, background: "#f59e0b" }}>
              📝 Actualizar Reserva
            </button>
            <button onClick={() => onSave("pendiente")} style={S.btn}>
              ✓ Completar y Enviar a Aprobación
            </button>
          </>
        )}

        {editingId && form.current_status !== "reservado" && (
          <button onClick={() => onSave("pendiente")} style={S.btn}>
            Guardar Correcciones
          </button>
        )}
      </div>

      {/* Modal firma */}
      {showSignatureModal && (
        <SignaturePad
          existingSignature={form.client_signature}
          onCancel={() => setShowSignatureModal(false)}
          onSave={(dataURL) => {
            setForm(prev => ({
              ...prev,
              client_signature: dataURL,
              signed_at: new Date().toISOString(),
            }));
            setShowSignatureModal(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: DETALLE DE VENTA
// ============================================================
function VentaDetailView({ sale, onBack, onEdit, onDelete }) {
  const isPendiente = sale.status === "pendiente";
  const isReservado = sale.status === "reservado";
  const statusColor = sale.status === "aprobada" ? "#10b981" : sale.status === "rechazada" ? "#e11d48" : "#f59e0b";
  const statusLabel = sale.status === "aprobada" ? "Aprobada" : sale.status === "rechazada" ? "Rechazada" : sale.status === "reservado" ? "📝 Reservada" : "Pendiente";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={onBack} style={S.btnGhost}>← Volver</button>
          <h2 style={{ margin: 0 }}>Plan de venta #{sale.sale_number}</h2>
          <span style={S.badge(statusColor)}>{statusLabel}</span>
        </div>
        {(isPendiente || isReservado) && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={onEdit} style={S.btn}>Editar</button>
            <button onClick={onDelete} style={S.btnDanger}>Borrar</button>
          </div>
        )}
      </div>

      {sale.status === "rechazada" && sale.rejected_reason && (
        <div style={{ ...S.card, background: "#fef2f2", borderLeft: "4px solid #e11d48" }}>
          <strong>Razón de rechazo:</strong> {sale.rejected_reason}
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardTitle}>Cliente</div>
        <div style={S.grid2}>
          <div><strong>Nombre:</strong> {sale.client_name}</div>
          <div><strong>Cédula:</strong> {sale.client_cedula}</div>
          <div><strong>Teléfono:</strong> {sale.client_phone1 || "-"}</div>
          <div><strong>Email:</strong> {sale.client_email || "-"}</div>
          <div style={{ gridColumn: "span 2" }}><strong>Dirección:</strong> {sale.client_address || "-"}</div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Vehículo</div>
        <div style={S.grid2}>
          <div><strong>Placa:</strong> {sale.vehicle_plate}</div>
          <div><strong>Modelo:</strong> {sale.vehicle_brand} {sale.vehicle_model} {sale.vehicle_year}</div>
          <div><strong>Color:</strong> {sale.vehicle_color || "-"}</div>
          <div><strong>Km:</strong> {sale.vehicle_km ? sale.vehicle_km.toLocaleString() : "-"}</div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>Precios</div>
        <div style={S.grid2}>
          {(() => {
            const cur = sale.sale_currency || sale.currency || "USD";
            return (
              <>
                <div><strong>Precio de venta:</strong> {fmt(sale.sale_price, cur)}</div>
                <div><strong>Tipo de cambio:</strong> {sale.sale_exchange_rate || "-"}</div>
                <div><strong>Trade-in:</strong> {fmt(sale.tradein_amount, cur)}</div>
                <div><strong>Prima:</strong> {fmt(sale.down_payment, cur)}</div>
                <div><strong>Depósitos totales:</strong> {fmt(sale.deposits_total, cur)}</div>
                <div><strong>Saldo:</strong> {fmt(sale.total_balance, cur)}</div>
                <div><strong>Método de pago:</strong> {sale.payment_method || "-"}</div>
                <div><strong>Tipo de venta:</strong> {sale.sale_type}</div>
              </>
            );
          })()}
        </div>
      </div>

      {sale.deposits && sale.deposits.length > 0 && (
        <div style={S.card}>
          <div style={S.cardTitle}>Depósitos detalle</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Fecha</th>
                <th style={S.th}>Banco</th>
                <th style={S.th}>Referencia</th>
                <th style={S.th}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {sale.deposits.map((d, idx) => (
                <tr key={idx}>
                  <td style={S.td}>{d.deposit_date || "-"}</td>
                  <td style={S.td}>{d.bank || "-"}</td>
                  <td style={S.td}>{d.reference || "-"}</td>
                  <td style={S.td}>{fmt(d.amount, sale.sale_currency || sale.currency || "USD")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sale.observations && (
        <div style={S.card}>
          <div style={S.cardTitle}>Observaciones</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{sale.observations}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: DESGLOSE EN VIVO
// ============================================================
function BreakdownCard({ form }) {
  const currency = form.sale_currency || "USD";
  const isCash = (form.payment_method || "contado") === "contado";
  const { salePrice, transferExtra, transferApart, tradein, down, depsTotal, balance } = computeBreakdown(form);

  const tolerance = 0.01;
  const isZero = Math.abs(balance) <= tolerance;
  const isNegative = balance < -tolerance;

  // Estado visual del saldo
  let balanceColor, balanceLabel, balanceBg, statusMsg;
  if (isNegative) {
    balanceColor = "#991b1b";
    balanceBg = "#fef2f2";
    balanceLabel = "Saldo negativo";
    statusMsg = "El cliente está pagando más de lo que cuesta. Revisá los montos.";
  } else if (isZero) {
    balanceColor = "#065f46";
    balanceBg = "#d1fae5";
    balanceLabel = "Saldo cubierto";
    statusMsg = "La venta cuadra perfecto. Listo para enviar a revisión.";
  } else if (isCash) {
    balanceColor = "#991b1b";
    balanceBg = "#fef2f2";
    balanceLabel = "Saldo pendiente";
    statusMsg = "Venta de contado: el saldo debe ser 0. Agregá más depósitos o ajustá los montos.";
  } else {
    balanceColor = "#1e40af";
    balanceBg = "#dbeafe";
    balanceLabel = "Saldo a financiar";
    statusMsg = "Venta financiada: este saldo es lo que va a cubrir el banco.";
  }

  const lineStyle = { display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.95rem" };
  const lineBorder = { ...lineStyle, borderBottom: "1px solid #e4e4e7" };

  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      padding: "1.5rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      marginBottom: "1.5rem",
      border: "2px solid " + balanceColor + "40",
    }}>
      <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", color: "#18181b" }}>
        Desglose del plan de venta
      </div>

      <div style={lineBorder}>
        <span>Precio de venta</span>
        <strong>{fmt(salePrice, currency)}</strong>
      </div>

      {transferApart && (
        <div style={lineBorder}>
          <span>+ Gastos de traspaso (aparte)</span>
          <strong style={{ color: "#92400e" }}>+ {fmt(transferExtra, currency)}</strong>
        </div>
      )}

      {tradein > 0 && (
        <div style={lineBorder}>
          <span>− Trade-in</span>
          <strong style={{ color: "#10b981" }}>− {fmt(tradein, currency)}</strong>
        </div>
      )}

      {down > 0 && (
        <div style={lineBorder}>
          <span>− Prima / Down payment</span>
          <strong style={{ color: "#10b981" }}>− {fmt(down, currency)}</strong>
        </div>
      )}

      {depsTotal > 0 && (
        <div style={lineBorder}>
          <span>− Depósitos ({(form.deposits || []).filter(d => parseFloat(d.amount) > 0).length})</span>
          <strong style={{ color: "#10b981" }}>− {fmt(depsTotal, currency)}</strong>
        </div>
      )}

      {/* TOTAL */}
      <div style={{
        ...lineStyle,
        marginTop: "0.75rem",
        padding: "1rem",
        background: balanceBg,
        borderRadius: 8,
        fontSize: "1.1rem",
      }}>
        <div>
          <strong style={{ color: balanceColor }}>{balanceLabel}</strong>
          <div style={{ fontSize: "0.8rem", fontWeight: 400, color: "#52525b", marginTop: "0.25rem" }}>
            {statusMsg}
          </div>
        </div>
        <strong style={{ color: balanceColor, fontSize: "1.3rem" }}>
          {fmt(balance, currency)}
        </strong>
      </div>

      {/* Info extra para venta financiada */}
      {!isCash && balance > tolerance && (
        <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#52525b" }}>
          Este saldo debería coincidir con el monto que vas a financiar. Actualmente pusiste{" "}
          <strong>{fmt(parseFloat(form.financing_amount) || 0, currency)}</strong> en "Monto financiado".
          {Math.abs(balance - (parseFloat(form.financing_amount) || 0)) > tolerance && (
            <span style={{ color: "#991b1b", fontWeight: 600 }}> (no coincide)</span>
          )}
        </div>
      )}
    </div>
  );
}
