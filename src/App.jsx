import React, { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from './supabase.js';
import * as XLSX from 'xlsx';

const exportXLS = (rows, name) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// CABYS codes for vehicles (most used)
const CABYS_VEHICLES = [
  { code: "4911200000100", label: "Microbús", type: "microbus" },
  { code: "4911200000200", label: "Buseta", type: "buseta" },
  { code: "4911305000100", label: "Coupé <= 2000cc", type: "coupe" },
  { code: "4911305000200", label: "Coupé > 2000cc", type: "coupe" },
  { code: "4911306010100", label: "SUV 2 puertas <= 2000cc", type: "suv" },
  { code: "4911306010200", label: "SUV 2 puertas > 2000cc", type: "suv" },
  { code: "4911306020100", label: "SUV 4 puertas <= 2000cc", type: "suv" },
  { code: "4911306020200", label: "SUV 4 puertas > 2000cc", type: "suv" },
  { code: "4911307010100", label: "Todoterreno 2 puertas <= 2000cc", type: "todoterreno" },
  { code: "4911307010200", label: "Todoterreno 2 puertas > 2000cc", type: "todoterreno" },
  { code: "4911307020100", label: "Todoterreno 4 puertas <= 2000cc", type: "todoterreno" },
  { code: "4911307020200", label: "Todoterreno 4 puertas > 2000cc", type: "todoterreno" },
  { code: "4911308010100", label: "Sedán 2p deportivo <= 2000cc", type: "sedan" },
  { code: "4911308010200", label: "Sedán 2p deportivo > 2000cc", type: "sedan" },
  { code: "4911308020100", label: "Sedán 2 puertas <= 2000cc", type: "sedan" },
  { code: "4911308020200", label: "Sedán 2 puertas > 2000cc", type: "sedan" },
  { code: "4911308030100", label: "Sedán 2p hatchback <= 2000cc", type: "sedan" },
  { code: "4911308030200", label: "Sedán 2p hatchback > 2000cc", type: "sedan" },
  { code: "4911308040100", label: "Sedán 3p hatchback <= 2000cc", type: "sedan" },
  { code: "4911308040200", label: "Sedán 3p hatchback > 2000cc", type: "sedan" },
  { code: "4911308050100", label: "Sedán 4 puertas <= 2000cc", type: "sedan" },
  { code: "4911308050200", label: "Sedán 4 puertas > 2000cc", type: "sedan" },
  { code: "4911308060000", label: "Sedán 2p 3 ruedas <= 1000cc", type: "sedan" },
  { code: "4911308070000", label: "Sedán 4p 3 ruedas <= 1000cc", type: "sedan" },
  { code: "4911308080000", label: "Sedán 4p 4 ruedas <= 1000cc", type: "sedan" },
  { code: "4911309000100", label: "Familiar/Camioneta <= 2000cc", type: "familiar" },
  { code: "4911309000200", label: "Familiar/Camioneta > 2000cc", type: "familiar" },
  { code: "4911315000000", label: "Híbrido-eléctrico", type: "hibrido" },
  { code: "4911401000100", label: "Adrales carga <= 5t", type: "carga" },
  { code: "4911401000200", label: "Adrales carga 5-20t", type: "carga" },
  { code: "4911404000000", label: "Pick up <= 5t", type: "pickup" },
];

// Auto-suggest CABYS based on vehicle style and engine CC
// Corte: <=2000cc usa codigo "...100", >2000cc usa codigo "...200"
// Si cc no se provee, usa el default >2000 (mas comun)
const suggestCabys = (style, cc) => {
  if (!style) return "";
  const s = style.toLowerCase();
  const ccNum = parseInt(cc, 10);
  const isSmall = !isNaN(ccNum) && ccNum > 0 && ccNum <= 2000;

  // Pick up: no distingue CC
  if (s.includes("pick up") || s.includes("pickup")) return "4911404000000";
  // Microbus: no distingue CC
  if (s.includes("microbus") || s.includes("microbús")) return "4911200000100";
  // Hibrido/electrico: no distingue CC
  if (s.includes("hibrido") || s.includes("híbrido") || s.includes("electri")) return "4911315000000";

  // Estos si distinguen CC
  if (s.includes("suv")) return isSmall ? "4911306020100" : "4911306020200";
  if (s.includes("sedan") || s.includes("sedán")) return isSmall ? "4911308050100" : "4911308050200";
  if (s.includes("hatchback")) return isSmall ? "4911308040100" : "4911308040200";
  if (s.includes("todoterreno")) return isSmall ? "4911307020100" : "4911307020200";
  if (s.includes("coupe") || s.includes("coupé")) return isSmall ? "4911305000100" : "4911305000200";
  if (s.includes("familiar") || s.includes("camioneta")) return isSmall ? "4911309000100" : "4911309000200";

  return "";
};

// Opciones fijas para dropdowns
const DRIVETRAIN_OPTIONS = ["4x2", "4x4", "AWD"];
const FUEL_OPTIONS = ["Gasolina", "Diesel", "Eléctrico", "Híbrido"];

// Marcas comunes precargadas (se combinan con las aprendidas del inventario)
const COMMON_BRANDS = [
  "TOYOTA", "HYUNDAI", "KIA", "NISSAN", "HONDA", "MITSUBISHI", "SUZUKI",
  "MAZDA", "FORD", "CHEVROLET", "VOLKSWAGEN", "BMW", "MERCEDES-BENZ",
  "AUDI", "SUBARU", "JEEP", "ISUZU", "LAND ROVER", "LEXUS", "DAIHATSU"
];

// Formatea placa: MAYUSCULAS + guion entre letras y numeros
// "dgh123" -> "DGH-123", "cl 5136416" -> "CL-5136416"
// Si ya tiene el formato correcto o no lo reconoce, devuelve en mayuscula
const formatPlate = (val) => {
  if (!val) return "";
  // Quitar espacios, guiones existentes, y poner en mayuscula
  const clean = String(val).toUpperCase().replace(/[\s-]/g, "");
  if (!clean) return "";
  // Detectar patron letras + numeros
  const match = clean.match(/^([A-Z]+)(\d+)$/);
  if (match) return `${match[1]}-${match[2]}`;
  // Patron mixto raro (ej: ABC123XYZ): no tocar, devolver en mayuscula sin guiones
  return clean;
};

// Helper: valores unicos de un campo del inventario, ordenados alfabeticamente
// Se usa para alimentar los datalist "learning" de marca/modelo/color/año
const uniqueFromInventory = (cars, field) => {
  if (!cars || !Array.isArray(cars)) return [];
  const set = new Set();
  cars.forEach(c => {
    const val = c[field];
    if (val != null && String(val).trim() !== "") {
      set.add(String(val).trim().toUpperCase());
    }
  });
  return Array.from(set).sort((a, b) => {
    // Años: orden descendente (mas nuevo primero)
    if (field === "y" || field === "year") return Number(b) - Number(a);
    return a.localeCompare(b);
  });
};

// Combina COMMON_BRANDS con las marcas aprendidas del inventario, sin duplicados
const brandOptions = (cars) => {
  const learned = uniqueFromInventory(cars, "b");
  const combined = new Set([...COMMON_BRANDS, ...learned]);
  return Array.from(combined).sort();
};

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
  {id:"herramientas",g:"costos_ventas",l:"Herramientas y Suministros",a:"Herramientas y Suministros Menores",aid:"5319"},
  {id:"lavado",g:"costos_ventas",l:"Lavado de Vehículos",a:"Lavado de Vehiculos",aid:"5292"},
  {id:"combustible",g:"costos_ventas",l:"Combustibles y Lubricantes",a:"Combustibles y Lubricantes",aid:"5291"},
  {id:"rep_vehiculos",g:"costos_ventas",l:"Reparaciones de Vehículos",a:"Reparaciones de Vehículos",aid:"5290"},
  {id:"traspaso",g:"costos_ventas",l:"Gastos de Inscripción y Traspaso",a:"Gastos de Inscripcion y Traspaso",aid:"5289"},
  {id:"marchamo",g:"costos_ventas",l:"Derechos de Circulación",a:"Derechos de Circulacion",aid:"5288"},
  // COSTOS - Mercancía vendida
  {id:"costo_inv",g:"costos_merc",l:"Costos del Inventario",a:"Costos del inventario",aid:"5147"},
  {id:"ajuste_inv",g:"costos_merc",l:"Ajustes al Inventario",a:"Ajustes al inventario",aid:"5148"},
  // GASTOS - Personal
  {id:"sueldos",g:"gastos_personal",l:"Sueldos",a:"Sueldos",aid:"5155"},
  {id:"cargas_sociales",g:"gastos_personal",l:"Cargas Sociales",a:"Cargas Sociales",aid:"5157"},
  {id:"comisiones_p",g:"gastos_personal",l:"Comisiones",a:"Comisiones",aid:"5158"},
  {id:"aguinaldos",g:"gastos_personal",l:"Aguinaldos",a:"Aguinaldos",aid:"5160"},
  {id:"riesgos_trabajo",g:"gastos_personal",l:"Póliza Riesgos del Trabajo",a:"Poliza de Riesgos del Trabajo",aid:"5159"},
  // GASTOS - Generales > Representación
  {id:"atencion_cli",g:"gastos_generales",l:"Atención a Clientes",a:"Atencion a Clientes",aid:"5327"},
  {id:"viaticos_emp",g:"gastos_generales",l:"Viáticos a Empleados",a:"Viaticos a Empleados",aid:"5326"},
  {id:"gastos_viaje",g:"gastos_generales",l:"Gastos de Viaje",a:"Gastos de Viaje",aid:"5325"},
  {id:"uniformes",g:"gastos_generales",l:"Uniformes para el Personal",a:"Uniformes para el Personal",aid:"5324"},
  // GASTOS - Generales > Oficina
  {id:"aseo",g:"gastos_generales",l:"Aseo y Limpieza",a:"Aseo y Limpieza",aid:"5329"},
  {id:"mensajeria",g:"gastos_generales",l:"Mensajería",a:"Mensajeria",aid:"5328"},
  {id:"oficina",g:"gastos_generales",l:"Papelería y Suministros de Oficina",a:"Papeleria y Suministos de Oficina",aid:"5193"},
  // GASTOS - Generales > Seguros
  {id:"seguros",g:"gastos_generales",l:"Seguro de Vehículos",a:"Seguro de Vehiculos",aid:"5202"},
  {id:"seguro_licencias",g:"gastos_generales",l:"Seguro de Licencias",a:"Seguro de Licencias",aid:"5201"},
  // GASTOS - Generales > Mantenimiento
  {id:"mantenimiento",g:"gastos_generales",l:"Mantenimiento Propiedades Arrendadas",a:"Mantenimiento Propiedades Arrendadas",aid:"5213"},
  {id:"mant_maquinaria",g:"gastos_generales",l:"Mantenimiento de Maquinaria y Herramientas",a:"Mantenimiento de Maquinaria y Herramientas",aid:"5339"},
  // GASTOS - Generales > Cuotas
  {id:"cuotas_susc",g:"gastos_generales",l:"Cuotas y Suscripciones",a:"Cuotas y Suscripciones",aid:"5331"},
  // GASTOS - Generales > Impuestos (sub-categorías)
  {id:"patentes_mun",g:"gastos_generales",l:"Patentes Municipales",a:"Patentes Municipales",aid:"5335"},
  {id:"imp_territoriales",g:"gastos_generales",l:"Impuestos Municipales y Territoriales",a:"Impuestos Municipales y Territoriales",aid:"5333"},
  {id:"timbre_edu",g:"gastos_generales",l:"Timbre de Educación y Cultura",a:"Timbre de Educacion y Cultura",aid:"5334"},
  {id:"imp_pers_jur",g:"gastos_generales",l:"Impuesto a las Personas Jurídicas",a:"Impuesto a las Personas Juridicas",aid:"5340"},
  {id:"iva_soportado",g:"gastos_generales",l:"Gasto por IVA Soportado",a:"Gasto por IVA Soportado",aid:"5336"},
  // GASTOS - Generales > Servicios Profesionales
  {id:"serv_prof",g:"gastos_generales",l:"Servicios Profesionales",a:"Servicios Profesionales",aid:"5341"},
  // GASTOS - Generales > Alquileres
  {id:"alquiler",g:"gastos_generales",l:"Alquiler de Local",a:"Alquiler de Local",aid:"5179"},
  // GASTOS - Generales > Servicios Públicos
  {id:"serv_publicos",g:"gastos_generales",l:"Teléfonos",a:"Telefonos",aid:"5185"},
  {id:"agua",g:"gastos_generales",l:"Agua",a:"Agua",aid:"5183"},
  {id:"electricidad",g:"gastos_generales",l:"Energía Eléctrica",a:"Energia Electrica",aid:"5184"},
  {id:"internet_cable",g:"gastos_generales",l:"Internet y Cable",a:"Internet y Cable",aid:"5186"},
  // GASTOS - Generales > Publicidad
  {id:"representacion",g:"gastos_generales",l:"Publicidad y Mercadeo",a:"Anuncios en Medios",aid:"5337"},
  {id:"ferias",g:"gastos_generales",l:"Ferias y Mercadeo",a:"Ferias y Otros de Mercadeo",aid:"5338"},
  // GASTOS - Financieros
  {id:"com_bancarias",g:"gastos_financieros",l:"Comisiones Bancarias",a:"Comisiones Bancarias",aid:"5308"},
  {id:"intereses",g:"gastos_financieros",l:"Intereses Financieros",a:"Gastos por Intereses financieros",aid:"5227"},
  {id:"intereses_daniel",g:"gastos_financieros",l:"Intereses Daniel Aguilar",a:"Intereses Daniel Aguilar Akerman",aid:"5304"},
  {id:"intereses_sonia",g:"gastos_financieros",l:"Intereses Sonia Azofeifa",a:"Intereses Sonia Azofeifa Villalobos",aid:"5305"},
  // OTROS GASTOS
  {id:"gastos_no_ded",g:"otros_gastos",l:"Gastos no Deducibles de ISR",a:"Gastos no Deducibles de ISR",aid:"5311"},
  {id:"contrib_parafisc",g:"otros_gastos",l:"Contribuciones Parafiscales",a:"Contribuciones Parafiscales",aid:"5312"},
  // OTROS (default)
  {id:"otro",g:"otros_gastos",l:"Sin clasificar",a:null,aid:null},
];

// ===== LIQUIDATION CATEGORY MAPPING =====
const LIQ_CATS = [
  { id: "viaticos", label: "Viáticos", catIds: ["viaticos_emp", "atencion_cli"] },
  { id: "combustibles", label: "Combustibles", catIds: ["combustible"] },
  { id: "reparaciones", label: "Reparaciones de Vehículos", catIds: ["rep_vehiculos", "marchamo", "herramientas", "lavado", "traspaso"] },
  { id: "otros", label: "Otros", catIds: null },
];
const getLiqCategory = (catId) => { for (const lc of LIQ_CATS) { if (lc.catIds && lc.catIds.includes(catId)) return lc.id; } return "otros"; };
const getLiqCatLabel = (liqCatId) => LIQ_CATS.find(c => c.id === liqCatId)?.label || "Otros";

const fmt = (n, c) => {
  if (n == null || isNaN(n)) return "-";
  return (c === "USD" ? "$" : "₡") + Number(n).toLocaleString("es-CR", {minimumFractionDigits:0, maximumFractionDigits:0});
};
const fmt2 = (n, c) => {
  if (n == null || isNaN(n)) return "-";
  return (c === "USD" ? "$" : "₡") + Number(n).toLocaleString("es-CR", {minimumFractionDigits:2, maximumFractionDigits:2});
};
const fK = (n) => Number(n).toLocaleString("es-CR") + " km";
const tabs = ["Dashboard","Inventario","Facturas","Costos","Clientes","Ventas","Liquidaciones","Planillas","Egresos","Settings","Reportes"];

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
const supDisplay = (inv) => {
  // Para contabilidad: prioridad al nombre legal (razón social)
  // Si no hay nombre legal, usar comercial
  // Si no hay ninguno, usar la cédula/ID
  if (inv.supName && inv.supName !== "NoAplica" && inv.supName.trim() !== "") return inv.supName;
  if (inv.supComm && inv.supComm !== "NoAplica" && inv.supComm.trim() !== "") return inv.supComm;
  return inv.supId || "Sin nombre";
};

// Componente reutilizable: dropdown con opciones aprendidas + "Otro" para escribir nueva
// Props:
// - value: valor actual (string)
// - onChange: (newValue) => void
// - options: array de strings con las opciones conocidas
// - placeholder: texto del option vacio (default "Seleccionar")
// - upperCase: si true, fuerza MAYUSCULAS al escribir en el input "Otro"
// - style: estilos adicionales
// - styleInp: estilos del input "Otro" (por si es distinto del select)
const SmartDropdown = ({ value, onChange, options = [], placeholder = "Seleccionar", upperCase = false, style = {}, styleInp = null }) => {
  const v = value || "";
  // Si el valor actual NO esta en las opciones conocidas, significa que es "Otro"
  const isOther = v !== "" && !options.includes(v);
  const [customMode, setCustomMode] = useState(isOther);

  // Si el value cambia externamente y ahora esta en options, salir de custom mode
  useEffect(() => {
    if (v && options.includes(v)) setCustomMode(false);
    else if (v && !options.includes(v)) setCustomMode(true);
  }, [v, options]);

  const handleSelectChange = (e) => {
    const val = e.target.value;
    if (val === "__OTRO__") {
      setCustomMode(true);
      onChange("");
    } else {
      setCustomMode(false);
      onChange(val);
    }
  };

  const handleCustomChange = (e) => {
    const val = upperCase ? e.target.value.toUpperCase() : e.target.value;
    onChange(val);
  };

  if (customMode) {
    return (
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <input
          value={v}
          onChange={handleCustomChange}
          placeholder="Escribir nueva..."
          style={{...(styleInp || style), flex:1}}
          autoFocus
        />
        <button
          type="button"
          onClick={() => { setCustomMode(false); onChange(""); }}
          style={{background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:6,padding:"4px 8px",color:"#8b8fa4",cursor:"pointer",fontSize:11}}
          title="Volver al dropdown"
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <select value={v} onChange={handleSelectChange} style={style}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__OTRO__">➕ Otro (escribir nuevo)</option>
    </select>
  );
};

// Canvas para capturar firma con dedo/mouse
// Props:
// - onSave(dataURL): se llama cuando clickean "Guardar firma"
// - onCancel(): se llama cuando cierran sin guardar
// - existingSignature: si ya habia firma, la muestra al abrir
const SignaturePad = ({ onSave, onCancel, existingSignature }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(!!existingSignature);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Ajustar resolucion del canvas para que la firma no se vea pixelada
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";

    // Si hay firma previa, dibujarla
    if (existingSignature) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = existingSignature;
    }
  }, [existingSignature]);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const end = () => setIsDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const save = () => {
    if (!hasDrawn) {
      alert("Por favor firmá antes de guardar.");
      return;
    }
    const dataURL = canvasRef.current.toDataURL("image/png");
    onSave(dataURL);
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:16,padding:24,maxWidth:600,width:"100%"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <h3 style={{fontSize:18,fontWeight:700,margin:0,color:"#111"}}>Firma del Cliente</h3>
          <button onClick={onCancel} style={{background:"none",border:"none",cursor:"pointer",color:"#666",fontSize:20}}>✕</button>
        </div>
        <p style={{fontSize:12,color:"#666",marginBottom:10}}>
          Firme en el recuadro con el dedo (móvil) o mouse (computadora).
        </p>
        <div style={{border:"2px dashed #ccc",borderRadius:10,background:"#fafafa",touchAction:"none"}}>
          <canvas
            ref={canvasRef}
            style={{width:"100%",height:220,cursor:"crosshair",display:"block"}}
            onMouseDown={start}
            onMouseMove={draw}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={draw}
            onTouchEnd={end}
          />
        </div>
        <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
          <button onClick={clear} style={{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:13,fontWeight:500}}>
            Limpiar
          </button>
          <button onClick={onCancel} style={{background:"#f3f4f6",color:"#111",border:"1px solid #e5e7eb",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:13,fontWeight:500}}>
            Cancelar
          </button>
          <button onClick={save} style={{background:"#10b981",color:"#fff",border:"none",borderRadius:8,padding:"8px 24px",cursor:"pointer",fontSize:13,fontWeight:600}}>
            Guardar firma
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [pickedInv, setPickedInv] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [fCat, setFCat] = useState("all");
  const [fPay, setFPay] = useState("all");
  const [fAssign, setFAssign] = useState("all");
  const [fType, setFType] = useState("all");
  const [fMethod, setFMethod] = useState("all");
  const [fCurrency, setFCurrency] = useState("all");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [selectedInvs, setSelectedInvs] = useState(new Set());
  const [costView, setCostView] = useState("vehicles");
  const [costExpanded, setCostExpanded] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [rejectedInvs, setRejectedInvs] = useState([]);
  const [showRejected, setShowRejected] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [vehicleForm, setVehicleForm] = useState(null);
  const [vehicleFormLine, setVehicleFormLine] = useState(null); // which invoice line is selected
  const [completedVehicleLines, setCompletedVehicleLines] = useState(new Set()); // line indices already added
  const [cars, setCars] = useState([]);
  const [invFilter, setInvFilter] = useState("disponible"); // disponible, reservado, vendido, all
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [newVehicleForm, setNewVehicleForm] = useState(null);

  // Sales state
  const [sales, setSales] = useState([]);
  const [agents, setAgents] = useState([]);
  const [salesView, setSalesView] = useState("list"); // list, form, preview
  const [searchingClient, setSearchingClient] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [saleForm, setSaleForm] = useState(null);
  const [pickedSale, setPickedSale] = useState(null);
  const [saleFilter, setSaleFilter] = useState("all");
  const [printSale, setPrintSale] = useState(null);
  const [expandedClient, setExpandedClient] = useState(null);
  const [pickedCli, setPickedCli] = useState(null);
  const [editingClient, setEditingClient] = useState(null);

  // ===== EGRESOS STATE =====
  const [egresosFilter, setEgresosFilter] = useState("all"); // all, factura, liquidacion, planilla
  const [expandedEgreso, setExpandedEgreso] = useState(null);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [confirmApprove, setConfirmApprove] = useState(null);
  const [selectedCars, setSelectedCars] = useState(new Set());
  const [selectedClis, setSelectedClis] = useState(new Set());

  // ===== LIQUIDATION STATE =====
  const [liquidations, setLiquidations] = useState([]);
  const [liqView, setLiqView] = useState("list");
  const [liqForm, setLiqForm] = useState(null);
  const [pickedLiq, setPickedLiq] = useState(null);
  const [liqFilter, setLiqFilter] = useState("all");
  const [printLiq, setPrintLiq] = useState(null);
  const [liqOptResult, setLiqOptResult] = useState(null);
  const [liqManualMode, setLiqManualMode] = useState(false);
  const [liqManualSelected, setLiqManualSelected] = useState(new Set());
  const [liqPayForm, setLiqPayForm] = useState(null);

  // ===== PAYROLL STATE =====
  const [payrolls, setPayrolls] = useState([]);
  const [payView, setPayView] = useState("list");
  const [payForm, setPayForm] = useState(null);
  const [payMonth, setPayMonth] = useState(new Date().getMonth());
  const [payYear, setPayYear] = useState(new Date().getFullYear());
  const [pickedPay, setPickedPay] = useState(null);
  const [printPay, setPrintPay] = useState(null);
  const [payPayForm, setPayPayForm] = useState(null);

  // ===== SETTINGS STATE =====
  const [appSettings, setAppSettings] = useState({ ccss_pct: 10.83, rent_brackets: [{ from: 0, to: 918000, pct: 0 },{ from: 918000, to: 1347000, pct: 10 },{ from: 1347000, to: 2364000, pct: 15 },{ from: 2364000, to: 4727000, pct: 20 },{ from: 4727000, to: 999999999, pct: 25 }] });
  const [settingsTab, setSettingsTab] = useState("employees");
  const [editingAgent, setEditingAgent] = useState(null);

  // ===== NOTIFICACIONES REALTIME =====
  const [notif, setNotif] = useState(null);

  // Load data on mount
  useEffect(() => { loadInvoices(); loadSyncStatus(); loadSales(); loadAgents(); loadVehicles(); loadLiquidations(); loadPayrolls(); loadSettings(); loadBankAccounts(); }, []);

  const loadBankAccounts = async () => {
    const { data } = await supabase.from('bank_accounts').select('*').order('id');
    if (data) setBankAccounts(data);
  };

  // Realtime: escuchar planes de venta nuevos (pendientes) de agentes
  useEffect(() => {
    const salesChannel = supabase
      .channel('admin-sales-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        loadSales();
        if (payload.new && payload.new.status === 'pendiente') {
          playAdminSound();
          showAdminNotif(`Nuevo plan de venta pendiente de ${payload.new.client_name || 'cliente'}`);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales' }, () => {
        loadSales();
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sales' }, () => {
        loadSales();
      })
      .subscribe();

    return () => { supabase.removeChannel(salesChannel); };
  }, []);

  function playAdminSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 660;
      gain.gain.value = 0.1;
      osc.start();
      setTimeout(() => { osc.frequency.value = 990; }, 100);
      setTimeout(() => { osc.stop(); ctx.close(); }, 250);
    } catch (e) { console.log('sound fail', e); }
  }

  function showAdminNotif(message) {
    setNotif(message);
    setTimeout(() => setNotif(null), 6000);
  }

  const loadVehicles = async () => {
    const { data } = await supabase.from('vehicles').select('*').order('created_at', { ascending: false });
    if (data) {
      // Get sale info for sold vehicles
      const soldPlates = data.filter(v => v.status === 'vendido').map(v => v.plate);
      let saleMap = {};
      if (soldPlates.length > 0) {
        const { data: saleData } = await supabase.from('sales').select('vehicle_plate,client_name,client_cedula,client_phone1,client_email,client_address,sale_date,status').in('vehicle_plate', soldPlates).eq('status','aprobada');
        (saleData || []).forEach(s => { saleMap[s.vehicle_plate] = s; });
      }
      setCars(data.map(v => {
        const sl = saleMap[v.plate];
        return {
          id: v.id, p: v.plate, b: v.brand, m: v.model, y: v.year, co: v.color,
          km: v.km, f: v.fuel, dr: v.drivetrain, st: v.style,
          engine_cc: v.engine_cc, passengers: v.passengers, chassis: v.chassis,
          usd: v.price_usd, crc: v.price_crc, s: v.status || "disponible",
          cabys: v.cabys_code,
          purchase_price: v.purchase_cost, purchase_currency: v.price_currency || "CRC",
          purchase_supplier: v.purchase_supplier, purchase_date: v.purchase_date || v.entry_date,
          exchange_rate: v.exchange_rate,
          sale_date: v.sale_date, sale_invoice_number: v.sale_invoice_number,
          sale_client: sl ? { name: sl.client_name, cedula: sl.client_cedula, phone: sl.client_phone1, email: sl.client_email, address: sl.client_address } : null,
          notes: v.notes, created_at: v.created_at,
        };
      }));
    }
  };

  const loadInvoices = async () => {
    const { data } = await supabase.from('invoices').select('*').order('emission_date', { ascending: false });
    if (data) {
      setInvoices(data.map(inv => ({
        key: inv.xml_key, last4: inv.last_four, date: inv.emission_date,
        supName: inv.supplier_name, supComm: inv.supplier_commercial_name, supId: inv.supplier_id,
        sub: inv.subtotal, tax: inv.tax_total, other: inv.other_charges, total: inv.total,
        currency: inv.currency || 'CRC', exchangeRate: inv.exchange_rate || 1,
        payCode: inv.payment_method_code, payLabel: inv.payment_method_label, isTC: inv.is_credit_card,
        plate: inv.plate, warnPlate: inv.assign_status === 'warning' ? inv.detected_plate : null,
        catId: inv.category_id || 'otro', assignStatus: inv.assign_status || 'unassigned',
        payStatus: inv.pay_status || 'pending', paidBank: inv.paid_bank || '', paidRef: inv.paid_reference || '',
        paidBankId: inv.paid_bank_id || null,
        isVehicle: inv.is_vehicle_purchase || false, vehicleStatus: inv.vehicle_purchase_status || null,
        paidDate: inv.paid_date || '', liquidationId: inv.liquidation_id || null,
        lines: [], dbId: inv.id,
        alegraSyncStatus: inv.alegra_sync_status || 'pending',
        alegraBillId: inv.alegra_bill_id || null,
        alegraSyncError: inv.alegra_sync_error || null,
        alegraAccountId: inv.alegra_account_id || null,
        alegraPaymentId: inv.alegra_payment_id || null,
        alegraPaymentSyncedAt: inv.alegra_payment_synced_at || null,
      })));
    }
  };

  const markAsPaidAndSync = async (inv) => {
    // Validaciones Opcion A: todo tiene que estar listo antes
    if (!inv.alegraBillId) {
      alert(
        '⚠ Esta factura aún no está sincronizada a Alegra.\n\n' +
        'Primero hacé click en el botón "→ Alegra" para crear la bill allá. ' +
        'Después podrás marcarla como pagada.'
      );
      return;
    }
    if (!inv.paidBankId) {
      alert('⚠ Seleccioná la cuenta bancaria primero.');
      return;
    }
    if (!inv.paidRef || !inv.paidRef.trim()) {
      alert('⚠ Ingresá el número de depósito o referencia primero.');
      return;
    }

    const bank = bankAccounts.find(b => b.id === inv.paidBankId);
    const conf = window.confirm(
      `¿Marcar factura como pagada?\n\n` +
      `Proveedor: ${inv.supName}\n` +
      `Monto: ${inv.total}\n` +
      `Cuenta: ${bank ? bank.name : '-'}\n` +
      `Referencia: ${inv.paidRef}\n\n` +
      `Esto va a:\n` +
      `1. Marcar como pagada en VCR Manager\n` +
      `2. Crear el pago en Alegra vinculado a la bill #${inv.alegraBillId}`
    );
    if (!conf) return;

    // Paso 1: marcar pagada localmente
    const today = new Date().toISOString().slice(0, 10);
    updateInv(inv.key, {
      payStatus: 'paid',
      paid_date: today
    });
    setPickedInv({...inv, payStatus: 'paid'});

    // Forzar update en DB del paid_date (updateInv no tiene ese mapping)
    await supabase.from('invoices')
      .update({ pay_status: 'paid', paid_date: today })
      .eq('id', inv.dbId);

    // Paso 2: enviar pago a Alegra
    try {
      const res = await fetch('/api/alegra-sync-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: inv.dbId })
      });
      const data = await res.json();

      if (data.ok) {
        alert(`✓ Pagada. Alegra Payment ID: ${data.alegra_payment_id}`);
        await loadInvoices();
        // Refrescar pickedInv
        const { data: fresh } = await supabase.from('invoices').select('*').eq('id', inv.dbId).single();
        if (fresh && pickedInv && pickedInv.dbId === inv.dbId) {
          setPickedInv({
            ...pickedInv,
            payStatus: 'paid',
            alegraPaymentId: fresh.alegra_payment_id
          });
        }
      } else {
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        alert(
          `⚠ Factura marcada como pagada localmente, pero el sync a Alegra falló:\n\n` +
          `${errMsg}\n\nStep: ${data.step || 'n/a'}\n\n` +
          `Podés reintentar luego o registrar el pago manualmente en Alegra.`
        );
        await loadInvoices();
      }
    } catch (e) {
      alert(
        `⚠ Factura marcada como pagada localmente, pero hubo error de red:\n\n${e.message}\n\n` +
        `Podés reintentar el sync más tarde.`
      );
      await loadInvoices();
    }
  };

  const syncInvoiceToAlegra = async (dbId, displayName) => {
    const conf = window.confirm(
      `¿Enviar factura de ${displayName} a Alegra?\n\n` +
      `Esto va a crear una bill en tu cuenta de Alegra (no timbrada).`
    );
    if (!conf) return;

    setInvoices(prev => prev.map(x => x.dbId === dbId ? { ...x, alegraSyncStatus: 'syncing' } : x));

    try {
      const res = await fetch('/api/alegra-sync-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoice_id: dbId })
      });
      const data = await res.json();

      if (data.ok) {
        const pdfMsg = data.pdf_uploaded ? ' con PDF' : (data.pdf_error ? ' (PDF falló)' : '');
        alert(`✓ Sincronizada. Alegra Bill ID: ${data.alegra_bill_id}${pdfMsg}`);
        await loadInvoices();
      } else {
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        alert(`✗ Error: ${errMsg}\n\nStep: ${data.step || 'n/a'}`);
        await loadInvoices();
      }
    } catch (e) {
      alert(`Error de red: ${e.message}`);
      setInvoices(prev => prev.map(x => x.dbId === dbId ? { ...x, alegraSyncStatus: 'error' } : x));
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
      const res = await fetch('/api/fetch-gmail-invoices', { headers: { 'Authorization': 'Bearer 1197877f004f6b2937905d056c5bab5a6d8c0e914a570c02cc5dbf39cb5c207d' } });
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
    setVehicleForm(null);
    setVehicleFormLine(null);
    setCompletedVehicleLines(new Set());
    if (!inv.lines || inv.lines.length === 0) {
      const { data: dbInv } = await supabase.from('invoices').select('id').eq('xml_key', inv.key).single();
      if (dbInv) {
        const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', dbInv.id).order('line_number');
        if (lines) {
          const mapped = lines.map(l => ({ desc: l.description, cabys: l.cabys_code, qty: l.quantity || 1, price: l.unit_price, taxRate: l.tax_rate, taxAmt: l.tax_amount, total: l.line_total }));
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
    if ('paidBankId' in updates) dbUpdates.paid_bank_id = updates.paidBankId;
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
    const invCurrency = inv.currency || 'CRC';
    const invExchangeRate = inv.exchangeRate || 1;

    // Use line cost if a specific line is selected, otherwise use total
    const lineCost = vehicleFormLine != null && inv.lines && inv.lines[vehicleFormLine]
      ? inv.lines[vehicleFormLine].total
      : inv.total;

    const purchaseCostCRC = invCurrency === 'USD' ? Math.round(lineCost * invExchangeRate) : lineCost;
    const purchaseCostUSD = invCurrency === 'USD' ? lineCost : (invExchangeRate > 1 ? Math.round(lineCost / invExchangeRate) : null);

    const { data: veh, error } = await supabase.from('vehicles').insert({
      plate: vehicleForm.plate.toUpperCase().replace(/\s+/g, '-'),
      brand: vehicleForm.brand || null,
      model: vehicleForm.model || null,
      year: parseInt(vehicleForm.year) || null,
      color: vehicleForm.color || null,
      km: parseFloat(vehicleForm.km) || null,
      drivetrain: vehicleForm.drive || null,
      fuel: vehicleForm.fuel || null,
      style: vehicleForm.style || null,
      engine_cc: vehicleForm.engine_cc || null,
      passengers: parseInt(vehicleForm.passengers) || null,
      chassis: vehicleForm.chassis || null,
      price_usd: parseFloat(vehicleForm.price_usd) || null,
      price_crc: parseFloat(vehicleForm.price_crc) || null,
      cabys_code: vehicleForm.cabys_code || null,
      purchase_cost: purchaseCostCRC,
      purchase_supplier: supDisplay(inv),
      purchase_date: inv.date ? inv.date.split('T')[0] : null,
      price_currency: invCurrency,
      exchange_rate: invCurrency === 'USD' ? invExchangeRate : null,
      status: 'disponible',
    }).select().single();
    if (error) { alert("Error: " + error.message); return; }

    // Track which lines have been completed
    const newCompleted = new Set(completedVehicleLines);
    if (vehicleFormLine != null) newCompleted.add(vehicleFormLine);
    setCompletedVehicleLines(newCompleted);

    // Check if all lines are done (or if single-line invoice)
    const totalLines = (inv.lines || []).length;
    const allDone = totalLines <= 1 || newCompleted.size >= totalLines;

    if (allDone) {
      // All vehicles added, mark invoice as completed
      await supabase.from('invoices').update({ 
        vehicle_purchase_status: 'completed',
        plate: vehicleForm.plate.toUpperCase().replace(/\s+/g, '-'),
        assign_status: 'assigned',
      }).eq('xml_key', inv.key);
      setInvoices(prev => prev.map(x => x.key === inv.key ? { ...x, vehicleStatus: 'completed', plate: vehicleForm.plate.toUpperCase() } : x));
      setPickedInv(prev => prev ? { ...prev, vehicleStatus: 'completed' } : null);
    }

    setVehicleForm(null);
    setVehicleFormLine(null);
    await loadVehicles();
    alert("Vehículo agregado al inventario: " + vehicleForm.plate.toUpperCase() + (allDone ? "" : ` (${newCompleted.size}/${totalLines} líneas completadas)`));
  };

  const dismissVehicle = async () => {
    await supabase.from('invoices').update({ vehicle_purchase_status: 'dismissed' }).eq('xml_key', pickedInv.key);
    setInvoices(prev => prev.map(x => x.key === pickedInv.key ? { ...x, vehicleStatus: 'dismissed' } : x));
    setPickedInv(prev => prev ? { ...prev, vehicleStatus: 'dismissed' } : null);
    setVehicleForm(null);
  };

  const updateVehicle = async () => {
    if (!editingVehicle) return;
    const ev = editingVehicle;
    const { error } = await supabase.from('vehicles').update({
      brand: ev.brand || null, model: ev.model || null, year: parseInt(ev.year) || null,
      color: ev.color || null, km: parseFloat(ev.km) || null,
      drivetrain: ev.drive || null, fuel: ev.fuel || null, style: ev.style || null,
      engine_cc: ev.engine_cc || null, passengers: parseInt(ev.passengers) || null, chassis: ev.chassis || null,
      price_usd: parseFloat(ev.price_usd) || null, price_crc: parseFloat(ev.price_crc) || null,
      purchase_cost: parseFloat(ev.purchase_cost) || null,
      purchase_supplier: ev.purchase_supplier || null,
      purchase_date: ev.purchase_date || null,
      exchange_rate: parseFloat(ev.exchange_rate) || null,
      cabys_code: ev.cabys_code || null, status: ev.status || 'disponible',
    }).eq('id', ev.id);
    if (error) { alert("Error: " + error.message); return; }
    await loadVehicles();
    setEditingVehicle(null);
    setPicked(null);
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
    client_id_type: "fisica", client_cedula: "", client_name: "", client_phone1: "", client_phone2: "",
    client_email: "", client_address: "", client_workplace: "", client_occupation: "", client_civil_status: "",
    vehicle_plate: "", vehicle_brand: "", vehicle_model: "", vehicle_year: "", vehicle_color: "",
    vehicle_km: "", vehicle_engine: "", vehicle_drive: "", vehicle_fuel: "",
    vehicle_style: "", vehicle_engine_cc: "",
    has_tradein: false,
    tradein_plate: "", tradein_brand: "", tradein_model: "", tradein_year: "", tradein_color: "",
    tradein_km: "", tradein_engine: "", tradein_drive: "", tradein_fuel: "", tradein_value: 0,
    sale_type: "propio", sale_currency: "USD", sale_price: "", sale_exchange_rate: "", tradein_amount: 0, down_payment: 0, deposit_signal: 0, total_balance: 0,
    payment_method: "", financing_term_months: "", financing_interest_pct: "", financing_amount: "",
    deposits: [{ bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }],
    transfer_included: false, transfer_in_price: false, transfer_in_financing: false,
    transfer_amount: "",
    has_insurance: false, insurance_months: "",
    observations: "",
    agent1_id: "", agent2_id: "",
    client_signature: null, signed_at: null,
  });

  const selectVehicleForSale = (plate) => {
    // Si elige "Otro", limpiar campos para que el vendedor los llene manualmente
    if (plate === "__OTRO__") {
      setSaleForm(prev => ({ ...prev,
        vehicle_id: null, vehicle_plate: "", vehicle_brand: "", vehicle_model: "",
        vehicle_style: "", vehicle_year: "", vehicle_color: "", vehicle_km: "",
        vehicle_drive: "", vehicle_fuel: "", vehicle_engine_cc: "",
        vehicle_cabys: "", sale_price: "",
      }));
      return;
    }
    const car = cars.find(c => c.p === plate);
    if (!car) return;
    setSaleForm(prev => ({ ...prev,
      vehicle_id: car.id || null,
      vehicle_plate: car.p, vehicle_brand: car.b, vehicle_model: car.m, vehicle_year: car.y,
      vehicle_color: car.co, vehicle_km: car.km, vehicle_drive: car.dr, vehicle_fuel: car.f,
      vehicle_style: car.st || "", vehicle_engine_cc: car.engine_cc || "",
      vehicle_cabys: car.cabys || "",
      sale_price: car.usd,
    }));
  };

  // Busca cliente existente por cedula en ventas anteriores.
  // Si encuentra, autocompleta TODOS los campos del cliente con los datos de la venta mas reciente.
  const lookupClientByCedula = async (cedula) => {
    if (!cedula || cedula.trim().length < 3) return;
    const { data } = await supabase
      .from('sales')
      .select('client_id_type,client_name,client_phone1,client_phone2,client_email,client_address,client_workplace,client_occupation,client_civil_status')
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
      }));
      return true; // encontrado
    }
    return false; // no encontrado localmente
  };

  // Busqueda con boton lupa: primero en ventas anteriores, despues en Alegra
  const searchClient = async () => {
    const cedula = (saleForm?.client_cedula || "").replace(/[\s-]/g, "").trim();
    if (!cedula) {
      alert("Escribí la cédula primero.");
      return;
    }

    setSearchingClient(true);
    try {
      // 1. Buscar primero en ventas anteriores locales
      const foundLocal = await lookupClientByCedula(cedula);
      if (foundLocal) {
        alert("✓ Cliente encontrado en ventas anteriores.");
        return;
      }

      // 2. No encontrado local -> buscar en Alegra
      const res = await fetch('/api/alegra-lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cedula })
      });
      const data = await res.json();

      if (!data.ok) {
        alert(`Error buscando en Alegra: ${data.error || 'desconocido'}`);
        return;
      }

      if (!data.found) {
        alert("Cliente no encontrado en Alegra. Llená los datos manualmente.");
        return;
      }

      // Encontrado en Alegra -> autocompletar
      const c = data.client;
      setSaleForm(prev => ({
        ...prev,
        client_id_type: c.client_id_type || prev.client_id_type || "fisica",
        client_name: c.name || "",
        client_phone1: c.phone1 || "",
        client_phone2: c.phone2 || "",
        client_email: c.email || "",
        client_address: c.address || "",
        // workplace, occupation, civil_status no estan en Alegra, se dejan vacios
      }));
      alert("✓ Cliente importado de Alegra. Completá los campos restantes (trabajo, oficio, estado civil).");

    } catch (e) {
      alert(`Error de red: ${e.message}`);
    } finally {
      setSearchingClient(false);
    }
  };

  // Cálculo completo del desglose de una venta
  // Fórmula: precio + traspaso (solo si aparte) - trade-in - prima - señal - depósitos = saldo
  const computeBreakdown = (form) => {
    const salePrice = parseFloat(form.sale_price) || 0;
    const tradein = parseFloat(form.tradein_amount) || 0;
    const down = parseFloat(form.down_payment) || 0;
    const signal = parseFloat(form.deposit_signal) || 0;
    const depsTotal = (form.deposits || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    const transferApart = !!form.transfer_included && !form.transfer_in_price && !form.transfer_in_financing;
    const transferExtra = transferApart ? (parseFloat(form.transfer_amount) || 0) : 0;
    const balance = salePrice + transferExtra - tradein - down - signal - depsTotal;
    return { salePrice, transferExtra, transferApart, tradein, down, signal, depsTotal, balance };
  };

  const calcBalance = (form) => {
    // Compatibilidad: devuelve el saldo (sin forzar positivo, permite negativos/cero)
    return computeBreakdown(form).balance;
  };

  const depositsTotal = (form) => (form.deposits || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

  const generateObservations = (form) => {
    const vehicle = `${form.vehicle_brand || ""} ${form.vehicle_model || ""} ${form.vehicle_year || ""} ${form.vehicle_plate || ""}`.trim().toLowerCase();

    const deps = (form.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0);
    let depText = "";
    if (deps.length > 0) {
      depText = "deposito(s) " + deps.map(d => {
        const parts = [];
        if (d.bank) parts.push((d.bank || "").toLowerCase());
        if (d.reference) parts.push(`numero ${d.reference}`);
        if (d.date) parts.push(`del ${new Date(d.date + "T12:00:00").toLocaleDateString("es-CR")}`);
        return parts.join(" ");
      }).join(", ");
    }

    let tradeVeh = "";
    if (form.has_tradein) {
      tradeVeh = `${form.tradein_brand || ""} ${form.tradein_model || ""} ${form.tradein_year || ""} ${form.tradein_plate || ""}`.trim().toLowerCase();
    }

    const isFinanced = form.payment_method === "Financiamiento" || form.payment_method === "Mixto";
    const plazo = form.financing_term_months || "";

    if (isFinanced) {
      let obs = "";
      if (form.has_tradein) {
        obs = `venta financiada, se vende ${vehicle} y se recibe ${tradeVeh} como parte de pago`;
      } else {
        obs = `venta financiada de ${vehicle}`;
      }
      const primaTotal = (parseFloat(form.down_payment) || 0) + depositsTotal(form);
      if (primaTotal > 0) {
        obs += `, cliente aporta prima de ${fmt(primaTotal, "USD")}`;
        if (depText) obs += ` en ${depText}`;
      }
      if (plazo) {
        obs += `, saldo pendiente debe cancelarse en un plazo de ${plazo} meses a mas tardar`;
      }
      return obs;
    } else {
      let obs = "";
      if (form.has_tradein) {
        obs = `venta de contado, se vende ${vehicle} y se recibe ${tradeVeh} como parte de pago`;
        if (depText) obs += `, saldo restante cancelado mediante ${depText}`;
      } else {
        obs = `venta de contado, se vende ${vehicle}`;
        if (depText) obs += `, ${depText}`;
      }
      return obs;
    }
  };

  const saveSale = async () => {
    if (!saleForm.client_name || !saleForm.sale_price) { alert("Nombre del cliente y precio son requeridos"); return; }
    if (!saleForm.sale_exchange_rate || parseFloat(saleForm.sale_exchange_rate) <= 0) { alert("Tipo de cambio es requerido"); return; }

    // VALIDACIÓN DE SALDO
    const bd = computeBreakdown(saleForm);
    const isCash = (saleForm.payment_method || "contado") === "contado";
    const tolerance = 0.01;

    if (isCash && Math.abs(bd.balance) > tolerance) {
      alert(
        `El saldo debe ser 0 para ventas de contado.\n\n` +
        `Saldo actual: ${bd.balance.toFixed(2)}\n\n` +
        `Revisá el desglose: precio + traspaso - trade-in - prima - depósitos debe dar 0.`
      );
      return;
    }
    if (!isCash && bd.balance < -tolerance) {
      alert(`El saldo no puede ser negativo. Saldo actual: ${bd.balance.toFixed(2)}`);
      return;
    }

    const balance = bd.balance;
    const saleType = saleForm.sale_type;
    const commPct = saleType === "consignacion_grupo" ? 1 : saleType === "consignacion_externa" ? 5 : 0;
    const commAmt = saleType !== "propio" ? (parseFloat(saleForm.sale_price) || 0) * commPct / 100 : 0;

    const row = {
      sale_date: saleForm.sale_date, status: "pendiente",
      client_id_type: saleForm.client_id_type || "fisica",
      client_name: saleForm.client_name, client_cedula: saleForm.client_cedula,
      client_phone1: saleForm.client_phone1, client_phone2: saleForm.client_phone2,
      client_email: saleForm.client_email, client_address: saleForm.client_address,
      client_workplace: saleForm.client_workplace, client_occupation: saleForm.client_occupation,
      client_civil_status: saleForm.client_civil_status,
      vehicle_id: saleForm.vehicle_id || null,
      vehicle_plate: saleForm.vehicle_plate, vehicle_brand: saleForm.vehicle_brand,
      vehicle_model: saleForm.vehicle_model, vehicle_year: parseInt(saleForm.vehicle_year) || null,
      vehicle_color: saleForm.vehicle_color, vehicle_km: parseFloat(saleForm.vehicle_km) || null,
      vehicle_engine: saleForm.vehicle_engine, vehicle_drive: saleForm.vehicle_drive, vehicle_fuel: saleForm.vehicle_fuel,
      vehicle_style: saleForm.vehicle_style || null,
      vehicle_engine_cc: parseInt(saleForm.vehicle_engine_cc) || null,
      vehicle_cabys: saleForm.vehicle_cabys || null,
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
      sale_currency: saleForm.sale_currency || "USD",
      sale_price: parseFloat(saleForm.sale_price) || 0,
      sale_exchange_rate: parseFloat(saleForm.sale_exchange_rate) || null,
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
      transfer_amount: parseFloat(saleForm.transfer_amount) || 0,
      has_insurance: saleForm.has_insurance,
      insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || generateObservations(saleForm),
      client_signature: saleForm.client_signature || null,
      signed_at: saleForm.signed_at || null,
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
    const saleTC = parseFloat(saleForm.sale_exchange_rate) || 0;
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== saleForm.agent1_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * (hasAgent2 ? 0.5 : 1);
    const splitCrc = Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100;
    if (saleForm.agent1_id) {
      const ag = agents.find(a => a.id === saleForm.agent1_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent1_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc });
    }
    if (hasAgent2) {
      const ag = agents.find(a => a.id === saleForm.agent2_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent2_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc });
    }
    if (agentRows.length > 0) await supabase.from('sale_agents').insert(agentRows);

    await loadSales();
    setSalesView("list");
    setSaleForm(null);
  };

  const approveSale = async (id) => {
    await supabase.from('sales').update({ status: "aprobada", approved_by: "admin", approved_at: new Date().toISOString() }).eq('id', id);
    await loadSales();
    setPickedSale(prev => prev ? { ...prev, status: "aprobada" } : null);
    setConfirmApprove(null);
  };

  const rejectSale = async (id, reason) => {
    await supabase.from('sales').update({ status: "rechazada", rejected_reason: reason || "Rechazada" }).eq('id', id);
    await loadSales();
    setPickedSale(prev => prev ? { ...prev, status: "rechazada" } : null);
  };

  const editSale = (sale) => {
    setEditingSaleId(sale.id);
    setSaleForm({
      sale_date: sale.sale_date || "",
      client_id_type: sale.client_id_type || "fisica",
      client_name: sale.client_name || "", client_cedula: sale.client_cedula || "",
      client_phone1: sale.client_phone1 || "", client_phone2: sale.client_phone2 || "", client_email: sale.client_email || "",
      client_address: sale.client_address || "", client_workplace: sale.client_workplace || "", client_occupation: sale.client_occupation || "",
      client_civil_status: sale.client_civil_status || "",
      vehicle_plate: sale.vehicle_plate || "", vehicle_brand: sale.vehicle_brand || "", vehicle_model: sale.vehicle_model || "",
      vehicle_year: sale.vehicle_year || "", vehicle_color: sale.vehicle_color || "", vehicle_km: sale.vehicle_km || "",
      vehicle_engine: sale.vehicle_engine || "", vehicle_drive: sale.vehicle_drive || "", vehicle_fuel: sale.vehicle_fuel || "",
      vehicle_style: sale.vehicle_style || "", vehicle_engine_cc: sale.vehicle_engine_cc || "",
      vehicle_cabys: sale.vehicle_cabys || "",
      has_tradein: sale.has_tradein || false,
      tradein_plate: sale.tradein_plate || "", tradein_brand: sale.tradein_brand || "", tradein_model: sale.tradein_model || "",
      tradein_year: sale.tradein_year || "", tradein_color: sale.tradein_color || "", tradein_km: sale.tradein_km || "",
      tradein_engine: sale.tradein_engine || "", tradein_drive: sale.tradein_drive || "", tradein_fuel: sale.tradein_fuel || "",
      tradein_value: sale.tradein_value || 0,
      sale_type: sale.sale_type || "propio",
      sale_currency: sale.sale_currency || "USD",
      sale_price: sale.sale_price || "", sale_exchange_rate: sale.sale_exchange_rate || "",
      tradein_amount: sale.tradein_amount || 0, down_payment: sale.down_payment || 0, deposit_signal: sale.deposit_signal || 0,
      payment_method: sale.payment_method || "", financing_term_months: sale.financing_term_months || "",
      financing_interest_pct: sale.financing_interest_pct || "", financing_amount: sale.financing_amount || "",
      deposits: (sale.deposits && sale.deposits.length > 0) ? sale.deposits.map(d => ({ bank: d.bank || "", reference: d.reference || "", date: d.deposit_date || "", amount: d.amount || "" })) : [{ bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }],
      transfer_included: sale.transfer_included || false, transfer_in_price: sale.transfer_in_price || false,
      transfer_in_financing: sale.transfer_in_financing || false,
      transfer_amount: sale.transfer_amount || "",
      has_insurance: sale.has_insurance || false, insurance_months: sale.insurance_months || "",
      observations: sale.observations || "",
      agent1_id: (sale.sale_agents && sale.sale_agents[0]) ? sale.sale_agents[0].agent_id : "",
      agent2_id: (sale.sale_agents && sale.sale_agents[1]) ? sale.sale_agents[1].agent_id : "",
      client_signature: sale.client_signature || null,
      signed_at: sale.signed_at || null,
    });
    setPickedSale(null);
    setSalesView("form");
  };

  const updateSale = async () => {
    if (!saleForm.client_name || !saleForm.sale_price) { alert("Nombre del cliente y precio son requeridos"); return; }
    if (!saleForm.sale_exchange_rate || parseFloat(saleForm.sale_exchange_rate) <= 0) { alert("Tipo de cambio es requerido"); return; }

    // VALIDACIÓN DE SALDO
    const bd = computeBreakdown(saleForm);
    const isCash = (saleForm.payment_method || "contado") === "contado";
    const tolerance = 0.01;

    if (isCash && Math.abs(bd.balance) > tolerance) {
      alert(
        `El saldo debe ser 0 para ventas de contado.\n\n` +
        `Saldo actual: ${bd.balance.toFixed(2)}\n\n` +
        `Revisá el desglose: precio + traspaso - trade-in - prima - depósitos debe dar 0.`
      );
      return;
    }
    if (!isCash && bd.balance < -tolerance) {
      alert(`El saldo no puede ser negativo. Saldo actual: ${bd.balance.toFixed(2)}`);
      return;
    }

    const balance = bd.balance;
    const saleType = saleForm.sale_type;
    const commPct = saleType === "consignacion_grupo" ? 1 : saleType === "consignacion_externa" ? 5 : 0;
    const commAmt = saleType !== "propio" ? (parseFloat(saleForm.sale_price) || 0) * commPct / 100 : 0;
    const row = {
      sale_date: saleForm.sale_date,
      client_id_type: saleForm.client_id_type || "fisica",
      client_name: saleForm.client_name, client_cedula: saleForm.client_cedula,
      client_phone1: saleForm.client_phone1, client_phone2: saleForm.client_phone2,
      client_email: saleForm.client_email, client_address: saleForm.client_address,
      client_workplace: saleForm.client_workplace, client_occupation: saleForm.client_occupation,
      client_civil_status: saleForm.client_civil_status,
      vehicle_plate: saleForm.vehicle_plate, vehicle_brand: saleForm.vehicle_brand,
      vehicle_model: saleForm.vehicle_model, vehicle_year: parseInt(saleForm.vehicle_year) || null,
      vehicle_color: saleForm.vehicle_color, vehicle_km: parseFloat(saleForm.vehicle_km) || null,
      vehicle_drive: saleForm.vehicle_drive, vehicle_fuel: saleForm.vehicle_fuel,
      vehicle_cabys: saleForm.vehicle_cabys || null,
      has_tradein: saleForm.has_tradein,
      tradein_plate: saleForm.has_tradein ? saleForm.tradein_plate : null,
      tradein_brand: saleForm.has_tradein ? saleForm.tradein_brand : null,
      tradein_model: saleForm.has_tradein ? saleForm.tradein_model : null,
      tradein_year: saleForm.has_tradein ? (parseInt(saleForm.tradein_year) || null) : null,
      tradein_value: saleForm.has_tradein ? (parseFloat(saleForm.tradein_value) || 0) : 0,
      sale_type: saleType, commission_pct: commPct, commission_amount: commAmt,
      sale_currency: saleForm.sale_currency || "USD",
      sale_price: parseFloat(saleForm.sale_price) || 0,
      sale_exchange_rate: parseFloat(saleForm.sale_exchange_rate) || null,
      tradein_amount: parseFloat(saleForm.tradein_amount) || 0,
      down_payment: parseFloat(saleForm.down_payment) || 0,
      deposit_signal: parseFloat(saleForm.deposit_signal) || 0,
      deposits_total: depositsTotal(saleForm), total_balance: balance,
      payment_method: saleForm.payment_method,
      financing_term_months: parseInt(saleForm.financing_term_months) || null,
      financing_interest_pct: parseFloat(saleForm.financing_interest_pct) || null,
      financing_amount: parseFloat(saleForm.financing_amount) || null,
      transfer_included: saleForm.transfer_included, transfer_in_price: saleForm.transfer_in_price,
      transfer_in_financing: saleForm.transfer_in_financing,
      transfer_amount: parseFloat(saleForm.transfer_amount) || 0,
      has_insurance: saleForm.has_insurance, insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || generateObservations(saleForm),
      client_signature: saleForm.client_signature || null,
      signed_at: saleForm.signed_at || null,
    };
    const { error } = await supabase.from('sales').update(row).eq('id', editingSaleId);
    if (error) { alert("Error: " + error.message); return; }
    // Replace deposits
    await supabase.from('sale_deposits').delete().eq('sale_id', editingSaleId);
    const depRows = (saleForm.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0).map(d => ({
      sale_id: editingSaleId, bank: d.bank || null, reference: d.reference || null, deposit_date: d.date || null, amount: parseFloat(d.amount) || 0,
    }));
    if (depRows.length > 0) await supabase.from('sale_deposits').insert(depRows);
    // Replace agents
    await supabase.from('sale_agents').delete().eq('sale_id', editingSaleId);
    const salePrice = parseFloat(saleForm.sale_price) || 0;
    const saleTC = parseFloat(saleForm.sale_exchange_rate) || 0;
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== saleForm.agent1_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * (hasAgent2 ? 0.5 : 1);
    const splitCrc = Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100;
    const agentRows = [];
    if (saleForm.agent1_id) { const ag = agents.find(a => a.id === saleForm.agent1_id); agentRows.push({ sale_id: editingSaleId, agent_id: saleForm.agent1_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc }); }
    if (hasAgent2) { const ag = agents.find(a => a.id === saleForm.agent2_id); agentRows.push({ sale_id: editingSaleId, agent_id: saleForm.agent2_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc }); }
    if (agentRows.length > 0) await supabase.from('sale_agents').insert(agentRows);
    await loadSales();
    setSalesView("list");
    setSaleForm(null);
    setEditingSaleId(null);
  };

  const deleteVehicles = async () => {
    const pin = prompt("PIN para eliminar " + selectedCars.size + " vehículo(s):");
    if (pin !== "1234") { alert("PIN incorrecto"); return; }
    for (const id of selectedCars) { await supabase.from('vehicles').delete().eq('id', id); }
    await loadVehicles();
    setSelectedCars(new Set());
  };

  const deleteClients = async () => {
    alert("Los clientes se generan de las ventas. Para eliminar un cliente, elimine sus ventas asociadas.");
  };

  const updateClient = async (originalCli, newData) => {
    // Match by cedula if present, otherwise by name
    const matchKey = originalCli.ce ? 'client_cedula' : 'client_name';
    const matchValue = originalCli.ce || originalCli.n;
    const { error } = await supabase.from('sales').update({
      client_name: newData.n || null,
      client_cedula: newData.ce || null,
      client_phone1: newData.ph || null,
      client_phone2: newData.ph2 || null,
      client_email: newData.em || null,
      client_address: newData.ad || null,
      client_workplace: newData.wk || null,
      client_occupation: newData.jo || null,
      client_civil_status: newData.ci || null,
    }).eq(matchKey, matchValue);
    if (error) { alert("Error: " + error.message); return; }
    await loadSales();
    setEditingClient(null);
    setPickedCli(null);
  };

  // ======= LIQUIDATION FUNCTIONS =======
  const loadLiquidations = async () => {
    const { data } = await supabase.from('liquidations').select('*').order('created_at', { ascending: false });
    if (data) {
      const ids = data.map(l => l.id);
      let liMap = {};
      if (ids.length > 0) {
        const { data: items } = await supabase.from('liquidation_invoices').select('*').in('liquidation_id', ids).order('liq_category');
        (items || []).forEach(i => { if (!liMap[i.liquidation_id]) liMap[i.liquidation_id] = []; liMap[i.liquidation_id].push(i); });
      }
      setLiquidations(data.map(l => ({ ...l, items: liMap[l.id] || [] })));
    }
  };

  const eligibleInvoices = useMemo(() => {
    return invoices.filter(inv => inv.payCode !== '04' && !inv.liquidationId && inv.payStatus === 'pending');
  }, [invoices]);

  const getEligibleByCurrency = (currency) => eligibleInvoices.filter(inv => inv.currency === currency);

  const getEligibleByCategory = (currency) => {
    const map = { viaticos: [], combustibles: [], reparaciones: [], otros: [] };
    getEligibleByCurrency(currency).forEach(inv => { map[getLiqCategory(inv.catId)].push(inv); });
    return map;
  };

  const optimizeLiquidation = (target, pcts, currency) => {
    const byCat = getEligibleByCategory(currency);
    const result = { viaticos: [], combustibles: [], reparaciones: [], otros: [] };
    let totalSelected = 0;
    const hasPcts = Object.values(pcts).some(v => v > 0);

    if (hasPcts) {
      for (const cat of ["viaticos", "combustibles", "reparaciones", "otros"]) {
        const catTarget = target * (pcts[cat] || 0) / 100;
        if (catTarget <= 0) continue;
        const available = [...byCat[cat]].sort((a, b) => b.total - a.total);
        let catTotal = 0;
        const selected = [];
        for (const inv of available) { if (catTotal >= catTarget) break; selected.push(inv); catTotal += inv.total; }
        if (catTotal < catTarget) {
          const remaining = available.filter(inv => !selected.includes(inv));
          for (const inv of remaining.sort((a, b) => a.total - b.total)) { if (catTotal >= catTarget) break; selected.push(inv); catTotal += inv.total; }
        }
        result[cat] = selected;
        totalSelected += catTotal;
      }
      if (totalSelected < target) {
        const used = new Set(Object.values(result).flat().map(i => i.key));
        const allRemaining = getEligibleByCurrency(currency).filter(inv => !used.has(inv.key)).sort((a, b) => a.total - b.total);
        for (const inv of allRemaining) { if (totalSelected >= target) break; const lc = getLiqCategory(inv.catId); result[lc].push(inv); totalSelected += inv.total; }
      }
    } else {
      // Sin porcentajes: agarrar facturas hasta llegar al monto, priorizando las mas grandes
      const all = getEligibleByCurrency(currency).sort((a, b) => b.total - a.total);
      for (const inv of all) { if (totalSelected >= target) break; const lc = getLiqCategory(inv.catId); result[lc].push(inv); totalSelected += inv.total; }
    }
    return result;
  };

  const saveLiquidation = async (name, optimized, currency) => {
    const allItems = [];
    let total = 0;
    for (const [cat, invs] of Object.entries(optimized)) {
      for (const inv of invs) { allItems.push({ cat, inv }); total += inv.total; }
    }
    const { data: liq, error } = await supabase.from('liquidations').insert({
      name, target_amount: liqForm?.target || 0, actual_amount: total, currency: currency || 'CRC', status: 'draft',
    }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    const rows = allItems.map(({ cat, inv }) => ({
      liquidation_id: liq.id, invoice_id: inv.dbId, invoice_xml_key: inv.key,
      liq_category: cat, amount: inv.total, supplier_name: supDisplay(inv),
      emission_date: inv.date, last_four: inv.last4,
    }));
    if (rows.length > 0) {
      await supabase.from('liquidation_invoices').insert(rows);
      for (const item of allItems) { await supabase.from('invoices').update({ liquidation_id: liq.id }).eq('xml_key', item.inv.key); }
    }
    await loadLiquidations(); await loadInvoices();
    setLiqView("list"); setLiqForm(null); setLiqOptResult(null); setLiqManualMode(false); setLiqManualSelected(new Set());
  };

  const confirmLiquidation = async (id) => {
    const liq = liquidations.find(l => l.id === id);
    if (!liq) return;
    for (const item of (liq.items || [])) {
      await supabase.from('invoices').update({ pay_status: 'paid', liquidation_id: id }).eq('xml_key', item.invoice_xml_key);
    }
    await supabase.from('liquidations').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', id);
    await loadLiquidations(); await loadInvoices();
    setPickedLiq(prev => prev ? { ...prev, status: 'confirmed' } : null);
  };

  const payLiquidation = async (id) => {
    if (!liqPayForm || !liqPayForm.bank) { alert("Ingrese el banco"); return; }
    await supabase.from('liquidations').update({
      status: 'paid', paid_bank: liqPayForm.bank, paid_reference: liqPayForm.reference,
      paid_date: liqPayForm.date, updated_at: new Date().toISOString(),
    }).eq('id', id);
    await loadLiquidations();
    setPickedLiq(prev => prev ? { ...prev, status: 'paid', paid_bank: liqPayForm.bank, paid_reference: liqPayForm.reference, paid_date: liqPayForm.date } : null);
    setLiqPayForm(null);
  };

  const deleteLiquidation = async (id) => {
    const pin = prompt("PIN para eliminar esta liquidación:");
    if (pin !== "1234") { alert("PIN incorrecto"); return; }
    const liq = liquidations.find(l => l.id === id);
    if (liq) { for (const item of (liq.items || [])) { await supabase.from('invoices').update({ liquidation_id: null, pay_status: 'pending' }).eq('xml_key', item.invoice_xml_key); } }
    await supabase.from('liquidation_invoices').delete().eq('liquidation_id', id);
    await supabase.from('liquidations').delete().eq('id', id);
    await loadLiquidations(); await loadInvoices(); setPickedLiq(null);
  };

  // ======= PAYROLL & SETTINGS FUNCTIONS =======
  const loadSettings = async () => {
    const { data } = await supabase.from('app_settings').select('*');
    if (data) {
      const map = {};
      data.forEach(r => { try { map[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value; } catch(e) { map[r.key] = r.value; } });
      setAppSettings(prev => ({ ...prev, ...map }));
    }
  };

  const saveSetting = async (key, value) => {
    const jsonVal = typeof value === 'string' ? value : JSON.stringify(value);
    await supabase.from('app_settings').upsert({ key, value: jsonVal, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    setAppSettings(prev => ({ ...prev, [key]: value }));
  };

  const loadPayrolls = async () => {
    const { data } = await supabase.from('payrolls').select('*').order('created_at', { ascending: false });
    if (data) {
      const ids = data.map(p => p.id);
      let lnMap = {};
      if (ids.length > 0) {
        const { data: lines } = await supabase.from('payroll_lines').select('*').in('payroll_id', ids).order('agent_name');
        (lines || []).forEach(l => { if (!lnMap[l.payroll_id]) lnMap[l.payroll_id] = []; lnMap[l.payroll_id].push(l); });
      }
      setPayrolls(data.map(p => ({ ...p, lines: lnMap[p.id] || [] })));
    }
  };

  const calcRent = (monthlyGross, pensionDeduction) => {
    const base = Math.max(0, monthlyGross - (pensionDeduction || 0));
    const brackets = appSettings.rent_brackets || [];
    let tax = 0;
    for (const b of brackets) {
      if (base <= b.from) continue;
      const taxable = Math.min(base, b.to) - b.from;
      tax += taxable * b.pct / 100;
    }
    return Math.round((tax + Number.EPSILON) * 100) / 100;
  };

  const getAgentCommissions = (agentId, month, year) => {
    // Returns { total_crc, missing_tc_count } - sum in colones, and count of sales without TC
    return sales.filter(s => {
      if (s.status !== 'aprobada') return false;
      if (!s.sale_date) return false;
      const d = new Date(s.sale_date + 'T12:00:00');
      return d.getMonth() === month && d.getFullYear() === year;
    }).reduce((acc, s) => {
      const sAgents = s.sale_agents || [];
      const match = sAgents.find(a => a.agent_id === agentId);
      if (!match) return acc;
      const crcAmt = match.commission_crc || 0;
      const hasTC = s.sale_exchange_rate && s.sale_exchange_rate > 0;
      if (!hasTC && match.commission_amount > 0) {
        // Sale without TC - count but don't include
        return { total_crc: acc.total_crc, missing_tc_count: acc.missing_tc_count + 1 };
      }
      return { total_crc: acc.total_crc + crcAmt, missing_tc_count: acc.missing_tc_count };
    }, { total_crc: 0, missing_tc_count: 0 });
  };

  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const buildPayroll = (type, periodLabel, targetMonth, targetYear) => {
    const ccss = parseFloat(appSettings.ccss_pct) || 10.83;
    const employees = agents.filter(a => a.is_employee !== false);
    const month = targetMonth != null ? targetMonth : new Date().getMonth();
    const year = targetYear != null ? targetYear : new Date().getFullYear();
    const isMensual = type === 'mensual';

    const lines = employees.map(emp => {
      const salary = r2(emp.salary || 0);
      const commData = isMensual ? getAgentCommissions(emp.id, month, year) : { total_crc: 0, missing_tc_count: 0 };
      const comms = r2(commData.total_crc);
      const grossQ = r2(salary + comms);
      const ccssAmt = r2(grossQ * ccss / 100);

      let rentAmt = 0;
      if (isMensual) {
        // Renta sobre salario mensual bruto (Q1 + Q2 con comisiones en colones)
        const monthlyGross = salary + salary + comms;
        rentAmt = calcRent(monthlyGross, emp.pension_deduction || 0);
      }

      const netPay = r2(grossQ - ccssAmt - rentAmt);
      return {
        agent_id: emp.id, agent_name: emp.name, salary, commissions: comms,
        gross_total: grossQ, ccss_pct: ccss, ccss_amount: ccssAmt,
        rent_base: isMensual ? r2(salary * 2 + comms) : 0,
        pension_deduction: r2(emp.pension_deduction || 0),
        rent_amount: rentAmt, net_pay: netPay,
        missing_tc_count: commData.missing_tc_count,
      };
    });

    const totals = lines.reduce((t, l) => ({
      gross: r2(t.gross + l.gross_total), ccss: r2(t.ccss + l.ccss_amount),
      rent: r2(t.rent + l.rent_amount), net: r2(t.net + l.net_pay), comms: r2(t.comms + l.commissions),
    }), { gross: 0, ccss: 0, rent: 0, net: 0, comms: 0 });

    return { type, name: periodLabel, lines, totals };
  };

  const savePayroll = async (preview) => {
    const { data: pr, error } = await supabase.from('payrolls').insert({
      name: preview.name, period_type: preview.type,
      total_gross: preview.totals.gross, total_ccss: preview.totals.ccss,
      total_rent: preview.totals.rent, total_net: preview.totals.net,
      total_commissions: preview.totals.comms, status: 'draft',
    }).select().single();
    if (error) { alert("Error: " + error.message); return; }
    const rows = preview.lines.map(l => {
      const { missing_tc_count, ...lineData } = l;
      return { payroll_id: pr.id, ...lineData };
    });
    await supabase.from('payroll_lines').insert(rows);
    await loadPayrolls();
    setPayView("list"); setPayForm(null);
  };

  const confirmPayroll = async (id) => {
    await supabase.from('payrolls').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', id);
    await loadPayrolls();
    setPickedPay(prev => prev ? { ...prev, status: 'confirmed' } : null);
  };

  const payPayroll = async (id) => {
    if (!payPayForm || !payPayForm.bank) { alert("Ingrese el banco"); return; }
    await supabase.from('payrolls').update({
      status: 'paid', paid_bank: payPayForm.bank, paid_reference: payPayForm.reference,
      paid_date: payPayForm.date, updated_at: new Date().toISOString(),
    }).eq('id', id);
    await loadPayrolls();
    setPickedPay(prev => prev ? { ...prev, status: 'paid', paid_bank: payPayForm.bank, paid_reference: payPayForm.reference, paid_date: payPayForm.date } : null);
    setPayPayForm(null);
  };

  const deletePayroll = async (id) => {
    if (!confirm("¿Está seguro de eliminar esta planilla? Esta acción no se puede deshacer.")) return;
    await supabase.from('payroll_lines').delete().eq('payroll_id', id);
    await supabase.from('payrolls').delete().eq('id', id);
    await loadPayrolls(); setPickedPay(null);
  };

  const [editingPayroll, setEditingPayroll] = useState(null);

  const saveEditPayroll = async () => {
    if (!editingPayroll) return;
    const ep = editingPayroll;
    // Update lines
    await supabase.from('payroll_lines').delete().eq('payroll_id', ep.id);
    const lineRows = ep.lines.map(l => {
      const { missing_tc_count, ...lineData } = l;
      return { payroll_id: ep.id, ...lineData };
    });
    if (lineRows.length > 0) await supabase.from('payroll_lines').insert(lineRows);
    // Update totals
    const totals = ep.lines.reduce((t, l) => ({
      gross: t.gross + (l.gross_total||0), ccss: t.ccss + (l.ccss_amount||0),
      rent: t.rent + (l.rent_amount||0), net: t.net + (l.net_pay||0), comms: t.comms + (l.commissions||0),
    }), { gross: 0, ccss: 0, rent: 0, net: 0, comms: 0 });
    await supabase.from('payrolls').update({
      total_gross: totals.gross, total_ccss: totals.ccss, total_rent: totals.rent,
      total_net: totals.net, total_commissions: totals.comms, updated_at: new Date().toISOString(),
    }).eq('id', ep.id);
    await loadPayrolls();
    setEditingPayroll(null); setPickedPay(null);
    alert("Planilla actualizada");
  };

  const filtered = cars.filter(v => { const s = q.toLowerCase(); return (!q || [v.p,v.b,v.m,v.co,String(v.y)].some(x => (x||"").toLowerCase().includes(s))) && (invFilter === "all" || v.s === invFilter); });

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

  const clients = useMemo(() => {
    const map = {};
    sales.forEach(s => {
      if (!s.client_name) return;
      const key = s.client_cedula || s.client_name;
      if (!map[key]) map[key] = { n: s.client_name, ce: s.client_cedula, ph: s.client_phone1, ph2: s.client_phone2, em: s.client_email, ad: s.client_address, jo: s.client_occupation, ci: s.client_civil_status, wk: s.client_workplace, bu: [] };
      map[key].bu.push({ d: s.sale_date, v: `${s.vehicle_brand} ${s.vehicle_model} ${s.vehicle_year}`, pl: s.vehicle_plate, pr: s.sale_price, st: s.status });
    });
    return Object.values(map);
  }, [sales]);

  // ======= RENDER: LIQUIDACIONES =======
  const renderLiquidaciones = () => {
    const F = liqForm || {};
    const uf = (k, v) => setLiqForm(prev => ({ ...prev, [k]: v }));
    const cur = F.currency || "CRC";
    const curSymbol = cur === "USD" ? "$" : "₡";
    const eligByCur = getEligibleByCurrency(cur);
    const eligByCat = getEligibleByCategory(cur);

    if (liqView === "list") {
      const filteredLiqs = liquidations.filter(l => liqFilter === "all" || l.status === liqFilter);
      const crcElig = getEligibleByCurrency("CRC");
      const usdElig = getEligibleByCurrency("USD");
      return (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h1 style={{fontSize:24,fontWeight:800}}>Liquidaciones</h1>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{
                const rows = [];
                for (const l of filteredLiqs) { for (const item of (l.items || [])) { rows.push({"Liquidación":l.name,"Moneda":l.currency||"CRC","Estado":l.status==="paid"?"Pagada":l.status==="confirmed"?"Confirmada":"Borrador","Categoría":getLiqCatLabel(item.liq_category),"Fecha Factura":item.emission_date?new Date(item.emission_date).toLocaleDateString("es-CR"):"","Últimos 4":item.last_four||"","Comercio":item.supplier_name||"","Monto":item.amount}); } }
                if (rows.length > 0) exportXLS(rows,"Liquidaciones_VCR");
              }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
              <button onClick={()=>{
                setLiqForm({ name:"", target:0, currency:"CRC", pcts:{ viaticos:0, combustibles:0, reparaciones:0, otros:0 } });
                setLiqOptResult(null); setLiqManualMode(false); setLiqManualSelected(new Set()); setLiqView("create");
              }} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,padding:"10px 20px"}}>+ Nueva Liquidación</button>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["all","Todas"],["draft","Borradores"],["confirmed","Confirmadas"],["paid","Pagadas"]].map(([v,l])=>(
              <button key={v} onClick={()=>setLiqFilter(v)} style={{...S.sel,background:liqFilter===v?"#4f8cff20":"#1e2130",color:liqFilter===v?"#4f8cff":"#8b8fa4",fontWeight:liqFilter===v?600:400}}>
                {l} ({liquidations.filter(x=>v==="all"||x.status===v).length})
              </button>
            ))}
          </div>
          <div style={{...S.card,padding:"14px 18px",marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:"#8b8fa4",marginBottom:8}}>FACTURAS DISPONIBLES PARA LIQUIDAR</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div style={{background:"#1e2130",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#4f8cff",marginBottom:6}}>COLONES (₡)</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {LIQ_CATS.map(lc => { const arr = getEligibleByCategory("CRC")[lc.id]||[]; return (
                    <div key={lc.id} style={{flex:"1 1 100px"}}>
                      <div style={{fontSize:9,color:"#8b8fa4"}}>{lc.label}</div>
                      <div style={{fontSize:13,fontWeight:700}}>{fmt(arr.reduce((s,i)=>s+i.total,0))}</div>
                      <div style={{fontSize:9,color:"#8b8fa4"}}>{arr.length} fact.</div>
                    </div>
                  );})}
                </div>
                <div style={{marginTop:6,fontSize:12,fontWeight:700,color:"#4f8cff"}}>Total: {fmt(crcElig.reduce((s,i)=>s+i.total,0))} ({crcElig.length})</div>
              </div>
              <div style={{background:"#1e2130",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,fontWeight:700,color:"#10b981",marginBottom:6}}>DÓLARES ($)</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {LIQ_CATS.map(lc => { const arr = getEligibleByCategory("USD")[lc.id]||[]; return (
                    <div key={lc.id} style={{flex:"1 1 100px"}}>
                      <div style={{fontSize:9,color:"#8b8fa4"}}>{lc.label}</div>
                      <div style={{fontSize:13,fontWeight:700}}>{fmt(arr.reduce((s,i)=>s+i.total,0),"USD")}</div>
                      <div style={{fontSize:9,color:"#8b8fa4"}}>{arr.length} fact.</div>
                    </div>
                  );})}
                </div>
                <div style={{marginTop:6,fontSize:12,fontWeight:700,color:"#10b981"}}>Total: {fmt(usdElig.reduce((s,i)=>s+i.total,0),"USD")} ({usdElig.length})</div>
              </div>
            </div>
          </div>
          {filteredLiqs.length === 0 ? (
            <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay liquidaciones{liqFilter!=="all"?" con este filtro":""}.</div>
          ) : (
            <div style={S.card}>
              {filteredLiqs.map((l,i)=>{
                const lCur = l.currency || "CRC";
                const catTotals = {};
                (l.items||[]).forEach(item => { if (!catTotals[item.liq_category]) catTotals[item.liq_category] = 0; catTotals[item.liq_category] += item.amount; });
                return (
                <div key={i} onClick={()=>setPickedLiq(l)} style={{padding:"14px 18px",borderBottom:"1px solid #2a2d3d",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{l.name}</div>
                    <div style={{fontSize:11,color:"#8b8fa4"}}>{(l.items||[]).length} facturas · {lCur} · {new Date(l.created_at).toLocaleDateString("es-CR")}</div>
                    <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                      <span style={S.badge(l.status==="paid"?"#10b981":l.status==="confirmed"?"#6366f1":"#f59e0b")}>
                        {l.status==="paid"?"Pagada":l.status==="confirmed"?"Confirmada":"Borrador"}
                      </span>
                      {Object.entries(catTotals).map(([cat,tot])=>(<span key={cat} style={S.badge("#64748b")}>{getLiqCatLabel(cat)}: {fmt(tot,lCur==="USD"?"USD":undefined)}</span>))}
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:18,fontWeight:800,color:lCur==="USD"?"#10b981":"#4f8cff"}}>{fmt(l.actual_amount,lCur==="USD"?"USD":undefined)}</div>
                    {l.target_amount > 0 && <div style={{fontSize:11,color:l.actual_amount >= l.target_amount ? "#10b981" : "#f59e0b"}}>Meta: {fmt(l.target_amount,lCur==="USD"?"USD":undefined)}</div>}
                  </div>
                </div>
              );})}
            </div>
          )}
        </div>
      );
    }

    // CREATE VIEW
    if (liqView === "create") {
      const pcts = F.pcts || { viaticos:0, combustibles:0, reparaciones:0, otros:0 };
      const pctSum = Object.values(pcts).reduce((s,v) => s + (parseFloat(v)||0), 0);
      const hasPcts = pctSum > 0;
      const target = parseFloat(F.target) || 0;
      const previewResult = liqOptResult;
      let previewTotal = 0;
      const previewCatTotals = {};
      if (previewResult) { for (const [cat, invs] of Object.entries(previewResult)) { const catT = invs.reduce((s, inv) => s + inv.total, 0); previewCatTotals[cat] = catT; previewTotal += catT; } }
      let manualTotal = 0;
      const manualCatTotals = {};
      if (liqManualMode) { eligByCur.filter(inv => liqManualSelected.has(inv.key)).forEach(inv => { const lc = getLiqCategory(inv.catId); manualCatTotals[lc] = (manualCatTotals[lc] || 0) + inv.total; manualTotal += inv.total; }); }

      return (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h1 style={{fontSize:24,fontWeight:800}}>Nueva Liquidación</h1>
            <button onClick={()=>{setLiqView("list");setLiqForm(null);setLiqOptResult(null);setLiqManualMode(false);}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
          </div>
          <div style={{...S.card,padding:"18px 20px",marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:"#4f8cff"}}>Configuración</div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:"0 14px"}}>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:"#8b8fa4",marginBottom:3}}>Nombre</div>
                <input value={F.name||""} onChange={e=>uf("name",e.target.value)} placeholder="Ej: Liquidación Marzo 2026, Caja Chica..." style={{...S.inp,width:"100%"}} />
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:"#8b8fa4",marginBottom:3}}>Moneda</div>
                <div style={{display:"flex",gap:6}}>
                  {[["CRC","₡ Colones"],["USD","$ Dólares"]].map(([v,l])=>(
                    <button key={v} onClick={()=>{uf("currency",v);setLiqOptResult(null);setLiqManualSelected(new Set());}} style={{...S.sel,flex:1,textAlign:"center",background:cur===v?(v==="CRC"?"#4f8cff20":"#10b98120"):"#1e2130",color:cur===v?(v==="CRC"?"#4f8cff":"#10b981"):"#8b8fa4",fontWeight:cur===v?700:400}}>{l}</button>
                  ))}
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:11,color:"#8b8fa4",marginBottom:3}}>Monto meta ({curSymbol})</div>
                <input type="number" value={F.target||""} onChange={e=>uf("target",e.target.value)} placeholder="Ej: 3000000" style={{...S.inp,width:"100%"}} />
              </div>
            </div>
          </div>
          <div style={{...S.card,padding:"18px 20px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontWeight:700,fontSize:14,color:"#4f8cff"}}>Distribución por Categoría <span style={{fontSize:11,color:"#8b8fa4",fontWeight:400}}>(opcional, dejar en 0 para auto)</span></div>
              {hasPcts && <span style={{fontSize:12,color:Math.abs(pctSum-100)<0.1?"#10b981":"#e11d48",fontWeight:600}}>Total: {pctSum}%</span>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
              {LIQ_CATS.map(lc => {
                const avail = (eligByCat[lc.id] || []).reduce((s,inv)=>s+inv.total,0);
                const catTarget = hasPcts ? target * (pcts[lc.id]||0) / 100 : 0;
                return (
                  <div key={lc.id}>
                    <div style={{fontSize:11,color:"#8b8fa4",marginBottom:3}}>{lc.label}</div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input type="number" value={pcts[lc.id]||""} onChange={e=>uf("pcts",{...pcts,[lc.id]:parseFloat(e.target.value)||0})} placeholder="0" style={{...S.inp,width:60,textAlign:"center"}} />
                      <span style={{fontSize:12,color:"#8b8fa4"}}>%</span>
                    </div>
                    {hasPcts && <div style={{fontSize:10,color:"#8b8fa4",marginTop:4}}>Meta: {fmt(catTarget,cur==="USD"?"USD":undefined)}</div>}
                    <div style={{fontSize:10,color:avail > 0 ? "#10b981" : "#e11d48"}}>Disp: {fmt(avail,cur==="USD"?"USD":undefined)} ({(eligByCat[lc.id]||[]).length})</div>
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8,marginTop:14}}>
              <button onClick={()=>{
                if (!F.name) { alert("Ingrese un nombre"); return; }
                if (!target || target <= 0) { alert("Ingrese un monto meta"); return; }
                if (hasPcts && Math.abs(pctSum - 100) > 0.1) { alert("Los porcentajes deben sumar 100%"); return; }
                setLiqOptResult(optimizeLiquidation(target, pcts, cur));
                setLiqManualMode(false);
              }} style={{...S.sel,background:"#4f8cff",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px",flex:1}}>
                {hasPcts ? "Optimizar con %" : "Optimizar automático"}
              </button>
              <button onClick={()=>{ setLiqManualMode(!liqManualMode); setLiqOptResult(null); setLiqManualSelected(new Set()); }}
                style={{...S.sel,background:liqManualMode?"#f59e0b20":"#1e2130",color:liqManualMode?"#f59e0b":"#8b8fa4",fontWeight:600}}>
                {liqManualMode ? "Manual activo" : "Selección manual"}
              </button>
            </div>
          </div>
          {/* OPTIMIZER RESULT */}
          {previewResult && !liqManualMode && (
            <div style={{...S.card,padding:"18px 20px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:14,color:"#10b981"}}>Resultado del Optimizador</div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:800,color:previewTotal>=target?"#10b981":"#f59e0b"}}>{fmt(previewTotal,cur==="USD"?"USD":undefined)}</div>
                  <div style={{fontSize:11,color:"#8b8fa4"}}>Meta: {fmt(target,cur==="USD"?"USD":undefined)} · Dif: {fmt(previewTotal - target,cur==="USD"?"USD":undefined)}</div>
                </div>
              </div>
              {LIQ_CATS.map(lc => {
                const invs = previewResult[lc.id] || [];
                if (invs.length === 0) return null;
                const catT = previewCatTotals[lc.id] || 0;
                const catTarget = hasPcts ? target * (pcts[lc.id]||0) / 100 : 0;
                return (
                  <div key={lc.id} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:"#1e2130",borderRadius:"8px 8px 0 0"}}>
                      <span style={{fontWeight:700,fontSize:13}}>{lc.label}</span>
                      <span style={{fontWeight:700,color:"#4f8cff"}}>{fmt(catT,cur==="USD"?"USD":undefined)} {hasPcts && <span style={{fontSize:10,color:"#8b8fa4",fontWeight:400}}>/ {fmt(catTarget,cur==="USD"?"USD":undefined)}</span>}</span>
                    </div>
                    {invs.map((inv,j) => (
                      <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid #2a2d3d",fontSize:12}}>
                        <div>
                          <span style={{color:"#8b8fa4"}}>{inv.date ? new Date(inv.date).toLocaleDateString("es-CR") : ""}</span>
                          <span style={{marginLeft:8,color:"#8b8fa4"}}>{inv.last4||""}</span>
                          <span style={{marginLeft:8,fontWeight:600}}>{supDisplay(inv)}</span>
                        </div>
                        <span style={{fontWeight:600}}>{fmt(inv.total,cur==="USD"?"USD":undefined)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div style={{display:"flex",gap:12,justifyContent:"flex-end",marginTop:16}}>
                <button onClick={()=>setLiqOptResult(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                <button onClick={()=>saveLiquidation(F.name, previewResult, cur)} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 30px"}}>Crear Liquidación</button>
              </div>
            </div>
          )}
          {/* MANUAL MODE */}
          {liqManualMode && (
            <div style={{...S.card,padding:"18px 20px",marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:14,color:"#f59e0b"}}>Selección Manual ({cur})</div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:800,color:"#4f8cff"}}>{fmt(manualTotal,cur==="USD"?"USD":undefined)}</div>
                  <div style={{fontSize:11,color:"#8b8fa4"}}>{liqManualSelected.size} seleccionada{liqManualSelected.size!==1?"s":""}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                {LIQ_CATS.map(lc => (<span key={lc.id} style={S.badge(manualCatTotals[lc.id]?"#4f8cff":"#64748b")}>{lc.label}: {fmt(manualCatTotals[lc.id]||0,cur==="USD"?"USD":undefined)}</span>))}
              </div>
              {LIQ_CATS.map(lc => {
                const avail = eligByCat[lc.id] || [];
                if (avail.length === 0) return null;
                return (
                  <div key={lc.id} style={{marginBottom:10}}>
                    <div style={{fontWeight:700,fontSize:12,color:"#8b8fa4",padding:"6px 0",borderBottom:"1px solid #2a2d3d"}}>{lc.label} ({avail.length})</div>
                    {avail.map((inv,j) => (
                      <div key={j} style={{display:"flex",gap:8,alignItems:"center",padding:"6px 0",borderBottom:"1px solid #2a2d3d10",background:liqManualSelected.has(inv.key)?"#4f8cff08":"transparent"}}>
                        <input type="checkbox" checked={liqManualSelected.has(inv.key)} onChange={()=>{ setLiqManualSelected(prev => { const n = new Set(prev); if (n.has(inv.key)) n.delete(inv.key); else n.add(inv.key); return n; }); }} style={{cursor:"pointer"}} />
                        <div style={{flex:1,display:"flex",justifyContent:"space-between",fontSize:12}}>
                          <div>
                            <span style={{color:"#8b8fa4"}}>{inv.date ? new Date(inv.date).toLocaleDateString("es-CR") : ""}</span>
                            <span style={{marginLeft:8,color:"#8b8fa4"}}>{inv.last4||""}</span>
                            <span style={{marginLeft:8,fontWeight:600}}>{supDisplay(inv)}</span>
                          </div>
                          <span style={{fontWeight:600}}>{fmt(inv.total,cur==="USD"?"USD":undefined)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div style={{display:"flex",gap:12,justifyContent:"flex-end",marginTop:16}}>
                <button onClick={()=>{setLiqManualMode(false);setLiqManualSelected(new Set());}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                <button onClick={()=>{
                  if (!F.name) { alert("Ingrese un nombre"); return; }
                  if (liqManualSelected.size === 0) { alert("Seleccione al menos una factura"); return; }
                  const result = { viaticos:[], combustibles:[], reparaciones:[], otros:[] };
                  eligByCur.filter(inv => liqManualSelected.has(inv.key)).forEach(inv => { result[getLiqCategory(inv.catId)].push(inv); });
                  saveLiquidation(F.name, result, cur);
                }} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 30px"}}>
                  Crear ({liqManualSelected.size} fact., {fmt(manualTotal,cur==="USD"?"USD":undefined)})
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // ======= RENDER: PLANILLAS =======
  const renderPlanillas = () => {
    if (payView === "list") {
      const month = payMonth;
      const year = payYear;
      const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
      const mName = monthNames[month];
      const lastDay = new Date(year, month+1, 0).getDate();
      const q1Label = `Planilla 1-15 ${mName} ${year}`;
      const mensualLabel = `Planilla 16-${lastDay} ${mName} ${year}`;

      const isCurrentMonth = month === new Date().getMonth() && year === new Date().getFullYear();
      const isFuture = year > new Date().getFullYear() || (year === new Date().getFullYear() && month > new Date().getMonth());

      // Check if already exist for this month
      const existingQ1 = payrolls.find(p => p.name === q1Label);
      const existingMensual = payrolls.find(p => p.name === mensualLabel);

      // Build preview for non-existing ones
      const previewQ1 = existingQ1 ? null : buildPayroll("quincenal_1", q1Label, month, year);
      const previewMensual = existingMensual ? null : buildPayroll("mensual", mensualLabel, month, year);

      const renderPayrollCard = (existing, preview, title, typeColor) => {
        const p = existing || preview;
        if (!p) return null;
        const isExisting = !!existing;
        const isPaid = isExisting && existing.status === "paid";
        const isConfirmed = isExisting && existing.status === "confirmed";
        const lines = isExisting ? (existing.lines || []) : preview.lines;
        const totals = isExisting ? {
          gross: existing.total_gross, ccss: existing.total_ccss,
          rent: existing.total_rent, net: existing.total_net, comms: existing.total_commissions,
        } : preview.totals;
        const isMensual = (isExisting ? existing.period_type : preview.type) === "mensual";

        return (
          <div style={{...S.card,position:"relative",overflow:"hidden"}}>
            {/* WATERMARK for PAID */}
            {isPaid && (
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",zIndex:10}}>
                <div style={{fontSize:60,fontWeight:900,color:"#10b981",opacity:0.15,transform:"rotate(-20deg)",letterSpacing:6,whiteSpace:"nowrap"}}>PAGADA</div>
              </div>
            )}
            <div style={{padding:"14px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",alignItems:"center",background:typeColor+"10"}}>
              <div>
                <div style={{fontSize:11,color:typeColor,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{title}</div>
                <div style={{fontWeight:700,fontSize:14}}>{p.name || (isExisting ? existing.name : preview.name)}</div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {isExisting ? (
                  <span style={S.badge(isPaid?"#10b981":isConfirmed?"#6366f1":"#f59e0b")}>
                    {isPaid?"Pagada":isConfirmed?"Confirmada":"Borrador"}
                  </span>
                ) : (
                  <span style={S.badge("#64748b")}>Preview en vivo</span>
                )}
              </div>
            </div>
            <div style={{padding:"12px 18px",display:"flex",gap:8,fontSize:12,borderBottom:"1px solid #2a2d3d"}}>
              <div style={{flex:1}}><div style={{color:"#8b8fa4",fontSize:10}}>Bruto</div><div style={{fontWeight:700}}>{fmt2(totals.gross)}</div></div>
              <div style={{flex:1}}><div style={{color:"#8b8fa4",fontSize:10}}>CCSS</div><div style={{fontWeight:700,color:"#e11d48"}}>{fmt2(totals.ccss)}</div></div>
              {isMensual && <div style={{flex:1}}><div style={{color:"#8b8fa4",fontSize:10}}>Renta</div><div style={{fontWeight:700,color:"#e11d48"}}>{fmt2(totals.rent)}</div></div>}
              {isMensual && <div style={{flex:1}}><div style={{color:"#8b8fa4",fontSize:10}}>Comisiones</div><div style={{fontWeight:700,color:"#f97316"}}>{totals.comms>0?fmt2(totals.comms):"-"}</div></div>}
              <div style={{flex:1}}><div style={{color:"#8b8fa4",fontSize:10}}>Neto</div><div style={{fontWeight:800,color:"#4f8cff",fontSize:14}}>{fmt2(totals.net)}</div></div>
            </div>
            <div style={{padding:"0"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#1e2130"}}>
                  {["Empleado","Sueldo","Com.","Bruto","CCSS",isMensual?"Renta":null,"Neto"].filter(Boolean).map(h=>(
                    <th key={h} style={{padding:"6px 10px",textAlign:h==="Empleado"?"left":"right",fontSize:9,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"1px solid #2a2d3d"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {lines.map((l,i) => (
                    <tr key={i} style={{borderBottom:"1px solid #2a2d3d"}}>
                      <td style={{padding:"6px 10px",fontSize:12,fontWeight:600}}>
                        {l.agent_name}
                        {l.missing_tc_count > 0 && <span style={{marginLeft:6,fontSize:10,color:"#e11d48",fontWeight:700}} title="Ventas sin TC asignado">⚠ {l.missing_tc_count} sin TC</span>}
                      </td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontSize:12}}>{fmt2(l.salary)}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:l.commissions>0?"#f97316":"#8b8fa4"}}>{l.commissions>0?fmt2(l.commissions):"-"}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontSize:12,fontWeight:600}}>{fmt2(l.gross_total)}</td>
                      <td style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:"#e11d48"}}>{fmt2(l.ccss_amount)}</td>
                      {isMensual && <td style={{padding:"6px 10px",textAlign:"right",fontSize:12,color:l.rent_amount>0?"#e11d48":"#8b8fa4"}}>{l.rent_amount>0?fmt2(l.rent_amount):"-"}</td>}
                      <td style={{padding:"6px 10px",textAlign:"right",fontSize:13,fontWeight:700,color:"#4f8cff"}}>{fmt2(l.net_pay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{padding:"12px 18px",display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid #2a2d3d",background:"#0f1117",position:"relative",zIndex:11}}>
              {isExisting ? (
                <button onClick={()=>{
                  // Always get fresh data from payrolls array
                  const fresh = payrolls.find(pp => pp.id === existing.id);
                  setPickedPay(fresh || existing);
                }} style={{...S.sel,background:typeColor+"18",color:typeColor,fontWeight:600}}>
                  {isPaid ? "Ver detalle" : "Gestionar"}
                </button>
              ) : (
                <button onClick={()=>{ setPayForm(preview); setPayView("create"); }} style={{...S.sel,background:typeColor,color:"#fff",fontWeight:700,border:"none",padding:"8px 20px"}}>
                  Crear esta planilla
                </button>
              )}
            </div>
          </div>
        );
      };

      // History: all payrolls that are NOT the current Q1 or Mensual of current month
      const historial = payrolls.filter(p => p.name !== q1Label && p.name !== mensualLabel);

      return (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h1 style={{fontSize:24,fontWeight:800}}>Planillas</h1>
            <button onClick={()=>{
              const rows = [];
              for (const p of payrolls) { for (const l of (p.lines||[])) { rows.push({"Planilla":p.name,"Tipo":p.period_type,"Estado":p.status==="paid"?"Pagada":p.status==="confirmed"?"Confirmada":"Borrador","Empleado":l.agent_name,"Sueldo":l.salary,"Comisiones":l.commissions,"Total bruto":l.gross_total,"CCSS %":l.ccss_pct,"CCSS":l.ccss_amount,"Base renta":l.rent_base,"Deducción pensión":l.pension_deduction,"Renta":l.rent_amount,"Neto":l.net_pay}); } }
              if (rows.length > 0) exportXLS(rows,"Planillas_VCR");
            }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar</button>
          </div>

          {/* Month/Year Navigator */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
            <button onClick={()=>{
              if (payMonth === 0) { setPayMonth(11); setPayYear(payYear-1); }
              else setPayMonth(payMonth-1);
            }} style={{...S.sel,padding:"8px 14px",fontSize:16,fontWeight:700,color:"#4f8cff"}}>◀</button>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <select value={payMonth} onChange={e=>setPayMonth(parseInt(e.target.value))} style={{...S.sel,fontSize:14,fontWeight:700,padding:"8px 12px"}}>
                {monthNames.map((m,i)=><option key={i} value={i}>{m}</option>)}
              </select>
              <select value={payYear} onChange={e=>setPayYear(parseInt(e.target.value))} style={{...S.sel,fontSize:14,fontWeight:700,padding:"8px 12px"}}>
                {[2025,2026,2027,2028].map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button onClick={()=>{
              if (payMonth === 11) { setPayMonth(0); setPayYear(payYear+1); }
              else setPayMonth(payMonth+1);
            }} style={{...S.sel,padding:"8px 14px",fontSize:16,fontWeight:700,color:"#4f8cff"}}>▶</button>
            {!isCurrentMonth && (
              <button onClick={()=>{setPayMonth(new Date().getMonth());setPayYear(new Date().getFullYear());}} style={{...S.sel,fontSize:11,color:"#8b8fa4",padding:"6px 12px"}}>Hoy</button>
            )}
            {isFuture && <span style={{fontSize:11,color:"#f59e0b",fontWeight:600}}>Preview futuro (datos predeterminados)</span>}
          </div>

          {agents.filter(a=>a.is_employee!==false).length === 0 ? (
            <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>
              No hay empleados configurados. Vaya a <strong>Settings</strong> para agregarlos.
            </div>
          ) : (
            <>
              <div style={{fontSize:13,fontWeight:700,color:"#8b8fa4",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>
                Planillas de {mName} {year} {isFuture ? "(Preview)" : ""}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr",gap:14,marginBottom:24}}>
                {renderPayrollCard(existingQ1, previewQ1, "Primera Quincena (1-15)", "#0ea5e9")}
                {renderPayrollCard(existingMensual, previewMensual, `Mensual (16-${lastDay})`, "#8b5cf6")}
              </div>

              {historial.length > 0 && (
                <>
                  <div style={{fontSize:13,fontWeight:700,color:"#8b8fa4",marginBottom:10,marginTop:10,textTransform:"uppercase",letterSpacing:.5}}>
                    Historial ({historial.length})
                  </div>
                  <div style={S.card}>
                    {historial.map((p,i)=>(
                      <div key={i} onClick={()=>setPickedPay(p)} style={{padding:"14px 18px",borderBottom:"1px solid #2a2d3d",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <div>
                          <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                          <div style={{fontSize:11,color:"#8b8fa4"}}>{(p.lines||[]).length} empleados · {new Date(p.created_at).toLocaleDateString("es-CR")}</div>
                          <div style={{display:"flex",gap:6,marginTop:6}}>
                            <span style={S.badge(p.status==="paid"?"#10b981":p.status==="confirmed"?"#6366f1":"#f59e0b")}>
                              {p.status==="paid"?"Pagada":p.status==="confirmed"?"Confirmada":"Borrador"}
                            </span>
                            <span style={S.badge(p.period_type==="mensual"?"#8b5cf6":"#0ea5e9")}>
                              {p.period_type==="mensual"?"Mensual":"Quincenal"}
                            </span>
                            {p.total_commissions > 0 && <span style={S.badge("#f97316")}>Com: {fmt2(p.total_commissions)}</span>}
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:18,fontWeight:800,color:"#4f8cff"}}>{fmt2(p.total_net)}</div>
                          <div style={{fontSize:11,color:"#8b8fa4"}}>Bruto: {fmt2(p.total_gross)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      );
    }

    // CREATE / PREVIEW
    if (payView === "create" && payForm) {
      const pv = payForm;
      const isMensual = pv.type === "mensual";
      return (
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h1 style={{fontSize:24,fontWeight:800}}>{pv.name}</h1>
            <button onClick={()=>{setPayView("list");setPayForm(null);}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <span style={S.badge(isMensual?"#8b5cf6":"#0ea5e9")}>{isMensual?"Mensual (2da quincena + comisiones + renta)":"Quincenal (1ra quincena)"}</span>
            <span style={S.badge("#64748b")}>CCSS: {appSettings.ccss_pct}%</span>
          </div>
          <div style={{...S.card,overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"#1e2130"}}>
                {["Empleado","Sueldo","Com.","Total bruto","CCSS",isMensual?"Renta":null,"Neto"].filter(Boolean).map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:h==="Empleado"?"left":"right",fontSize:10,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"2px solid #2a2d3d"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {pv.lines.map((l,i) => (
                  <tr key={i} style={{borderBottom:"1px solid #2a2d3d"}}>
                    <td style={{padding:"10px 12px",fontSize:13,fontWeight:600}}>{l.agent_name}{l.pension_deduction > 0 && <div style={{fontSize:10,color:"#8b8fa4"}}>Pensión: -{fmt2(l.pension_deduction)}</div>}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontSize:13}}>{fmt2(l.salary)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontSize:13,color:l.commissions>0?"#f97316":"#8b8fa4"}}>{l.commissions > 0 ? fmt2(l.commissions) : "-"}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontSize:13,fontWeight:600}}>{fmt2(l.gross_total)}</td>
                    <td style={{padding:"10px 12px",textAlign:"right",fontSize:13,color:"#e11d48"}}>{fmt2(l.ccss_amount)}</td>
                    {isMensual && <td style={{padding:"10px 12px",textAlign:"right",fontSize:13,color:l.rent_amount>0?"#e11d48":"#8b8fa4"}}>{l.rent_amount > 0 ? fmt2(l.rent_amount) : "-"}</td>}
                    <td style={{padding:"10px 12px",textAlign:"right",fontSize:14,fontWeight:800,color:"#4f8cff"}}>{fmt2(l.net_pay)}</td>
                  </tr>
                ))}
                <tr style={{background:"#1e2130"}}>
                  <td style={{padding:"10px 12px",fontWeight:800}}>TOTALES</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700}}>{fmt2(pv.lines.reduce((s,l)=>s+l.salary,0))}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#f97316"}}>{pv.totals.comms > 0 ? fmt2(pv.totals.comms) : "-"}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700}}>{fmt2(pv.totals.gross)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#e11d48"}}>{fmt2(pv.totals.ccss)}</td>
                  {isMensual && <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#e11d48"}}>{fmt2(pv.totals.rent)}</td>}
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:800,fontSize:16,color:"#4f8cff"}}>{fmt2(pv.totals.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",gap:12,justifyContent:"flex-end",marginTop:16}}>
            <button onClick={()=>{setPayView("list");setPayForm(null);}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
            <button onClick={()=>savePayroll(pv)} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 30px"}}>Crear Planilla</button>
          </div>
        </div>
      );
    }
    return null;
  };

  // ======= RENDER: SETTINGS =======
  const renderSettings = () => {
    const employees = agents.filter(a => a.is_employee !== false);
    const brackets = appSettings.rent_brackets || [];
    return (
      <div>
        <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Settings</h1>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[["employees","Empleados"],["ccss","Cargas Sociales"],["rent","Tramos de Renta"]].map(([v,l])=>(
            <button key={v} onClick={()=>setSettingsTab(v)} style={{...S.sel,background:settingsTab===v?"#4f8cff20":"#1e2130",color:settingsTab===v?"#4f8cff":"#8b8fa4",fontWeight:settingsTab===v?600:400}}>{l}</button>
          ))}
        </div>

        {settingsTab === "employees" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:14,fontWeight:700}}>Empleados ({employees.length})</div>
              <button onClick={async()=>{
                const name = prompt("Nombre del empleado:");
                if (!name) return;
                await supabase.from('agents').insert({ name, active: true, is_employee: true, salary: 0, pension_deduction: 0 });
                await loadAgents();
              }} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,fontSize:12}}>+ Agregar</button>
            </div>
            <div style={S.card}>
              {agents.map((a,i) => (
                <div key={i} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:600,fontSize:13}}>{a.name}</div>
                    <div style={{fontSize:11,color:"#8b8fa4"}}>
                      Sueldo quincenal: {fmt2(a.salary || 0)}
                      {(a.pension_deduction || 0) > 0 && ` · Deducción pensión: ${fmt2(a.pension_deduction)}`}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>setEditingAgent(editingAgent===a.id?null:a.id)} style={{...S.sel,fontSize:11,padding:"5px 10px",color:"#4f8cff"}}>
                      {editingAgent===a.id?"Cerrar":"Editar"}
                    </button>
                    <button onClick={async()=>{
                      if (!confirm("Desactivar a " + a.name + "?")) return;
                      await supabase.from('agents').update({ active: false }).eq('id', a.id);
                      await loadAgents();
                    }} style={{...S.sel,fontSize:11,padding:"5px 10px",color:"#e11d48"}}>Desactivar</button>
                  </div>
                </div>
              ))}
              {editingAgent && (() => {
                const a = agents.find(x => x.id === editingAgent);
                if (!a) return null;
                return (
                  <div style={{padding:"14px 18px",background:"#1e2130",borderBottom:"1px solid #2a2d3d"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div>
                        <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Nombre</div>
                        <input defaultValue={a.name} id="edit-agent-name" style={{...S.inp,width:"100%"}} />
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Sueldo quincenal (₡)</div>
                        <input type="number" defaultValue={a.salary||0} id="edit-agent-salary" style={{...S.inp,width:"100%"}} />
                      </div>
                      <div>
                        <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Deducción pensión (₡)</div>
                        <input type="number" defaultValue={a.pension_deduction||0} id="edit-agent-pension" style={{...S.inp,width:"100%"}} />
                      </div>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:10}}>
                      <button onClick={()=>setEditingAgent(null)} style={{...S.sel,color:"#8b8fa4",fontSize:12}}>Cancelar</button>
                      <button onClick={async()=>{
                        const name = document.getElementById('edit-agent-name').value;
                        const salary = parseFloat(document.getElementById('edit-agent-salary').value) || 0;
                        const pension = parseFloat(document.getElementById('edit-agent-pension').value) || 0;
                        await supabase.from('agents').update({ name, salary, pension_deduction: pension }).eq('id', a.id);
                        await loadAgents(); setEditingAgent(null);
                      }} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none",fontSize:12}}>Guardar</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {settingsTab === "ccss" && (
          <div style={{...S.card,padding:"18px 20px"}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Porcentaje de Cargas Sociales (CCSS)</div>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <input type="number" step="0.01" defaultValue={appSettings.ccss_pct} id="ccss-input" style={{...S.inp,width:120,textAlign:"center",fontSize:16}} />
              <span style={{fontSize:14,color:"#8b8fa4"}}>%</span>
              <button onClick={()=>{
                const val = parseFloat(document.getElementById('ccss-input').value);
                if (isNaN(val) || val < 0 || val > 50) { alert("Valor inválido"); return; }
                saveSetting('ccss_pct', val);
                alert("Guardado: " + val + "%");
              }} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none"}}>Guardar</button>
            </div>
            <div style={{fontSize:12,color:"#8b8fa4",marginTop:8}}>Se aplica al salario bruto de cada empleado en la planilla.</div>
          </div>
        )}

        {settingsTab === "rent" && (
          <div style={{...S.card,padding:"18px 20px"}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>Tramos de Impuesto de Renta (mensuales)</div>
            <div style={{fontSize:12,color:"#8b8fa4",marginBottom:12}}>Se aplican al salario bruto mensual (Q1 + Q2 + comisiones) menos la deducción por pensión.</div>
            {brackets.map((b,i) => (
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 80px 40px",gap:8,marginBottom:6,alignItems:"center"}}>
                <input type="number" defaultValue={b.from} id={`bracket-from-${i}`} style={{...S.inp,textAlign:"right"}} />
                <input type="number" defaultValue={b.to} id={`bracket-to-${i}`} style={{...S.inp,textAlign:"right"}} />
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <input type="number" defaultValue={b.pct} id={`bracket-pct-${i}`} style={{...S.inp,width:50,textAlign:"center"}} />
                  <span style={{color:"#8b8fa4"}}>%</span>
                </div>
                <button onClick={()=>{
                  const nb = [...brackets]; nb.splice(i,1);
                  saveSetting('rent_brackets', nb);
                }} style={{background:"none",border:"none",color:"#e11d48",cursor:"pointer",fontSize:14}}>✕</button>
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button onClick={()=>{
                const nb = [...brackets, { from: brackets.length > 0 ? brackets[brackets.length-1].to : 0, to: 999999999, pct: 0 }];
                saveSetting('rent_brackets', nb);
              }} style={{...S.sel,color:"#4f8cff",background:"#4f8cff10",fontWeight:600,fontSize:12}}>+ Agregar tramo</button>
              <button onClick={()=>{
                const nb = brackets.map((b,i) => ({
                  from: parseFloat(document.getElementById(`bracket-from-${i}`).value) || 0,
                  to: parseFloat(document.getElementById(`bracket-to-${i}`).value) || 0,
                  pct: parseFloat(document.getElementById(`bracket-pct-${i}`).value) || 0,
                }));
                saveSetting('rent_brackets', nb);
                alert("Tramos guardados");
              }} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none",fontSize:12}}>Guardar tramos</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ======= RENDER FUNCTIONS =======
  const renderDash = () => (
    <div>
      <h1 style={{fontSize:26,fontWeight:800,marginBottom:20}}>Dashboard</h1>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:24}}>
        {[[cars.length,"Vehículos","#6366f1"],[cars.filter(c=>c.s==="disponible").length,"Disponibles","#10b981"],[invoices.length,"Facturas","#8b5cf6"],[invoices.filter(i=>i.payStatus==="pending").length,"Por pagar","#f59e0b"],[clients.length,"Clientes","#f97316"],[liquidations.length,"Liquidaciones","#e11d48"]].map(([v,l,c])=>(
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

  const updateVehicleField = async (id, field, value) => {
    await supabase.from('vehicles').update({ [field]: value }).eq('id', id);
    setCars(prev => prev.map(c => c.id === id ? { ...c, ...(field === 'price_crc' ? { crc: value } : field === 'price_usd' ? { usd: value } : {}) } : c));
  };

  const renderInv = () => {
    const filteredCars = cars.filter(v => {
      const matchSearch = !q || [v.p,v.b,v.m,v.co,String(v.y)].some(x => (x||"").toLowerCase().includes(q.toLowerCase()));
      const matchFilter = invFilter === "all" || v.s === invFilter;
      return matchSearch && matchFilter;
    });
    const emptyVeh = () => ({ plate:"",brand:"",model:"",year:"",color:"",km:"",drive:"",fuel:"",style:"",engine_cc:"",passengers:"",chassis:"",purchase_cost:"",exchange_rate:"",price_crc:"",cabys_code:"",status:"disponible",entry_date:new Date().toISOString().split('T')[0] });
    const saveNewVehicle = async () => {
      if (!newVehicleForm || !newVehicleForm.plate) { alert("La placa es requerida"); return; }
      if (!newVehicleForm.cabys_code) { alert("El código CABYS es requerido"); return; }
      const { error } = await supabase.from('vehicles').insert({
        plate: newVehicleForm.plate.toUpperCase().replace(/\s+/g, '-'),
        brand: newVehicleForm.brand || null, model: newVehicleForm.model || null,
        year: parseInt(newVehicleForm.year) || null, color: newVehicleForm.color || null,
        km: parseFloat(newVehicleForm.km) || null, drivetrain: newVehicleForm.drive || null,
        fuel: newVehicleForm.fuel || null, style: newVehicleForm.style || null,
        engine_cc: newVehicleForm.engine_cc || null,
        passengers: parseInt(newVehicleForm.passengers) || null,
        chassis: newVehicleForm.chassis || null,
        price_usd: (parseFloat(newVehicleForm.price_crc) && parseFloat(newVehicleForm.exchange_rate)) ? Math.round(parseFloat(newVehicleForm.price_crc) / parseFloat(newVehicleForm.exchange_rate)) : null,
        price_crc: parseFloat(newVehicleForm.price_crc) || null,
        purchase_cost: parseFloat(newVehicleForm.purchase_cost) || null,
        exchange_rate: parseFloat(newVehicleForm.exchange_rate) || null,
        entry_date: newVehicleForm.entry_date || null,
        price_currency: newVehicleForm.purchase_cost ? "CRC" : null,
        cabys_code: newVehicleForm.cabys_code, status: newVehicleForm.status || "disponible",
      });
      if (error) { alert("Error: " + error.message); return; }
      await loadVehicles(); setNewVehicleForm(null); setShowAddVehicle(false);
    };
    const thS = { padding:"10px 12px", textAlign:"left", fontSize:10, fontWeight:700, color:"#8b8fa4", textTransform:"uppercase", letterSpacing:0.4, borderBottom:"2px solid #2a2d3d", whiteSpace:"nowrap" };
    const tdS = { padding:"10px 12px", borderBottom:"1px solid #2a2d3d", fontSize:12, verticalAlign:"middle" };
    const showHist = invFilter !== "disponible";

    const exportInventory = () => {
      const rows = filteredCars.map(v => {
        const costs = costsByPlate[v.p]; const costoCRC = v.purchase_price || 0; const costosAsoc = costs ? costs.total : 0;
        const tc = costoCRC && v.usd ? Math.round(costoCRC / v.usd) : 0; const costoUSD = tc > 0 ? costoCRC / tc : 0;
        const row = { "Marca": v.b, "Modelo": v.m, "Año": v.y, "Placa": v.p, "Color": v.co, "Km": v.km || "", "CC": v.engine_cc || "", "Pasajeros": v.passengers || "", "Chasis": v.chassis || "", "Fecha Compra": v.purchase_date || "", "Proveedor": v.purchase_supplier || "", "Costo CRC": costoCRC, "TC Compra": tc || "", "CABYS": v.cabys || "", "Precio Venta CRC": v.crc || "", "Costos Asociados CRC": costosAsoc, "Utilidad CRC": v.crc && costoCRC ? Math.round((v.crc||0) - costoCRC - costosAsoc) : "", "Estado": v.s };
        if (v.s === "vendido") { row["Fecha Venta"] = v.sale_date || ""; row["Consecutivo"] = v.sale_invoice_number || ""; row["Cliente"] = v.sale_client ? v.sale_client.name : ""; }
        return row;
      });
      exportXLS(rows, "Inventario_VCR");
    };

    const exportAlegraItems = () => {
      const rows = filteredCars.map(v => {
        const alegraName = `${(v.b||"").toUpperCase()} ${(v.m||"").toUpperCase()} ${v.y||""} ${v.p||""}`.trim();
        const descParts = [(v.b||"").toUpperCase() + " " + (v.m||"").toUpperCase(), v.y, (v.co||"").toUpperCase()];
        if (v.engine_cc) descParts.push(v.engine_cc + " CC");
        if (v.dr) descParts.push(v.dr.toUpperCase());
        if (v.passengers) descParts.push(v.passengers + " PASAJEROS");
        if (v.f) descParts.push(v.f.toUpperCase());
        descParts.push("PLACAS# " + (v.p||""));
        if (v.chassis) descParts.push("SERIE# " + v.chassis.toUpperCase());
        return {
          "Tipo": "Producto", "Ítem inventariable": "Si", "Ítem con variantes": "No",
          "Venta en negativo": "No", "Nombre": alegraName,
          "Código de producto o servicio": v.cabys || "",
          "Unidad de medida": "Unidad", "Categoría": "",
          "Descripción": descParts.filter(Boolean).join(", "),
          "Costo inicial": v.purchase_price || 0, "Precio base": v.crc || 0,
          "Impuesto": "", "Precio total": v.crc || 0, "Precio: General": v.crc || 0,
          "Cuenta contable": "Ventas", "Cuenta de inventario": "Inventarios",
          "Cuenta de costo de venta": "Costos del inventario",
        };
      });
      exportXLS(rows, "Items_Alegra_VCR");
    };

    return (<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h1 style={{fontSize:24,fontWeight:800}}>Inventario</h1>
        <div style={{display:"flex",gap:8}}>
          <button onClick={exportInventory} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
          <button onClick={()=>{ setNewVehicleForm(emptyVeh()); setShowAddVehicle(true); }} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,padding:"10px 20px"}}>+ Agregar vehículo</button>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar placa, marca, modelo..." style={{...S.inp,flex:1,maxWidth:300}} />
        {[["disponible","Disponibles"],["vendido","Históricos"],["all","Todos"]].map(([v,l])=>(
          <button key={v} onClick={()=>setInvFilter(v)} style={{...S.sel,background:invFilter===v?"#4f8cff20":"#1e2130",color:invFilter===v?"#4f8cff":"#8b8fa4",fontWeight:invFilter===v?600:400}}>{l} ({cars.filter(c=>v==="all"||c.s===v).length})</button>
        ))}
      </div>
      {selectedCars.size > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:600,color:"#4f8cff"}}>{selectedCars.size} seleccionado{selectedCars.size!==1?"s":""}</span>
          <button onClick={deleteVehicles} style={{...S.sel,fontSize:11,padding:"6px 12px",background:"#e11d4810",color:"#e11d48",fontWeight:600}}>Eliminar</button>
          <button onClick={()=>setSelectedCars(new Set())} style={{...S.sel,fontSize:11,padding:"6px 12px",color:"#8b8fa4"}}>Deseleccionar</button>
        </div>
      )}
      {filteredCars.length===0?(<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>{cars.length===0?"No hay vehículos en inventario.":"No hay vehículos con este filtro."}</div>):(
      <div style={{...S.card,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{background:"#1e2130"}}>
        <th style={{...thS,width:30}}><input type="checkbox" checked={filteredCars.length>0&&selectedCars.size===filteredCars.length} onChange={()=>{if(selectedCars.size===filteredCars.length){setSelectedCars(new Set())}else{setSelectedCars(new Set(filteredCars.map(v=>v.id)))}}} style={{cursor:"pointer"}} /></th>
        <th style={thS}>Vehículo</th><th style={thS}>Placa</th><th style={thS}>Color</th><th style={thS}>Km</th><th style={thS}>Fecha compra</th><th style={thS}>Proveedor</th><th style={thS}>Costo (₡)</th><th style={thS}>T/C compra</th><th style={thS}>CABYS</th><th style={thS}>Precio venta (₡)</th><th style={thS}>Costos asoc.</th><th style={thS}>Utilidad (₡)</th>
        {showHist&&<><th style={thS}>Fecha venta</th><th style={thS}>Consecutivo</th><th style={thS}>Cliente</th></>}
      </tr></thead><tbody>
        {filteredCars.map(v=>{const costs=costsByPlate[v.p];const costoCRC=v.purchase_price||0;const costosAsoc=costs?costs.total:0;const precioVentaCRC=v.crc||0;const tc=v.exchange_rate||0;const utilidad=precioVentaCRC>0&&costoCRC>0?precioVentaCRC-costoCRC-costosAsoc:0;const cabysItem=CABYS_VEHICLES.find(c=>c.code===v.cabys);
        return(<React.Fragment key={v.id}><tr style={{cursor:"pointer",background:selectedCars.has(v.id)?"#4f8cff08":"transparent"}} onMouseEnter={e=>e.currentTarget.style.background=selectedCars.has(v.id)?"#4f8cff12":"#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=selectedCars.has(v.id)?"#4f8cff08":""}>
          <td style={tdS}><input type="checkbox" checked={selectedCars.has(v.id)} onChange={()=>{setSelectedCars(prev=>{const n=new Set(prev);if(n.has(v.id))n.delete(v.id);else n.add(v.id);return n;});}} onClick={e=>e.stopPropagation()} style={{cursor:"pointer"}} /></td>
          <td style={tdS} onClick={()=>setPicked(v)}><div style={{fontWeight:700,fontSize:13}}>{v.b} {v.m}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{v.y}</div></td>
          <td style={tdS} onClick={()=>setPicked(v)}><span style={{fontWeight:600}}>{v.p}</span></td>
          <td style={tdS} onClick={()=>setPicked(v)}>{v.co||"-"}</td>
          <td style={tdS} onClick={()=>setPicked(v)}>{v.km?fK(v.km):"-"}</td>
          <td style={tdS} onClick={()=>setPicked(v)}><div style={{fontSize:11}}>{v.purchase_date?new Date(v.purchase_date+"T12:00:00").toLocaleDateString("es-CR"):"-"}</div></td>
          <td style={{...tdS,maxWidth:120}} onClick={()=>setPicked(v)}><div style={{fontSize:11,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{v.purchase_supplier||"-"}</div></td>
          <td style={tdS} onClick={()=>setPicked(v)}><span style={{fontWeight:600}}>{costoCRC?fmt(costoCRC):"-"}</span></td>
          <td style={tdS} onClick={()=>setPicked(v)}><span style={{fontSize:11,color:"#8b8fa4"}}>{tc>0?tc:"-"}</span></td>
          <td style={tdS} onClick={()=>setPicked(v)}><div style={{fontSize:10,color:"#8b8fa4"}} title={cabysItem?cabysItem.label:v.cabys}>{v.cabys?"..."+v.cabys.slice(-6):"-"}</div></td>
          <td style={tdS}><input type="number" value={v.crc||""} onChange={e=>{const val=parseFloat(e.target.value)||null;setCars(prev=>prev.map(c=>c.id===v.id?{...c,crc:val}:c));}} onBlur={e=>updateVehicleField(v.id,'price_crc',parseFloat(e.target.value)||null)} style={{...S.inp,width:110,padding:"4px 8px",fontSize:12,textAlign:"right"}} /></td>
          <td style={tdS} onClick={()=>setPicked(v)}><span style={{color:"#f59e0b",fontWeight:600}}>{costosAsoc>0?fmt(costosAsoc):"-"}</span>{costs&&<div style={{fontSize:10,color:"#8b8fa4"}}>{costs.items.length} fact.</div>}</td>
          <td style={tdS} onClick={()=>setPicked(v)}><span style={{fontWeight:700,color:utilidad>0?"#10b981":utilidad<0?"#e11d48":"#8b8fa4"}}>{precioVentaCRC>0&&costoCRC>0?fmt(utilidad):"-"}</span></td>
          {showHist&&<td style={tdS}><div style={{fontSize:11}}>{v.sale_date?new Date(v.sale_date+"T12:00:00").toLocaleDateString("es-CR"):"-"}</div></td>}
          {showHist&&<td style={tdS}><div style={{fontSize:11,color:"#4f8cff"}}>{v.sale_invoice_number||"-"}</div></td>}
          {showHist&&<td style={tdS}>{v.sale_client?<button onClick={()=>setExpandedClient(expandedClient===v.id?null:v.id)} style={{...S.sel,fontSize:11,padding:"4px 10px",background:"#4f8cff18",color:"#4f8cff"}}>{v.sale_client.name}</button>:"-"}</td>}
        </tr>
        {showHist&&expandedClient===v.id&&v.sale_client&&(<tr><td colSpan={16} style={{padding:"12px 20px",background:"#1e2130",borderBottom:"2px solid #4f8cff30"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,fontSize:12}}>
            <div><span style={{color:"#8b8fa4",fontSize:10,textTransform:"uppercase"}}>Nombre</span><div style={{fontWeight:600}}>{v.sale_client.name}</div></div>
            <div><span style={{color:"#8b8fa4",fontSize:10,textTransform:"uppercase"}}>Cédula</span><div style={{fontWeight:600}}>{v.sale_client.cedula||"-"}</div></div>
            <div><span style={{color:"#8b8fa4",fontSize:10,textTransform:"uppercase"}}>Teléfono</span><div style={{fontWeight:600}}>{v.sale_client.phone||"-"}</div></div>
            <div><span style={{color:"#8b8fa4",fontSize:10,textTransform:"uppercase"}}>Email</span><div style={{fontWeight:600}}>{v.sale_client.email||"-"}</div></div>
          </div>
          {v.sale_client.address&&<div style={{marginTop:6,fontSize:11,color:"#8b8fa4"}}>Dirección: {v.sale_client.address}</div>}
        </td></tr>)}
        </React.Fragment>);})}
      </tbody></table></div>)}

      {picked&&<div style={S.modal} onClick={()=>{setPicked(null);setEditingVehicle(null);}}><div style={{...S.mbox,maxWidth:550}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
          <div><h2 style={{fontSize:20,fontWeight:800,margin:0}}>{picked.b} {picked.m}</h2><p style={{fontSize:13,color:"#8b8fa4",margin:"4px 0 0"}}>{picked.y} · {picked.p}</p></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!editingVehicle && <button onClick={()=>setEditingVehicle({
              id:picked.id, brand:picked.b||"", model:picked.m||"", year:picked.y||"", color:picked.co||"",
              km:picked.km||"", drive:picked.dr||"", fuel:picked.f||"", style:picked.st||"",
              engine_cc:picked.engine_cc||"", passengers:picked.passengers||"", chassis:picked.chassis||"",
              price_usd:picked.usd||"", price_crc:picked.crc||"",
              purchase_cost:picked.purchase_price||"", purchase_supplier:picked.purchase_supplier||"",
              purchase_date:picked.purchase_date||"", exchange_rate:picked.exchange_rate||"",
              cabys_code:picked.cabys||"", status:picked.s||"disponible",
            })} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,fontSize:12}}>Editar</button>}
            <button onClick={()=>{setPicked(null);setEditingVehicle(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:20}}>✕</button>
          </div>
        </div>

        {editingVehicle ? (
          <div>
            <datalist id="dl-colors">{uniqueFromInventory(cars, "co").map(v => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-years">{uniqueFromInventory(cars, "y").map(v => <option key={v} value={v} />)}</datalist>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 12px",marginBottom:14}}>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Marca</div>
                <SmartDropdown
                  value={editingVehicle.brand||""}
                  onChange={val => setEditingVehicle(prev => ({...prev, brand: val}))}
                  options={brandOptions(cars)}
                  upperCase={true}
                  style={{...S.sel,width:"100%",fontSize:12}}
                  styleInp={{...S.inp,width:"100%",fontSize:12}}
                />
              </div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Modelo</div>
                <SmartDropdown
                  value={editingVehicle.model||""}
                  onChange={val => setEditingVehicle(prev => ({...prev, model: val}))}
                  options={uniqueFromInventory(cars, "m")}
                  upperCase={true}
                  style={{...S.sel,width:"100%",fontSize:12}}
                  styleInp={{...S.inp,width:"100%",fontSize:12}}
                />
              </div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Año</div><input list="dl-years" type="number" value={editingVehicle.year||""} onChange={e=>setEditingVehicle(prev=>({...prev,year:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Color</div><input list="dl-colors" value={editingVehicle.color||""} onChange={e=>setEditingVehicle(prev=>({...prev,color:e.target.value.toUpperCase()}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Kilometraje</div><input type="number" value={editingVehicle.km||""} onChange={e=>setEditingVehicle(prev=>({...prev,km:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Tracción</div><select value={editingVehicle.drive||editingVehicle.drivetrain||""} onChange={e=>setEditingVehicle(prev=>({...prev,drive:e.target.value,drivetrain:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{DRIVETRAIN_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Combustible</div><select value={editingVehicle.fuel||""} onChange={e=>setEditingVehicle(prev=>({...prev,fuel:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div><input type="number" value={editingVehicle.engine_cc||""} onChange={e=>{const val=e.target.value;setEditingVehicle(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Pasajeros</div><input type="number" value={editingVehicle.passengers||""} onChange={e=>setEditingVehicle(prev=>({...prev,passengers:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Serie/Chasis</div><input value={editingVehicle.chassis||""} onChange={e=>setEditingVehicle(prev=>({...prev,chassis:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Proveedor</div><input value={editingVehicle.purchase_supplier||""} onChange={e=>setEditingVehicle(prev=>({...prev,purchase_supplier:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Costo compra (₡)</div><input type="number" value={editingVehicle.purchase_cost||""} onChange={e=>setEditingVehicle(prev=>({...prev,purchase_cost:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>TC referencia</div><input type="number" value={editingVehicle.exchange_rate||""} onChange={e=>setEditingVehicle(prev=>({...prev,exchange_rate:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta USD</div><input type="number" value={editingVehicle.price_usd||""} onChange={e=>setEditingVehicle(prev=>({...prev,price_usd:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta CRC</div><input type="number" value={editingVehicle.price_crc||""} onChange={e=>setEditingVehicle(prev=>({...prev,price_crc:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
              <div>
                <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Fecha compra</div>
                <input type="date" value={editingVehicle.purchase_date||""} onChange={e=>setEditingVehicle(prev=>({...prev,purchase_date:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
              </div>
              <div>
                <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estilo</div>
                <select value={editingVehicle.style||""} onChange={e=>{const val=e.target.value;setEditingVehicle(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}>
                  <option value="">Seleccionar</option>{["SUV","SEDAN","PICK UP","HATCHBACK","COUPE","FAMILIAR","TODOTERRENO","MICROBUS"].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estado</div>
                <select value={editingVehicle.status||"disponible"} onChange={e=>setEditingVehicle(prev=>({...prev,status:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}>
                  <option value="disponible">Disponible</option><option value="reservado">Reservado</option><option value="vendido">Vendido</option>
                </select>
              </div>
              <div style={{gridColumn:"1/3"}}>
                <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Código CABYS</div>
                <select value={editingVehicle.cabys_code||""} onChange={e=>setEditingVehicle(prev=>({...prev,cabys_code:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}>
                  <option value="">Seleccionar CABYS</option>
                  {CABYS_VEHICLES.map(c=><option key={c.code} value={c.code}>{c.code} - {c.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setEditingVehicle(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
              <button onClick={updateVehicle} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Guardar</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{background:"#1e2130",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:10,color:"#8b8fa4"}}>PRECIO VENTA</div><div style={{fontSize:24,fontWeight:800,color:"#4f8cff"}}>{picked.crc?fmt(picked.crc):picked.usd?fmt(picked.usd,"USD"):"-"}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#8b8fa4"}}>COSTO COMPRA</div><div style={{fontSize:16,fontWeight:700,color:"#f59e0b"}}>{picked.purchase_price?fmt(picked.purchase_price):"-"}</div></div></div>
            <div style={S.g2}>{[["Color",picked.co],["Km",picked.km?fK(picked.km):"-"],["Combustible",picked.f],["Tracción",picked.dr],["Cilindrada",picked.engine_cc?picked.engine_cc+" CC":"-"],["Pasajeros",picked.passengers||"-"],["Estilo",picked.st],["Estado",picked.s],["CABYS",picked.cabys||"-"],["Chasis",picked.chassis||"-"]].map(([l,v],i)=><div key={i} style={S.gc}><div style={S.gl}>{l}</div><div style={S.gv}>{v||"-"}</div></div>)}</div>
            {picked.purchase_supplier&&<div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Proveedor: {picked.purchase_supplier}</div>}
            {picked.purchase_date&&<div style={{fontSize:12,color:"#8b8fa4",marginBottom:12}}>Fecha compra: {new Date(picked.purchase_date+"T12:00:00").toLocaleDateString("es-CR")}</div>}
            {costsByPlate[picked.p]?<div><div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Costos asociados ({fmt(costsByPlate[picked.p].total)})</div>{costsByPlate[picked.p].items.map((inv,i)=><div key={i} style={{padding:"8px 14px",background:"#1e2130",borderRadius:8,marginBottom:6,display:"flex",justifyContent:"space-between",fontSize:12}}><div><div style={{fontWeight:600}}>{supDisplay(inv)}</div><div style={{color:"#8b8fa4",fontSize:11}}>{catLabel(inv.catId)}</div></div><span style={{fontWeight:700,color:"#4f8cff"}}>{fmt(inv.total)}</span></div>)}</div>:<div style={{fontSize:12,color:"#8b8fa4"}}>Sin costos asociados</div>}
            {picked.s==="vendido"&&picked.sale_client&&<div style={{marginTop:12,padding:"10px 14px",background:"#10b98110",borderRadius:8}}><div style={{fontSize:12,color:"#10b981",fontWeight:600,marginBottom:4}}>Vendido a: {picked.sale_client.name}</div><div style={{fontSize:11,color:"#8b8fa4"}}>{picked.sale_client.cedula} · {picked.sale_client.phone}</div>{picked.sale_invoice_number&&<div style={{fontSize:11,color:"#4f8cff",marginTop:4}}>Factura: {picked.sale_invoice_number}</div>}</div>}
          </>
        )}
      </div></div>}

      {showAddVehicle&&newVehicleForm&&(<div style={S.modal} onClick={()=>{setShowAddVehicle(false);setNewVehicleForm(null);}}><div style={{...S.mbox,maxWidth:600}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><h3 style={{fontSize:18,fontWeight:800,margin:0}}>Agregar Vehículo</h3><button onClick={()=>{setShowAddVehicle(false);setNewVehicleForm(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:18}}>✕</button></div>
        <datalist id="dl-colors">{uniqueFromInventory(cars, "co").map(v => <option key={v} value={v} />)}</datalist>
        <datalist id="dl-years">{uniqueFromInventory(cars, "y").map(v => <option key={v} value={v} />)}</datalist>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 12px"}}>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Placa *</div><input value={newVehicleForm.plate||""} onChange={e=>setNewVehicleForm(prev=>({...prev,plate:e.target.value.toUpperCase()}))} onBlur={e=>setNewVehicleForm(prev=>({...prev,plate:formatPlate(e.target.value)}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Marca</div>
            <SmartDropdown
              value={newVehicleForm.brand||""}
              onChange={val => setNewVehicleForm(prev => ({...prev, brand: val}))}
              options={brandOptions(cars)}
              upperCase={true}
              style={{...S.sel,width:"100%",fontSize:12}}
              styleInp={{...S.inp,width:"100%",fontSize:12}}
            />
          </div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Modelo</div>
            <SmartDropdown
              value={newVehicleForm.model||""}
              onChange={val => setNewVehicleForm(prev => ({...prev, model: val}))}
              options={uniqueFromInventory(cars, "m")}
              upperCase={true}
              style={{...S.sel,width:"100%",fontSize:12}}
              styleInp={{...S.inp,width:"100%",fontSize:12}}
            />
          </div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Año</div><input list="dl-years" type="number" value={newVehicleForm.year||""} onChange={e=>setNewVehicleForm(prev=>({...prev,year:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Color</div><input list="dl-colors" value={newVehicleForm.color||""} onChange={e=>setNewVehicleForm(prev=>({...prev,color:e.target.value.toUpperCase()}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Kilometraje</div><input type="number" value={newVehicleForm.km||""} onChange={e=>setNewVehicleForm(prev=>({...prev,km:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Tracción</div><select value={newVehicleForm.drive||""} onChange={e=>setNewVehicleForm(prev=>({...prev,drive:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{DRIVETRAIN_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Combustible</div><select value={newVehicleForm.fuel||""} onChange={e=>setNewVehicleForm(prev=>({...prev,fuel:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div><input type="number" value={newVehicleForm.engine_cc||""} onChange={e=>{const val=e.target.value;setNewVehicleForm(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Pasajeros</div><input type="number" value={newVehicleForm.passengers||""} onChange={e=>setNewVehicleForm(prev=>({...prev,passengers:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div style={{gridColumn:"1/3"}}><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Serie/Chasis</div><input value={newVehicleForm.chassis||""} onChange={e=>setNewVehicleForm(prev=>({...prev,chassis:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Fecha compra</div><input type="date" value={newVehicleForm.entry_date||""} onChange={e=>setNewVehicleForm(prev=>({...prev,entry_date:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Costo compra (₡)</div><input type="number" value={newVehicleForm.purchase_cost||""} onChange={e=>setNewVehicleForm(prev=>({...prev,purchase_cost:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Tipo cambio (ref.)</div><input type="number" value={newVehicleForm.exchange_rate||""} onChange={e=>setNewVehicleForm(prev=>({...prev,exchange_rate:e.target.value}))} placeholder="Ej: 530" style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta (₡)</div><input type="number" value={newVehicleForm.price_crc||""} onChange={e=>setNewVehicleForm(prev=>({...prev,price_crc:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estilo</div><select value={newVehicleForm.style||""} onChange={e=>{const val=e.target.value;setNewVehicleForm(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{["SUV","SEDAN","PICK UP","HATCHBACK","COUPE","FAMILIAR","TODOTERRENO","MICROBUS"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estado</div><select value={newVehicleForm.status||"disponible"} onChange={e=>setNewVehicleForm(prev=>({...prev,status:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="disponible">Disponible</option><option value="reservado">Reservado</option></select></div>
          <div style={{gridColumn:"1/3"}}><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Código CABYS *</div><select value={newVehicleForm.cabys_code||""} onChange={e=>setNewVehicleForm(prev=>({...prev,cabys_code:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar CABYS</option>{CABYS_VEHICLES.map(c=><option key={c.code} value={c.code}>{c.code} - {c.label}</option>)}</select></div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}><button onClick={()=>{setShowAddVehicle(false);setNewVehicleForm(null);}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button><button onClick={saveNewVehicle} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none",padding:"10px 24px"}}>Guardar vehículo</button></div>
      </div></div>)}
    </div>);
  };

  const renderFac = () => {
    const fList = invoices.filter(x => {
      if (fType!=="all" && catType(x.catId)!==fType) return false;
      if (fCat!=="all" && x.catId!==fCat) return false;
      if (fPay!=="all" && x.payStatus!==fPay) return false;
      if (fAssign!=="all" && x.assignStatus!==fAssign) return false;
      if (fMethod!=="all" && x.payCode!==fMethod) return false;
      if (fCurrency!=="all" && x.currency!==fCurrency) return false;
      if (fDateFrom && x.date && x.date.split('T')[0] < fDateFrom) return false;
      if (fDateTo && x.date && x.date.split('T')[0] > fDateTo) return false;
      return true;
    });
    return (
      <div>
        <h1 style={{fontSize:24,fontWeight:800,marginBottom:16}}>Facturas</h1>
        <div style={{display:"flex",gap:12,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={syncGmail} disabled={syncing} style={{...S.sel,background:syncing?"#1e2130":"#4f8cff18",color:syncing?"#8b8fa4":"#4f8cff",fontWeight:600,padding:"10px 20px"}}>
            {syncing?"Sincronizando...":"Sincronizar Gmail"}
          </button>
          <button onClick={async ()=>{
            const rows = [];
            for (const inv of fList) {
              const { data: dbInv } = await supabase.from('invoices').select('*').eq('xml_key', inv.key).single();
              if (!dbInv) continue;
              const { data: lines } = await supabase.from('invoice_lines').select('*').eq('invoice_id', dbInv.id).order('line_number');
              const cat = CATS.find(c => c.id === inv.catId);
              const alegraName = cat?.a || dbInv.alegra_category || 'Otros Gastos';
              const idTypeMap = {"01":"Cédula Física","02":"Cédula Jurídica","03":"DIMEX","04":"NITE"};
              const idTypeLabel = idTypeMap[dbInv.supplier_id_type] || dbInv.supplier_id_type || '';
              const base = {"FECHA DE EMISIÓN":dbInv.emission_date?new Date(dbInv.emission_date).toLocaleDateString("es-CR"):"","CÓDIGO":dbInv.consecutive||"","ESTADO":dbInv.pay_status==="paid"?"Pagado":"Por pagar","ESTADO LEGAL":"","BODEGA":"Principal","CENTRO DE COSTO":"","ÓRDENES DE COMPRA ASOCIADAS":"","PROVEEDOR - NOMBRE":dbInv.supplier_name||"","PROVEEDOR - TIPO DE IDENTIFICACIÓN":idTypeLabel,"PROVEEDOR - IDENTIFICACIÓN":dbInv.supplier_id||"","PROVEEDOR - OTRAS SEÑAS":dbInv.supplier_address||"","PROVEEDOR - TELÉFONO":dbInv.supplier_phone||"","PROVEEDOR - CANTÓN":dbInv.supplier_canton||"","VENCIMIENTO":dbInv.due_date?new Date(dbInv.due_date).toLocaleDateString("es-CR"):"","MONEDA":dbInv.currency||"CRC","TASA DE CAMBIO":dbInv.exchange_rate||1};
              if (lines && lines.length > 0) {
                for (const line of lines) rows.push({...base,"ÍTEM - NOMBRE":alegraName,"ÍTEM - OBSERVACIONES":line.description||"","ÍTEM - REFERENCIA":"","ÍTEM - CANTIDAD":line.quantity||1,"ÍTEM - PRECIO":line.unit_price||0,"ÍTEM - DESCUENTO (%)":line.discount_pct||0,"ÍTEM - IMPUESTO":line.tax_code==="01"?"IVA":"","ÍTEM - IMPUESTO (%)":line.tax_rate||0,"ÍTEM - IMPUESTO (VALOR)":line.tax_amount||0,"ÍTEM - TOTAL":line.line_total||0,"ÍTEM - SUBTOTAL":line.subtotal||0,"TOTAL - FACTURA DE VENTA":dbInv.total||0});
              } else rows.push({...base,"ÍTEM - NOMBRE":alegraName,"ÍTEM - OBSERVACIONES":"","ÍTEM - REFERENCIA":"","ÍTEM - CANTIDAD":1,"ÍTEM - PRECIO":dbInv.subtotal||0,"ÍTEM - DESCUENTO (%)":0,"ÍTEM - IMPUESTO":"IVA","ÍTEM - IMPUESTO (%)":13,"ÍTEM - IMPUESTO (VALOR)":dbInv.tax_total||0,"ÍTEM - TOTAL":dbInv.total||0,"ÍTEM - SUBTOTAL":dbInv.subtotal||0,"TOTAL - FACTURA DE VENTA":dbInv.total||0});
            }
            if (rows.length > 0) exportXLS(rows,"Facturas_Alegra_VCR");
          }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Alegra</button>
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
            <select value={fMethod} onChange={e=>setFMethod(e.target.value)} style={S.sel}><option value="all">Medio pago</option><option value="01">Efectivo</option><option value="02">Tarjeta</option><option value="04">Transferencia</option><option value="03">Cheque</option><option value="99">Otros</option></select>
            <select value={fCurrency} onChange={e=>setFCurrency(e.target.value)} style={S.sel}><option value="all">Moneda</option><option value="CRC">₡ Colones</option><option value="USD">$ Dólares</option></select>
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="date" value={fDateFrom} onChange={e=>setFDateFrom(e.target.value)} style={{...S.sel,fontSize:11,padding:"6px 8px",color:fDateFrom?"#e8eaf0":"#8b8fa4"}} />
              <span style={{color:"#8b8fa4",fontSize:11}}>a</span>
              <input type="date" value={fDateTo} onChange={e=>setFDateTo(e.target.value)} style={{...S.sel,fontSize:11,padding:"6px 8px",color:fDateTo?"#e8eaf0":"#8b8fa4"}} />
              {(fDateFrom||fDateTo)&&<button onClick={()=>{setFDateFrom("");setFDateTo("");}} style={{background:"none",border:"none",color:"#e11d48",cursor:"pointer",fontSize:13,padding:"2px 6px"}}>✕</button>}
            </div>
          </div>
          {/* Payment method summary */}
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",fontSize:11}}>
            {[["01","Efectivo","#10b981"],["02","Tarjeta","#f97316"],["04","Transfer.","#4f8cff"],["03","Cheque","#8b5cf6"],["99","Otros","#8b8fa4"]].map(([code,label,color])=>{
              const items = fList.filter(x=>x.payCode===code);
              if (items.length===0) return null;
              const totalCRC = items.filter(x=>x.currency!=="USD").reduce((s,x)=>s+x.total,0);
              const totalUSD = items.filter(x=>x.currency==="USD").reduce((s,x)=>s+x.total,0);
              return (<div key={code} onClick={()=>setFMethod(fMethod===code?"all":code)} style={{padding:"6px 12px",background:fMethod===code?color+"20":"#1e2130",borderRadius:8,cursor:"pointer",border:`1px solid ${fMethod===code?color+"40":"#2a2d3d"}`}}>
                <span style={{color,fontWeight:700}}>{label}</span>
                <span style={{color:"#8b8fa4",marginLeft:6}}>({items.length})</span>
                {totalCRC > 0 && <span style={{marginLeft:6,fontWeight:600}}>{fmt(totalCRC)}</span>}
                {totalUSD > 0 && <span style={{marginLeft:6,fontWeight:600,color:"#10b981"}}>{fmt(totalUSD,"USD")}</span>}
              </div>);
            })}
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
                  {x.alegraSyncStatus==="synced"&&<span style={S.badge("#10b981")}>✓ Alegra #{x.alegraBillId}</span>}
                  {x.alegraSyncStatus==="synced_no_pdf"&&<span style={S.badge("#f59e0b")}>✓ Alegra #{x.alegraBillId} (sin PDF)</span>}
                  {x.alegraSyncStatus==="synced_manual"&&<span style={S.badge("#64748b")}>✓ Alegra (manual)</span>}
                  {x.alegraSyncStatus==="syncing"&&<span style={S.badge("#4f8cff")}>⏳ Enviando...</span>}
                  {x.alegraSyncStatus==="error"&&<span style={S.badge("#e11d48")} title={x.alegraSyncError||""}>✗ Error Alegra</span>}
                </div>
                </div>
                {x.alegraSyncStatus!=="synced"&&x.alegraSyncStatus!=="synced_no_pdf"&&x.alegraSyncStatus!=="synced_manual"&&x.alegraSyncStatus!=="syncing"&&x.alegraAccountId&&(
                  <button
                    onClick={(e)=>{e.stopPropagation();syncInvoiceToAlegra(x.dbId,x.supName);}}
                    style={{...S.sel,fontSize:11,padding:"6px 10px",background:"#4f8cff18",color:"#4f8cff",fontWeight:600,flexShrink:0,cursor:"pointer"}}
                    title="Enviar esta factura a Alegra"
                  >
                    → Alegra
                  </button>
                )}
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
    const totalVehicleCosts = plates.reduce((s,p) => s + costsByPlate[p].total, 0);
    const totalOpCosts = opCosts.reduce((s,i) => s + i.total, 0);
    // Only show cost-type invoices in unassigned (not gastos)
    const unassignedCosts = unassigned.filter(i => catType(i.catId) === "costo" || i.catId === "otro");

    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h1 style={{fontSize:24,fontWeight:800}}>Costos</h1>
          <button onClick={()=>{
            const rows = [];
            plates.forEach(plate=>{const car=cars.find(c=>c.p===plate);costsByPlate[plate].items.forEach(inv=>{rows.push({"Placa":plate,"Vehículo":car?`${car.b} ${car.m} ${car.y}`:"","Proveedor":supDisplay(inv),"Categoría":catLabel(inv.catId),"Fecha":inv.date,"Total":inv.total,"Moneda":inv.currency||"CRC","Estado":inv.payStatus==="paid"?"Pagada":"Pendiente"});});});
            opCosts.forEach(inv=>{rows.push({"Placa":"OPERATIVO","Vehículo":"","Proveedor":supDisplay(inv),"Categoría":catLabel(inv.catId),"Fecha":inv.date,"Total":inv.total,"Moneda":inv.currency||"CRC","Estado":inv.payStatus==="paid"?"Pagada":"Pendiente"});});
            exportXLS(rows,"Costos_VCR");
          }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
        </div>

        {/* Summary cards */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
          <div onClick={()=>setCostView("vehicles")} style={{...S.card,padding:"14px 18px",cursor:"pointer",border:costView==="vehicles"?"1px solid #4f8cff":"1px solid #2a2d3d"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Por vehículo ({plates.length})</div>
            <div style={{fontSize:20,fontWeight:800,color:"#e11d48"}}>{fmt(totalVehicleCosts)}</div>
          </div>
          <div onClick={()=>setCostView("operational")} style={{...S.card,padding:"14px 18px",cursor:"pointer",border:costView==="operational"?"1px solid #4f8cff":"1px solid #2a2d3d"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Operativos ({opCosts.length})</div>
            <div style={{fontSize:20,fontWeight:800,color:"#f97316"}}>{fmt(totalOpCosts)}</div>
          </div>
          <div onClick={()=>setCostView("unassigned")} style={{...S.card,padding:"14px 18px",cursor:"pointer",border:costView==="unassigned"?"1px solid #4f8cff":"1px solid #2a2d3d"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Sin asignar</div>
            <div style={{fontSize:20,fontWeight:800,color:"#8b8fa4"}}>{unassignedCosts.length}</div>
          </div>
        </div>

        {/* VEHICLES TABLE */}
        {costView==="vehicles"&&(plates.length===0 ? (
          <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay facturas asignadas a vehículos</div>
        ) : (
          <div style={S.card}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"#1e2130"}}>
                {["Vehículo","Placa","Facturas","Total",""].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:h==="Total"?"right":(h===""?"center":"left"),fontSize:10,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"2px solid #2a2d3d"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {plates.map(plate => {
                  const car = cars.find(c=>c.p===plate);
                  const data = costsByPlate[plate];
                  const isOpen = costExpanded === plate;
                  return (
                    <React.Fragment key={plate}>
                      <tr onClick={()=>setCostExpanded(isOpen?null:plate)} style={{cursor:"pointer",borderBottom:"1px solid #2a2d3d"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                        <td style={{padding:"10px 14px",fontWeight:600,fontSize:13}}>
                          {car ? `${car.b} ${car.m} ${car.y}` : plate}
                          {car && car.s === "vendido" && <span style={{...S.badge("#10b981"),marginLeft:8,fontSize:9}}>Vendido</span>}
                        </td>
                        <td style={{padding:"10px 14px",fontSize:12,color:"#8b8fa4"}}>{plate}</td>
                        <td style={{padding:"10px 14px",fontSize:12}}>{data.items.length}</td>
                        <td style={{padding:"10px 14px",textAlign:"right",fontWeight:700,fontSize:14,color:"#e11d48"}}>{fmt(data.total)}</td>
                        <td style={{padding:"10px 14px",textAlign:"center",color:"#8b8fa4",fontSize:12}}>{isOpen?"▲":"▼"}</td>
                      </tr>
                      {isOpen && data.items.map((inv,j) => (
                        <tr key={j} onClick={()=>openInvoice(inv)} style={{cursor:"pointer",background:"#1e2130",borderBottom:"1px solid #2a2d3d"}}
                          onMouseEnter={e=>e.currentTarget.style.background="#252840"} onMouseLeave={e=>e.currentTarget.style.background="#1e2130"}>
                          <td style={{padding:"8px 14px 8px 30px",fontSize:12}}>
                            <div style={{fontWeight:600}}>{supDisplay(inv)}</div>
                            <div style={{fontSize:10,color:"#8b8fa4"}}>{catLabel(inv.catId)}</div>
                          </td>
                          <td style={{padding:"8px 14px",fontSize:11,color:"#8b8fa4"}}>{inv.date ? new Date(inv.date).toLocaleDateString("es-CR") : ""}</td>
                          <td style={{padding:"8px 14px"}}><span style={S.badge(inv.payStatus==="paid"?"#10b981":"#f59e0b")}>{inv.payStatus==="paid"?"Pagada":"Pendiente"}</span></td>
                          <td style={{padding:"8px 14px",textAlign:"right",fontWeight:600,fontSize:12,color:inv.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(inv.total,inv.currency==="USD"?"USD":undefined)}</td>
                          <td></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {/* OPERATIONAL */}
        {costView==="operational"&&(opCosts.length===0 ? (
          <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay costos operativos</div>
        ) : (
          <div style={S.card}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"#1e2130"}}>
                {["Proveedor","Categoría","Fecha","Monto"].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:h==="Monto"?"right":"left",fontSize:10,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"2px solid #2a2d3d"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {opCosts.map((inv,i)=>(
                  <tr key={i} onClick={()=>openInvoice(inv)} style={{cursor:"pointer",borderBottom:"1px solid #2a2d3d"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <td style={{padding:"10px 14px",fontSize:12,fontWeight:600}}>{supDisplay(inv)}</td>
                    <td style={{padding:"10px 14px",fontSize:12,color:"#8b8fa4"}}>{catLabel(inv.catId)}</td>
                    <td style={{padding:"10px 14px",fontSize:12,color:"#8b8fa4"}}>{inv.date ? new Date(inv.date).toLocaleDateString("es-CR") : ""}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",fontWeight:600,color:inv.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(inv.total,inv.currency==="USD"?"USD":undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* UNASSIGNED - only cost-type invoices */}
        {costView==="unassigned"&&(unassignedCosts.length===0 ? (
          <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay costos sin asignar</div>
        ) : (
          <div style={S.card}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr style={{background:"#1e2130"}}>
                {["Proveedor","Categoría","Fecha","Placa detectada","Monto"].map(h=>(
                  <th key={h} style={{padding:"10px 14px",textAlign:h==="Monto"?"right":"left",fontSize:10,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"2px solid #2a2d3d"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {unassignedCosts.map((inv,i)=>(
                  <tr key={i} onClick={()=>openInvoice(inv)} style={{cursor:"pointer",borderBottom:"1px solid #2a2d3d"}}
                    onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background=""}>
                    <td style={{padding:"10px 14px",fontSize:12,fontWeight:600}}>{supDisplay(inv)}</td>
                    <td style={{padding:"10px 14px",fontSize:12,color:"#8b8fa4"}}>{catLabel(inv.catId)}</td>
                    <td style={{padding:"10px 14px",fontSize:12,color:"#8b8fa4"}}>{inv.date ? new Date(inv.date).toLocaleDateString("es-CR") : ""}</td>
                    <td style={{padding:"10px 14px",fontSize:12}}>{inv.warnPlate ? <span style={{color:"#f59e0b"}}>⚠ {inv.warnPlate}</span> : <span style={{color:"#8b8fa4"}}>-</span>}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",fontWeight:600,color:inv.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(inv.total,inv.currency==="USD"?"USD":undefined)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  };

  const renderCli = () => {
    return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <h1 style={{fontSize:24,fontWeight:800}}>Clientes</h1>
        <button onClick={()=>{
          const rows = clients.map(c=>({Nombre:c.n,Cédula:c.ce||"",Teléfono:c.ph||"","Teléfono 2":c.ph2||"",Email:c.em||"",Dirección:c.ad||"",Trabajo:c.wk||"",Oficio:c.jo||"","Estado Civil":c.ci||"",Compras:c.bu.length}));
          exportXLS(rows,"Clientes_VCR");
        }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
      </div>
      {selectedClis.size > 0 && (
        <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:600,color:"#4f8cff"}}>{selectedClis.size} seleccionado{selectedClis.size!==1?"s":""}</span>
          <button onClick={()=>{
            const rows = clients.filter((_,i)=>selectedClis.has(i)).map(c=>({Nombre:c.n,Cédula:c.ce||"",Teléfono:c.ph||"","Teléfono 2":c.ph2||"",Email:c.em||"",Dirección:c.ad||"",Trabajo:c.wk||"",Oficio:c.jo||"","Estado Civil":c.ci||"",Compras:c.bu.length}));
            exportXLS(rows,"Clientes_Seleccionados_VCR");
          }} style={{...S.sel,fontSize:11,padding:"6px 12px",background:"#10b98118",color:"#10b981",fontWeight:600}}>Exportar selección</button>
          <button onClick={()=>setSelectedClis(new Set())} style={{...S.sel,fontSize:11,padding:"6px 12px",color:"#8b8fa4"}}>Deseleccionar</button>
        </div>
      )}
      {clients.length===0?(<div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay clientes. Los clientes se generan automáticamente al crear planes de venta.</div>):(
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
        {clients.map((c,i)=><div key={i} style={{...S.card,padding:"16px 20px",cursor:"pointer",border:selectedClis.has(i)?"1px solid #4f8cff":"1px solid #2a2d3d"}} onMouseEnter={e=>e.currentTarget.style.background="#1e2130"} onMouseLeave={e=>e.currentTarget.style.background="#181a23"}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div onClick={()=>setPickedCli(c)} style={{flex:1}}>
              <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{c.n}</div>
              <div style={{fontSize:12,color:"#8b8fa4"}}>{c.ce} · {c.ph}</div>
              {c.em&&<div style={{fontSize:11,color:"#8b8fa4"}}>{c.em}</div>}
            </div>
            <input type="checkbox" checked={selectedClis.has(i)} onChange={()=>{setSelectedClis(prev=>{const n=new Set(prev);if(n.has(i))n.delete(i);else n.add(i);return n;});}} onClick={e=>e.stopPropagation()} style={{cursor:"pointer",marginTop:4}} />
          </div>
          {c.bu.length>0&&<div style={{marginTop:8,display:"flex",gap:6}} onClick={()=>setPickedCli(c)}>
            <span style={S.badge("#10b981")}>{c.bu.length} compra{c.bu.length>1?"s":""}</span>
            <span style={S.badge("#4f8cff")}>{fmt(c.bu.reduce((s,b)=>s+(b.pr||0),0),"USD")}</span>
          </div>}
        </div>)}
      </div>)}

      {pickedCli&&<div style={S.modal} onClick={()=>{setPickedCli(null);setEditingClient(null);}}><div style={{...S.mbox,maxWidth:550}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}>
          <div><h2 style={{fontSize:20,fontWeight:800,margin:0}}>{pickedCli.n}</h2><p style={{fontSize:13,color:"#8b8fa4",margin:"4px 0 0"}}>{pickedCli.ce}</p></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            {!editingClient && <button onClick={()=>setEditingClient({n:pickedCli.n||"",ce:pickedCli.ce||"",ph:pickedCli.ph||"",ph2:pickedCli.ph2||"",em:pickedCli.em||"",ad:pickedCli.ad||"",wk:pickedCli.wk||"",jo:pickedCli.jo||"",ci:pickedCli.ci||""})} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,fontSize:12}}>Editar</button>}
            <button onClick={()=>{setPickedCli(null);setEditingClient(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:20}}>✕</button>
          </div>
        </div>

        {editingClient ? (
          <div>
            <div style={{fontSize:12,color:"#f59e0b",marginBottom:10,padding:"8px 12px",background:"#f59e0b10",borderRadius:6}}>
              ⓘ Los cambios se aplicarán a todas las ventas de este cliente
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 12px",marginBottom:14}}>
              {[["Nombre *","n"],["Cédula","ce"],["Teléfono 1","ph"],["Teléfono 2","ph2"],["Email","em"],["Trabajo","wk"],["Oficio","jo"],["Estado civil","ci"]].map(([l,k])=>(
                <div key={k}>
                  <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>{l}</div>
                  <input value={editingClient[k]||""} onChange={e=>setEditingClient(prev=>({...prev,[k]:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                </div>
              ))}
              <div style={{gridColumn:"1/3"}}>
                <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Dirección</div>
                <input value={editingClient.ad||""} onChange={e=>setEditingClient(prev=>({...prev,ad:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setEditingClient(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
              <button onClick={()=>{
                if (!editingClient.n) { alert("El nombre es requerido"); return; }
                updateClient(pickedCli, editingClient);
              }} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Guardar</button>
            </div>
          </div>
        ) : (
          <>
            <div style={S.g2}>{[["Teléfono",pickedCli.ph],["Teléfono 2",pickedCli.ph2],["Email",pickedCli.em],["Dirección",pickedCli.ad],["Trabajo",pickedCli.wk],["Oficio",pickedCli.jo],["Estado civil",pickedCli.ci]].filter(([,v])=>v).map(([l,v],i)=><div key={i} style={S.gc}><div style={S.gl}>{l}</div><div style={S.gv}>{v}</div></div>)}</div>
            {pickedCli.bu.length>0&&<div>
              <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Historial de compras</div>
              {pickedCli.bu.map((b,i)=><div key={i} style={{padding:"10px 14px",background:"#1e2130",borderRadius:8,marginBottom:6,display:"flex",justifyContent:"space-between",fontSize:12}}>
                <div><div style={{fontWeight:600}}>{b.v}</div><div style={{color:"#8b8fa4",fontSize:11}}>{b.pl} · {b.d?new Date(b.d+"T12:00:00").toLocaleDateString("es-CR"):""}</div></div>
                <div style={{textAlign:"right"}}><span style={{fontWeight:700,color:"#4f8cff"}}>{fmt(b.pr,"USD")}</span><div><span style={S.badge(b.st==="aprobada"?"#10b981":b.st==="rechazada"?"#e11d48":"#f59e0b")}>{b.st==="aprobada"?"Aprobada":b.st==="rechazada"?"Rechazada":"Pendiente"}</span></div></div>
              </div>)}
            </div>}
          </>
        )}
      </div></div>}
    </div>);
  };

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
          <input
            list={opts.list || undefined}
            value={F[key] || ""}
            onChange={e => {
              const val = opts.upperCase ? e.target.value.toUpperCase() : e.target.value;
              uf(key, val);
              if (opts.onChange) opts.onChange(val);
            }}
            onBlur={opts.onBlur ? e => {
              const val = opts.onBlur(e.target.value);
              if (val !== undefined) uf(key, val);
            } : undefined}
            placeholder={opts.ph || ""}
            type={opts.inputType || "text"}
            style={{ ...S.inp, width: "100%" }}
          />
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
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{
                const rows = filteredSales.map(s=>({"#":s.sale_number,"Fecha":s.sale_date,"Estado":s.status==="aprobada"?"Aprobada":s.status==="rechazada"?"Rechazada":"Pendiente","Cliente":s.client_name,"Cédula":s.client_cedula,"Teléfono":s.client_phone1,"Vehículo":`${s.vehicle_brand} ${s.vehicle_model} ${s.vehicle_year}`,"Placa":s.vehicle_plate,"Tipo":s.sale_type==="propio"?"Propio":s.sale_type==="consignacion_grupo"?"Consig. Grupo 1%":"Consig. Externa 5%","Precio USD":s.sale_price,"Trade-in":s.tradein_amount||0,"Prima":s.down_payment||0,"Depósitos":s.deposits_total||0,"Saldo":s.total_balance,"Método Pago":s.payment_method||"","Observaciones":s.observations||""}));
                exportXLS(rows,"Ventas_VCR");
              }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
              <button onClick={() => { setSaleForm(emptySaleForm()); setSalesView("form"); }} style={{ ...S.sel, background: "#4f8cff18", color: "#4f8cff", fontWeight: 600, padding: "10px 20px" }}>
              + Nuevo Plan de Ventas
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["all", "Todas"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"]].map(([v, l]) => (
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
                      <span style={S.badge(s.status === "aprobada" ? "#10b981" : s.status === "rechazada" ? "#e11d48" : "#f59e0b")}>
                        {s.status === "aprobada" ? "Aprobada" : s.status === "rechazada" ? "Rechazada" : "Pendiente"}
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
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>{editingSaleId ? "Corregir Plan de Ventas" : "Nuevo Plan de Ventas"}</h1>
            <button onClick={() => { setSalesView("list"); setSaleForm(null); }} style={{ ...S.sel, color: "#8b8fa4" }}>Cancelar</button>
          </div>

          {/* CLIENT INFO */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Datos del Cliente</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Tipo de identificación *", "client_id_type", { type: "select", options: [{v:"fisica",l:"Cédula Física"},{v:"juridica",l:"Cédula Jurídica"},{v:"dimex",l:"DIMEX"},{v:"extranjero",l:"Extranjero/Pasaporte"}] })}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Número de identificación *</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={F.client_cedula || ""}
                    onChange={e => {
                      // Quitar espacios y guiones, mayusculas
                      const clean = e.target.value.replace(/[\s-]/g, "").toUpperCase();
                      uf("client_cedula", clean);
                    }}
                    placeholder="Sin espacios ni guiones"
                    style={{ ...S.inp, flex: 1 }}
                  />
                  <button
                    onClick={searchClient}
                    disabled={searchingClient}
                    title="Buscar cliente en Alegra"
                    style={{
                      ...S.sel,
                      background: searchingClient ? "#1e2130" : "#4f8cff18",
                      color: searchingClient ? "#8b8fa4" : "#4f8cff",
                      fontWeight: 600,
                      cursor: searchingClient ? "not-allowed" : "pointer",
                      padding: "8px 14px",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {searchingClient ? "⏳..." : "🔍 Buscar"}
                  </button>
                </div>
              </div>
              {fld("Nombre del cliente *", "client_name", { full: true, upperCase: true })}
              {fld("Teléfono 1", "client_phone1", { onChange: (val) => {
                const digits = val.replace(/\D/g, "");
                if (digits.length === 8 && !val.includes("-")) uf("client_phone1", `${digits.slice(0,4)}-${digits.slice(4)}`);
              }})}
              {fld("Teléfono 2", "client_phone2", { onChange: (val) => {
                const digits = val.replace(/\D/g, "");
                if (digits.length === 8 && !val.includes("-")) uf("client_phone2", `${digits.slice(0,4)}-${digits.slice(4)}`);
              }})}
              {fld("Email", "client_email", { onChange: (val) => {
                const lower = val.toLowerCase();
                if (lower !== val) uf("client_email", lower);
              }})}
              {fld("Lugar de trabajo", "client_workplace")}
              {fld("Oficio", "client_occupation")}
              {fld("Estado civil", "client_civil_status", { type: "select", options: [{ v: "Soltero/a", l: "Soltero/a" }, { v: "Casado/a", l: "Casado/a" }, { v: "Divorciado/a", l: "Divorciado/a" }, { v: "Viudo/a", l: "Viudo/a" }, { v: "Unión libre", l: "Unión libre" }] })}
              {fld("Dirección exacta", "client_address", { full: true })}
            </div>
          </div>

          {/* VEHICLE BEING SOLD */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Vehículo que Compra</div>
            <datalist id="dl-sale-colors">{uniqueFromInventory(cars, "co").map(v => <option key={v} value={v} />)}</datalist>
            <datalist id="dl-sale-years">{uniqueFromInventory(cars, "y").map(v => <option key={v} value={v} />)}</datalist>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Seleccionar del inventario</div>
              <select value={F.vehicle_plate || ""} onChange={e => selectVehicleForSale(e.target.value)} style={{ ...S.sel, width: "100%" }}>
                <option value="">Seleccionar vehículo</option>
                {cars.filter(c => c.s === "disponible").map(c => <option key={c.p} value={c.p}>{c.p} - {c.b} {c.m} {c.y} - {fmt(c.usd, "USD")}</option>)}
                <option value="__OTRO__">➕ Otro (carro no listado)</option>
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Placa", "vehicle_plate", { upperCase: true, onBlur: formatPlate })}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Marca</div>
                <SmartDropdown
                  value={F.vehicle_brand||""}
                  onChange={val => uf("vehicle_brand", val)}
                  options={brandOptions(cars)}
                  upperCase={true}
                  style={{...S.sel, width: "100%"}}
                  styleInp={{...S.inp, width: "100%"}}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Modelo</div>
                <SmartDropdown
                  value={F.vehicle_model||""}
                  onChange={val => uf("vehicle_model", val)}
                  options={uniqueFromInventory(cars, "m")}
                  upperCase={true}
                  style={{...S.sel, width: "100%"}}
                  styleInp={{...S.inp, width: "100%"}}
                />
              </div>
              {fld("Estilo", "vehicle_style", { type: "select", options: [{v:"SUV",l:"SUV"},{v:"SEDAN",l:"SEDAN"},{v:"PICK UP",l:"PICK UP"},{v:"HATCHBACK",l:"HATCHBACK"},{v:"COUPE",l:"COUPE"},{v:"FAMILIAR",l:"FAMILIAR"},{v:"TODOTERRENO",l:"TODOTERRENO"},{v:"MICROBUS",l:"MICROBUS"}] })}
              {fld("Año", "vehicle_year", { inputType: "number", list: "dl-sale-years" })}
              {fld("Color", "vehicle_color", { list: "dl-sale-colors", upperCase: true })}
              {fld("Kilometraje", "vehicle_km", { inputType: "number" })}
              {fld("Tracción", "vehicle_drive", { type: "select", options: DRIVETRAIN_OPTIONS.map(o=>({v:o,l:o})) })}
              {fld("Combustible", "vehicle_fuel", { type: "select", options: FUEL_OPTIONS.map(o=>({v:o,l:o})) })}
              {fld("Cilindrada (CC)", "vehicle_engine_cc", { inputType: "number" })}
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
                Ingreso por comisión: {F.sale_type === "consignacion_grupo" ? "1%" : "5%"} = {fmt((parseFloat(F.sale_price) || 0) * (F.sale_type === "consignacion_grupo" ? 0.01 : 0.05), F.sale_currency === "CRC" ? undefined : "USD")}
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
                {fld("Placa", "tradein_plate", { upperCase: true, onBlur: formatPlate })}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Marca</div>
                  <SmartDropdown
                    value={F.tradein_brand||""}
                    onChange={val => uf("tradein_brand", val)}
                    options={brandOptions(cars)}
                    upperCase={true}
                    style={{...S.sel, width: "100%"}}
                    styleInp={{...S.inp, width: "100%"}}
                  />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Modelo</div>
                  <SmartDropdown
                    value={F.tradein_model||""}
                    onChange={val => uf("tradein_model", val)}
                    options={uniqueFromInventory(cars, "m")}
                    upperCase={true}
                    style={{...S.sel, width: "100%"}}
                    styleInp={{...S.inp, width: "100%"}}
                  />
                </div>
                {fld("Año", "tradein_year", { inputType: "number" })}
                {fld("Color", "tradein_color", { upperCase: true })}
                {fld("Kilometraje", "tradein_km", { inputType: "number" })}
                {fld("Tracción", "tradein_drive", { type: "select", options: DRIVETRAIN_OPTIONS.map(o=>({v:o,l:o})) })}
                {fld("Combustible", "tradein_fuel", { type: "select", options: FUEL_OPTIONS.map(o=>({v:o,l:o})) })}
                {fld(`Valor del trade-in (${F.sale_currency === "CRC" ? "₡" : "$"})`, "tradein_value", { inputType: "number" })}
              </div>
            )}
          </div>

          {/* CONDITIONS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Condiciones de Venta</div>

            {/* Selector de moneda */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 6 }}>Moneda de la operación</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[["USD", "Dólares ($)"], ["CRC", "Colones (₡)"]].map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => {
                      if (F.sale_currency === v) return;
                      // Al cambiar moneda: limpiar TODOS los campos monetarios (Opcion C)
                      if (F.sale_currency && F.sale_currency !== v) {
                        const conf = window.confirm(
                          "Cambiar la moneda limpiará todos los campos monetarios del plan.\n\n¿Continuar?"
                        );
                        if (!conf) return;
                      }
                      setSaleForm(prev => ({
                        ...prev,
                        sale_currency: v,
                        sale_price: "",
                        tradein_amount: 0,
                        down_payment: 0,
                        deposit_signal: 0,
                        transfer_amount: "",
                        tradein_value: 0,
                        financing_amount: "",
                        deposits: [{ bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }],
                      }));
                    }}
                    style={{
                      ...S.sel, flex: 1, textAlign: "center",
                      background: F.sale_currency === v ? (v === "USD" ? "#10b98120" : "#4f8cff20") : "#1e2130",
                      color: F.sale_currency === v ? (v === "USD" ? "#10b981" : "#4f8cff") : "#8b8fa4",
                      fontWeight: F.sale_currency === v ? 700 : 400,
                    }}
                  >{l}</button>
                ))}
              </div>
            </div>

            {(() => {
              const curSym = F.sale_currency === "CRC" ? "₡" : "$";
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
                    {fld(`Precio de venta (${curSym}) *`, "sale_price", { inputType: "number" })}
                    {fld(F.sale_currency === "CRC" ? "Tipo de cambio ref. ($)" : "Tipo de cambio ref. (₡)", "sale_exchange_rate", { inputType: "number", ph: "Ej: 520" })}
                    {fld(`Vehículo recibido (${curSym})`, "tradein_amount", { inputType: "number" })}
                    {fld(`Prima (${curSym})`, "down_payment", { inputType: "number" })}
                    {fld(`Señal de trato (${curSym})`, "deposit_signal", { inputType: "number" })}
                  </div>
                  <div style={{ background: "#1e2130", borderRadius: 10, padding: "12px 16px", marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#8b8fa4" }}>Saldo total:</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#4f8cff" }}>{fmt(balance, F.sale_currency === "CRC" ? undefined : "USD")}</span>
                  </div>
                </>
              );
            })()}
          </div>

          {/* PAYMENT + DEPOSITS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Forma de Pago</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Forma de pago", "payment_method", { type: "select", options: [{ v: "Contado", l: "Contado" }, { v: "Financiamiento", l: "Financiamiento" }, { v: "Mixto", l: "Mixto" }] })}
              {fld("Plazo (meses)", "financing_term_months", { inputType: "number" })}
              {fld("Interés (%)", "financing_interest_pct", { inputType: "number" })}
              {fld(`Monto financiado (${F.sale_currency === "CRC" ? "₡" : "$"})`, "financing_amount", { inputType: "number" })}
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
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Monto ({F.sale_currency === "CRC" ? "₡" : "$"})</div>
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
                  Total depósitos: {fmt(depositsTotal(F), F.sale_currency === "CRC" ? undefined : "USD")}
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
            {F.transfer_included && !F.transfer_in_price && !F.transfer_in_financing && (
              <div style={{ marginBottom: 10, padding: "10px 12px", background: "#f59e0b20", border: "1px solid #f59e0b60", borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600, marginBottom: 6 }}>
                  Traspaso cobrado aparte - suma al total
                </div>
                <div style={{ width: 180 }}>{fld(`Monto traspaso (${F.sale_currency === "CRC" ? "₡" : "$"})`, "transfer_amount", { inputType: "number" })}</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.has_insurance} onChange={e => uf("has_insurance", e.target.checked)} /> Incluye seguro
              </label>
              {F.has_insurance && (
                <div style={{ width: 120 }}>{fld("Meses", "insurance_months", { inputType: "number" })}</div>
              )}
            </div>
          </div>

          {/* DESGLOSE EN VIVO */}
          {(() => {
            const bd = computeBreakdown(F);
            const isCash = (F.payment_method || "contado") === "contado";
            const tolerance = 0.01;
            const isZero = Math.abs(bd.balance) <= tolerance;
            const isNegative = bd.balance < -tolerance;
            const currSym = "USD"; // admin ve todo en USD por ahora
            let bColor, bLabel, bBg, statusMsg;
            if (isNegative) {
              bColor = "#e11d48"; bBg = "#e11d4820"; bLabel = "Saldo negativo";
              statusMsg = "El cliente estaría pagando más de lo que cuesta.";
            } else if (isZero) {
              bColor = "#10b981"; bBg = "#10b98120"; bLabel = "Saldo cubierto";
              statusMsg = "La venta cuadra. Listo para aprobar.";
            } else if (isCash) {
              bColor = "#e11d48"; bBg = "#e11d4820"; bLabel = "Saldo pendiente";
              statusMsg = "Venta de contado: el saldo debe ser 0.";
            } else {
              bColor = "#4f8cff"; bBg = "#4f8cff20"; bLabel = "Saldo a financiar";
              statusMsg = "Venta financiada: este saldo lo cubre el banco.";
            }
            const line = { display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderBottom: "1px solid #2a2d3d", color: "#e8eaf0" };
            return (
              <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14, border: `2px solid ${bColor}60` }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>
                  Desglose del plan de venta
                </div>
                <div style={line}>
                  <span>Precio de venta</span>
                  <strong>{fmt(bd.salePrice, currSym)}</strong>
                </div>
                {bd.transferApart && (
                  <div style={line}>
                    <span>+ Gastos de traspaso (aparte)</span>
                    <strong style={{ color: "#f59e0b" }}>+ {fmt(bd.transferExtra, currSym)}</strong>
                  </div>
                )}
                {bd.tradein > 0 && (
                  <div style={line}>
                    <span>− Trade-in</span>
                    <strong style={{ color: "#10b981" }}>− {fmt(bd.tradein, currSym)}</strong>
                  </div>
                )}
                {bd.down > 0 && (
                  <div style={line}>
                    <span>− Prima</span>
                    <strong style={{ color: "#10b981" }}>− {fmt(bd.down, currSym)}</strong>
                  </div>
                )}
                {bd.signal > 0 && (
                  <div style={line}>
                    <span>− Señal</span>
                    <strong style={{ color: "#10b981" }}>− {fmt(bd.signal, currSym)}</strong>
                  </div>
                )}
                {bd.depsTotal > 0 && (
                  <div style={line}>
                    <span>− Depósitos ({(F.deposits || []).filter(d => parseFloat(d.amount) > 0).length})</span>
                    <strong style={{ color: "#10b981" }}>− {fmt(bd.depsTotal, currSym)}</strong>
                  </div>
                )}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginTop: 12, padding: "12px 14px", background: bBg, borderRadius: 8,
                }}>
                  <div>
                    <strong style={{ color: bColor, fontSize: 14 }}>{bLabel}</strong>
                    <div style={{ fontSize: 11, color: "#8b8fa4", marginTop: 2 }}>{statusMsg}</div>
                  </div>
                  <strong style={{ color: bColor, fontSize: 18 }}>
                    {fmt(bd.balance, currSym)}
                  </strong>
                </div>
              </div>
            );
          })()}

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
              const tc = parseFloat(F.sale_exchange_rate) || 0;
              const totalCommCrc = totalComm * tc;
              const eachCrc = each * tc;
              return (
                <div style={{ fontSize: 12, color: "#8b8fa4", marginTop: 4 }}>
                  <div>Comisión total: {fmt(totalComm, "USD")} {tc > 0 && <span style={{color:"#10b981"}}>= {fmt(totalCommCrc)}</span>}</div>
                  {has2 && <div>Por vendedor: {fmt(each, "USD")} {tc > 0 && <span style={{color:"#10b981"}}>= {fmt(eachCrc)}</span>}</div>}
                  {!tc && <div style={{color:"#e11d48",marginTop:4}}>⚠ Ingrese el tipo de cambio para ver la comisión en colones</div>}
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

          {/* FIRMA DEL CLIENTE */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#4f8cff" }}>Firma del Cliente (opcional)</div>
              {F.client_signature && (
                <span style={{ fontSize: 11, color: "#10b981", background: "#10b98118", padding: "4px 10px", borderRadius: 8 }}>
                  ✓ Firmado {F.signed_at ? `el ${new Date(F.signed_at).toLocaleDateString("es-CR")}` : ""}
                </span>
              )}
            </div>
            {F.client_signature ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ background: "#fff", borderRadius: 8, padding: 8, border: "1px solid #2a2d3d" }}>
                  <img src={F.client_signature} alt="Firma" style={{ height: 80, display: "block" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button onClick={() => setShowSignatureModal(true)} style={{ ...S.sel, background: "#4f8cff18", color: "#4f8cff", fontWeight: 600, fontSize: 12 }}>
                    ✍️ Volver a firmar
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("¿Borrar la firma actual?")) {
                        uf("client_signature", null);
                        uf("signed_at", null);
                      }
                    }}
                    style={{ ...S.sel, background: "#e11d4818", color: "#e11d48", fontWeight: 500, fontSize: 12 }}
                  >
                    Borrar firma
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 12, color: "#8b8fa4", marginBottom: 10 }}>
                  Pedile al cliente que firme para dejar constancia de que vio y aceptó el plan. No es obligatorio para enviar.
                </p>
                <button onClick={() => setShowSignatureModal(true)} style={{ ...S.sel, background: "#10b98118", color: "#10b981", fontWeight: 600, padding: "10px 18px" }}>
                  ✍️ Capturar firma del cliente
                </button>
              </div>
            )}
          </div>

          {/* SUBMIT */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <button onClick={() => { setSalesView("list"); setSaleForm(null); setEditingSaleId(null); }} style={{ ...S.sel, color: "#8b8fa4", padding: "12px 24px" }}>Cancelar</button>
            <button onClick={editingSaleId ? updateSale : saveSale} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
              {editingSaleId ? "Guardar Correcciones" : "Enviar para Aprobación"}
            </button>
          </div>

          {/* Modal de firma */}
          {showSignatureModal && (
            <SignaturePad
              existingSignature={F.client_signature}
              onCancel={() => setShowSignatureModal(false)}
              onSave={(dataURL) => {
                setSaleForm(prev => ({
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

    return null;
  };

  // ======= RENDER: EGRESOS =======
  const renderEgresos = () => {
    // Build unified list of all paid expenses
    const egresos = [];

    // Paid invoices NOT in a liquidation (standalone invoice payments)
    invoices.filter(i => i.payStatus === 'paid' && !i.liquidationId).forEach(inv => {
      egresos.push({
        id: 'inv-' + inv.key,
        type: 'factura',
        date: inv.paidDate || inv.date,
        title: supDisplay(inv),
        subtitle: `Factura · ${catLabel(inv.catId)}`,
        amount: inv.total,
        currency: inv.currency || 'CRC',
        bank: inv.paidBank,
        reference: inv.paidRef,
        data: inv,
      });
    });

    // Paid liquidations
    liquidations.filter(l => l.status === 'paid').forEach(liq => {
      egresos.push({
        id: 'liq-' + liq.id,
        type: 'liquidacion',
        date: liq.paid_date || liq.created_at,
        title: liq.name,
        subtitle: `Liquidación · ${(liq.items||[]).length} facturas`,
        amount: liq.actual_amount,
        currency: liq.currency || 'CRC',
        bank: liq.paid_bank,
        reference: liq.paid_reference,
        data: liq,
      });
    });

    // Paid payrolls
    payrolls.filter(p => p.status === 'paid').forEach(p => {
      egresos.push({
        id: 'pay-' + p.id,
        type: 'planilla',
        date: p.paid_date || p.created_at,
        title: p.name,
        subtitle: `Gastos de Personal · ${(p.lines||[]).length} empleados`,
        classification: "Gastos > Administración y Ventas > Gastos de Personal",
        amount: p.total_net,
        currency: 'CRC',
        bank: p.paid_bank,
        reference: p.paid_reference,
        data: p,
      });
    });

    // Filter
    const filtered = egresos.filter(e => egresosFilter === 'all' || e.type === egresosFilter);
    // Sort by date desc
    filtered.sort((a,b) => (b.date || '').localeCompare(a.date || ''));

    // Totals by currency
    const totalCRC = filtered.filter(e => e.currency === 'CRC').reduce((s,e) => s + (e.amount||0), 0);
    const totalUSD = filtered.filter(e => e.currency === 'USD').reduce((s,e) => s + (e.amount||0), 0);

    const typeColors = { factura: "#f97316", liquidacion: "#8b5cf6", planilla: "#6366f1" };
    const typeLabels = { factura: "Factura", liquidacion: "Liquidación", planilla: "Planilla" };

    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h1 style={{fontSize:24,fontWeight:800}}>Egresos</h1>
          <button onClick={()=>{
            const rows = filtered.map(e => ({
              "Tipo": typeLabels[e.type], "Fecha": e.date, "Descripción": e.title,
              "Detalle": e.subtitle, "Monto": e.amount, "Moneda": e.currency,
              "Banco": e.bank || "", "Referencia": e.reference || "",
            }));
            if (rows.length > 0) exportXLS(rows, "Egresos_VCR");
          }} style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:600,padding:"10px 16px"}}>Exportar Excel</button>
        </div>

        {/* Totals summary */}
        <div style={{display:"flex",gap:12,marginBottom:16}}>
          <div style={{flex:1,...S.card,padding:"14px 18px"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Total Colones</div>
            <div style={{fontSize:22,fontWeight:800,color:"#4f8cff"}}>{fmt(totalCRC)}</div>
          </div>
          <div style={{flex:1,...S.card,padding:"14px 18px"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Total Dólares</div>
            <div style={{fontSize:22,fontWeight:800,color:"#10b981"}}>{fmt(totalUSD,"USD")}</div>
          </div>
          <div style={{flex:1,...S.card,padding:"14px 18px"}}>
            <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase"}}>Total Egresos</div>
            <div style={{fontSize:22,fontWeight:800,color:"#e11d48"}}>{filtered.length}</div>
          </div>
        </div>

        {/* Filters */}
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {[["all","Todos",egresos.length],["factura","Facturas",egresos.filter(e=>e.type==="factura").length],["liquidacion","Liquidaciones",egresos.filter(e=>e.type==="liquidacion").length],["planilla","Planillas",egresos.filter(e=>e.type==="planilla").length]].map(([v,l,n])=>(
            <button key={v} onClick={()=>setEgresosFilter(v)} style={{...S.sel,background:egresosFilter===v?"#4f8cff20":"#1e2130",color:egresosFilter===v?"#4f8cff":"#8b8fa4",fontWeight:egresosFilter===v?600:400}}>
              {l} ({n})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div style={{padding:40,textAlign:"center",color:"#8b8fa4",fontSize:13}}>No hay egresos pagados{egresosFilter!=="all"?" en este filtro":""}.</div>
        ) : (
          <div style={S.card}>
            {filtered.map(e => (
              <React.Fragment key={e.id}>
                <div onClick={()=>{
                  if (e.type === 'factura') openInvoice(e.data);
                  else if (e.type === 'planilla') setPickedPay(e.data);
                  else setExpandedEgreso(expandedEgreso===e.id?null:e.id);
                }} style={{padding:"12px 18px",borderBottom:"1px solid #2a2d3d",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#1e2130"} onMouseLeave={ev=>ev.currentTarget.style.background=""}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={S.badge(typeColors[e.type])}>{typeLabels[e.type]}</span>
                      <span style={{fontWeight:600,fontSize:13}}>{e.title}</span>
                    </div>
                    <div style={{fontSize:11,color:"#8b8fa4"}}>
                      {e.subtitle}
                      {e.date && ` · ${new Date(e.date + (e.date.length === 10 ? "T12:00:00" : "")).toLocaleDateString("es-CR")}`}
                      {e.bank && ` · ${e.bank}`}
                      {e.reference && ` · #${e.reference}`}
                    </div>
                    {e.classification && <div style={{fontSize:10,color:"#6366f1",marginTop:2}}>{e.classification}</div>}
                  </div>
                  <div style={{textAlign:"right",display:"flex",alignItems:"center",gap:10}}>
                    <div>
                      <div style={{fontWeight:800,fontSize:16,color:e.currency==="USD"?"#10b981":"#4f8cff"}}>{fmt(e.amount,e.currency==="USD"?"USD":undefined)}</div>
                    </div>
                    {e.type === 'liquidacion' && (
                      <span style={{color:"#8b8fa4",fontSize:14}}>{expandedEgreso===e.id?"▲":"▼"}</span>
                    )}
                  </div>
                </div>

                {/* Expanded liquidation details */}
                {e.type === 'liquidacion' && expandedEgreso === e.id && (
                  <div style={{padding:"12px 18px",background:"#1e2130",borderBottom:"1px solid #2a2d3d"}}>
                    {LIQ_CATS.map(lc => {
                      const items = (e.data.items||[]).filter(i => i.liq_category === lc.id);
                      if (items.length === 0) return null;
                      const catTotal = items.reduce((s,i) => s + i.amount, 0);
                      const lCur = e.currency;
                      const lFmt = (n) => fmt(n, lCur==="USD"?"USD":undefined);
                      return (
                        <div key={lc.id} style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0f1117",borderRadius:"6px 6px 0 0",fontWeight:700,fontSize:12}}>
                            <span>{lc.label}</span><span style={{color:lCur==="USD"?"#10b981":"#4f8cff"}}>{lFmt(catTotal)}</span>
                          </div>
                          {items.map((item,j) => (
                            <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"5px 10px",borderBottom:"1px solid #2a2d3d",fontSize:11}}>
                              <div>
                                <span style={{color:"#8b8fa4"}}>{item.emission_date ? new Date(item.emission_date).toLocaleDateString("es-CR") : ""}</span>
                                <span style={{marginLeft:8,color:"#8b8fa4"}}>{item.last_four||""}</span>
                                <span style={{marginLeft:8,fontWeight:600}}>{item.supplier_name||""}</span>
                              </div>
                              <span style={{fontWeight:600}}>{lFmt(item.amount)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                    <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
                      <button onClick={(ev)=>{ev.stopPropagation();setPrintLiq(e.data);}} style={{...S.sel,fontSize:11,background:"#4f8cff18",color:"#4f8cff",fontWeight:600,padding:"5px 12px"}}>Imprimir</button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPage = () => {
    if (tab==="Dashboard") return renderDash();
    if (tab==="Inventario") return renderInv();
    if (tab==="Facturas") return renderFac();
    if (tab==="Costos") return renderCostos();
    if (tab==="Clientes") return renderCli();
    if (tab==="Ventas") return renderSales();
    if (tab==="Liquidaciones") return renderLiquidaciones();
    if (tab==="Planillas") return renderPlanillas();
    if (tab==="Egresos") return renderEgresos();
    if (tab==="Settings") return renderSettings();
    return <PH t={tab}/>;
  };

  // ======= MAIN RENDER =======
  return (
    <div style={{fontFamily:"'DM Sans',system-ui,sans-serif",background:"#0f1117",color:"#e8eaf0",minHeight:"100vh"}}>
      {/* TOAST NOTIFICACIÓN REALTIME */}
      {notif && (
        <div
          onClick={() => setNotif(null)}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            zIndex: 99999,
            padding: "14px 22px",
            borderRadius: 10,
            background: "linear-gradient(135deg,#4f8cff,#6366f1)",
            color: "#fff",
            fontWeight: 600,
            fontSize: 14,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            cursor: "pointer",
            maxWidth: 380,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          🔔 {notif}
          <div style={{fontSize:11,fontWeight:400,marginTop:4,opacity:0.85}}>
            Click para cerrar
          </div>
        </div>
      )}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');*{margin:0;padding:0;box-sizing:border-box}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#2a2d3d;border-radius:3px}select{appearance:auto}@media print{body{background:#fff!important}body *{visibility:hidden!important}#plan-de-ventas-print,#plan-de-ventas-print *,#print-area,#print-area *{visibility:visible!important}#plan-de-ventas-print,#print-area{position:fixed!important;inset:0!important;z-index:99999!important;background:#fff!important;padding:30px 40px!important;overflow:visible!important;color:#1a1a2e!important}#print-area table,#plan-de-ventas-print table{border-collapse:collapse!important}#print-area td,#print-area th,#plan-de-ventas-print td,#plan-de-ventas-print th{color:#1a1a2e!important;border-color:#ddd!important}.no-print,.no-print *{display:none!important;visibility:hidden!important}}`}</style>
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
            <div style={S.modal}>
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

                  {pickedInv.payStatus === "paid" ? (
                    /* YA PAGADA: muestra info en modo lectura */
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{...S.badge("#10b981"),fontSize:12,padding:"6px 10px"}}>✓ Pagada</span>
                      <span style={{fontSize:12,color:"#8b8fa4"}}>Cuenta:</span>
                      <span style={{fontSize:12,fontWeight:600}}>{pickedInv.paidBank || "-"}</span>
                      <span style={{fontSize:12,color:"#8b8fa4",marginLeft:8}}>Ref:</span>
                      <span style={{fontSize:12,fontWeight:600}}>{pickedInv.paidRef || "-"}</span>
                      {pickedInv.alegraPaymentId ? (
                        <span style={{...S.badge("#10b981"),fontSize:11,marginLeft:8}}>
                          ✓ Alegra Pago #{pickedInv.alegraPaymentId}
                        </span>
                      ) : (
                        <span style={{...S.badge("#f59e0b"),fontSize:11,marginLeft:8}}>
                          ⚠ No sincronizado a Alegra
                        </span>
                      )}
                      <button
                        onClick={() => {
                          if (!window.confirm("¿Desmarcar como pagada?\n\nNOTA: esto NO borra el pago en Alegra. Si ya se envió, hay que borrarlo manualmente allá.")) return;
                          updateInv(pickedInv.key, {payStatus:"pending"});
                          setPickedInv({...pickedInv, payStatus:"pending"});
                        }}
                        style={{...S.sel, fontSize:11, padding:"4px 10px", background:"#1e2130", color:"#8b8fa4", marginLeft:"auto"}}
                      >
                        Desmarcar
                      </button>
                    </div>
                  ) : (
                    /* NO PAGADA: campos en lineas separadas como los otros selects que funcionan */
                    <div>
                      <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}>Cuenta bancaria</div>
                      <select
                        value={pickedInv.paidBankId || ""}
                        onChange={e => {
                          const val = e.target.value;
                          const bankId = val || null;  // UUID string, no parseInt
                          const bank = bankId ? bankAccounts.find(b => b.id === bankId) : null;
                          const bankName = bank ? bank.name : '';
                          updateInv(pickedInv.key, { paidBankId: bankId, paidBank: bankName });
                          setPickedInv({...pickedInv, paidBankId: bankId, paidBank: bankName});
                        }}
                        style={{...S.sel, width:"100%", marginBottom:8}}
                      >
                        <option value="">Seleccionar cuenta...</option>
                        {bankAccounts
                          .filter(b => b.currency === (pickedInv.currency || 'CRC'))
                          .map(b => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.currency})
                            </option>
                          ))
                        }
                      </select>
                      <div style={{fontSize:12,color:"#8b8fa4",marginBottom:4}}># depósito / referencia</div>
                      <input
                        placeholder="Número de depósito, transferencia, etc."
                        value={pickedInv.paidRef||""}
                        onChange={e=>{
                          updateInv(pickedInv.key,{paidRef:e.target.value});
                          setPickedInv({...pickedInv,paidRef:e.target.value});
                        }}
                        style={{...S.inp, width:"100%", marginBottom:10}}
                      />
                      <button
                        onClick={() => markAsPaidAndSync(pickedInv)}
                        style={{
                          ...S.sel,
                          width:"100%",
                          background:"#10b98120",
                          color:"#10b981",
                          fontWeight:600,
                          cursor:"pointer",
                          padding:"10px 14px",
                          fontSize:14
                        }}
                      >
                        ✓ Marcar pagada
                      </button>
                    </div>
                  )}
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
                    <div style={{fontWeight:700,fontSize:13,color:"#f59e0b",marginBottom:10}}>
                      🚗 Compra de vehículo detectada
                      {(pickedInv.lines||[]).length > 1 && <span style={{fontWeight:400,fontSize:11,color:"#8b8fa4",marginLeft:8}}>({(pickedInv.lines||[]).length} líneas, {completedVehicleLines.size} agregada{completedVehicleLines.size!==1?"s":""})</span>}
                    </div>

                    {!vehicleForm ? (
                      <div>
                        {/* Show lines to pick from if multiple lines */}
                        {(pickedInv.lines||[]).length > 1 ? (
                          <div style={{marginBottom:10}}>
                            <div style={{fontSize:11,color:"#8b8fa4",marginBottom:6}}>Seleccione la línea del vehículo a agregar:</div>
                            {(pickedInv.lines||[]).map((line, idx) => {
                              const isDone = completedVehicleLines.has(idx);
                              return (
                                <div key={idx} onClick={() => {
                                  if (isDone) return;
                                  setVehicleFormLine(idx);
                                  setVehicleForm({plate:"",brand:"",model:"",year:"",color:"",km:"",drive:"",fuel:"",style:"",price_usd:"",price_crc:"",cabys_code:"",consignment:false,consignment_owner:""});
                                }} style={{padding:"8px 12px",marginBottom:4,borderRadius:8,cursor:isDone?"default":"pointer",background:isDone?"#10b98110":"#1e2130",border:isDone?"1px solid #10b98130":"1px solid #2a2d3d",opacity:isDone?0.6:1,display:"flex",justifyContent:"space-between",alignItems:"center"}}
                                  onMouseEnter={e=>{if(!isDone)e.currentTarget.style.background="#f59e0b10"}} onMouseLeave={e=>{if(!isDone)e.currentTarget.style.background=isDone?"#10b98110":"#1e2130"}}>
                                  <div style={{fontSize:12,flex:1}}>
                                    {isDone && <span style={{color:"#10b981",marginRight:6}}>✓</span>}
                                    <span style={{fontWeight:600}}>{line.desc ? (line.desc.length > 60 ? line.desc.slice(0,60)+"..." : line.desc) : `Línea ${idx+1}`}</span>
                                  </div>
                                  <span style={{fontWeight:700,color:pickedInv.currency==="USD"?"#10b981":"#4f8cff",fontSize:13}}>
                                    {fmt(line.total, pickedInv.currency==="USD"?"USD":undefined)}
                                  </span>
                                </div>
                              );
                            })}
                            {completedVehicleLines.size > 0 && completedVehicleLines.size < (pickedInv.lines||[]).length && (
                              <button onClick={async () => {
                                await supabase.from('invoices').update({ vehicle_purchase_status: 'completed', assign_status: 'assigned' }).eq('xml_key', pickedInv.key);
                                setInvoices(prev => prev.map(x => x.key === pickedInv.key ? { ...x, vehicleStatus: 'completed' } : x));
                                setPickedInv(prev => prev ? { ...prev, vehicleStatus: 'completed' } : null);
                              }} style={{...S.sel,color:"#10b981",background:"#10b98110",fontWeight:600,width:"100%",marginTop:8,fontSize:12}}>
                                Listo, no hay más vehículos en esta factura
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{display:"flex",gap:8}}>
                            <button onClick={() => {
                              setVehicleFormLine(0);
                              setVehicleForm({plate:"",brand:"",model:"",year:"",color:"",km:"",drive:"",fuel:"",style:"",price_usd:"",price_crc:"",cabys_code:"",consignment:false,consignment_owner:""});
                            }} style={{...S.sel,background:"#f59e0b",color:"#fff",fontWeight:600,flex:1,border:"none"}}>
                              Completar datos del vehículo
                            </button>
                            <button onClick={dismissVehicle} style={{...S.sel,color:"#8b8fa4"}}>No es un vehículo</button>
                          </div>
                        )}
                        {(pickedInv.lines||[]).length <= 1 && (
                          <div style={{marginTop:6}}>
                            <button onClick={dismissVehicle} style={{...S.sel,color:"#8b8fa4",fontSize:11,width:"100%"}}>No es un vehículo</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {vehicleFormLine != null && pickedInv.lines && pickedInv.lines[vehicleFormLine] && (
                          <div style={{background:"#1e2130",borderRadius:8,padding:"8px 12px",marginBottom:10,fontSize:12}}>
                            <div style={{color:"#8b8fa4",fontSize:10}}>Línea seleccionada:</div>
                            <div style={{fontWeight:600}}>{pickedInv.lines[vehicleFormLine].desc}</div>
                            <div style={{fontWeight:700,color:pickedInv.currency==="USD"?"#10b981":"#4f8cff"}}>
                              Costo: {fmt(pickedInv.lines[vehicleFormLine].total, pickedInv.currency==="USD"?"USD":undefined)}
                            </div>
                          </div>
                        )}
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 12px"}}>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Placa *</div>
                            <input value={vehicleForm.plate||""}
                              onChange={e=>setVehicleForm(prev=>({...prev,plate:e.target.value.toUpperCase()}))}
                              onBlur={e=>setVehicleForm(prev=>({...prev,plate:formatPlate(e.target.value)}))}
                              style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Marca</div>
                            <SmartDropdown
                              value={vehicleForm.brand||""}
                              onChange={val => setVehicleForm(prev => ({...prev, brand: val}))}
                              options={brandOptions(cars)}
                              upperCase={true}
                              style={{...S.sel,width:"100%",fontSize:12}}
                              styleInp={{...S.inp,width:"100%",fontSize:12}}
                            />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Modelo</div>
                            <SmartDropdown
                              value={vehicleForm.model||""}
                              onChange={val => setVehicleForm(prev => ({...prev, model: val}))}
                              options={uniqueFromInventory(cars, "m")}
                              upperCase={true}
                              style={{...S.sel,width:"100%",fontSize:12}}
                              styleInp={{...S.inp,width:"100%",fontSize:12}}
                            />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Año</div>
                            <input type="number" value={vehicleForm.year||""} onChange={e=>setVehicleForm(prev=>({...prev,year:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Color</div>
                            <input value={vehicleForm.color||""} onChange={e=>setVehicleForm(prev=>({...prev,color:e.target.value.toUpperCase()}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Kilometraje</div>
                            <input type="number" value={vehicleForm.km||""} onChange={e=>setVehicleForm(prev=>({...prev,km:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estilo</div>
                            <select value={vehicleForm.style||""} onChange={e=>{const val=e.target.value;setVehicleForm(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}>
                              <option value="">Seleccionar</option>{["SUV","SEDAN","PICK UP","HATCHBACK","COUPE","FAMILIAR","TODOTERRENO","MICROBUS"].map(s=><option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Tracción</div>
                            <select value={vehicleForm.drive||""} onChange={e=>setVehicleForm(prev=>({...prev,drive:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}>
                              <option value="">Seleccionar</option>{DRIVETRAIN_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Combustible</div>
                            <select value={vehicleForm.fuel||""} onChange={e=>setVehicleForm(prev=>({...prev,fuel:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}>
                              <option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div>
                            <input type="number" value={vehicleForm.engine_cc||""} onChange={e=>{const val=e.target.value;setVehicleForm(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Pasajeros</div>
                            <input type="number" value={vehicleForm.passengers||""} onChange={e=>setVehicleForm(prev=>({...prev,passengers:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Serie/Chasis</div>
                            <input value={vehicleForm.chassis||""} onChange={e=>setVehicleForm(prev=>({...prev,chassis:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta USD</div>
                            <input type="number" value={vehicleForm.price_usd||""} onChange={e=>setVehicleForm(prev=>({...prev,price_usd:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta CRC</div>
                            <input type="number" value={vehicleForm.price_crc||""} onChange={e=>setVehicleForm(prev=>({...prev,price_crc:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} />
                          </div>
                          <div style={{gridColumn:"1/3"}}>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Código CABYS *</div>
                            <select value={vehicleForm.cabys_code||""} onChange={e=>setVehicleForm(prev=>({...prev,cabys_code:e.target.value}))} style={{...S.sel,width:"100%",fontSize:12}}>
                              <option value="">Seleccionar CABYS</option>
                              {CABYS_VEHICLES.map(c=><option key={c.code} value={c.code}>{c.code} - {c.label}</option>)}
                            </select>
                          </div>
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
                          <button onClick={()=>{setVehicleForm(null);setVehicleFormLine(null);}} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
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
                    <span style={S.badge(pickedSale.status === "aprobada" ? "#10b981" : pickedSale.status === "rechazada" ? "#e11d48" : "#f59e0b")}>
                      {pickedSale.status === "aprobada" ? "Aprobada" : pickedSale.status === "rechazada" ? "Rechazada" : "Pendiente"}
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
                {pickedSale.status === "pendiente" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={() => { const r = prompt("Razón del rechazo (opcional):"); if (r !== null) rejectSale(pickedSale.id, r); }}
                      style={{ ...S.sel, color: "#e11d48", background: "#e11d4810", fontWeight: 600, padding: "12px 24px" }}>
                      Rechazar
                    </button>
                    <button onClick={() => editSale(pickedSale)}
                      style={{ ...S.sel, color: "#f59e0b", background: "#f59e0b10", fontWeight: 600, padding: "12px 24px" }}>
                      Corregir
                    </button>
                    <button onClick={() => setConfirmApprove(pickedSale.id)}
                      style={{ ...S.sel, background: "#10b981", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                      Aprobar
                    </button>
                  </div>
                )}
                {pickedSale.status === "aprobada" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16 }}>
                    <button onClick={() => editSale(pickedSale)}
                      style={{ ...S.sel, color: "#f59e0b", background: "#f59e0b10", fontWeight: 600, padding: "12px 24px" }}>
                      Corregir
                    </button>
                    <button onClick={() => { setPrintSale(pickedSale); setPickedSale(null); }}
                      style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                      Ver Plan de Ventas
                    </button>
                  </div>
                )}

                {/* Confirm approval dialog */}
                {confirmApprove && (
                  <div style={{ marginTop: 16, padding: "16px 20px", background: "#10b98110", border: "1px solid #10b98130", borderRadius: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#10b981", marginBottom: 8 }}>Confirmar aprobación</div>
                    <p style={{ fontSize: 12, color: "#8b8fa4", marginBottom: 12 }}>Al confirmar se emitirá la factura de venta en Alegra. Desea continuar?</p>
                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                      <button onClick={() => setConfirmApprove(null)}
                        style={{ ...S.sel, color: "#8b8fa4", padding: "10px 20px" }}>Cancelar</button>
                      <button onClick={() => approveSale(confirmApprove)}
                        style={{ ...S.sel, background: "#10b981", color: "#fff", fontWeight: 700, padding: "10px 24px", border: "none" }}>
                        Confirmar y Emitir
                      </button>
                    </div>
                  </div>
                )}
                {pickedSale.status === "rechazada" && pickedSale.rejected_reason && (
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
                        <span style={{ display: "inline-block", background: s.status === "aprobada" ? "#10b981" : "#f59e0b", color: "#fff", padding: "3px 14px", borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                          {s.status === "aprobada" ? "Aprobada" : s.status === "rechazada" ? "Rechazada" : "Pendiente"}
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
                              <tr key={i}><td style={P.td}>{a.agent_name}</td><td style={P.tdR}>{a.commission_pct}% = {fmt(a.commission_amount, "USD")}{a.commission_crc > 0 ? ` (${fmt(a.commission_crc)})` : ""}</td></tr>
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

          {/* LIQUIDATION DETAIL MODAL */}
          {pickedLiq && (
            <div style={S.modal} onClick={()=>{setPickedLiq(null);setLiqPayForm(null);}}>
              <div style={{...S.mbox,maxWidth:700}} onClick={e=>e.stopPropagation()}>
                {(() => { const lCur = pickedLiq.currency || "CRC"; const lFmt = (n) => fmt(n, lCur==="USD"?"USD":undefined); return (<>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <h3 style={{fontSize:18,fontWeight:800,margin:0}}>{pickedLiq.name}</h3>
                    <p style={{fontSize:12,color:"#8b8fa4"}}>{lCur} · {new Date(pickedLiq.created_at).toLocaleDateString("es-CR")}</p>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={S.badge(pickedLiq.status==="paid"?"#10b981":pickedLiq.status==="confirmed"?"#6366f1":"#f59e0b")}>
                      {pickedLiq.status==="paid"?"Pagada":pickedLiq.status==="confirmed"?"Confirmada":"Borrador"}
                    </span>
                    <button onClick={()=>{setPickedLiq(null);setLiqPayForm(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:18}}>✕</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {[["Meta",pickedLiq.target_amount],["Total",pickedLiq.actual_amount],["Dif.",pickedLiq.actual_amount - pickedLiq.target_amount]].map(([l,v],i)=>(
                    <div key={l} style={{flex:1,background:"#1e2130",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:"#8b8fa4"}}>{l}</div>
                      <div style={{fontSize:16,fontWeight:700,color:i===2?(v>=0?"#10b981":"#e11d48"):(i===1?(lCur==="USD"?"#10b981":"#4f8cff"):"#e8eaf0")}}>{lFmt(v)}</div>
                    </div>
                  ))}
                </div>
                {LIQ_CATS.map(lc => {
                  const items = (pickedLiq.items||[]).filter(i => i.liq_category === lc.id);
                  if (items.length === 0) return null;
                  const catTotal = items.reduce((s,i) => s + i.amount, 0);
                  return (
                    <div key={lc.id} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 14px",background:"#1e2130",borderRadius:"8px 8px 0 0",fontWeight:700,fontSize:13}}>
                        <span>{lc.label}</span><span style={{color:lCur==="USD"?"#10b981":"#4f8cff"}}>{lFmt(catTotal)}</span>
                      </div>
                      {items.map((item,j) => (
                        <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"6px 14px",borderBottom:"1px solid #2a2d3d",fontSize:12}}>
                          <div>
                            <span style={{color:"#8b8fa4"}}>{item.emission_date ? new Date(item.emission_date).toLocaleDateString("es-CR") : ""}</span>
                            <span style={{marginLeft:8,color:"#8b8fa4"}}>{item.last_four||""}</span>
                            <span style={{marginLeft:8,fontWeight:600}}>{item.supplier_name||""}</span>
                          </div>
                          <span style={{fontWeight:600}}>{lFmt(item.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {pickedLiq.status === "paid" && (
                  <div style={{background:"#10b98110",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#10b981",marginBottom:6}}>Pago registrado</div>
                    <div style={{fontSize:12,display:"flex",gap:16,flexWrap:"wrap"}}>
                      <span><span style={{color:"#8b8fa4"}}>Banco:</span> {pickedLiq.paid_bank}</span>
                      <span><span style={{color:"#8b8fa4"}}>Ref:</span> {pickedLiq.paid_reference||"-"}</span>
                      <span><span style={{color:"#8b8fa4"}}>Fecha:</span> {pickedLiq.paid_date ? new Date(pickedLiq.paid_date+"T12:00:00").toLocaleDateString("es-CR") : "-"}</span>
                    </div>
                  </div>
                )}
                {liqPayForm && pickedLiq.status === "confirmed" && (
                  <div style={{background:"#6366f110",border:"1px solid #6366f130",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#6366f1",marginBottom:10}}>Registrar Pago</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Banco *</div><input value={liqPayForm.bank||""} onChange={e=>setLiqPayForm(prev=>({...prev,bank:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Referencia</div><input value={liqPayForm.reference||""} onChange={e=>setLiqPayForm(prev=>({...prev,reference:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Fecha</div><input type="date" value={liqPayForm.date||""} onChange={e=>setLiqPayForm(prev=>({...prev,date:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
                      <button onClick={()=>setLiqPayForm(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                      <button onClick={()=>payLiquidation(pickedLiq.id)} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none"}}>Confirmar Pago</button>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
                  {pickedLiq.status === "draft" && (<>
                    <button onClick={()=>deleteLiquidation(pickedLiq.id)} style={{...S.sel,color:"#e11d48",background:"#e11d4810",fontWeight:600}}>Eliminar</button>
                    <button onClick={()=>confirmLiquidation(pickedLiq.id)} style={{...S.sel,background:"#6366f1",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Confirmar</button>
                  </>)}
                  {pickedLiq.status === "confirmed" && !liqPayForm && (<>
                    <button onClick={()=>deleteLiquidation(pickedLiq.id)} style={{...S.sel,color:"#e11d48",background:"#e11d4810",fontWeight:600}}>Eliminar</button>
                    <button onClick={()=>setLiqPayForm({bank:"",reference:"",date:new Date().toISOString().split('T')[0]})} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Registrar Pago</button>
                  </>)}
                  <button onClick={()=>{setPrintLiq(pickedLiq);setPickedLiq(null);}} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600}}>Imprimir</button>
                </div>
                </>); })()}
              </div>
            </div>
          )}

          {/* PRINTABLE LIQUIDATION */}
          {printLiq && (() => {
            const l = printLiq; const lCur = l.currency || "CRC"; const lFmt = (n) => fmt(n, lCur==="USD"?"USD":undefined);
            const catGroups = {}; (l.items||[]).forEach(item => { if (!catGroups[item.liq_category]) catGroups[item.liq_category] = []; catGroups[item.liq_category].push(item); });
            return (
              <div style={{position:"fixed",inset:0,zIndex:9999,background:"#0f1117ee",overflowY:"auto"}}>
                <div style={{maxWidth:850,margin:"20px auto",position:"relative"}}>
                  <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginBottom:10,padding:"0 10px"}} className="no-print">
                    <button onClick={()=>window.print()} style={{...S.sel,background:"#4f8cff",color:"#fff",fontWeight:600,padding:"8px 20px",border:"none"}}>Imprimir / PDF</button>
                    <button onClick={()=>setPrintLiq(null)} style={{...S.sel,color:"#8b8fa4",padding:"8px 20px"}}>Cerrar</button>
                  </div>
                  <div id="print-area" style={{background:"#fff",color:"#1a1a2e",padding:"40px 50px",maxWidth:800,margin:"0 auto",fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,lineHeight:1.6}}>
                    <div style={{textAlign:"center",marginBottom:30}}>
                      <div style={{fontSize:22,fontWeight:800,color:"#e11d48",letterSpacing:1}}>VEHÍCULOS DE COSTA RICA</div>
                      <div style={{fontSize:11,color:"#666",marginTop:2}}>Cédula Jurídica 3-101-124464</div>
                      <div style={{fontSize:16,fontWeight:800,marginTop:16}}>{l.name}</div>
                      <div style={{fontSize:12,color:"#666"}}>{lCur} · {new Date(l.created_at).toLocaleDateString("es-CR",{day:"numeric",month:"long",year:"numeric"})}</div>
                      <div style={{marginTop:6}}>
                        <span style={{display:"inline-block",background:l.status==="paid"?"#10b981":l.status==="confirmed"?"#6366f1":"#f59e0b",color:"#fff",padding:"3px 14px",borderRadius:20,fontSize:11,fontWeight:700,textTransform:"uppercase"}}>
                          {l.status==="paid"?"Pagada":l.status==="confirmed"?"Confirmada":"Borrador"}
                        </span>
                      </div>
                    </div>
                    {LIQ_CATS.map(lc => {
                      const items = catGroups[lc.id]; if (!items || items.length === 0) return null;
                      const catTotal = items.reduce((s,i) => s + i.amount, 0);
                      return (
                        <div key={lc.id} style={{marginBottom:20}}>
                          <div style={{fontWeight:800,fontSize:14,borderBottom:"2px solid #e11d48",paddingBottom:4,marginBottom:6}}>{lc.label.toUpperCase()}</div>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                            <thead><tr>
                              <th style={{textAlign:"left",padding:"6px 10px",borderBottom:"1px solid #ddd",fontSize:10,color:"#666",fontWeight:700}}>FECHA</th>
                              <th style={{textAlign:"left",padding:"6px 10px",borderBottom:"1px solid #ddd",fontSize:10,color:"#666",fontWeight:700}}>CONSEC.</th>
                              <th style={{textAlign:"left",padding:"6px 10px",borderBottom:"1px solid #ddd",fontSize:10,color:"#666",fontWeight:700}}>COMERCIO</th>
                              <th style={{textAlign:"right",padding:"6px 10px",borderBottom:"1px solid #ddd",fontSize:10,color:"#666",fontWeight:700}}>MONTO</th>
                            </tr></thead>
                            <tbody>
                              {items.map((item,j) => (<tr key={j}><td style={{padding:"4px 10px",borderBottom:"1px solid #eee"}}>{item.emission_date ? new Date(item.emission_date).toLocaleDateString("es-CR") : ""}</td><td style={{padding:"4px 10px",borderBottom:"1px solid #eee"}}>{item.last_four||""}</td><td style={{padding:"4px 10px",borderBottom:"1px solid #eee"}}>{item.supplier_name||""}</td><td style={{padding:"4px 10px",borderBottom:"1px solid #eee",textAlign:"right",fontWeight:600}}>{lFmt(item.amount)}</td></tr>))}
                              <tr style={{background:"#f5f5f5"}}><td colSpan={3} style={{padding:"6px 10px",fontWeight:800}}>Subtotal {lc.label}</td><td style={{padding:"6px 10px",textAlign:"right",fontWeight:800}}>{lFmt(catTotal)}</td></tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                    <div style={{marginTop:20,padding:"12px 16px",background:"#f8f8f8",borderRadius:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontWeight:800,fontSize:16}}>TOTAL</span>
                      <span style={{fontWeight:800,fontSize:18,color:"#e11d48"}}>{lFmt(l.actual_amount)}</span>
                    </div>
                    {l.target_amount > 0 && (
                      <div style={{display:"flex",justifyContent:"flex-end",fontSize:12,color:"#666",marginTop:6,gap:20}}>
                        <span>Meta: {lFmt(l.target_amount)}</span>
                        <span>Diferencia: {lFmt(l.actual_amount - l.target_amount)}</span>
                      </div>
                    )}
                    {l.status === "paid" && (<div style={{marginTop:20,padding:"10px 16px",border:"1px solid #ddd",borderRadius:6,fontSize:12}}><strong>Pago:</strong> {l.paid_bank} · Ref: {l.paid_reference||"-"} · Fecha: {l.paid_date ? new Date(l.paid_date+"T12:00:00").toLocaleDateString("es-CR") : "-"}</div>)}
                    <div style={{marginTop:40,textAlign:"center",fontSize:10,color:"#999",borderTop:"1px solid #ddd",paddingTop:12}}>Vehículos de Costa Rica S.R.L. · Cédula Jurídica 3-101-124464 · {new Date().toLocaleDateString("es-CR",{day:"numeric",month:"long",year:"numeric"})}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* PAYROLL DETAIL MODAL */}
          {pickedPay && (
            <div style={S.modal} onClick={()=>{setPickedPay(null);setPayPayForm(null);}}>
              <div style={{...S.mbox,maxWidth:750}} onClick={e=>e.stopPropagation()}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
                  <div>
                    <h3 style={{fontSize:18,fontWeight:800,margin:0}}>{pickedPay.name}</h3>
                    <p style={{fontSize:12,color:"#8b8fa4"}}>{new Date(pickedPay.created_at).toLocaleDateString("es-CR")}</p>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={S.badge(pickedPay.period_type==="mensual"?"#8b5cf6":"#0ea5e9")}>{pickedPay.period_type==="mensual"?"Mensual":"Quincenal"}</span>
                    <span style={S.badge(pickedPay.status==="paid"?"#10b981":pickedPay.status==="confirmed"?"#6366f1":"#f59e0b")}>
                      {pickedPay.status==="paid"?"Pagada":pickedPay.status==="confirmed"?"Confirmada":"Borrador"}
                    </span>
                    <button onClick={()=>{setPickedPay(null);setPayPayForm(null);}} style={{background:"none",border:"none",cursor:"pointer",color:"#8b8fa4",fontSize:18}}>✕</button>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {[["Bruto",pickedPay.total_gross],["CCSS",pickedPay.total_ccss],["Renta",pickedPay.total_rent],["Neto",pickedPay.total_net]].map(([l,v],i)=>(
                    <div key={l} style={{flex:1,background:"#1e2130",borderRadius:10,padding:"10px 14px"}}>
                      <div style={{fontSize:10,color:"#8b8fa4"}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:700,color:i===3?"#4f8cff":(i>0?"#e11d48":"#e8eaf0")}}>{fmt2(v)}</div>
                    </div>
                  ))}
                </div>
                <div style={{...S.card,overflowX:"auto",marginBottom:14}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr style={{background:"#1e2130"}}>
                      {["Empleado","Sueldo","Com.","Bruto","CCSS",pickedPay.period_type==="mensual"?"Renta":null,"Neto"].filter(Boolean).map(h=>(
                        <th key={h} style={{padding:"8px 12px",textAlign:h==="Empleado"?"left":"right",fontSize:10,fontWeight:700,color:"#8b8fa4",textTransform:"uppercase",borderBottom:"2px solid #2a2d3d"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {(pickedPay.lines||[]).map((l,i) => (
                        <tr key={i} style={{borderBottom:"1px solid #2a2d3d"}}>
                          <td style={{padding:"8px 12px",fontSize:12,fontWeight:600}}>{l.agent_name}</td>
                          <td style={{padding:"8px 12px",textAlign:"right",fontSize:12}}>{fmt2(l.salary)}</td>
                          <td style={{padding:"8px 12px",textAlign:"right",fontSize:12,color:l.commissions>0?"#f97316":"#8b8fa4"}}>{l.commissions>0?fmt2(l.commissions):"-"}</td>
                          <td style={{padding:"8px 12px",textAlign:"right",fontSize:12,fontWeight:600}}>{fmt2(l.gross_total)}</td>
                          <td style={{padding:"8px 12px",textAlign:"right",fontSize:12,color:"#e11d48"}}>{fmt2(l.ccss_amount)}</td>
                          {pickedPay.period_type==="mensual"&&<td style={{padding:"8px 12px",textAlign:"right",fontSize:12,color:l.rent_amount>0?"#e11d48":"#8b8fa4"}}>{l.rent_amount>0?fmt2(l.rent_amount):"-"}</td>}
                          <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,fontWeight:800,color:"#4f8cff"}}>{fmt2(l.net_pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pickedPay.status === "paid" && (
                  <div style={{background:"#10b98110",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#10b981",marginBottom:6}}>Pago registrado</div>
                    <div style={{fontSize:12,display:"flex",gap:16,flexWrap:"wrap"}}>
                      <span><span style={{color:"#8b8fa4"}}>Banco:</span> {pickedPay.paid_bank}</span>
                      <span><span style={{color:"#8b8fa4"}}>Ref:</span> {pickedPay.paid_reference||"-"}</span>
                      <span><span style={{color:"#8b8fa4"}}>Fecha:</span> {pickedPay.paid_date ? new Date(pickedPay.paid_date+"T12:00:00").toLocaleDateString("es-CR") : "-"}</span>
                    </div>
                  </div>
                )}
                {payPayForm && pickedPay.status === "confirmed" && (
                  <div style={{background:"#6366f110",border:"1px solid #6366f130",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#6366f1",marginBottom:10}}>Registrar Pago</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Banco *</div><input value={payPayForm.bank||""} onChange={e=>setPayPayForm(prev=>({...prev,bank:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Referencia</div><input value={payPayForm.reference||""} onChange={e=>setPayPayForm(prev=>({...prev,reference:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                      <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Fecha</div><input type="date" value={payPayForm.date||""} onChange={e=>setPayPayForm(prev=>({...prev,date:e.target.value}))} style={{...S.inp,width:"100%"}} /></div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end"}}>
                      <button onClick={()=>setPayPayForm(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                      <button onClick={()=>payPayroll(pickedPay.id)} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:600,border:"none"}}>Confirmar Pago</button>
                    </div>
                  </div>
                )}
                <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16,flexWrap:"wrap"}}>
                  <button onClick={()=>deletePayroll(pickedPay.id)} style={{...S.sel,color:"#e11d48",background:"#e11d4810",fontWeight:600}}>Eliminar</button>
                  <button onClick={()=>{
                    setEditingPayroll({
                      id: pickedPay.id,
                      lines: (pickedPay.lines||[]).map(l => ({...l})),
                    });
                  }} style={{...S.sel,color:"#f97316",background:"#f97316"+"10",fontWeight:600}}>Editar</button>
                  {pickedPay.status === "draft" && (
                    <button onClick={()=>confirmPayroll(pickedPay.id)} style={{...S.sel,background:"#6366f1",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Confirmar</button>
                  )}
                  {pickedPay.status === "confirmed" && !payPayForm && (
                    <button onClick={()=>setPayPayForm({bank:"",reference:"",date:new Date().toISOString().split('T')[0]})} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Registrar Pago</button>
                  )}
                  <button onClick={()=>{setPrintPay(pickedPay);setPickedPay(null);}} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600}}>Imprimir</button>
                </div>

                {/* EDIT PAYROLL MODAL */}
                {editingPayroll && (
                  <div style={{marginTop:16,background:"#f97316"+"10",border:"1px solid #f97316"+"30",borderRadius:12,padding:"14px 16px"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#f97316",marginBottom:10}}>Editar líneas de planilla</div>
                    <div style={{fontSize:11,color:"#f59e0b",marginBottom:10}}>Modifique los montos directamente. Al guardar se recalculan los totales.</div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:10}}>
                      <thead><tr style={{background:"#1e2130"}}>
                        {["Empleado","Sueldo","Comisiones","CCSS","Renta","Neto"].map(h=>(
                          <th key={h} style={{padding:"6px 8px",textAlign:h==="Empleado"?"left":"right",fontSize:9,fontWeight:700,color:"#8b8fa4"}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {editingPayroll.lines.map((l,i) => (
                          <tr key={i} style={{borderBottom:"1px solid #2a2d3d"}}>
                            <td style={{padding:"6px 8px",fontWeight:600,fontSize:11}}>{l.agent_name}</td>
                            <td style={{padding:"4px 4px"}}><input type="number" value={l.salary||""} onChange={e=>{
                              const v = parseFloat(e.target.value)||0;
                              setEditingPayroll(prev=>{const nl=[...prev.lines];nl[i]={...nl[i],salary:v,gross_total:v+(nl[i].commissions||0),ccss_amount:r2((v+(nl[i].commissions||0))*(nl[i].ccss_pct||10.83)/100),net_pay:r2(v+(nl[i].commissions||0)-r2((v+(nl[i].commissions||0))*(nl[i].ccss_pct||10.83)/100)-(nl[i].rent_amount||0))};return{...prev,lines:nl};});
                            }} style={{...S.inp,width:"100%",fontSize:11,textAlign:"right"}} /></td>
                            <td style={{padding:"4px 4px"}}><input type="number" value={l.commissions||""} onChange={e=>{
                              const v = parseFloat(e.target.value)||0;
                              setEditingPayroll(prev=>{const nl=[...prev.lines];nl[i]={...nl[i],commissions:v,gross_total:(nl[i].salary||0)+v,ccss_amount:r2(((nl[i].salary||0)+v)*(nl[i].ccss_pct||10.83)/100),net_pay:r2((nl[i].salary||0)+v-r2(((nl[i].salary||0)+v)*(nl[i].ccss_pct||10.83)/100)-(nl[i].rent_amount||0))};return{...prev,lines:nl};});
                            }} style={{...S.inp,width:"100%",fontSize:11,textAlign:"right"}} /></td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontSize:11,color:"#e11d48"}}>{fmt2(l.ccss_amount)}</td>
                            <td style={{padding:"4px 4px"}}><input type="number" value={l.rent_amount||""} onChange={e=>{
                              const v = parseFloat(e.target.value)||0;
                              setEditingPayroll(prev=>{const nl=[...prev.lines];nl[i]={...nl[i],rent_amount:v,net_pay:r2((nl[i].gross_total||0)-(nl[i].ccss_amount||0)-v)};return{...prev,lines:nl};});
                            }} style={{...S.inp,width:"100%",fontSize:11,textAlign:"right"}} /></td>
                            <td style={{padding:"6px 8px",textAlign:"right",fontSize:11,fontWeight:700,color:"#4f8cff"}}>{fmt2(l.net_pay)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>setEditingPayroll(null)} style={{...S.sel,color:"#8b8fa4"}}>Cancelar</button>
                      <button onClick={saveEditPayroll} style={{...S.sel,background:"#10b981",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>Guardar cambios</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PRINTABLE PAYROLL */}
          {printPay && (() => {
            const p = printPay; const isMensual = p.period_type === "mensual";
            return (
              <div style={{position:"fixed",inset:0,zIndex:9999,background:"#0f1117ee",overflowY:"auto"}}>
                <div style={{maxWidth:850,margin:"20px auto",position:"relative"}}>
                  <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginBottom:10,padding:"0 10px"}} className="no-print">
                    <button onClick={()=>window.print()} style={{...S.sel,background:"#4f8cff",color:"#fff",fontWeight:600,padding:"8px 20px",border:"none"}}>Imprimir / PDF</button>
                    <button onClick={()=>setPrintPay(null)} style={{...S.sel,color:"#8b8fa4",padding:"8px 20px"}}>Cerrar</button>
                  </div>
                  <div id="print-area" style={{background:"#fff",color:"#1a1a2e",padding:"40px 50px",maxWidth:800,margin:"0 auto",fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:13,lineHeight:1.6}}>
                    <div style={{marginBottom:24}}>
                      <div style={{fontSize:14,fontWeight:800,letterSpacing:.5}}>PLANILLA</div>
                      <div style={{fontSize:13,fontWeight:600}}>{p.name}</div>
                      <div style={{fontSize:11,color:"#666",marginTop:2}}>{new Date(p.created_at).toLocaleDateString("es-CR",{day:"numeric",month:"long",year:"numeric"})}</div>
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr>
                        {["NOMBRE","SUELDO ORDINARIO","COM.","TOTAL","DEDUC "+((appSettings.ccss_pct||10.83)+"%"),isMensual?"SUELDO DEVENGADO":null,isMensual?"HACIENDA":null,"NETO POR PAGAR"].filter(Boolean).map(h=>(
                          <th key={h} style={{padding:"8px 10px",textAlign:h==="NOMBRE"?"left":"right",borderBottom:"2px solid #333",fontWeight:700,fontSize:10}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {(p.lines||[]).map((l,i) => {
                          const devengado = l.gross_total - l.ccss_amount;
                          return (
                          <tr key={i} style={{borderBottom:"1px solid #ddd"}}>
                            <td style={{padding:"6px 10px",fontWeight:600}}>{l.agent_name}</td>
                            <td style={{padding:"6px 10px",textAlign:"right"}}>{Number(l.salary).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            <td style={{padding:"6px 10px",textAlign:"right"}}>{l.commissions > 0 ? Number(l.commissions).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2}) : "-"}</td>
                            <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600}}>{Number(l.gross_total).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            <td style={{padding:"6px 10px",textAlign:"right"}}>{Number(l.ccss_amount).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                            {isMensual&&<td style={{padding:"6px 10px",textAlign:"right"}}>{Number(devengado).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>}
                            {isMensual&&<td style={{padding:"6px 10px",textAlign:"right"}}>{l.rent_amount > 0 ? Number(l.rent_amount).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2}) : "-"}</td>}
                            <td style={{padding:"6px 10px",textAlign:"right",fontWeight:700}}>{Number(l.net_pay).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          </tr>
                        );})}
                        <tr style={{borderTop:"2px solid #333",fontWeight:800}}>
                          <td style={{padding:"8px 10px"}}></td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>{Number((p.lines||[]).reduce((s,l)=>s+l.salary,0)).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>{p.total_commissions > 0 ? Number(p.total_commissions).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2}) : "-"}</td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>{Number(p.total_gross).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          <td style={{padding:"8px 10px",textAlign:"right"}}>{Number(p.total_ccss).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                          {isMensual&&<td style={{padding:"8px 10px",textAlign:"right"}}>{Number(p.total_gross - p.total_ccss).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>}
                          {isMensual&&<td style={{padding:"8px 10px",textAlign:"right"}}>{p.total_rent > 0 ? Number(p.total_rent).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2}) : "-"}</td>}
                          <td style={{padding:"8px 10px",textAlign:"right"}}>{Number(p.total_net).toLocaleString("es-CR",{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                        </tr>
                      </tbody>
                    </table>
                    {p.status === "paid" && (<div style={{marginTop:20,padding:"10px 16px",border:"1px solid #ddd",borderRadius:6,fontSize:12}}><strong>Pago:</strong> {p.paid_bank} · Ref: {p.paid_reference||"-"} · Fecha: {p.paid_date ? new Date(p.paid_date+"T12:00:00").toLocaleDateString("es-CR") : "-"}</div>)}
                    <div style={{marginTop:30,textAlign:"center",fontSize:10,color:"#999",borderTop:"1px solid #ddd",paddingTop:12}}>Vehículos de Costa Rica S.R.L. · Cédula Jurídica 3-101-124464</div>
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
