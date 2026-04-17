import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { useAuth } from './AuthProvider.jsx';

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

const emptyForm = () => ({
  sale_date: todayStr(),
  currency: "USD", // moneda global de la venta
  client_name: "", client_cedula: "", client_phone1: "", client_phone2: "", client_email: "",
  client_address: "", client_workplace: "", client_occupation: "", client_civil_status: "",
  vehicle_id: "", vehicle_plate: "", vehicle_brand: "", vehicle_model: "", vehicle_year: "",
  vehicle_color: "", vehicle_km: "", vehicle_engine: "", vehicle_drive: "", vehicle_fuel: "",
  vehicle_cabys: "",
  has_tradein: false,
  tradein_plate: "", tradein_brand: "", tradein_model: "", tradein_year: "",
  tradein_color: "", tradein_km: "", tradein_engine: "", tradein_drive: "", tradein_fuel: "",
  tradein_value: "",
  sale_type: "propio",
  sale_price: "", sale_exchange_rate: "", tradein_amount: "", down_payment: "",
  deposits: [{ bank: "", reference: "", date: "", amount: "" }],
  payment_method: "contado",
  financing_term_months: "", financing_interest_pct: "", financing_amount: "",
  transfer_included: false, transfer_in_price: false, transfer_in_financing: false,
  has_insurance: false, insurance_months: "",
  observations: "",
  agent2_id: "", // agent1 siempre es el usuario logueado
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
      f.vehicle_cabys = vehicle.cabys_code || "";
      f.sale_price = vehicle.price_usd || "";
    }
    setEditingSaleId(null);
    setSaleForm(f);
    setTab("ventas");
    setView("form");
  }

  function openEditSaleForm(sale) {
    if (sale.status !== "pendiente") {
      alert("Solo podés editar ventas en estado pendiente.");
      return;
    }
    const f = emptyForm();
    // Copiar todos los campos de la venta al formulario
    Object.keys(f).forEach(k => {
      if (sale[k] !== undefined && sale[k] !== null) f[k] = sale[k];
    });
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

  async function saveSale() {
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

    const salePrice = parseFloat(saleForm.sale_price) || 0;
    const tradein = parseFloat(saleForm.tradein_amount) || 0;
    const down = parseFloat(saleForm.down_payment) || 0;
    const depsTotal = (saleForm.deposits || []).reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0);
    const balance = salePrice - tradein - down - depsTotal;

    const row = {
      sale_date: saleForm.sale_date,
      status: "pendiente",
      currency: saleForm.currency || "USD",
      client_name: saleForm.client_name,
      client_cedula: saleForm.client_cedula,
      client_phone1: saleForm.client_phone1 || null,
      client_phone2: saleForm.client_phone2 || null,
      client_email: saleForm.client_email || null,
      client_address: saleForm.client_address || null,
      client_workplace: saleForm.client_workplace || null,
      client_occupation: saleForm.client_occupation || null,
      client_civil_status: saleForm.client_civil_status || null,
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
      total_balance: balance,
      deposits_total: depsTotal,
      payment_method: saleForm.payment_method || null,
      financing_term_months: parseInt(saleForm.financing_term_months) || null,
      financing_interest_pct: parseFloat(saleForm.financing_interest_pct) || null,
      financing_amount: parseFloat(saleForm.financing_amount) || null,
      transfer_included: !!saleForm.transfer_included,
      transfer_in_price: !!saleForm.transfer_in_price,
      transfer_in_financing: !!saleForm.transfer_in_financing,
      has_insurance: !!saleForm.has_insurance,
      insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || null,
    };

    let saleId = editingSaleId;

    if (editingSaleId) {
      // UPDATE
      const { error } = await supabase.from('sales').update(row).eq('id', editingSaleId);
      if (error) { alert("Error al actualizar: " + error.message); return; }
      // Borrar deposits y agents anteriores, insertar de nuevo
      await supabase.from('sale_deposits').delete().eq('sale_id', editingSaleId);
      await supabase.from('sale_agents').delete().eq('sale_id', editingSaleId);
    } else {
      // INSERT
      const { data, error } = await supabase.from('sales').insert(row).select().single();
      if (error) { alert("Error al crear: " + error.message); return; }
      saleId = data.id;
    }

    // Insertar deposits
    const depRows = (saleForm.deposits || [])
      .filter(d => d.amount && parseFloat(d.amount) > 0)
      .map(d => ({
        sale_id: saleId,
        bank: d.bank || null,
        reference: d.reference || null,
        deposit_date: d.date || null,
        amount: parseFloat(d.amount) || 0,
      }));
    if (depRows.length > 0) {
      const { error } = await supabase.from('sale_deposits').insert(depRows);
      if (error) { alert("Error guardando depósitos: " + error.message); return; }
    }

    // Insertar sale_agents (agente 1 = usuario actual, agente 2 opcional)
    const agentRows = [];
    const saleTC = parseFloat(saleForm.sale_exchange_rate) || 0;
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== profile.agent_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * splitPct;
    const splitCrc = Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100;

    const myAgent = agentsList.find(a => a.id === profile.agent_id);
    agentRows.push({
      sale_id: saleId,
      agent_id: profile.agent_id,
      agent_name: myAgent?.name || profile.full_name || "",
      commission_pct: splitPct,
      commission_amount: splitAmt,
      commission_crc: splitCrc,
    });

    if (hasAgent2) {
      const ag2 = agentsList.find(a => a.id === saleForm.agent2_id);
      agentRows.push({
        sale_id: saleId,
        agent_id: saleForm.agent2_id,
        agent_name: ag2?.name || "",
        commission_pct: splitPct,
        commission_amount: splitAmt,
        commission_crc: splitCrc,
      });
    }

    const { error: agErr } = await supabase.from('sale_agents').insert(agentRows);
    if (agErr) { alert("Error guardando agentes: " + agErr.message); return; }

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
                    {v.price_currency === "USD" ? fmt(v.price_usd, "USD") : fmt(v.price_crc, "CRC")}
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
        {[["all", "Todas"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"]].map(([v, l]) => (
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
                <td style={S.td}>{fmt(s.sale_price, "USD")}</td>
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
function VentaFormView({ form, setForm, vehicles, agents, editingId, onSave, onCancel }) {
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
    setForm(prev => ({
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
      sale_price: prev.sale_price || v.price_usd || "",
    }));
  };

  const salePrice = parseFloat(form.sale_price) || 0;
  const saleTC = parseFloat(form.sale_exchange_rate) || 0;
  const hasAgent2 = form.agent2_id && form.agent2_id !== "";
  const splitPct = hasAgent2 ? 0.5 : 1;
  const commUsd = salePrice * 0.01 * splitPct;
  const commCrc = commUsd * saleTC;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>{editingId ? "Editar plan de venta" : "Nuevo plan de venta"}</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={onCancel} style={S.btnGhost}>Cancelar</button>
          <button onClick={onSave} style={S.btn}>Guardar</button>
        </div>
      </div>

      {/* CLIENTE */}
      <div style={S.card}>
        <div style={S.cardTitle}>Datos del cliente</div>
        <div style={S.grid2}>
          <div>
            <label style={S.label}>Nombre completo *</label>
            <input style={S.input} value={form.client_name} onChange={e => upd("client_name", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Cédula *</label>
            <input style={S.input} value={form.client_cedula} onChange={e => upd("client_cedula", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Teléfono 1</label>
            <input style={S.input} value={form.client_phone1} onChange={e => upd("client_phone1", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Teléfono 2</label>
            <input style={S.input} value={form.client_phone2} onChange={e => upd("client_phone2", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Email</label>
            <input style={S.input} value={form.client_email} onChange={e => upd("client_email", e.target.value)} />
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
            <label style={S.label}>Dirección</label>
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
          <div style={{ ...S.grid4, marginTop: "1rem" }}>
            <div><label style={S.label}>Placa</label><input style={S.input} value={form.vehicle_plate} readOnly /></div>
            <div><label style={S.label}>Marca</label><input style={S.input} value={form.vehicle_brand} readOnly /></div>
            <div><label style={S.label}>Modelo</label><input style={S.input} value={form.vehicle_model} readOnly /></div>
            <div><label style={S.label}>Año</label><input style={S.input} value={form.vehicle_year} readOnly /></div>
          </div>
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
            <div><label style={S.label}>Valor acordado ({form.currency || "USD"})</label><input style={S.input} type="number" value={form.tradein_value} onChange={e => upd("tradein_value", e.target.value)} /></div>
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
              value={form.currency || "USD"}
              onChange={e => upd("currency", e.target.value)}
            >
              <option value="USD">USD (dólares)</option>
              <option value="CRC">CRC (colones)</option>
            </select>
            <span style={{ fontSize: "0.85rem", color: "#52525b" }}>
              Todos los montos de esta venta se expresan en {form.currency === "CRC" ? "colones" : "dólares"}.
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
            <label style={S.label}>Precio de venta ({form.currency || "USD"}) *</label>
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
            <label style={S.label}>Trade-in ({form.currency || "USD"})</label>
            <input style={S.input} type="number" value={form.tradein_amount} onChange={e => upd("tradein_amount", e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Prima / Down payment ({form.currency || "USD"})</label>
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
            <div><label style={S.label}>Monto financiado ({form.currency || "USD"})</label><input style={S.input} type="number" value={form.financing_amount} onChange={e => upd("financing_amount", e.target.value)} /></div>
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
            <div><label style={S.label}>Banco</label><input style={S.input} value={d.bank} onChange={e => updDeposit(idx, "bank", e.target.value)} /></div>
            <div><label style={S.label}>Referencia</label><input style={S.input} value={d.reference} onChange={e => updDeposit(idx, "reference", e.target.value)} /></div>
            <div><label style={S.label}>Fecha</label><input style={S.input} type="date" value={d.date} onChange={e => updDeposit(idx, "date", e.target.value)} /></div>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Monto ({form.currency || "USD"})</label>
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
            Incluye traspaso
          </label>
          {form.transfer_included && (
            <div style={{ marginLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" checked={!!form.transfer_in_price} onChange={e => upd("transfer_in_price", e.target.checked)} />
                Traspaso incluido en precio
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <input type="checkbox" checked={!!form.transfer_in_financing} onChange={e => upd("transfer_in_financing", e.target.checked)} />
                Traspaso incluido en financiamiento
              </label>
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

      {/* AGENTES Y COMISION */}
      <div style={S.card}>
        <div style={S.cardTitle}>Vendedores</div>
        <div style={{ marginBottom: "0.75rem", color: "#71717a", fontSize: "0.9rem" }}>
          Vos ya estás asociado como vendedor principal. Si otro vendedor te ayudó, podés agregarlo acá para que se divida la comisión 50/50.
        </div>
        <div>
          <label style={S.label}>Segundo vendedor (opcional)</label>
          <select style={S.sel} value={form.agent2_id} onChange={e => upd("agent2_id", e.target.value)}>
            <option value="">-- Ninguno --</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div style={{ marginTop: "1rem", padding: "0.75rem", background: "#f9fafb", borderRadius: 6, fontSize: "0.9rem" }}>
          <div><strong>Comisión preview:</strong></div>
          <div>Porcentaje: {(splitPct * 100).toFixed(1)}% del 1% ({hasAgent2 ? "dividida entre 2" : "completa"})</div>
          <div>USD: {fmt(commUsd, "USD")}</div>
          <div>CRC: {fmt(commCrc, "CRC")} (usando TC {saleTC || "?"})</div>
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

      {/* BOTONES FINAL */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
        <button onClick={onCancel} style={S.btnGhost}>Cancelar</button>
        <button onClick={onSave} style={S.btn}>Guardar plan de venta</button>
      </div>
    </div>
  );
}

// ============================================================
// SUBCOMPONENTE: DETALLE DE VENTA
// ============================================================
function VentaDetailView({ sale, onBack, onEdit, onDelete }) {
  const isPendiente = sale.status === "pendiente";
  const statusColor = sale.status === "aprobada" ? "#10b981" : sale.status === "rechazada" ? "#e11d48" : "#f59e0b";
  const statusLabel = sale.status === "aprobada" ? "Aprobada" : sale.status === "rechazada" ? "Rechazada" : "Pendiente";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button onClick={onBack} style={S.btnGhost}>← Volver</button>
          <h2 style={{ margin: 0 }}>Plan de venta #{sale.sale_number}</h2>
          <span style={S.badge(statusColor)}>{statusLabel}</span>
        </div>
        {isPendiente && (
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
          <div><strong>Precio de venta:</strong> {fmt(sale.sale_price, "USD")}</div>
          <div><strong>Tipo de cambio:</strong> {sale.sale_exchange_rate || "-"}</div>
          <div><strong>Trade-in:</strong> {fmt(sale.tradein_amount, "USD")}</div>
          <div><strong>Prima:</strong> {fmt(sale.down_payment, "USD")}</div>
          <div><strong>Depósitos totales:</strong> {fmt(sale.deposits_total, "USD")}</div>
          <div><strong>Saldo:</strong> {fmt(sale.total_balance, "USD")}</div>
          <div><strong>Método de pago:</strong> {sale.payment_method || "-"}</div>
          <div><strong>Tipo de venta:</strong> {sale.sale_type}</div>
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
                  <td style={S.td}>{fmt(d.amount, "USD")}</td>
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
