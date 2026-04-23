import React, { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from './supabase.js';
import { useAuth } from './AuthProvider.jsx';
import * as XLSX from 'xlsx';

// ==================================================================
// COTIZADORES DE FINANCIAMIENTO (BAC, RAPIMAX, Credito Personal)
// ==================================================================

const BAC_PLANES = {
  seminuevo: {
    anios: [2023,2024,2025,2026,2027],
    prima_min: 0.20, comision: 0.035,
    usd: { tasa_fija: 0.08, plazo_max: 96, tipo: 'fija_total' },
    crc: { tasa_fija: 0.0925, plazo_max: 96, tipo: 'fija_total' },
  },
  usado: {
    anios: [2019,2020,2021,2022],
    prima_min: 0.25, comision: 0.0325,
    usd: { tasa_fija_inicial: 0.0865, tasa_variable_piso: 0.092, plazo_max: 84, tipo: 'fija_2_anios' },
    crc: { tasa_fija_inicial: 0.0995, tasa_variable_piso: 0.102, plazo_max: 84, tipo: 'fija_2_anios' },
  },
};

const BAC_SEG_FACT = {
  reciente: {
    usd: { particular: {A:199.40,D:0.01871,F:0.00996,H:0.00173}, pickup: {A:274.50,D:0.04597,F:0.01252,H:0.00369} },
    crc: { particular: {A:97400,D:0.01827,F:0.00972,H:0.00170}, pickup: {A:133838,D:0.04490,F:0.01224,H:0.00362} },
  },
  usado: {
    usd: { particular: {A:199.40,D:0.03361,F:0.00996,H:0.00173}, pickup: {A:274.71,D:0.04596,F:0.01252,H:0.00369} },
    crc: { particular: {A:97400,D:0.03276,F:0.00972,H:0.00170}, pickup: {A:133838,D:0.04490,F:0.01224,H:0.00362} },
  },
};

const RAPIMAX_POL = {
  2027:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:72,plazo_max:96,comision:0.05},
  2026:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:72,plazo_max:96,comision:0.05},
  2025:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:72,plazo_max:96,comision:0.05},
  2024:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:72,plazo_max:96,comision:0.05},
  2023:{prima:0.20,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:72,plazo_max:96,comision:0.05},
  2022:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:60,plazo_max:84,comision:0.05},
  2021:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:60,plazo_max:84,comision:0.05},
  2020:{prima:0.25,tasa_usd:0.12,tasa_crc:0.14,spread:0.02,plazo_fijo:24,plazo_variable:60,plazo_max:84,comision:0.05},
  2019:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,spread:0.02,plazo_fijo:24,plazo_variable:36,plazo_max:60,comision:0.05},
  2018:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,spread:0.02,plazo_fijo:24,plazo_variable:36,plazo_max:60,comision:0.05},
  2017:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,spread:0.02,plazo_fijo:24,plazo_variable:36,plazo_max:60,comision:0.05},
  2016:{prima:0.25,tasa_usd:0.13,tasa_crc:0.15,spread:0.02,plazo_fijo:24,plazo_variable:36,plazo_max:60,comision:0.05},
};

const RM_SEG_ACTIVO_USD = 71;
const RM_SEG_ACTIVO_CRC = 34100;
const RM_FACTOR_SD = 0.37536;
const RM_FACTOR_DES = 28.02297;
const RM_FACTOR_MULT = 1000;
const RM_GPS_USD = 32;
const RM_GPS_CRC = 17000;
const CP_CUOTA_POR_MILLON = 21000;

function cuotaAmort(P, tasaAnual, n) {
  const r = tasaAnual / 12;
  if (r === 0) return P / n;
  return P * (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
}

function calcSegBAC(valor, anio, moneda, esPickup) {
  const tabla = anio >= 2023 ? 'reciente' : 'usado';
  const tipo = esPickup ? 'pickup' : 'particular';
  const f = BAC_SEG_FACT[tabla][moneda.toLowerCase()][tipo];
  const sub = f.A + valor*f.D + valor*f.F + valor*f.H;
  return sub * 1.13 * 0.5 / 12; // formula Excel BAC: con impuesto 13%, descuento 50%, luego mensual
}

function cotizarBAC({ valorAuto, traspaso, moneda, anio, plazo, primaPct, esPickup, esAsalariado }) {
  const mon = moneda.toLowerCase();
  const plan = anio >= 2023 ? BAC_PLANES.seminuevo : (anio >= 2019 ? BAC_PLANES.usado : null);
  if (!plan) return { error: 'BAC no financia este año (solo 2019+)' };
  // Control Car: dispositivo GPS de BAC que se suma al financiamiento (instalación única)
  const controlCar = mon === 'usd' ? 436 : 256000;
  const precioTotal = valorAuto + traspaso;
  const primaMonto = precioTotal * primaPct;
  if (primaPct < plan.prima_min) return { error: `Prima mínima: ${(plan.prima_min*100).toFixed(0)}%` };
  const sinCom = precioTotal - primaMonto;
  const comision = sinCom * plan.comision;
  // Seguro auto del primer mes tambien se suma al financiamiento
  const segA = calcSegBAC(valorAuto, anio, mon, esPickup);
  const monto = sinCom + comision + controlCar + segA; // incluye Control Car + seguro 1er mes
  const cfg = plan[mon];
  if (plazo > cfg.plazo_max) return { error: `Plazo máximo: ${cfg.plazo_max} meses` };
  let cIni, cVar, tIni, tVar, tipoPlan;
  if (cfg.tipo === 'fija_total') {
    tIni = cfg.tasa_fija;
    cIni = cuotaAmort(monto, tIni, plazo);
    cVar = null;
    tipoPlan = 'Tasa fija todo el plazo';
  } else {
    tIni = cfg.tasa_fija_inicial;
    tVar = cfg.tasa_variable_piso;
    cIni = cuotaAmort(monto, tIni, plazo);
    let saldo = monto;
    const r = tIni / 12;
    for (let i = 0; i < 24; i++) {
      const int = saldo * r;
      saldo -= (cIni - int);
    }
    const mR = plazo - 24;
    if (mR > 0 && saldo > 0) cVar = cuotaAmort(saldo, tVar, mR);
    tipoPlan = 'Fija 2 años, luego variable';
  }
  const segDI = esAsalariado ? monto * 0.0115 / 12 : 0; // 1.15% anual sobre saldo
  const segDV = esAsalariado && cVar ? monto * 0.0115 / 12 : 0;
  // Colchón: aseguramos que la cuota no se quede por debajo de la real. 8% + 20 unidades mínimo.
  const cushionFactor = 1.08;
  const cushionMin = mon === 'usd' ? 20 : 10000;
  const applyCushion = (c) => Math.max(c * cushionFactor, c + cushionMin);
  const cTI = applyCushion(cIni + segA + segDI);
  const cTV = cVar ? applyCushion(cVar + segA + segDV) : null;
  return {
    banco: 'BAC',
    plan: anio >= 2023 ? 'Seminuevo' : 'Usado',
    tipoPlan, moneda: mon.toUpperCase(),
    valorAuto, traspaso, precioTotal,
    primaPct, primaMonto, primaMinPct: plan.prima_min,
    comision, comisionPct: plan.comision,
    controlCar,
    monto, plazo,
    tasaInicial: tIni, tasaVariable: tVar,
    cuotaFinInicial: cIni, cuotaFinVariable: cVar,
    segAuto: segA, segDesempleoInicial: segDI, segDesempleoVariable: segDV,
    cuotaTotalInicial: cTI, cuotaTotalVariable: cTV,
  };
}

function cotizarRAPIMAX({ valorAuto, traspaso, moneda, anio, plazo, primaPct, incluirGPS = true, incluirDesempleo = true }) {
  const mon = moneda.toLowerCase();
  const pol = RAPIMAX_POL[anio];
  if (!pol) return { error: 'RAPIMAX solo financia 2016-2027' };
  const precioTotal = valorAuto + traspaso;
  const primaMonto = precioTotal * primaPct;
  if (primaPct < pol.prima) return { error: `Prima mínima: ${(pol.prima*100).toFixed(0)}%` };
  const sinCom = precioTotal - primaMonto;
  const comision = sinCom * pol.comision;
  const monto = sinCom + comision;
  if (plazo > pol.plazo_max) return { error: `Plazo máximo: ${pol.plazo_max} meses` };
  const tF = mon === 'usd' ? pol.tasa_usd : pol.tasa_crc;
  const tV = tF + pol.spread;
  const cFF = cuotaAmort(monto, tF, plazo);
  let saldo = monto;
  const r = tF / 12;
  const mF = Math.min(pol.plazo_fijo, plazo);
  for (let i = 0; i < mF; i++) { const int = saldo * r; saldo -= (cFF - int); }
  const mV = plazo - mF;
  const cFV = mV > 0 && saldo > 0 ? cuotaAmort(saldo, tV, mV) : null;
  const segA = mon === 'usd' ? RM_SEG_ACTIVO_USD : RM_SEG_ACTIVO_CRC;
  const segSD = Math.ceil(monto * RM_FACTOR_SD / RM_FACTOR_MULT);
  const gps = incluirGPS ? (mon === 'usd' ? RM_GPS_USD : RM_GPS_CRC) : 0;
  const segDF = incluirDesempleo ? Math.ceil((cFF + segA + gps) * RM_FACTOR_DES / RM_FACTOR_MULT) : 0;
  const segDV_rm = incluirDesempleo && cFV ? Math.ceil((cFV + segA + gps) * RM_FACTOR_DES / RM_FACTOR_MULT) : 0;
  // Colchón: aseguramos cuota por encima de la real. 8% + 20 unidades mínimo.
  const cushionFactorRM = 1.08;
  const cushionMinRM = mon === 'usd' ? 20 : 10000;
  const applyCushionRM = (c) => Math.max(c * cushionFactorRM, c + cushionMinRM);
  const cTF = applyCushionRM(cFF + segA + segSD + segDF + gps);
  const cTV = cFV ? applyCushionRM(cFV + segA + segSD + segDV_rm + gps) : null;
  return {
    banco: 'RAPIMAX', tipoPlan: 'Leasing', moneda: mon.toUpperCase(),
    valorAuto, traspaso, precioTotal,
    primaPct, primaMonto, primaMinPct: pol.prima,
    comision, comisionPct: pol.comision, monto, plazo,
    plazoFijo: mF, plazoVariable: mV,
    tasaFija: tF, tasaVariable: tV,
    cuotaFinFija: cFF, cuotaFinVariable: cFV,
    segActivo: segA, segSaldoDeudor: segSD, segDesempleoFijo: segDF, segDesempleoVariable: segDV_rm, gps,
    cuotaTotalFija: cTF, cuotaTotalVariable: cTV,
  };
}

function cotizarCP({ valorAuto, traspaso, monedaAuto, tipoCambio }) {
  const precioTotal = valorAuto + traspaso;
  let precioCRC;
  if (monedaAuto.toLowerCase() === 'usd') {
    if (!tipoCambio || tipoCambio <= 0) return { error: 'TC requerido para carros en USD' };
    precioCRC = precioTotal * tipoCambio;
  } else precioCRC = precioTotal;
  const cuota = (precioCRC / 1000000) * CP_CUOTA_POR_MILLON;
  return {
    banco: 'Crédito Personal', tipoPlan: 'Solo asalariados', moneda: 'CRC',
    valorAuto, traspaso, precioTotal, precioCRC,
    tipoCambio: monedaAuto.toLowerCase() === 'usd' ? tipoCambio : null,
    cuotaMensual: cuota,
    factor: CP_CUOTA_POR_MILLON,
  };
}

function bancosDispAnio(anio) {
  const b = [];
  if (anio >= 2019 && anio <= 2027) b.push('BAC');
  if (anio >= 2016 && anio <= 2027) b.push('RAPIMAX');
  if (anio <= 2015) b.push('CP');
  return b;
}

function primaMinBAC(anio) { return anio >= 2023 ? 0.20 : (anio >= 2019 ? 0.25 : null); }
function primaMinRM(anio) { return RAPIMAX_POL[anio]?.prima || null; }
function plazoMaxBAC(anio) { return anio >= 2023 ? 96 : (anio >= 2019 ? 84 : null); }
function plazoMaxRM(anio) { return RAPIMAX_POL[anio]?.plazo_max || null; }

// ==================================================================

const exportXLS = (rows, name) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0,31));
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// CABYS vigentes Hacienda (formato v4.4, 13 dígitos)
// Las 12 categorías que realmente vende VCR
const CABYS_VEHICLES = [
  { code: "4911306020100", label: "SUV 4 puertas <= 2000cc", type: "suv" },
  { code: "4911306020200", label: "SUV 4 puertas > 2000cc", type: "suv" },
  { code: "4911307020100", label: "Todoterreno 4 puertas <= 2000cc", type: "todoterreno" },
  { code: "4911307020200", label: "Todoterreno 4 puertas > 2000cc", type: "todoterreno" },
  { code: "4911308050100", label: "Sedán 4 puertas <= 2000cc", type: "sedan" },
  { code: "4911308050200", label: "Sedán 4 puertas > 2000cc", type: "sedan" },
  { code: "4911308040100", label: "Sedán hatchback 3p <= 2000cc", type: "hatchback" },
  { code: "4911308040200", label: "Sedán hatchback 3p > 2000cc", type: "hatchback" },
  { code: "4911404000000", label: "Pick Up (hasta 5t)", type: "pickup" },
  { code: "4911200000100", label: "Microbús", type: "microbus" },
  { code: "4911315000000", label: "Vehículo eléctrico", type: "electrico" },
  { code: "4911316000000", label: "Vehículo híbrido", type: "hibrido" },
];

// Auto-sugerir CABYS segun estilo, CC y combustible
// Combustible tiene prioridad: si es electrico o hibrido, usa esos codigos especiales
// Despues el estilo decide la categoria, y el CC decide el sub-codigo (<=2000 o >2000)
const suggestCabys = (style, cc, fuel) => {
  // Combustible primero: electrico/hibrido ganan siempre
  if (fuel) {
    const f = String(fuel).toLowerCase();
    if (f.includes("electri")) return "4911315000000";
    if (f.includes("hibrido") || f.includes("híbrido") || f.includes("hybrid")) return "4911316000000";
  }

  if (!style) return "";
  const s = String(style).toLowerCase();
  const ccNum = parseInt(cc, 10);
  const isSmall = !isNaN(ccNum) && ccNum > 0 && ccNum <= 2000;

  // Sin distinción de CC
  if (s.includes("pick up") || s.includes("pickup") || s.includes("camioneta")) return "4911404000000";
  if (s.includes("microbus") || s.includes("microbús") || s.includes("van")) return "4911200000100";

  // Con distinción de CC
  if (s.includes("suv")) return isSmall ? "4911306020100" : "4911306020200";
  if (s.includes("todoterreno") || s.includes("todo terreno")) return isSmall ? "4911307020100" : "4911307020200";
  if (s.includes("hatchback")) return isSmall ? "4911308040100" : "4911308040200";
  if (s.includes("sedan") || s.includes("sedán")) return isSmall ? "4911308050100" : "4911308050200";

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
// Formatea placas costarricenses:
// - Default: MAYUSCULA sin guion (BSS530, BXR237, 353821)
// - Excepcion: CL lleva guion (CL-5136416)
const formatPlate = (val) => {
  if (!val) return "";
  // Quitar espacios y guiones existentes, poner en mayuscula
  const clean = String(val).toUpperCase().replace(/[\s-]/g, "");
  if (!clean) return "";
  // Si empieza con CL, agregar guion despues de CL
  const clMatch = clean.match(/^CL(\d+)$/);
  if (clMatch) return `CL-${clMatch[1]}`;
  // Todo lo demas: dejar pegado
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
const tabs = ["Dashboard","Inventario","Showroom","Facturas","Costos","Clientes","Ventas","Liquidaciones","Planillas","Egresos","Settings","Reportes"];

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
  // Estilos para Showroom
  input: {background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:8,padding:"9px 12px",color:"#e8eaf0",fontSize:13,fontFamily:"inherit",outline:"none"},
  select: {background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:8,padding:"9px 12px",color:"#e8eaf0",fontSize:13,fontFamily:"inherit",outline:"none",cursor:"pointer"},
  btn: {background:"#4f8cff",border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"},
  btnGhost: {background:"#1e2130",border:"1px solid #2a2d3d",borderRadius:8,padding:"9px 16px",color:"#e8eaf0",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:"inherit"},
  detailLabel: {fontSize:10,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.5,fontWeight:600,marginBottom:3},
  detailValue: {fontSize:15,color:"#e8eaf0",fontWeight:600},
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
  const { profile, signOut, isAdmin } = useAuth();
  const [tab, setTab] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false); // controlado por botón hamburguesa en móvil
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [pickedInv, setPickedInv] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  // Showroom state
  const [showroomQ, setShowroomQ] = useState("");
  const [showroomSort, setShowroomSort] = useState("precio_desc");
  const [showroomPicked, setShowroomPicked] = useState(null);
  const [cotState, setCotState] = useState({});
  const [fotoElegida, setFotoElegida] = useState(null);
  const [showroomVehicles, setShowroomVehicles] = useState([]);
  const [showroomSyncing, setShowroomSyncing] = useState(false);
  const [showroomLastSync, setShowroomLastSync] = useState(null);
  const [showAddCarModal, setShowAddCarModal] = useState(false);
  const [editingPlate, setEditingPlate] = useState(null);
  const [newCar, setNewCar] = useState({
    estado: 'DISPONIBLE', plate: '', brand: '', model: '', year: '',
    transmission: '', color: '', km: '', fuel: '', engine_cc: '',
    cylinders: '', origin: '', drivetrain: '', passengers: '', style: '',
    price: '', currency: 'USD'
  });
  const [addingCar, setAddingCar] = useState(false);

  // ============================================================
  // COSTOS DEL SHOWROOM (solo admin ve esto)
  // ============================================================
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [vehicleCost, setVehicleCost] = useState(null);        // { purchase_cost_amount, purchase_cost_currency, purchase_cost_tc, purchase_cost_date }
  const [manualCosts, setManualCosts] = useState([]);          // [{id, concept, amount, currency, tc, cost_date, description}]
  const [invoiceCosts, setInvoiceCosts] = useState([]);        // [{id, emission_date, supplier_name, total, currency, exchange_rate}]
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [editingCost, setEditingCost] = useState(null);        // para editar/crear costo manual
  const [savingPurchaseCost, setSavingPurchaseCost] = useState(false);

  // ============================================================
  // TC DEL BAC (se usa SOLO para mostrar precio de venta equivalente)
  // Los costos siguen con TC del BCCR, esto es aparte.
  // ============================================================
  const [tcBac, setTcBac] = useState(null);  // { compra, venta, fecha }
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
  const [changingVendor, setChangingVendor] = useState(false);
  const [newVendorId, setNewVendorId] = useState("");
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
  const [appSettings, setAppSettings] = useState({
    ccss_pct: 10.83,
    rent_brackets: [
      { from: 0, to: 918000, pct: 0 },
      { from: 918000, to: 1347000, pct: 10 },
      { from: 1347000, to: 2364000, pct: 15 },
      { from: 2364000, to: 4727000, pct: 20 },
      { from: 4727000, to: 999999999, pct: 25 }
    ],
    // Cargas sociales patronales (pagadas por la empresa, NO se descuentan al empleado)
    // Se usan para el asiento contable de la planilla
    employer_charges: [
      { name: "SEM", pct: 9.25 },
      { name: "IVM", pct: 5.42 },
      { name: "Banco Popular (aporte patronal)", pct: 0.25 },
      { name: "Asignaciones Familiares", pct: 5.00 },
      { name: "IMAS", pct: 0.50 },
      { name: "INA", pct: 1.50 },
      { name: "Banco Popular (aporte)", pct: 0.25 },
      { name: "ROP", pct: 2.00 },
      { name: "FCL", pct: 1.50 },
      { name: "INS (ROP)", pct: 1.00 }
    ],
    // Directores que cobran dietas mensuales + retencion fija
    directors: [
      { name: "Director 1", dieta_monthly: 250000 },
      { name: "Director 2", dieta_monthly: 250000 },
      { name: "Director 3", dieta_monthly: 250000 }
    ],
    dieta_retention_pct: 15
  });
  const [settingsTab, setSettingsTab] = useState("employees");
  const [accountingConfig, setAccountingConfig] = useState([]);
  const [searchingAccounts, setSearchingAccounts] = useState(false);
  const [suggestedMatches, setSuggestedMatches] = useState({});
  const loadAccountingConfig = async () => {
    const { data } = await supabase.from('accounting_config').select('*').order('id');
    if (data) setAccountingConfig(data);
  };
  const saveAccountingMapping = async (concept, alegra_account_id) => {
    await supabase.from('accounting_config').update({
      alegra_account_id: alegra_account_id || null,
      updated_at: new Date().toISOString()
    }).eq('concept', concept);
    await loadAccountingConfig();
  };

  const searchAlegraAccounts = async () => {
    setSearchingAccounts(true);
    try {
      const res = await fetch('/api/alegra-sync?type=list-accounts', { method: 'POST' });
      const j = await res.json();
      if (j.ok) {
        const map = {};
        (j.matches || []).forEach(m => { map[m.concept] = m.suggestions || []; });
        setSuggestedMatches(map);
        const totalMatches = (j.matches || []).filter(m => m.suggestions.length > 0).length;
        alert(`✅ Búsqueda completa\n\n${totalMatches} de ${(j.matches || []).length} conceptos tienen sugerencias\n${j.total_alegra_accounts} cuentas revisadas en Alegra\n\nElegí cada una y guardá.`);
      } else {
        alert(`❌ Error: ${j.error || 'No se pudo buscar'}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    } finally {
      setSearchingAccounts(false);
    }
  };
  const [editingAgent, setEditingAgent] = useState(null);

  // ===== NOTIFICACIONES REALTIME =====
  const [notif, setNotif] = useState(null);

  // Load data on mount
  useEffect(() => { loadInvoices(); loadSyncStatus(); loadSales(); loadAgents(); loadVehicles(); loadLiquidations(); loadPayrolls(); loadSettings(); loadBankAccounts(); loadShowroomVehicles(); loadAccountingConfig(); fetchTcBac(); }, []);

  // Cargar vendidos cuando se abre la tab o cambian filtros
  useEffect(() => {
    if (showSoldTab && isAdmin) {
      loadSoldVehicles();
    }
  }, [showSoldTab, soldFilterFrom, soldFilterTo, soldFilterTipo, isAdmin]);

  // Cargar costos cuando cambia el vehículo del showroom seleccionado
  useEffect(() => {
    if (showroomPicked?.plate) {
      loadShowroomCosts(showroomPicked.plate);
    } else {
      setVehicleCost(null);
      setManualCosts([]);
      setInvoiceCosts([]);
    }
  }, [showroomPicked?.plate]);

  const loadBankAccounts = async () => {
    const { data } = await supabase.from('bank_accounts').select('*').order('id');
    if (data) setBankAccounts(data);
  };

  const loadShowroomVehicles = async () => {
    const { data } = await supabase.from('showroom_vehicles').select('*').order('estado, brand, model');
    if (data) {
      setShowroomVehicles(data);
      if (data.length > 0 && data[0].synced_at) {
        setShowroomLastSync(data[0].synced_at);
      }
    }
  };

  const syncShowroomNow = async () => {
    setShowroomSyncing(true);
    try {
      const res = await fetch('/api/sync-showroom', { method: 'POST' });
      const j = await res.json();
      if (j.ok) {
        alert(`✅ Sincronizados ${j.synced} vehículos del Sheets\n(${j.skipped || 0} filas omitidas)`);
        await loadShowroomVehicles();
      } else {
        alert(`❌ Error: ${j.error || 'Sincronización falló'}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    } finally {
      setShowroomSyncing(false);
    }
  };

  const addCarToShowroom = async () => {
    // Validar campos obligatorios
    const required = ['plate', 'brand', 'model', 'year', 'price'];
    const missing = required.filter(f => !newCar[f]);
    if (missing.length) {
      alert(`Faltan campos obligatorios: ${missing.join(', ')}`);
      return;
    }
    setAddingCar(true);
    try {
      const res = await fetch('/api/sync-showroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', car: newCar }),
      });
      const j = await res.json();
      if (j.ok) {
        alert(`✅ Carro ${newCar.brand} ${newCar.model} (${newCar.plate}) agregado al Sheets y al Showroom.\n\nRecordá agregar las fotos manualmente en el Sheets (columna Fotos y Fotos Lovable).`);
        setShowAddCarModal(false);
        setNewCar({
          estado: 'DISPONIBLE', plate: '', brand: '', model: '', year: '',
          transmission: '', color: '', km: '', fuel: '', engine_cc: '',
          cylinders: '', origin: '', drivetrain: '', passengers: '', style: '',
          price: '', currency: 'USD'
        });
        await loadShowroomVehicles();
      } else {
        alert(`❌ Error: ${j.error || 'No se pudo agregar'}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    } finally {
      setAddingCar(false);
    }
  };

  const editCarShowroom = async (carData) => {
    setAddingCar(true);
    try {
      const res = await fetch('/api/sync-showroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', car: carData }),
      });
      const j = await res.json();
      if (j.ok) {
        alert(`✅ Carro ${carData.plate} actualizado`);
        setShowAddCarModal(false);
        setEditingPlate(null);
        setNewCar({
          estado: 'DISPONIBLE', plate: '', brand: '', model: '', year: '',
          transmission: '', color: '', km: '', fuel: '', engine_cc: '',
          cylinders: '', origin: '', drivetrain: '', passengers: '', style: '',
          price: '', currency: 'USD'
        });
        await loadShowroomVehicles();
      } else {
        alert(`❌ Error: ${j.error || 'No se pudo editar'}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    } finally {
      setAddingCar(false);
    }
  };

  const deleteCarShowroom = async (plate, brand, model) => {
    const confirm1 = window.confirm(`¿Seguro que querés borrar ${brand} ${model} (${plate}) del Showroom y del Sheets?`);
    if (!confirm1) return;
    try {
      const res = await fetch('/api/sync-showroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', plate }),
      });
      const j = await res.json();
      if (j.ok) {
        alert(`✅ ${plate} borrado`);
        await loadShowroomVehicles();
      } else {
        alert(`❌ Error: ${j.error || 'No se pudo borrar'}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    }
  };

  const openEditCarModal = (v) => {
    setEditingPlate(v.plate);
    setNewCar({
      estado: v.estado || 'DISPONIBLE',
      plate: v.plate || '',
      brand: v.brand || '',
      model: v.model || '',
      year: v.year || '',
      transmission: v.transmission || '',
      color: v.color || '',
      km: v.km || '',
      fuel: v.fuel || '',
      engine_cc: v.engine_cc || '',
      cylinders: v.cylinders || '',
      origin: v.origin || '',
      drivetrain: v.drivetrain || '',
      passengers: v.passengers || '',
      style: v.style || '',
      price: v.price || '',
      currency: v.currency || 'USD'
    });
    setShowAddCarModal(true);
  };

  // ============================================================
  // HELPERS DUAL CURRENCY (DEBEN estar antes de cualquier render function que los use)
  // ============================================================
  const fmt0 = (n) => {
    if (n == null || isNaN(n)) return "0";
    return Math.round(Number(n)).toLocaleString("es-CR");
  };

  const convertirMontos = (amount, currency, tc) => {
    const amt = parseFloat(amount) || 0;
    const t = parseFloat(tc) || 0;
    if (!t || t <= 0) return { crc: currency === "CRC" ? amt : 0, usd: currency === "USD" ? amt : 0 };
    if (currency === "USD") return { crc: amt * t, usd: amt };
    return { crc: amt, usd: amt / t };
  };

  const DualAmount = ({ amount, currency, tc, align = "left", bigSize = 18, smallSize = 11 }) => {
    const { crc, usd } = convertirMontos(amount, currency, tc);
    const origSymbol = currency === "USD" ? "$" : "₡";
    const altSymbol = currency === "USD" ? "₡" : "$";
    const altValue = currency === "USD" ? crc : usd;
    return (
      <div style={{ textAlign: align }}>
        <div style={{ fontSize: bigSize, fontWeight: 700, color: "#e8eaf0", lineHeight: 1.1 }}>
          {origSymbol}{fmt0(amount)}
        </div>
        <div style={{ fontSize: smallSize, color: "#8b8fa4", marginTop: 2 }}>
          ≈ {altSymbol}{fmt0(altValue)} · TC {tc || "?"}
        </div>
      </div>
    );
  };

  const fetchTC = async (fechaYMD) => {
    try {
      const res = await fetch('/api/alegra-lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tc', fecha: fechaYMD })
      });
      const data = await res.json();
      if (data.ok && data.tc_venta) return { tc: data.tc_venta, warning: data.warning || null };
      return { tc: null, warning: data.error || 'TC no disponible' };
    } catch (e) {
      return { tc: null, warning: e.message };
    }
  };

  const fetchTcBac = async () => {
    try {
      const res = await fetch('/api/alegra-lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tc_bac' })
      });
      const data = await res.json();
      if (data.ok && data.tc_compra_bac && data.tc_venta_bac) {
        setTcBac({
          compra: parseFloat(data.tc_compra_bac),
          venta: parseFloat(data.tc_venta_bac),
          fecha: data.fecha,
          from_cache: data.from_cache,
          warning: data.warning || null,
        });
      } else {
        setTcBac(null);
      }
    } catch (e) {
      setTcBac(null);
    }
  };

  const precioEquivalenteBac = (amount, currency) => {
    if (!tcBac || !amount) return null;
    const amt = parseFloat(amount) || 0;
    if (amt <= 0) return null;
    if (currency === "CRC") {
      return { value: amt / tcBac.compra, currency: "USD", tc: tcBac.compra, tcTipo: "compra" };
    } else if (currency === "USD") {
      return { value: amt * tcBac.venta, currency: "CRC", tc: tcBac.venta, tcTipo: "venta" };
    }
    return null;
  };

  const loadShowroomCosts = async (plate) => {
    if (!plate) return;
    setLoadingCosts(true);
    try {
      const np = plate.toUpperCase().replace(/\s+/g, '-');
      const { data: costData } = await supabase
        .from('showroom_vehicle_costs')
        .select('*')
        .eq('plate', np)
        .maybeSingle();
      setVehicleCost(costData || null);

      const { data: manuals } = await supabase
        .from('vehicle_manual_costs')
        .select('*')
        .eq('plate', np)
        .order('cost_date', { ascending: false });
      setManualCosts(manuals || []);

      const { data: invs } = await supabase
        .from('invoices')
        .select('id, emission_date, supplier_name, total, currency, exchange_rate, plate')
        .eq('plate', np)
        .order('emission_date', { ascending: false });
      setInvoiceCosts(invs || []);
    } catch (err) {
      console.error('Error cargando costos:', err);
    } finally {
      setLoadingCosts(false);
    }
  };

  const savePurchaseCost = async (plate, amount, currency, fecha) => {
    if (!plate) return { ok: false, error: 'Sin placa' };
    setSavingPurchaseCost(true);
    try {
      const np = plate.toUpperCase().replace(/\s+/g, '-');
      const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
      const tcResult = await fetchTC(fechaFinal);
      if (!tcResult.tc) {
        return { ok: false, error: `No se pudo obtener TC: ${tcResult.warning}` };
      }
      const row = {
        plate: np,
        purchase_cost_amount: parseFloat(amount) || 0,
        purchase_cost_currency: currency,
        purchase_cost_tc: tcResult.tc,
        purchase_cost_date: fechaFinal,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('showroom_vehicle_costs')
        .upsert(row, { onConflict: 'plate' });
      if (error) return { ok: false, error: error.message };
      await loadShowroomCosts(np);
      return { ok: true, tc: tcResult.tc };
    } finally {
      setSavingPurchaseCost(false);
    }
  };

  const addManualCost = async (plate, data) => {
    if (!plate) return { ok: false, error: 'Sin placa' };
    const np = plate.toUpperCase().replace(/\s+/g, '-');
    const fechaFinal = data.cost_date || new Date().toISOString().slice(0, 10);
    const tcResult = await fetchTC(fechaFinal);
    const row = {
      plate: np,
      concept: data.concept,
      description: data.description || null,
      amount: parseFloat(data.amount) || 0,
      currency: data.currency || 'CRC',
      tc: tcResult.tc || null,
      cost_date: fechaFinal,
    };
    const { error } = await supabase.from('vehicle_manual_costs').insert(row);
    if (error) return { ok: false, error: error.message };
    await loadShowroomCosts(np);
    return { ok: true };
  };

  const deleteManualCost = async (id, plate) => {
    if (!window.confirm("¿Borrar este costo manual?")) return;
    const { error } = await supabase.from('vehicle_manual_costs').delete().eq('id', id);
    if (error) { alert("Error: " + error.message); return; }
    await loadShowroomCosts(plate);
  };

  // ============================================================
  // MARCAR VENDIDO (modal con formulario de datos de venta)
  // ============================================================
  const [soldModalOpen, setSoldModalOpen] = useState(false);
  const [soldCar, setSoldCar] = useState(null);  // carro que se está vendiendo
  const [soldForm, setSoldForm] = useState({
    sold_price: '',
    sold_currency: 'USD',
    sold_at: new Date().toISOString().slice(0, 10),
    tipo_operacion: 'propia',
    client_name: '',
    client_id: '',
    commission_amount: '',
    commission_currency: 'CRC',
    notes: '',
  });
  const [savingSold, setSavingSold] = useState(false);

  // ============================================================
  // HISTÓRICO DE VENDIDOS (solo admin, solo se carga al clickear tab)
  // ============================================================
  const [showSoldTab, setShowSoldTab] = useState(false);
  const [soldList, setSoldList] = useState([]);
  const [soldLoading, setSoldLoading] = useState(false);
  const [soldFilterFrom, setSoldFilterFrom] = useState('');
  const [soldFilterTo, setSoldFilterTo] = useState('');
  const [soldFilterTipo, setSoldFilterTipo] = useState('all');
  const [soldDetailOpen, setSoldDetailOpen] = useState(null);  // un sold row para ver detalles

  const marcarVendido = (v) => {
    // Abre modal con formulario pre-llenado con datos del carro
    setSoldCar(v);
    setSoldForm({
      sold_price: v.price || '',
      sold_currency: v.currency || 'USD',
      sold_at: new Date().toISOString().slice(0, 10),
      tipo_operacion: 'propia',
      client_name: '',
      client_id: '',
      commission_amount: '',
      commission_currency: v.currency || 'CRC',
      notes: '',
    });
    setSoldModalOpen(true);
  };

  // Guarda el registro de venta en el histórico y luego marca el carro como vendido (como antes)
  const confirmarVenta = async () => {
    if (!soldCar) return;
    if (!soldForm.sold_price || parseFloat(soldForm.sold_price) <= 0) {
      alert('Ingresá el precio final de venta'); return;
    }
    if (!soldForm.sold_at) { alert('Fecha obligatoria'); return; }

    setSavingSold(true);
    try {
      const v = soldCar;

      // 1. Calcular costos snapshot (solo tiene sentido en venta propia)
      let purchaseCostCRC = 0, invoiceCostsCRC = 0, manualCostsCRC = 0;
      if (soldForm.tipo_operacion === 'propia') {
        // Traer costo de compra
        const np = v.plate.toUpperCase().replace(/\s+/g, '-');
        const { data: pcost } = await supabase.from('showroom_vehicle_costs').select('*').eq('plate', np).maybeSingle();
        if (pcost && pcost.purchase_cost_amount) {
          const amt = parseFloat(pcost.purchase_cost_amount);
          const tc = parseFloat(pcost.purchase_cost_tc) || 1;
          purchaseCostCRC = pcost.purchase_cost_currency === 'USD' ? amt * tc : amt;
        }
        // Traer facturas con esa placa
        const { data: invs } = await supabase.from('invoices').select('total, currency, exchange_rate').eq('plate', np);
        (invs || []).forEach(inv => {
          const amt = parseFloat(inv.total) || 0;
          const tc = parseFloat(inv.exchange_rate) || 1;
          invoiceCostsCRC += inv.currency === 'USD' ? amt * tc : amt;
        });
        // Traer costos manuales
        const { data: mans } = await supabase.from('vehicle_manual_costs').select('amount, currency, tc').eq('plate', np);
        (mans || []).forEach(m => {
          const amt = parseFloat(m.amount) || 0;
          const tc = parseFloat(m.tc) || 1;
          manualCostsCRC += m.currency === 'USD' ? amt * tc : amt;
        });
      }
      const totalCostCRC = purchaseCostCRC + invoiceCostsCRC + manualCostsCRC;

      // 2. Utilidad
      const soldPrice = parseFloat(soldForm.sold_price) || 0;
      const commissionAmt = parseFloat(soldForm.commission_amount) || 0;

      // TC BAC del día para convertir
      const tcBacCompra = tcBac?.compra || 0;
      const tcBacVenta = tcBac?.venta || 0;

      let utilityCRC = 0, utilityUSD = 0;
      if (soldForm.tipo_operacion === 'propia') {
        // Precio venta en CRC
        const precioVentaCRC = soldForm.sold_currency === 'USD' ? soldPrice * (tcBacVenta || 500) : soldPrice;
        utilityCRC = precioVentaCRC - totalCostCRC;
        utilityUSD = tcBacVenta ? utilityCRC / tcBacVenta : 0;
      } else {
        // Consignación: utilidad = comisión
        const commInCRC = soldForm.commission_currency === 'USD' ? commissionAmt * (tcBacVenta || 500) : commissionAmt;
        utilityCRC = commInCRC;
        utilityUSD = tcBacVenta ? commInCRC / tcBacVenta : 0;
      }

      // 3. Insertar en histórico
      const record = {
        plate: v.plate,
        brand: v.brand, model: v.model, year: v.year,
        color: v.color, km: v.km, fuel: v.fuel, transmission: v.transmission,
        engine_cc: v.engine_cc, cylinders: v.cylinders, origin: v.origin,
        drivetrain: v.drivetrain, passengers: v.passengers, style: v.style,

        listed_price: parseFloat(v.price) || null,
        listed_currency: v.currency || 'USD',
        sold_price: soldPrice,
        sold_currency: soldForm.sold_currency,

        sold_tc_bac_compra: tcBacCompra || null,
        sold_tc_bac_venta: tcBacVenta || null,
        sold_tc_bccr: null,

        sold_at: soldForm.sold_at,
        tipo_operacion: soldForm.tipo_operacion,

        client_name: soldForm.client_name || null,
        client_id: soldForm.client_id || null,

        agent_id: profile?.id || null,
        agent_name: profile?.full_name || 'Admin',

        sale_id: null,
        sale_snapshot: null,

        purchase_cost_crc: soldForm.tipo_operacion === 'propia' ? purchaseCostCRC : null,
        invoice_costs_crc: soldForm.tipo_operacion === 'propia' ? invoiceCostsCRC : null,
        manual_costs_crc: soldForm.tipo_operacion === 'propia' ? manualCostsCRC : null,
        total_cost_crc: soldForm.tipo_operacion === 'propia' ? totalCostCRC : 0,

        commission_amount: commissionAmt || null,
        commission_currency: commissionAmt ? soldForm.commission_currency : null,
        utility_crc: utilityCRC || null,
        utility_usd: utilityUSD || null,

        notes: soldForm.notes || null,
        created_by: profile?.id || null,
      };

      const { error: histErr } = await supabase.from('sold_showroom_vehicles').insert(record);
      if (histErr) {
        alert(`Error guardando histórico: ${histErr.message}`);
        setSavingSold(false);
        return;
      }

      // 4. Marcar vendido en Sheet + borrar de showroom_vehicles
      const carUpdated = {
        estado: 'VENDIDO',
        plate: v.plate, brand: v.brand, model: v.model, year: v.year,
        transmission: v.transmission, color: v.color, km: v.km, fuel: v.fuel,
        engine_cc: v.engine_cc, cylinders: v.cylinders, origin: v.origin,
        drivetrain: v.drivetrain, passengers: v.passengers, style: v.style,
        price: v.price, currency: v.currency
      };
      const res = await fetch('/api/sync-showroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', car: carUpdated }),
      });
      const j = await res.json();
      if (j.ok) {
        await supabase.from('showroom_vehicles').delete().eq('plate', v.plate);
        await loadShowroomVehicles();
        setSoldModalOpen(false);
        setSoldCar(null);
        alert(`✅ ${v.plate} vendido y guardado en histórico`);
      } else {
        alert(`⚠️ Histórico guardado, pero error al marcar en Sheets: ${j.error}`);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setSavingSold(false);
    }
  };

  // Cargar vendidos (con filtros)
  const loadSoldVehicles = async () => {
    setSoldLoading(true);
    try {
      let q = supabase.from('sold_showroom_vehicles').select('*').order('sold_at', { ascending: false });
      if (soldFilterFrom) q = q.gte('sold_at', soldFilterFrom);
      if (soldFilterTo) q = q.lte('sold_at', soldFilterTo);
      if (soldFilterTipo !== 'all') q = q.eq('tipo_operacion', soldFilterTipo);
      const { data, error } = await q;
      if (error) { console.error('Error cargando vendidos:', error); setSoldList([]); }
      else setSoldList(data || []);
    } finally {
      setSoldLoading(false);
    }
  };
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
          alegra_item_id: v.alegra_item_id || null,
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
      const res = await fetch('/api/alegra-sync?type=payment', {
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
      const res = await fetch('/api/alegra-sync?type=bill', {
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

    // Sincronizar a Alegra (modo espejo)
    let alegraMsg = "";
    try {
      const syncRes = await fetch('/api/alegra-sync?type=vehicle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_id: veh.id })
      });
      const syncData = await syncRes.json();
      if (syncData.ok && !syncData.already_synced) {
        alegraMsg = `\n🧾 Sincronizado con Alegra (ID ${syncData.alegra_item_id})`;
      } else if (syncData.already_synced) {
        alegraMsg = `\n🧾 Ya estaba en Alegra`;
      } else {
        alegraMsg = `\n⚠ No se sincronizo con Alegra: ${syncData.error || 'error'}`;
      }
    } catch (e) {
      alegraMsg = `\n⚠ No se pudo sincronizar con Alegra: ${e.message}`;
    }

    alert("Vehículo agregado al inventario: " + vehicleForm.plate.toUpperCase() + (allDone ? "" : ` (${newCompleted.size}/${totalLines} líneas completadas)`) + alegraMsg);
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
    tradein_engine_cc: "", tradein_chassis: "", tradein_style: "", tradein_cabys: "",
    sale_type: "propio", sale_currency: "USD", sale_price: "", sale_exchange_rate: "", tradein_amount: 0, down_payment: 0, deposit_signal: 0, total_balance: 0,
    payment_method: "", financing_term_months: "", financing_interest_pct: "", financing_amount: "",
    credit_due_days: "",
    deposits: [{ bank: "", reference: "", date: new Date().toISOString().split('T')[0], amount: "" }],
    transfer_included: false, transfer_in_price: false, transfer_in_financing: false,
    transfer_amount: "",
    has_insurance: false, insurance_months: "",
    observations: "",
    agent1_id: "", agent2_id: "",
    client_signature: null, signed_at: null,
    client_has_activity: false, client_activity_code: "",
    iva_exceptional: false, iva_rate: 0,
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

  // Busqueda con boton lupa: UN SOLO call que trae Hacienda (oficial) + Alegra (contactos)
  const searchClient = async () => {
    const cedulaRaw = (saleForm?.client_cedula || "").replace(/[\s-]/g, "").trim();
    if (!cedulaRaw) {
      alert("Escribí la cédula primero.");
      return;
    }

    setSearchingClient(true);
    let foundName = "";
    let foundInHacienda = false;

    try {
      const res = await fetch('/api/alegra-lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cedula: cedulaRaw })
      });
      const data = await res.json();

      if (!data.ok) {
        alert(`Error: ${data.error || 'desconocido'}`);
        return;
      }

      // Procesar Hacienda primero (fuente oficial)
      if (data.hacienda?.found) {
        foundName = data.hacienda.nombre || "";
        foundInHacienda = true;
        const tipoMap = { "01": "fisica", "02": "juridica", "03": "dimex", "04": "extranjero" };
        const tipoDetectado = tipoMap[data.hacienda.tipo_identificacion] || saleForm?.client_id_type || "fisica";
        setSaleForm(prev => ({ ...prev, client_name: foundName, client_id_type: tipoDetectado }));
      }

      // Buscar en ventas anteriores locales
      const foundLocal = await lookupClientByCedula(cedulaRaw);
      if (foundLocal) {
        alert(foundInHacienda
          ? "✓ Nombre de Hacienda + datos de ventas anteriores cargados."
          : "✓ Cliente encontrado en ventas anteriores.");
        return;
      }

      // Procesar Alegra
      if (!data.found) {
        if (foundInHacienda) {
          alert("✓ Nombre cargado de Hacienda. Completá teléfono, correo y otros datos manualmente.");
        } else {
          alert("Cliente no encontrado. Llená los datos manualmente.");
        }
        return;
      }

      const c = data.client;
      setSaleForm(prev => ({
        ...prev,
        client_id_type: foundInHacienda ? prev.client_id_type : (c.client_id_type || prev.client_id_type || "fisica"),
        client_name: foundInHacienda ? foundName : (c.name || ""),
        client_phone1: c.phone1 || "",
        client_phone2: c.phone2 || "",
        client_email: c.email || "",
        client_address: c.address || "",
      }));
      alert(foundInHacienda
        ? "✓ Nombre de Hacienda + contactos de Alegra cargados."
        : "✓ Cliente importado de Alegra. Completá los campos restantes (trabajo, oficio, estado civil).");

    } catch (e) {
      alert(`Error de red: ${e.message}`);
    } finally {
      setSearchingClient(false);
    }
  };

  // Cálculo completo del desglose de una venta
  // Fórmula: precio + traspaso (solo si aparte) - trade-in - prima_efectiva - señal = saldo
  // IMPORTANTE: "prima_efectiva" = MAX(down_payment, sum(deposits))
  // Los depósitos son el desglose detallado de la prima. Si el usuario mete ambos,
  // se toma el mayor para no contar doble. Esto tolera casos donde:
  //   - Solo se mete monto total en "Prima" (sin detallar depósitos)
  //   - Solo se meten depósitos individuales (sin repetir total en "Prima")
  //   - Se mete el total en "Prima" y además el desglose en depósitos (coinciden)
  const computeBreakdown = (form) => {
    const salePrice = parseFloat(form.sale_price) || 0;
    const tradein = parseFloat(form.tradein_amount) || 0;
    const down = parseFloat(form.down_payment) || 0;
    const signal = parseFloat(form.deposit_signal) || 0;
    const depsTotal = (form.deposits || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);
    const primaEfectiva = Math.max(down, depsTotal);
    const transferApart = !!form.transfer_included && !form.transfer_in_price && !form.transfer_in_financing;
    const transferExtra = transferApart ? (parseFloat(form.transfer_amount) || 0) : 0;
    const balance = salePrice + transferExtra - tradein - primaEfectiva - signal;
    return { salePrice, transferExtra, transferApart, tradein, down, signal, depsTotal, primaEfectiva, balance };
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
      const primaTotal = Math.max(parseFloat(form.down_payment) || 0, depositsTotal(form));
      if (primaTotal > 0) {
        obs += `, cliente aporta prima de ${fmt(primaTotal, form.sale_currency === "CRC" ? "CRC" : "USD")}`;
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

  const saveSale = async (targetStatus = "pendiente") => {
    // Validaciones base (siempre obligatorias)
    if (!saleForm.client_name || !saleForm.sale_price) { alert("Nombre del cliente y precio son requeridos"); return; }
    if (!saleForm.sale_exchange_rate || parseFloat(saleForm.sale_exchange_rate) <= 0) { alert("Tipo de cambio es requerido"); return; }

    // Si es reserva: menos validaciones, solo lo esencial
    if (targetStatus === "reservado") {
      if (!saleForm.client_cedula) { alert("Cédula del cliente es requerida para reservar"); return; }
      if (!saleForm.vehicle_plate) { alert("Placa del vehículo es requerida"); return; }
      // No se validan depósitos ni saldo para una reserva
    } else {
      // targetStatus === "pendiente": validación completa de depósitos y saldo
      const validDeposits = (saleForm.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0);
      if (validDeposits.length === 0) {
        alert("Para enviar a aprobación debés agregar al menos un depósito con monto.\n\nSi aún no hay depósitos, usá 'Guardar como Reserva' en su lugar.");
        return;
      }
      for (const d of validDeposits) {
        if (!d.bank || !d.reference) {
          alert("Cada depósito debe tener banco y número de referencia.");
          return;
        }
      }

      // VALIDACIÓN DE SALDO (solo para pendiente)
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
    }

    // Recomputar breakdown aquí (fuera del if) para poder usar bd.balance después
    const bd = computeBreakdown(saleForm);
    const balance = bd.balance;
    const saleType = saleForm.sale_type;
    const commPct = saleType === "consignacion_grupo" ? 1 : saleType === "consignacion_externa" ? 5 : 0;
    const commAmt = saleType !== "propio" ? (parseFloat(saleForm.sale_price) || 0) * commPct / 100 : 0;

    const row = {
      sale_date: saleForm.sale_date, status: targetStatus,
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
      tradein_engine_cc: saleForm.has_tradein ? (parseInt(saleForm.tradein_engine_cc) || null) : null,
      tradein_chassis: saleForm.has_tradein ? (saleForm.tradein_chassis || null) : null,
      tradein_style: saleForm.has_tradein ? (saleForm.tradein_style || null) : null,
      tradein_cabys: saleForm.has_tradein ? (saleForm.tradein_cabys || null) : null,
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
      credit_due_days: parseInt(saleForm.credit_due_days) || null,
      transfer_included: saleForm.transfer_included, transfer_in_price: saleForm.transfer_in_price,
      transfer_in_financing: saleForm.transfer_in_financing,
      transfer_amount: parseFloat(saleForm.transfer_amount) || 0,
      has_insurance: saleForm.has_insurance,
      insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || generateObservations(saleForm),
      client_signature: saleForm.client_signature || null,
      signed_at: saleForm.signed_at || null,
      client_has_activity: !!saleForm.client_has_activity,
      client_activity_code: saleForm.client_has_activity ? (saleForm.client_activity_code || null) : null,
      iva_exceptional: !!saleForm.iva_exceptional,
      iva_rate: saleForm.iva_exceptional ? (parseFloat(saleForm.iva_rate) || 0) : 0,
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
    const saleCurrency = saleForm.sale_currency || "CRC";
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== saleForm.agent1_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * (hasAgent2 ? 0.5 : 1);
    // FIX: Si la venta es en CRC, la comisión ya está en CRC (no multiplicar por TC)
    // Si es en USD, convertir a CRC multiplicando por el TC
    const splitCrc = saleCurrency === "USD"
      ? Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100
      : Math.round((splitAmt + Number.EPSILON) * 100) / 100;
    if (saleForm.agent1_id) {
      const ag = agents.find(a => a.id === saleForm.agent1_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent1_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc });
    }
    if (hasAgent2) {
      const ag = agents.find(a => a.id === saleForm.agent2_id);
      agentRows.push({ sale_id: data.id, agent_id: saleForm.agent2_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc });
    }
    if (agentRows.length > 0) await supabase.from('sale_agents').insert(agentRows);

    // Si se guardo como reserva, generar PDF automaticamente
    if (targetStatus === "reservado") {
      try {
        const res = await fetch('/api/approve-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: data.id, mode: 'reserve' })
        });
        const pdfData = await res.json();
        if (pdfData.ok && pdfData.pdf_url) {
          alert(`📝 Reserva guardada.\n\nPDF de reserva subido a Drive: ${pdfData.file_name}`);
        } else {
          alert(`📝 Reserva guardada pero el PDF tuvo un problema: ${pdfData.error || 'desconocido'}`);
        }
      } catch (e) {
        alert(`📝 Reserva guardada pero falló subir el PDF: ${e.message}`);
      }
    }

    await loadSales();
    setSalesView("list");
    setSaleForm(null);
  };

  const approveSale = async (id) => {
    try {
      const res = await fetch('/api/approve-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale_id: id, mode: 'approve' })
      });
      const data = await res.json();

      if (data.ok && data.pdf_url) {
        // Intentar emitir factura en Alegra (borrador)
        let alegraMsg = "";
        try {
          const alegraRes = await fetch('/api/emit-alegra-invoice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sale_id: id })
          });
          const alegraData = await alegraRes.json();
          if (alegraData.ok) {
            if (alegraData.already_emitted) {
              alegraMsg = `\n🧾 Ya tenía factura Alegra: ${alegraData.alegra_invoice_id}`;
            } else {
              const tipoDoc = alegraData.document_type === 'ticket' ? 'Tiquete' : 'Factura';
              alegraMsg = `\n🧾 ${tipoDoc} creado como BORRADOR en Alegra.\nRevisá y timbrá desde Alegra.`;
            }
          } else {
            alegraMsg = `\n⚠ No se pudo crear en Alegra: ${alegraData.error || 'error'}`;
          }
        } catch (e) {
          alegraMsg = `\n⚠ No se pudo conectar con Alegra: ${e.message}`;
        }

        // Si hay trade-in, crearlo en el inventario
        let tradeinMsg = "";
        try {
          const trRes = await fetch('/api/create-tradein-vehicle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sale_id: id })
          });
          const trData = await trRes.json();
          if (trData.ok) {
            if (trData.skipped) {
              // Sin trade-in, no mostrar nada
            } else if (trData.already_exists) {
              tradeinMsg = `\n🚗 Trade-in ${trData.plate} ya estaba en inventario.`;
            } else {
              tradeinMsg = `\n🚗 Trade-in ${trData.plate} agregado al inventario como DISPONIBLE.`;
            }
          } else {
            tradeinMsg = `\n⚠ No se pudo agregar trade-in al inventario: ${trData.error || 'error'}`;
          }
        } catch (e) {
          tradeinMsg = `\n⚠ Error agregando trade-in al inventario: ${e.message}`;
        }

        // Si hay trade-in, crear factura de COMPRA en Alegra
        let billMsg = "";
        try {
          const billRes = await fetch('/api/create-tradein-bill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sale_id: id })
          });
          const billData = await billRes.json();
          if (billData.ok) {
            if (billData.skipped) {
              // Sin trade-in, nada que mostrar
            } else if (billData.already_created) {
              billMsg = `\n📝 Factura de compra ya existia: ${billData.bill_number || ''}`;
            } else {
              billMsg = `\n📝 Factura de compra ${billData.bill_number} creada en Alegra (TC: ${billData.tc_used}).`;
            }
          } else {
            billMsg = `\n⚠ No se pudo crear factura de compra: ${billData.error || 'error'}`;
          }
        } catch (e) {
          billMsg = `\n⚠ Error creando factura de compra: ${e.message}`;
        }

        alert(`✓ Venta aprobada y PDF generado.\n\nArchivo: ${data.file_name}\nSe subió a la carpeta "PLAN DE VENTAS DIGITAL" en Google Drive.${alegraMsg}${tradeinMsg}${billMsg}`);
      } else if (data.ok && data.approved) {
        // Aprobada pero el PDF o Drive falló
        const warn = data.error || 'El PDF no se pudo procesar completamente.';
        alert(`⚠ Venta aprobada, pero: ${warn}\n\nPuedes reintentar más tarde.`);
      } else {
        alert(`Error: ${data.error || 'No se pudo aprobar'}`);
        return;
      }

      await loadSales();
      setPickedSale(prev => prev ? { ...prev, status: "aprobada" } : null);
      setConfirmApprove(null);
    } catch (e) {
      alert(`Error de red: ${e.message}`);
    }
  };

  const rejectSale = async (id, reason) => {
    await supabase.from('sales').update({ status: "rechazada", rejected_reason: reason || "Rechazada" }).eq('id', id);
    await loadSales();
    setPickedSale(prev => prev ? { ...prev, status: "rechazada" } : null);
  };

  // Eliminar venta completa (solo admin). Borra sale + sale_agents + sale_deposits
  const deleteSale = async (sale) => {
    const confirm1 = confirm(`¿ELIMINAR la venta #${sale.sale_number}?\n\nCliente: ${sale.client_name}\nVehículo: ${sale.vehicle_brand} ${sale.vehicle_model} (${sale.vehicle_plate})\nPrecio: ${fmt(sale.sale_price, sale.sale_currency || 'CRC')}\n\nEsta acción NO se puede deshacer.`);
    if (!confirm1) return;

    const typed = prompt(`Para confirmar, escriba: ELIMINAR`);
    if (typed !== "ELIMINAR") {
      alert("Cancelado. Debe escribir exactamente 'ELIMINAR'");
      return;
    }

    try {
      // Borrar en orden: agents -> deposits -> sale
      await supabase.from('sale_agents').delete().eq('sale_id', sale.id);
      await supabase.from('sale_deposits').delete().eq('sale_id', sale.id);
      const { error } = await supabase.from('sales').delete().eq('id', sale.id);
      if (error) { alert("Error al eliminar: " + error.message); return; }

      await loadSales();
      setPickedSale(null);
      alert(`✅ Venta #${sale.sale_number} eliminada`);
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  // Cambiar vendedor de una venta. Requiere PIN admin.
  // Borra TODOS los sale_agents anteriores y deja solo el nuevo vendedor con 100% de la comisión
  const changeSaleVendor = async (sale, newAgentId) => {
    if (!newAgentId) { alert("Seleccione un vendedor"); return; }

    const pin = prompt("Ingrese su PIN de administrador para cambiar el vendedor:");
    if (!pin) return;

    // Validar PIN (el admin tiene PIN propio guardado en profiles o en una tabla, uso confirm simple si no)
    const expectedPin = profile?.admin_pin || "1234"; // fallback
    if (pin !== expectedPin) {
      // Si no hay admin_pin configurado, al menos verificar con confirm
      if (!profile?.admin_pin) {
        if (!confirm(`¿Confirma cambiar el vendedor a ${agents.find(a => a.id === newAgentId)?.name}?\n\nEsto eliminará todos los agentes anteriores y dejará solo el nuevo con el 100% de la comisión.`)) {
          return;
        }
      } else {
        alert("PIN incorrecto");
        return;
      }
    }

    const newAgent = agents.find(a => a.id === newAgentId);
    if (!newAgent) { alert("Agente no encontrado"); return; }

    // Calcular nueva comisión con el fix de moneda
    const salePrice = parseFloat(sale.sale_price) || 0;
    const saleTC = parseFloat(sale.sale_exchange_rate) || 0;
    const saleCurrency = sale.sale_currency || "CRC";
    const commAmt = salePrice * 0.01; // 100% de la comisión para 1 solo vendedor
    const commCrc = saleCurrency === "USD"
      ? Math.round((commAmt * saleTC + Number.EPSILON) * 100) / 100
      : Math.round((commAmt + Number.EPSILON) * 100) / 100;

    // Borrar agentes anteriores e insertar el nuevo
    await supabase.from('sale_agents').delete().eq('sale_id', sale.id);
    await supabase.from('sale_agents').insert({
      sale_id: sale.id,
      agent_id: newAgentId,
      agent_name: newAgent.name,
      commission_pct: 1,
      commission_amount: commAmt,
      commission_crc: commCrc
    });

    await loadSales();
    setPickedSale(prev => prev ? {
      ...prev,
      sale_agents: [{
        agent_id: newAgentId,
        agent_name: newAgent.name,
        commission_pct: 1,
        commission_amount: commAmt,
        commission_crc: commCrc
      }]
    } : null);
    setChangingVendor(false);
    setNewVendorId("");
    alert(`✅ Vendedor cambiado a ${newAgent.name}`);
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
      tradein_engine_cc: sale.tradein_engine_cc || "", tradein_chassis: sale.tradein_chassis || "",
      tradein_style: sale.tradein_style || "", tradein_cabys: sale.tradein_cabys || "",
      tradein_value: sale.tradein_value || 0,
      sale_type: sale.sale_type || "propio",
      sale_currency: sale.sale_currency || "USD",
      sale_price: sale.sale_price || "", sale_exchange_rate: sale.sale_exchange_rate || "",
      tradein_amount: sale.tradein_amount || 0, down_payment: sale.down_payment || 0, deposit_signal: sale.deposit_signal || 0,
      payment_method: sale.payment_method || "", financing_term_months: sale.financing_term_months || "",
      financing_interest_pct: sale.financing_interest_pct || "", financing_amount: sale.financing_amount || "",
      credit_due_days: sale.credit_due_days || "",
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
      current_status: sale.status || null,
      client_has_activity: sale.client_has_activity || false,
      client_activity_code: sale.client_activity_code || "",
      iva_exceptional: sale.iva_exceptional || false,
      iva_rate: sale.iva_rate || 0,
    });
    setPickedSale(null);
    setSalesView("form");
  };

  const updateSale = async (targetStatus = null) => {
    if (!saleForm.client_name || !saleForm.sale_price) { alert("Nombre del cliente y precio son requeridos"); return; }
    if (!saleForm.sale_exchange_rate || parseFloat(saleForm.sale_exchange_rate) <= 0) { alert("Tipo de cambio es requerido"); return; }

    // Si se pide cambiar a pendiente (completar desde reserva), validar depósitos
    if (targetStatus === "pendiente") {
      const validDeposits = (saleForm.deposits || []).filter(d => d.amount && parseFloat(d.amount) > 0);
      if (validDeposits.length === 0) {
        alert("Para enviar a aprobación necesitás al menos un depósito con monto.");
        return;
      }
      for (const d of validDeposits) {
        if (!d.bank || !d.reference) {
          alert("Cada depósito debe tener banco y número de referencia.");
          return;
        }
      }
    }

    // VALIDACIÓN DE SALDO (excepto si sigue siendo reserva)
    const bd = computeBreakdown(saleForm);
    const isCash = (saleForm.payment_method || "contado") === "contado";
    const tolerance = 0.01;

    // Si NO es reserva (es decir, editando una venta aprobada/pendiente/rechazada), validar saldo
    const isReservationEdit = !targetStatus && saleForm.current_status === "reservado";
    if (!isReservationEdit) {
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
    }

    const balance = bd.balance;
    const saleType = saleForm.sale_type;
    const commPct = saleType === "consignacion_grupo" ? 1 : saleType === "consignacion_externa" ? 5 : 0;
    const commAmt = saleType !== "propio" ? (parseFloat(saleForm.sale_price) || 0) * commPct / 100 : 0;
    const row = {
      sale_date: saleForm.sale_date,
      ...(targetStatus ? { status: targetStatus } : {}),
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
      tradein_engine_cc: saleForm.has_tradein ? (parseInt(saleForm.tradein_engine_cc) || null) : null,
      tradein_chassis: saleForm.has_tradein ? (saleForm.tradein_chassis || null) : null,
      tradein_style: saleForm.has_tradein ? (saleForm.tradein_style || null) : null,
      tradein_cabys: saleForm.has_tradein ? (saleForm.tradein_cabys || null) : null,
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
      credit_due_days: parseInt(saleForm.credit_due_days) || null,
      transfer_included: saleForm.transfer_included, transfer_in_price: saleForm.transfer_in_price,
      transfer_in_financing: saleForm.transfer_in_financing,
      transfer_amount: parseFloat(saleForm.transfer_amount) || 0,
      has_insurance: saleForm.has_insurance, insurance_months: parseInt(saleForm.insurance_months) || null,
      observations: saleForm.observations || generateObservations(saleForm),
      client_signature: saleForm.client_signature || null,
      signed_at: saleForm.signed_at || null,
      client_has_activity: !!saleForm.client_has_activity,
      client_activity_code: saleForm.client_has_activity ? (saleForm.client_activity_code || null) : null,
      iva_exceptional: !!saleForm.iva_exceptional,
      iva_rate: saleForm.iva_exceptional ? (parseFloat(saleForm.iva_rate) || 0) : 0,
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
    const saleCurrency = saleForm.sale_currency || "CRC";
    const hasAgent2 = saleForm.agent2_id && saleForm.agent2_id !== saleForm.agent1_id;
    const splitPct = hasAgent2 ? 0.5 : 1;
    const splitAmt = salePrice * 0.01 * (hasAgent2 ? 0.5 : 1);
    // FIX: Si la venta es en CRC, la comisión ya está en CRC
    const splitCrc = saleCurrency === "USD"
      ? Math.round((splitAmt * saleTC + Number.EPSILON) * 100) / 100
      : Math.round((splitAmt + Number.EPSILON) * 100) / 100;
    const agentRows = [];
    if (saleForm.agent1_id) { const ag = agents.find(a => a.id === saleForm.agent1_id); agentRows.push({ sale_id: editingSaleId, agent_id: saleForm.agent1_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc }); }
    if (hasAgent2) { const ag = agents.find(a => a.id === saleForm.agent2_id); agentRows.push({ sale_id: editingSaleId, agent_id: saleForm.agent2_id, agent_name: ag?.name || "", commission_pct: splitPct, commission_amount: splitAmt, commission_crc: splitCrc }); }
    if (agentRows.length > 0) await supabase.from('sale_agents').insert(agentRows);

    // Regenerar PDF si viene de una reserva:
    // - Actualizar reserva o pasar a pendiente: el PDF sigue siendo de "reserva" (aun no aprobado)
    // - Cuando David apruebe, se regenera con titulo "PLAN DE VENTAS"
    if (saleForm.current_status === "reservado") {
      try {
        await fetch('/api/approve-sale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sale_id: editingSaleId, mode: 'update_reserve' })
        });
      } catch (e) {
        console.error('Error actualizando PDF:', e.message);
      }
    }

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
    // Returns { total_crc, missing_tc_count } - sum in colones, and count of USD sales without TC
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
      const saleCurrency = s.sale_currency || "CRC";
      const hasTC = s.sale_exchange_rate && s.sale_exchange_rate > 0;
      // Solo se requiere TC para ventas en USD. Ventas en CRC ya tienen commission_crc directa.
      if (saleCurrency === "USD" && !hasTC && match.commission_amount > 0) {
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

    // Cargas patronales: total % de la empresa
    const employerCharges = appSettings.employer_charges || [];
    const employerPct = employerCharges.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);

    const lines = employees.map(emp => {
      const salaryQ = r2(emp.salary || 0); // salario de UNA quincena
      const commData = isMensual ? getAgentCommissions(emp.id, month, year) : { total_crc: 0, missing_tc_count: 0 };
      const comms = r2(commData.total_crc);

      // En MENSUAL: el bruto incluye Q1 + Q2 + comisiones
      // En QUINCENAL: solo 1 quincena (sin comisiones)
      const salary = isMensual ? r2(salaryQ * 2) : salaryQ;
      const grossTotal = r2(salary + comms);
      const ccssAmt = r2(grossTotal * ccss / 100);

      let rentAmt = 0;
      if (isMensual) {
        // Renta sobre salario mensual bruto
        rentAmt = calcRent(grossTotal, emp.pension_deduction || 0);
      }

      // Cargas patronales y aguinaldo: solo en planilla mensual (no aplica en quincenas)
      const employerChargesAmount = isMensual ? r2(grossTotal * employerPct / 100) : 0;
      const aguinaldoAmount = isMensual ? r2(grossTotal / 12) : 0;

      const netPay = r2(grossTotal - ccssAmt - rentAmt);
      return {
        agent_id: emp.id, agent_name: emp.name, salary, commissions: comms,
        gross_total: grossTotal, ccss_pct: ccss, ccss_amount: ccssAmt,
        rent_base: isMensual ? grossTotal : 0,
        pension_deduction: r2(emp.pension_deduction || 0),
        rent_amount: rentAmt, net_pay: netPay,
        employer_charges_amount: employerChargesAmount,
        aguinaldo_amount: aguinaldoAmount,
        missing_tc_count: commData.missing_tc_count,
      };
    });

    // Dietas directores (solo mensual)
    const directors = appSettings.directors || [];
    const dietaRetentionPct = parseFloat(appSettings.dieta_retention_pct) || 0;
    const totalDietas = isMensual ? directors.reduce((s, d) => s + (parseFloat(d.dieta_monthly) || 0), 0) : 0;
    const dietasRetencion = r2(totalDietas * dietaRetentionPct / 100);
    const dietasNeto = r2(totalDietas - dietasRetencion);

    const totals = lines.reduce((t, l) => ({
      gross: r2(t.gross + l.gross_total),
      ccss: r2(t.ccss + l.ccss_amount),
      rent: r2(t.rent + l.rent_amount),
      net: r2(t.net + l.net_pay),
      comms: r2(t.comms + l.commissions),
      employer_charges: r2(t.employer_charges + l.employer_charges_amount),
      aguinaldo: r2(t.aguinaldo + l.aguinaldo_amount),
    }), { gross: 0, ccss: 0, rent: 0, net: 0, comms: 0, employer_charges: 0, aguinaldo: 0 });

    totals.dietas = totalDietas;
    totals.dietas_retencion = dietasRetencion;
    totals.dietas_neto = dietasNeto;

    return {
      type,
      name: periodLabel,
      lines,
      totals,
      directors_snapshot: isMensual ? directors : [],
    };
  };

  const savePayroll = async (preview) => {
    const { data: pr, error } = await supabase.from('payrolls').insert({
      name: preview.name,
      period_type: preview.type,
      total_gross: preview.totals.gross,
      total_ccss: preview.totals.ccss,
      total_rent: preview.totals.rent,
      total_net: preview.totals.net,
      total_commissions: preview.totals.comms,
      total_employer_charges: preview.totals.employer_charges || 0,
      total_aguinaldo: preview.totals.aguinaldo || 0,
      total_dietas: preview.totals.dietas || 0,
      total_dietas_retencion: preview.totals.dietas_retencion || 0,
      total_dietas_neto: preview.totals.dietas_neto || 0,
      directors_snapshot: preview.directors_snapshot || [],
      status: 'draft',
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

  const [sendingJournal, setSendingJournal] = useState(false);
  const [showJournalPreview, setShowJournalPreview] = useState(false);

  // Calcula el asiento contable localmente (igual al que generará el backend) para mostrar preview
  const buildJournalPreview = (payroll) => {
    if (!payroll || !payroll.lines) return null;
    const lines = payroll.lines;
    const accMap = {};
    accountingConfig.forEach(a => { accMap[a.concept] = a; });

    const totalComisiones = lines.reduce((s, l) => s + parseFloat(l.commissions || 0), 0);
    const totalCCSSObrero = lines.reduce((s, l) => s + parseFloat(l.ccss_amount || 0), 0);
    const totalCCSSPatronal = lines.reduce((s, l) => s + parseFloat(l.employer_charges_amount || 0), 0);
    const totalCCSSTotal = totalCCSSObrero + totalCCSSPatronal;
    const totalRentaISR = lines.reduce((s, l) => s + parseFloat(l.rent_amount || 0), 0);
    const totalNetoEmpleados = lines.reduce((s, l) => s + parseFloat(l.net_pay || 0), 0);
    const totalAguinaldo = lines.reduce((s, l) => s + parseFloat(l.aguinaldo_amount || 0), 0);
    const totalDietas = parseFloat(payroll.total_dietas || 0);
    const totalDietasRet = parseFloat(payroll.total_dietas_retencion || 0);
    const totalDietasNeto = parseFloat(payroll.total_dietas_neto || 0);
    const directorsSnapshot = Array.isArray(payroll.directors_snapshot) ? payroll.directors_snapshot : [];

    const debits = [];
    const credits = [];

    // DEBITOS: sueldos desglosados por empleado
    for (const l of lines) {
      const salary = parseFloat(l.salary || 0);
      if (salary > 0) debits.push({ concept: 'sueldos_gasto', label: `Sueldo ${l.agent_name}`, amount: salary });
    }
    if (totalComisiones > 0) debits.push({ concept: 'comisiones_gasto', label: 'Comisiones', amount: totalComisiones });
    // Dietas desglosadas por director
    for (const d of directorsSnapshot) {
      const amount = parseFloat(d.dieta_monthly || 0);
      if (amount > 0) debits.push({ concept: 'dietas_gasto', label: `Dieta ${d.name}`, amount });
    }
    // Solo cargas patronales como gasto (el obrero es retención del empleado)
    if (totalCCSSPatronal > 0) debits.push({ concept: 'cargas_sociales_gasto', label: 'Cargas Sociales Patronales', amount: totalCCSSPatronal });
    if (totalAguinaldo > 0) debits.push({ concept: 'aguinaldos_gasto', label: 'Aguinaldos (provisión)', amount: totalAguinaldo });

    // CREDITOS
    if (totalNetoEmpleados > 0) credits.push({ concept: 'sueldos_por_pagar', label: 'Sueldos por Pagar', amount: totalNetoEmpleados });
    // CCSS por pagar: obrero + patronal juntos
    if (totalCCSSTotal > 0) credits.push({ concept: 'cargas_sociales_por_pagar', label: 'Cargas Sociales por Pagar (obrero + patronal)', amount: totalCCSSTotal });
    if (totalRentaISR > 0) credits.push({ concept: 'retencion_isr_empleados', label: 'Retención de ISR Empleados', amount: totalRentaISR });
    if (totalDietasNeto > 0) credits.push({ concept: 'dietas_por_pagar', label: 'Dietas por Pagar', amount: totalDietasNeto });
    if (totalDietasRet > 0) credits.push({ concept: 'retencion_dietas_por_pagar', label: 'Retención DIETAS', amount: totalDietasRet });
    if (totalAguinaldo > 0) credits.push({ concept: 'aguinaldos_por_pagar', label: 'Aguinaldos por Pagar', amount: totalAguinaldo });

    // Marcar qué cuenta está configurada y cuál no
    const enriched = (list) => list.map(e => ({
      ...e,
      alegra_id: accMap[e.concept]?.alegra_account_id || null,
      configured: !!accMap[e.concept]?.alegra_account_id,
    }));

    const d = enriched(debits);
    const c = enriched(credits);
    const totalDebit = d.reduce((s, e) => s + e.amount, 0);
    const totalCredit = c.reduce((s, e) => s + e.amount, 0);
    const balanced = Math.abs(totalDebit - totalCredit) < 0.02;
    const missing = [...d, ...c].filter(e => !e.configured).map(e => e.concept);

    return { debits: d, credits: c, totalDebit, totalCredit, balanced, missing };
  };

  const sendJournalToAlegra = async (payrollId) => {
    const preview = buildJournalPreview(pickedPay);
    if (!preview) return;
    if (!preview.balanced) {
      alert(`❌ Asiento descuadrado\nDébitos: ${fmt2(preview.totalDebit)}\nCréditos: ${fmt2(preview.totalCredit)}\nDiferencia: ${fmt2(preview.totalDebit - preview.totalCredit)}`);
      return;
    }
    if (preview.missing.length > 0) {
      alert(`❌ Faltan ${preview.missing.length} cuentas por configurar en Settings → Cuentas Contables:\n\n${preview.missing.join('\n')}`);
      return;
    }
    if (!confirm(`¿Enviar asiento contable a Alegra?\n\nDébitos: ${fmt2(preview.totalDebit)}\nCréditos: ${fmt2(preview.totalCredit)}\n\nEsta acción no se puede deshacer.`)) return;

    setSendingJournal(true);
    try {
      const res = await fetch('/api/alegra-sync?type=journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payroll_id: payrollId }),
      });
      const j = await res.json();
      if (j.ok) {
        alert(`✅ Asiento enviado a Alegra\nID del asiento: #${j.alegra_journal_id}`);
        await loadPayrolls();
        setPickedPay(prev => prev ? { ...prev, alegra_journal_id: j.alegra_journal_id } : null);
        setShowJournalPreview(false);
      } else {
        alert(`❌ Error: ${j.error || 'No se pudo enviar'}${j.missing_concepts ? '\n\nFaltan: ' + j.missing_concepts.join(', ') : ''}`);
      }
    } catch (e) {
      alert(`❌ Error de red: ${e.message}`);
    } finally {
      setSendingJournal(false);
    }
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
          {[["employees","Empleados"],["ccss","CCSS Obrero"],["employer","Cargas Patronales"],["dietas","Dietas Directores"],["rent","Tramos de Renta"],["accounts","Cuentas Contables"]].map(([v,l])=>(
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
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
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
                      <div>
                        <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>ID Contacto Alegra</div>
                        <input type="number" defaultValue={a.alegra_contact_id||""} id="edit-agent-alegra" placeholder="ej: 271" style={{...S.inp,width:"100%"}} />
                      </div>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:10}}>
                      <button onClick={()=>setEditingAgent(null)} style={{...S.sel,color:"#8b8fa4",fontSize:12}}>Cancelar</button>
                      <button onClick={async()=>{
                        const name = document.getElementById('edit-agent-name').value;
                        const salary = parseFloat(document.getElementById('edit-agent-salary').value) || 0;
                        const pension = parseFloat(document.getElementById('edit-agent-pension').value) || 0;
                        const alegraId = document.getElementById('edit-agent-alegra').value;
                        const alegraContactId = alegraId ? parseInt(alegraId) : null;
                        await supabase.from('agents').update({ name, salary, pension_deduction: pension, alegra_contact_id: alegraContactId }).eq('id', a.id);
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

        {settingsTab === "employer" && (() => {
          const charges = appSettings.employer_charges || [];
          const total = charges.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
          return (
            <div style={{...S.card, padding:"18px 20px"}}>
              <div style={{fontWeight:700, fontSize:14, marginBottom:6}}>Cargas Sociales Patronales</div>
              <div style={{fontSize:12, color:"#8b8fa4", marginBottom:14}}>
                Porcentajes que paga la empresa (no se descuentan al empleado). Se usan para el asiento contable de la planilla.
              </div>

              {charges.map((c, i) => (
                <div key={i} style={{display:"grid", gridTemplateColumns:"1fr 100px 40px", gap:10, marginBottom:8, alignItems:"center"}}>
                  <input
                    type="text"
                    defaultValue={c.name}
                    id={`employer-name-${i}`}
                    style={{...S.inp}}
                    placeholder="Nombre (ej: SEM)"
                  />
                  <div style={{display:"flex", alignItems:"center", gap:4}}>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={c.pct}
                      id={`employer-pct-${i}`}
                      style={{...S.inp, width:70, textAlign:"right"}}
                    />
                    <span style={{color:"#8b8fa4"}}>%</span>
                  </div>
                  <button
                    onClick={()=>{
                      const nb = [...charges]; nb.splice(i,1);
                      saveSetting('employer_charges', nb);
                    }}
                    style={{background:"none", border:"none", color:"#e11d48", cursor:"pointer", fontSize:14}}
                  >✕</button>
                </div>
              ))}

              <div style={{display:"flex", gap:8, marginTop:14}}>
                <button
                  onClick={()=>{
                    const nb = [...charges, {name:"Nuevo cargo", pct:0}];
                    saveSetting('employer_charges', nb);
                  }}
                  style={{...S.sel, color:"#4f8cff", background:"#4f8cff10", fontWeight:600, fontSize:12}}
                >+ Agregar cargo</button>
                <button
                  onClick={()=>{
                    const nb = charges.map((c, i) => ({
                      name: document.getElementById(`employer-name-${i}`).value || c.name,
                      pct: parseFloat(document.getElementById(`employer-pct-${i}`).value) || 0
                    }));
                    saveSetting('employer_charges', nb);
                    alert(`Guardado. Total: ${nb.reduce((s,c)=>s+c.pct,0).toFixed(2)}%`);
                  }}
                  style={{...S.sel, background:"#10b981", color:"#fff", fontWeight:600, border:"none", fontSize:12}}
                >Guardar todos</button>
              </div>

              <div style={{marginTop:16, padding:"10px 14px", background:"#1e2130", borderRadius:6, display:"flex", justifyContent:"space-between"}}>
                <span style={{fontSize:13, color:"#8b8fa4"}}>Total patronal:</span>
                <span style={{fontSize:14, fontWeight:700, color:"#4f8cff"}}>{total.toFixed(2)}%</span>
              </div>
            </div>
          );
        })()}

        {settingsTab === "dietas" && (() => {
          const directors = appSettings.directors || [];
          const retentionPct = parseFloat(appSettings.dieta_retention_pct) || 15;
          const totalDietas = directors.reduce((s, d) => s + (parseFloat(d.dieta_monthly) || 0), 0);
          const retencion = totalDietas * retentionPct / 100;
          const netoDietas = totalDietas - retencion;
          return (
            <div style={{...S.card, padding:"18px 20px"}}>
              <div style={{fontWeight:700, fontSize:14, marginBottom:6}}>Dietas a Directores</div>
              <div style={{fontSize:12, color:"#8b8fa4", marginBottom:14}}>
                Pagos mensuales a directores de la Junta Directiva. Se incluyen en el asiento contable como "Dietas" (débito) y generan retención de renta.
              </div>

              <div style={{marginBottom:14, padding:"10px 14px", background:"#1e2130", borderRadius:6, display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                <span style={{fontSize:13, color:"#8b8fa4"}}>Retención sobre dietas:</span>
                <div style={{display:"flex", alignItems:"center", gap:6}}>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={retentionPct}
                    id="dieta-retention-input"
                    style={{...S.inp, width:70, textAlign:"right"}}
                  />
                  <span style={{color:"#8b8fa4"}}>%</span>
                  <button
                    onClick={()=>{
                      const val = parseFloat(document.getElementById('dieta-retention-input').value);
                      if (isNaN(val) || val < 0 || val > 100) { alert("Valor inválido"); return; }
                      saveSetting('dieta_retention_pct', val);
                      alert("Retención guardada: " + val + "%");
                    }}
                    style={{...S.sel, background:"#10b981", color:"#fff", fontWeight:600, border:"none", fontSize:11}}
                  >Guardar</button>
                </div>
              </div>

              <div style={{fontSize:12, color:"#8b8fa4", marginBottom:8, fontWeight:600}}>DIRECTORES</div>
              {directors.map((d, i) => (
                <div key={i} style={{display:"grid", gridTemplateColumns:"1fr 140px 110px 40px", gap:10, marginBottom:8, alignItems:"center"}}>
                  <input
                    type="text"
                    defaultValue={d.name}
                    id={`director-name-${i}`}
                    style={{...S.inp}}
                    placeholder="Nombre del director"
                  />
                  <div style={{display:"flex", alignItems:"center", gap:4}}>
                    <span style={{color:"#8b8fa4", fontSize:12}}>₡</span>
                    <input
                      type="number"
                      defaultValue={d.dieta_monthly}
                      id={`director-dieta-${i}`}
                      style={{...S.inp, textAlign:"right"}}
                    />
                  </div>
                  <input
                    type="number"
                    defaultValue={d.alegra_contact_id || ""}
                    id={`director-alegra-${i}`}
                    style={{...S.inp, textAlign:"center"}}
                    placeholder="ID Alegra"
                  />
                  <button
                    onClick={()=>{
                      const nb = [...directors]; nb.splice(i,1);
                      saveSetting('directors', nb);
                    }}
                    style={{background:"none", border:"none", color:"#e11d48", cursor:"pointer", fontSize:14}}
                  >✕</button>
                </div>
              ))}

              <div style={{display:"flex", gap:8, marginTop:14}}>
                <button
                  onClick={()=>{
                    const nb = [...directors, {name:"Nuevo director", dieta_monthly:250000, alegra_contact_id: null}];
                    saveSetting('directors', nb);
                  }}
                  style={{...S.sel, color:"#4f8cff", background:"#4f8cff10", fontWeight:600, fontSize:12}}
                >+ Agregar director</button>
                <button
                  onClick={()=>{
                    const nb = directors.map((d, i) => ({
                      name: document.getElementById(`director-name-${i}`).value || d.name,
                      dieta_monthly: parseFloat(document.getElementById(`director-dieta-${i}`).value) || 0,
                      alegra_contact_id: document.getElementById(`director-alegra-${i}`).value ? parseInt(document.getElementById(`director-alegra-${i}`).value) : null
                    }));
                    saveSetting('directors', nb);
                    alert("Directores guardados");
                  }}
                  style={{...S.sel, background:"#10b981", color:"#fff", fontWeight:600, border:"none", fontSize:12}}
                >Guardar directores</button>
              </div>

              <div style={{marginTop:18, padding:"14px 16px", background:"#1e2130", borderRadius:8, fontSize:13}}>
                <div style={{color:"#8b8fa4", fontSize:11, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8, fontWeight:600}}>Cálculo Mensual (preview)</div>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
                  <span style={{color:"#8b8fa4"}}>Total dietas ({directors.length} directores):</span>
                  <span>{fmt2(totalDietas)}</span>
                </div>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:4, color:"#e11d48"}}>
                  <span>Retención ({retentionPct}%):</span>
                  <span>-{fmt2(retencion)}</span>
                </div>
                <div style={{display:"flex", justifyContent:"space-between", paddingTop:6, borderTop:"1px solid #2a2d3d", fontWeight:700, color:"#10b981"}}>
                  <span>Neto a pagar directores:</span>
                  <span>{fmt2(netoDietas)}</span>
                </div>
              </div>
            </div>
          );
        })()}

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

        {settingsTab === "accounts" && (
          <div style={{...S.card,padding:"18px 20px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>Mapeo de Cuentas Contables Alegra</div>
                <div style={{fontSize:11,color:"#8b8fa4"}}>
                  Cada concepto de la planilla debe apuntar a una cuenta en Alegra.
                </div>
              </div>
              <button
                onClick={searchAlegraAccounts}
                disabled={searchingAccounts}
                style={{...S.sel, background: searchingAccounts ? "#8b5cf677" : "#8b5cf6", color:"#fff", fontWeight:700, border:"none", fontSize:12, padding:"8px 14px"}}
              >
                {searchingAccounts ? "⏳ Buscando..." : "🔍 Buscar automáticamente"}
              </button>
            </div>

            <div style={{fontSize:11,color:"#8b8fa4",marginBottom:14,padding:"8px 12px",background:"#1e2130",borderRadius:6}}>
              💡 Tip: Usá "Buscar automáticamente" para que el sistema busque las cuentas en Alegra por nombre. También podés pegar el ID manualmente (ej: de la URL <code style={{color:"#4f8cff"}}>.../accounts/edit/12345</code>).
            </div>

            {accountingConfig.map((row) => {
              const suggestions = suggestedMatches[row.concept] || [];
              const hasSuggestions = suggestions.length > 0;
              return (
                <div key={row.id} style={{marginBottom:8, padding:"10px 12px", background:"#1e2130", borderRadius:6}}>
                  <div style={{display:"grid", gridTemplateColumns:"1fr 160px 100px", gap:10, alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13}}>{row.account_name}</div>
                      <div style={{fontSize:10,color:"#8b8fa4",marginTop:2}}>concepto: <code style={{color:"#4f8cff"}}>{row.concept}</code></div>
                    </div>
                    <input
                      type="number"
                      defaultValue={row.alegra_account_id || ''}
                      id={`acc-${row.concept}`}
                      placeholder="ID Alegra"
                      style={{...S.inp,textAlign:"center"}}
                    />
                    <button
                      onClick={()=>{
                        const val = document.getElementById(`acc-${row.concept}`).value;
                        const id = val ? parseInt(val) : null;
                        saveAccountingMapping(row.concept, id);
                      }}
                      style={{...S.sel,background:row.alegra_account_id?"#10b98118":"#4f8cff18",color:row.alegra_account_id?"#10b981":"#4f8cff",fontWeight:600,fontSize:11}}
                    >{row.alegra_account_id ? "Actualizar" : "Guardar"}</button>
                  </div>

                  {hasSuggestions && (
                    <div style={{marginTop:8, paddingTop:8, borderTop:"1px solid #2a2d3d"}}>
                      <div style={{fontSize:10, color:"#8b5cf6", fontWeight:700, marginBottom:6, textTransform:"uppercase", letterSpacing:0.5}}>
                        Sugerencias ({suggestions.length})
                      </div>
                      <div style={{display:"flex", flexWrap:"wrap", gap:6}}>
                        {suggestions.map(s => (
                          <button
                            key={s.id}
                            onClick={()=>saveAccountingMapping(row.concept, s.id)}
                            style={{
                              ...S.sel,
                              background: row.alegra_account_id === s.id ? "#10b98130" : "#8b5cf618",
                              color: row.alegra_account_id === s.id ? "#10b981" : "#8b5cf6",
                              fontSize:11,
                              padding:"5px 10px",
                              border: row.alegra_account_id === s.id ? "1px solid #10b98160" : "1px solid #8b5cf640"
                            }}
                          >
                            {row.alegra_account_id === s.id ? "✓ " : ""}
                            <code style={{fontSize:10, marginRight:4}}>#{s.id}</code>
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            <div style={{marginTop:14,padding:"10px 14px",background:"#f59e0b18",border:"1px solid #f59e0b44",borderRadius:6,fontSize:12,color:"#f59e0b"}}>
              ⚠️ Faltan {accountingConfig.filter(r => !r.alegra_account_id).length} cuentas por configurar antes de poder enviar asientos a Alegra.
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
      const { data: inserted, error } = await supabase.from('vehicles').insert({
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
      }).select().single();
      if (error) { alert("Error: " + error.message); return; }
      await loadVehicles(); setNewVehicleForm(null); setShowAddVehicle(false);

      // Sincronizar a Alegra (modo espejo)
      let alegraMsg = "";
      try {
        const syncRes = await fetch('/api/alegra-sync?type=vehicle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehicle_id: inserted.id })
        });
        const syncData = await syncRes.json();
        if (syncData.ok && !syncData.already_synced) {
          alegraMsg = `\n🧾 Sincronizado con Alegra (ID ${syncData.alegra_item_id})`;
        } else if (syncData.ok && syncData.already_synced) {
          alegraMsg = `\n🧾 Ya estaba en Alegra`;
        } else {
          alegraMsg = `\n⚠ No se sincronizo con Alegra: ${syncData.error || 'error'}`;
        }
      } catch (e) {
        alegraMsg = `\n⚠ Error sincronizando con Alegra: ${e.message}`;
      }
      alert(`✓ Vehículo ${inserted.plate} agregado al inventario.${alegraMsg}`);
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
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Combustible</div><select value={editingVehicle.fuel||""} onChange={e=>{const val=e.target.value;setEditingVehicle(prev=>({...prev,fuel:val,cabys_code:suggestCabys(prev.style,prev.engine_cc,val)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
              <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div><input type="number" value={editingVehicle.engine_cc||""} onChange={e=>{const val=e.target.value;setEditingVehicle(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val,prev.fuel)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} /></div>
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
                <select value={editingVehicle.style||""} onChange={e=>{const val=e.target.value;setEditingVehicle(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc,prev.fuel)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}>
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
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Combustible</div><select value={newVehicleForm.fuel||""} onChange={e=>{const val=e.target.value;setNewVehicleForm(prev=>({...prev,fuel:val,cabys_code:suggestCabys(prev.style,prev.engine_cc,val)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div><input type="number" value={newVehicleForm.engine_cc||""} onChange={e=>{const val=e.target.value;setNewVehicleForm(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val,prev.fuel)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}># Pasajeros</div><input type="number" value={newVehicleForm.passengers||""} onChange={e=>setNewVehicleForm(prev=>({...prev,passengers:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div style={{gridColumn:"1/3"}}><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Serie/Chasis</div><input value={newVehicleForm.chassis||""} onChange={e=>setNewVehicleForm(prev=>({...prev,chassis:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Fecha compra</div><input type="date" value={newVehicleForm.entry_date||""} onChange={e=>setNewVehicleForm(prev=>({...prev,entry_date:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Costo compra (₡)</div><input type="number" value={newVehicleForm.purchase_cost||""} onChange={e=>setNewVehicleForm(prev=>({...prev,purchase_cost:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Tipo cambio (ref.)</div><input type="number" value={newVehicleForm.exchange_rate||""} onChange={e=>setNewVehicleForm(prev=>({...prev,exchange_rate:e.target.value}))} placeholder="Ej: 530" style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Precio venta (₡)</div><input type="number" value={newVehicleForm.price_crc||""} onChange={e=>setNewVehicleForm(prev=>({...prev,price_crc:e.target.value}))} style={{...S.inp,width:"100%",fontSize:12}} /></div>
          <div><div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Estilo</div><select value={newVehicleForm.style||""} onChange={e=>{const val=e.target.value;setNewVehicleForm(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc,prev.fuel)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}><option value="">Seleccionar</option>{["SUV","SEDAN","PICK UP","HATCHBACK","COUPE","FAMILIAR","TODOTERRENO","MICROBUS"].map(s=><option key={s} value={s}>{s}</option>)}</select></div>
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
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            {[["all", "Todas"], ["reservado", "Reservadas"], ["pendiente", "Pendientes"], ["aprobada", "Aprobadas"], ["rechazada", "Rechazadas"]].map(([v, l]) => (
              <button key={v} onClick={() => setSaleFilter(v)} style={{ ...S.sel, background: saleFilter === v ? (v === "reservado" ? "#f59e0b20" : "#4f8cff20") : "#1e2130", color: saleFilter === v ? (v === "reservado" ? "#f59e0b" : "#4f8cff") : "#8b8fa4", fontWeight: saleFilter === v ? 600 : 400 }}>
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
                      <span style={S.badge(s.status === "aprobada" ? "#10b981" : s.status === "rechazada" ? "#e11d48" : s.status === "reservado" ? "#f59e0b" : "#f59e0b")}>
                        {s.status === "aprobada" ? "Aprobada" : s.status === "rechazada" ? "Rechazada" : s.status === "reservado" ? "📝 Reservada" : "Pendiente"}
                      </span>
                      <span style={S.badge(s.sale_type === "propio" ? "#6366f1" : s.sale_type === "consignacion_grupo" ? "#8b5cf6" : "#f97316")}>
                        {s.sale_type === "propio" ? "Propio" : s.sale_type === "consignacion_grupo" ? "Consig. Grupo 1%" : "Consig. Externa 5%"}
                      </span>
                      {s.has_tradein && <span style={S.badge("#0ea5e9")}>Trade-in</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#4f8cff" }}>{fmt(s.sale_price, s.sale_currency === "CRC" ? "CRC" : "USD")}</div>
                    {s.sale_type !== "propio" && <div style={{ fontSize: 11, color: "#10b981" }}>Comisión: {fmt(s.commission_amount, s.sale_currency === "CRC" ? "CRC" : "USD")}</div>}
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
            <h1 style={{ fontSize: 24, fontWeight: 800 }}>{editingSaleId ? (F.current_status === "reservado" ? "Editar Reserva" : "Corregir Plan de Ventas") : "Nuevo Plan de Ventas"}</h1>
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

              {/* Actividad económica para facturación Alegra */}
              <div style={{ gridColumn: "1/3", marginBottom: 10, padding: "10px 12px", background: "#1e2130", borderRadius: 8, border: "1px solid #2a2d3d" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#e8eaf0", cursor: "pointer", marginBottom: F.client_has_activity ? 10 : 0 }}>
                  <input
                    type="checkbox"
                    checked={!!F.client_has_activity}
                    onChange={e => {
                      uf("client_has_activity", e.target.checked);
                      if (!e.target.checked) uf("client_activity_code", "");
                    }}
                  />
                  ¿El cliente tiene actividad económica inscrita en Hacienda?
                </label>
                {F.client_has_activity && (
                  <div>
                    <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Número de actividad económica (formato Hacienda, ej. 4510.0) *</div>
                    <input
                      value={F.client_activity_code || ""}
                      onChange={e => uf("client_activity_code", e.target.value)}
                      placeholder="Ej: 4510.0"
                      style={{ ...S.inp, width: "100%" }}
                    />
                    <div style={{ fontSize: 10, color: "#8b8fa4", marginTop: 4 }}>
                      Si tiene actividad económica → se emite Factura. Si no → se emite Tiquete.
                    </div>
                  </div>
                )}
              </div>
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
              {fld("Estilo", "vehicle_style", {
                type: "select",
                options: [{v:"SUV",l:"SUV"},{v:"SEDAN",l:"SEDAN"},{v:"PICK UP",l:"PICK UP"},{v:"HATCHBACK",l:"HATCHBACK"},{v:"COUPE",l:"COUPE"},{v:"FAMILIAR",l:"FAMILIAR"},{v:"TODOTERRENO",l:"TODOTERRENO"},{v:"MICROBUS",l:"MICROBUS"}],
                onChange: (val) => {
                  const cabys = suggestCabys(val, F.vehicle_engine_cc, F.vehicle_fuel);
                  if (cabys && !F.vehicle_cabys) uf("vehicle_cabys", cabys);
                }
              })}
              {fld("Año", "vehicle_year", { inputType: "number", list: "dl-sale-years" })}
              {fld("Color", "vehicle_color", { list: "dl-sale-colors", upperCase: true })}
              {fld("Kilometraje", "vehicle_km", { inputType: "number" })}
              {fld("Tracción", "vehicle_drive", { type: "select", options: DRIVETRAIN_OPTIONS.map(o=>({v:o,l:o})) })}
              {fld("Combustible", "vehicle_fuel", { type: "select", options: FUEL_OPTIONS.map(o=>({v:o,l:o})) })}
              {fld("Cilindrada (CC)", "vehicle_engine_cc", {
                inputType: "number",
                onChange: (val) => {
                  const cabys = suggestCabys(F.vehicle_style, val, F.vehicle_fuel);
                  if (cabys && !F.vehicle_cabys) uf("vehicle_cabys", cabys);
                }
              })}
              <div style={{ marginBottom: 10, gridColumn: "1/3" }}>
                <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>Código CABYS</div>
                <select
                  value={F.vehicle_cabys || ""}
                  onChange={e => uf("vehicle_cabys", e.target.value)}
                  style={{ ...S.sel, width: "100%" }}
                >
                  <option value="">Seleccionar CABYS (se sugiere con estilo + CC)</option>
                  {CABYS_VEHICLES.map(c => <option key={c.code} value={c.code}>{c.code} - {c.label}</option>)}
                </select>
              </div>
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
                <div>
                  <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Estilo</div>
                  <select
                    value={F.tradein_style || ""}
                    onChange={e => {
                      const val = e.target.value;
                      setSaleForm(prev => ({
                        ...prev,
                        tradein_style: val,
                        tradein_cabys: suggestCabys(val, prev.tradein_engine_cc, prev.tradein_fuel) || prev.tradein_cabys
                      }));
                    }}
                    style={{ ...S.sel, width: "100%", fontSize: 12 }}
                  >
                    <option value="">Seleccionar</option>
                    {["SUV","SEDAN","HATCHBACK","TODOTERRENO","PICK UP","MICROBUS"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Cilindrada (CC)</div>
                  <input
                    type="number"
                    value={F.tradein_engine_cc || ""}
                    onChange={e => {
                      const val = e.target.value;
                      setSaleForm(prev => ({
                        ...prev,
                        tradein_engine_cc: val,
                        tradein_cabys: suggestCabys(prev.tradein_style, val, prev.tradein_fuel) || prev.tradein_cabys
                      }));
                    }}
                    style={{ ...S.inp, width: "100%", fontSize: 12 }}
                  />
                </div>
                {fld("Chasis (VIN)", "tradein_chassis", { upperCase: true })}
                <div>
                  <div style={{ fontSize: 10, color: "#8b8fa4", marginBottom: 2 }}>Código CABYS</div>
                  <select
                    value={F.tradein_cabys || ""}
                    onChange={e => uf("tradein_cabys", e.target.value)}
                    style={{ ...S.sel, width: "100%", fontSize: 12 }}
                  >
                    <option value="">Seleccionar</option>
                    {CABYS_VEHICLES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
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
                  <div style={{ fontSize: 12, color: "#8b8fa4", marginTop: 6, marginBottom: 4, fontStyle: "italic" }}>
                    Prima: poné el monto total o dejá el campo vacío y detallá los depósitos abajo. El sistema toma el mayor entre los dos para no sumar doble.
                  </div>
                  <div style={{ background: "#1e2130", borderRadius: 10, padding: "12px 16px", marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#8b8fa4" }}>Saldo total:</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: "#4f8cff" }}>{fmt(balance, F.sale_currency === "CRC" ? undefined : "USD")}</span>
                  </div>
                </>
              );
            })()}

            {/* IVA excepcional */}
            <div style={{ marginTop: 12, padding: "10px 12px", background: "#1e2130", borderRadius: 8, border: "1px solid #2a2d3d" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#e8eaf0", cursor: "pointer", marginBottom: F.iva_exceptional ? 10 : 0 }}>
                <input
                  type="checkbox"
                  checked={!!F.iva_exceptional}
                  onChange={e => {
                    uf("iva_exceptional", e.target.checked);
                    if (!e.target.checked) uf("iva_rate", 0);
                  }}
                />
                Caso de IVA excepcional
              </label>
              {F.iva_exceptional && (
                <div>
                  <div style={{ fontSize: 11, color: "#8b8fa4", marginBottom: 3 }}>% IVA a aplicar en la factura</div>
                  <input
                    type="number"
                    step="0.01"
                    value={F.iva_rate || ""}
                    onChange={e => uf("iva_rate", e.target.value)}
                    placeholder="Ej: 13"
                    style={{ ...S.inp, width: 120 }}
                  />
                  <div style={{ fontSize: 10, color: "#8b8fa4", marginTop: 4 }}>
                    Por defecto las ventas van como IVA exento (0%). Activá esto solo para casos especiales (carros nuevos sin inscribir, eléctricos, etc.).
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PAYMENT + DEPOSITS */}
          <div style={{ ...S.card, padding: "18px 20px", marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#4f8cff" }}>Forma de Pago</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" }}>
              {fld("Forma de pago", "payment_method", { type: "select", options: [{ v: "Contado", l: "Contado" }, { v: "Financiamiento", l: "Financiamiento" }, { v: "Mixto", l: "Mixto" }] })}
              {fld("Plazo (meses)", "financing_term_months", { inputType: "number" })}
              {fld("Interés (%)", "financing_interest_pct", { inputType: "number" })}
              {fld(`Monto financiado (${F.sale_currency === "CRC" ? "₡" : "$"})`, "financing_amount", { inputType: "number" })}
              {(F.payment_method === "Financiamiento" || F.payment_method === "Mixto") && fld("Días para cancelar saldo", "credit_due_days", { inputType: "number" })}
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
                    <select
                      value={dep.bank || ""}
                      onChange={e => { const d = [...F.deposits]; d[di] = { ...d[di], bank: e.target.value }; uf("deposits", d); }}
                      style={{ ...S.sel, width: "100%" }}
                    >
                      <option value="">Seleccionar cuenta</option>
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
                <input type="checkbox" checked={F.transfer_included} onChange={e => uf("transfer_included", e.target.checked)} /> Traspaso por aparte
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e8eaf0", cursor: "pointer" }}>
                <input type="checkbox" checked={F.transfer_in_price} onChange={e => uf("transfer_in_price", e.target.checked)} /> Traspaso incluido
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
                  <div>Comisión total: {fmt(totalComm, F.sale_currency === "CRC" ? "CRC" : "USD")} {tc > 0 && <span style={{color:"#10b981"}}>= {fmt(totalCommCrc)}</span>}</div>
                  {has2 && <div>Por vendedor: {fmt(each, F.sale_currency === "CRC" ? "CRC" : "USD")} {tc > 0 && <span style={{color:"#10b981"}}>= {fmt(eachCrc)}</span>}</div>}
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
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button onClick={() => { setSalesView("list"); setSaleForm(null); setEditingSaleId(null); }} style={{ ...S.sel, color: "#8b8fa4", padding: "12px 24px" }}>Cancelar</button>

            {(() => {
              // Caso 1: Plan nuevo (no está editando nada)
              if (!editingSaleId) {
                return (
                  <>
                    <button onClick={() => saveSale("reservado")} style={{ ...S.sel, background: "#f59e0b", color: "#fff", fontWeight: 700, padding: "12px 24px", border: "none" }}>
                      📝 Guardar como Reserva
                    </button>
                    <button onClick={() => saveSale("pendiente")} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 24px", border: "none" }}>
                      ✓ Enviar para Aprobación
                    </button>
                  </>
                );
              }

              // Caso 2: Editando un plan que está en estado "reservado"
              if (F.current_status === "reservado") {
                return (
                  <>
                    <button onClick={() => updateSale(null)} style={{ ...S.sel, background: "#f59e0b", color: "#fff", fontWeight: 700, padding: "12px 24px", border: "none" }}>
                      📝 Actualizar Reserva
                    </button>
                    <button onClick={() => updateSale("pendiente")} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 24px", border: "none" }}>
                      ✓ Completar y Enviar a Aprobación
                    </button>
                  </>
                );
              }

              // Caso 3: Editando un plan pendiente/aprobado/rechazado (botón tradicional)
              return (
                <button onClick={() => updateSale(null)} style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                  Guardar Correcciones
                </button>
              );
            })()}
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

  // ===== SHOWROOM (Inventario comercial con cotizador) =====
  const renderShowroom = () => {
    const all = showroomVehicles;
    const srQ = showroomQ;
    const srSort = showroomSort;
    const srPicked = showroomPicked;

    const filt = all.filter(v => {
      if (!srQ) return true;
      const qL = srQ.toLowerCase();
      return [v.plate, v.brand, v.model, v.color, String(v.year)].some(x => (x || "").toLowerCase().includes(qL));
    });
    const sorted = [...filt].sort((a,b) => {
      const valA = a.currency === "USD" ? (a.price || 0) : (a.price || 0) / 500;
      const valB = b.currency === "USD" ? (b.price || 0) : (b.price || 0) / 500;
      if (srSort === "precio_desc") return valB - valA;
      if (srSort === "precio_asc") return valA - valB;
      if (srSort === "anio_desc") return (b.year || 0) - (a.year || 0);
      if (srSort === "anio_asc") return (a.year || 0) - (b.year || 0);
      if (srSort === "km_asc") return (a.km || 999999) - (b.km || 999999);
      if (srSort === "km_desc") return (b.km || 0) - (a.km || 0);
      return 0;
    });

    if (srPicked) {
      const v = all.find(c => c.id === srPicked);
      if (!v) {
        // No actualizamos state durante el render (anti-patron). Mostramos mensaje.
        return <div style={{padding:20,color:"#8b8fa4"}}>Vehículo no encontrado. <button onClick={() => setShowroomPicked(null)} style={S.btn}>Volver</button></div>;
      }
      return renderShowroomDetail(v);
    }

    const lastSyncTxt = showroomLastSync
      ? new Date(showroomLastSync).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" })
      : "nunca";

    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12,marginBottom:8}}>
          <div>
            <h1 style={{fontSize:26,fontWeight:800,marginBottom:4}}>Showroom</h1>
            <div style={{fontSize:13,color:"#8b8fa4"}}>
              Inventario comercial — {all.length} vehículos • Última sincronización: {lastSyncTxt}
            </div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button
              onClick={() => setShowAddCarModal(true)}
              style={{...S.btn, background: "#10b981"}}
            >
              ➕ Agregar carro
            </button>
            <button
              onClick={syncShowroomNow}
              disabled={showroomSyncing}
              style={{...S.btn, background: showroomSyncing ? "#4f8cff77" : "#4f8cff"}}
            >
              {showroomSyncing ? "⏳ Sincronizando..." : "🔄 Sincronizar con Google Sheets"}
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowSoldTab(!showSoldTab)}
                style={{...S.btn, background: showSoldTab ? "#9333ea" : "#9333ea88"}}
              >
                {showSoldTab ? "🚗 Ver disponibles" : "📊 Ver vendidos"}
              </button>
            )}
          </div>
        </div>

        {/* ===================== VISTA VENDIDOS (SOLO ADMIN) ===================== */}
        {showSoldTab && isAdmin ? (
          <div>
            <div style={{...S.card, padding: 16, marginBottom: 16}}>
              <div style={{fontSize: 13, fontWeight: 700, marginBottom: 10, color: "#9333ea"}}>📊 Histórico de ventas y consignaciones</div>
              <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10}}>
                <div>
                  <div style={{fontSize: 10, color: "#8b8fa4", marginBottom: 4}}>DESDE</div>
                  <input type="date" value={soldFilterFrom} onChange={e => setSoldFilterFrom(e.target.value)} style={{...S.input, width: "100%"}} />
                </div>
                <div>
                  <div style={{fontSize: 10, color: "#8b8fa4", marginBottom: 4}}>HASTA</div>
                  <input type="date" value={soldFilterTo} onChange={e => setSoldFilterTo(e.target.value)} style={{...S.input, width: "100%"}} />
                </div>
                <div>
                  <div style={{fontSize: 10, color: "#8b8fa4", marginBottom: 4}}>TIPO</div>
                  <select value={soldFilterTipo} onChange={e => setSoldFilterTipo(e.target.value)} style={{...S.select, width: "100%"}}>
                    <option value="all">Todas</option>
                    <option value="propia">Venta propia</option>
                    <option value="consignacion_grupo">Consignación grupo (1%)</option>
                    <option value="consignacion_externa">Consignación externa (5%)</option>
                  </select>
                </div>
                <div style={{display: "flex", alignItems: "flex-end"}}>
                  <button onClick={() => { setSoldFilterFrom(''); setSoldFilterTo(''); setSoldFilterTipo('all'); }} style={{...S.btnGhost, width: "100%"}}>Limpiar</button>
                </div>
              </div>
            </div>

            {/* Totales */}
            {soldList.length > 0 && (() => {
              const totalVentas = soldList.length;
              const utilidadCRC = soldList.reduce((a, s) => a + (parseFloat(s.utility_crc) || 0), 0);
              const utilidadUSD = soldList.reduce((a, s) => a + (parseFloat(s.utility_usd) || 0), 0);
              const propias = soldList.filter(s => s.tipo_operacion === 'propia').length;
              const consGrupo = soldList.filter(s => s.tipo_operacion === 'consignacion_grupo').length;
              const consExt = soldList.filter(s => s.tipo_operacion === 'consignacion_externa').length;
              return (
                <div style={{...S.card, padding: 16, marginBottom: 16}}>
                  <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12}}>
                    <div>
                      <div style={{fontSize: 11, color: "#8b8fa4"}}>OPERACIONES</div>
                      <div style={{fontSize: 22, fontWeight: 800, color: "#4f8cff"}}>{totalVentas}</div>
                      <div style={{fontSize: 10, color: "#8b8fa4"}}>{propias} propias · {consGrupo} grupo · {consExt} ext</div>
                    </div>
                    <div>
                      <div style={{fontSize: 11, color: "#8b8fa4"}}>UTILIDAD TOTAL CRC</div>
                      <div style={{fontSize: 22, fontWeight: 800, color: utilidadCRC >= 0 ? "#10b981" : "#e11d48"}}>₡{fmt0(utilidadCRC)}</div>
                    </div>
                    <div>
                      <div style={{fontSize: 11, color: "#8b8fa4"}}>UTILIDAD TOTAL USD</div>
                      <div style={{fontSize: 22, fontWeight: 800, color: utilidadUSD >= 0 ? "#10b981" : "#e11d48"}}>${fmt0(utilidadUSD)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {soldLoading ? (
              <div style={{...S.card, padding: 40, textAlign: "center", color: "#8b8fa4"}}>Cargando histórico...</div>
            ) : soldList.length === 0 ? (
              <div style={{...S.card, padding: 40, textAlign: "center", color: "#8b8fa4"}}>No hay ventas registradas con esos filtros.</div>
            ) : (
              <div style={{...S.card, padding: 0, overflow: "hidden"}}>
                <div style={{overflowX: "auto"}}>
                  <table style={{width: "100%", borderCollapse: "collapse", fontSize: 12}}>
                    <thead>
                      <tr style={{background: "#1e2130"}}>
                        <th style={{padding: "10px 12px", textAlign: "left", color: "#8b8fa4", fontWeight: 700}}>FECHA</th>
                        <th style={{padding: "10px 12px", textAlign: "left", color: "#8b8fa4", fontWeight: 700}}>VEHÍCULO</th>
                        <th style={{padding: "10px 12px", textAlign: "left", color: "#8b8fa4", fontWeight: 700}}>PLACA</th>
                        <th style={{padding: "10px 12px", textAlign: "left", color: "#8b8fa4", fontWeight: 700}}>TIPO</th>
                        <th style={{padding: "10px 12px", textAlign: "left", color: "#8b8fa4", fontWeight: 700}}>CLIENTE</th>
                        <th style={{padding: "10px 12px", textAlign: "right", color: "#8b8fa4", fontWeight: 700}}>PRECIO</th>
                        <th style={{padding: "10px 12px", textAlign: "right", color: "#8b8fa4", fontWeight: 700}}>UTILIDAD/COMISIÓN</th>
                        <th style={{padding: "10px 12px", textAlign: "center", color: "#8b8fa4", fontWeight: 700}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {soldList.map(s => {
                        const tipoLabel = {
                          propia: '🚗 Propia',
                          consignacion_grupo: '🤝 Cons. Grupo',
                          consignacion_externa: '🌐 Cons. Ext',
                        }[s.tipo_operacion] || s.tipo_operacion;
                        const priceSymbol = s.sold_currency === 'USD' ? '$' : '₡';
                        return (
                          <tr key={s.id} style={{borderBottom: "1px solid #2a2d3d"}}>
                            <td style={{padding: "10px 12px"}}>{s.sold_at}</td>
                            <td style={{padding: "10px 12px"}}>{s.brand} {s.model} {s.year || ''}</td>
                            <td style={{padding: "10px 12px", color: "#4f8cff", fontWeight: 600}}>{s.plate}</td>
                            <td style={{padding: "10px 12px", fontSize: 11}}>{tipoLabel}</td>
                            <td style={{padding: "10px 12px", color: "#8b8fa4"}}>{s.client_name || "-"}</td>
                            <td style={{padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#10b981"}}>
                              {priceSymbol}{fmt0(s.sold_price)}
                            </td>
                            <td style={{padding: "10px 12px", textAlign: "right", fontWeight: 700, color: (parseFloat(s.utility_crc) || 0) >= 0 ? "#10b981" : "#e11d48"}}>
                              ₡{fmt0(s.utility_crc || 0)}
                              <div style={{fontSize: 10, color: "#8b8fa4"}}>${fmt0(s.utility_usd || 0)}</div>
                            </td>
                            <td style={{padding: "10px 12px", textAlign: "center"}}>
                              <button onClick={() => setSoldDetailOpen(s)} style={{...S.btnGhost, fontSize: 11, padding: "4px 10px"}}>Ver</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Modal detalle de venta */}
            {soldDetailOpen && (
              <div style={{position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20}} onClick={() => setSoldDetailOpen(null)}>
                <div style={{...S.card, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto", padding: 24}} onClick={e => e.stopPropagation()}>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16}}>
                    <div>
                      <h2 style={{fontSize: 20, fontWeight: 800}}>{soldDetailOpen.brand} {soldDetailOpen.model} {soldDetailOpen.year || ''}</h2>
                      <div style={{fontSize: 13, color: "#4f8cff", fontWeight: 700}}>{soldDetailOpen.plate}</div>
                    </div>
                    <button onClick={() => setSoldDetailOpen(null)} style={{background: "transparent", border: "none", color: "#8b8fa4", cursor: "pointer", fontSize: 24}}>×</button>
                  </div>

                  <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16}}>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>FECHA VENTA</div><div style={{fontWeight: 600}}>{soldDetailOpen.sold_at}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>TIPO</div><div style={{fontWeight: 600}}>{soldDetailOpen.tipo_operacion}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>CLIENTE</div><div style={{fontWeight: 600}}>{soldDetailOpen.client_name || "-"}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>CÉDULA</div><div style={{fontWeight: 600}}>{soldDetailOpen.client_id || "-"}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>AGENTE</div><div style={{fontWeight: 600}}>{soldDetailOpen.agent_name || "-"}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>PRECIO LISTADO</div><div style={{fontWeight: 600}}>{soldDetailOpen.listed_currency === 'USD' ? '$' : '₡'}{fmt0(soldDetailOpen.listed_price)}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>PRECIO VENDIDO</div><div style={{fontWeight: 700, color: "#10b981"}}>{soldDetailOpen.sold_currency === 'USD' ? '$' : '₡'}{fmt0(soldDetailOpen.sold_price)}</div></div>
                    <div><div style={{fontSize: 10, color: "#8b8fa4"}}>TC BAC DEL DÍA</div><div style={{fontSize: 12}}>C:{soldDetailOpen.sold_tc_bac_compra || "-"} / V:{soldDetailOpen.sold_tc_bac_venta || "-"}</div></div>
                  </div>

                  {soldDetailOpen.tipo_operacion === 'propia' && (
                    <div style={{background: "#1e2130", padding: 12, borderRadius: 8, marginBottom: 12}}>
                      <div style={{fontSize: 12, fontWeight: 700, marginBottom: 8}}>Desglose de costos (CRC)</div>
                      <div style={{display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4}}>
                        <span style={{color: "#8b8fa4"}}>Costo compra:</span>
                        <span>₡{fmt0(soldDetailOpen.purchase_cost_crc || 0)}</span>
                      </div>
                      <div style={{display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4}}>
                        <span style={{color: "#8b8fa4"}}>Facturas:</span>
                        <span>₡{fmt0(soldDetailOpen.invoice_costs_crc || 0)}</span>
                      </div>
                      <div style={{display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 8}}>
                        <span style={{color: "#8b8fa4"}}>Costos manuales:</span>
                        <span>₡{fmt0(soldDetailOpen.manual_costs_crc || 0)}</span>
                      </div>
                      <div style={{display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, paddingTop: 8, borderTop: "1px solid #2a2d3d"}}>
                        <span>Costo total:</span>
                        <span>₡{fmt0(soldDetailOpen.total_cost_crc || 0)}</span>
                      </div>
                    </div>
                  )}

                  {(soldDetailOpen.tipo_operacion === 'consignacion_grupo' || soldDetailOpen.tipo_operacion === 'consignacion_externa') && soldDetailOpen.commission_amount && (
                    <div style={{background: "#1e2130", padding: 12, borderRadius: 8, marginBottom: 12}}>
                      <div style={{display: "flex", justifyContent: "space-between", fontSize: 13}}>
                        <span style={{color: "#8b8fa4"}}>Comisión cobrada:</span>
                        <span style={{fontWeight: 700}}>{soldDetailOpen.commission_currency === 'USD' ? '$' : '₡'}{fmt0(soldDetailOpen.commission_amount)}</span>
                      </div>
                    </div>
                  )}

                  <div style={{display: "flex", justifyContent: "space-between", padding: 14, background: (parseFloat(soldDetailOpen.utility_crc) || 0) >= 0 ? "#10b98118" : "#e11d4818", borderRadius: 8}}>
                    <div>
                      <div style={{fontSize: 11, color: "#8b8fa4"}}>{soldDetailOpen.tipo_operacion === 'propia' ? 'UTILIDAD' : 'COMISIÓN EQUIVALENTE'}</div>
                      <div style={{fontSize: 18, fontWeight: 800, color: (parseFloat(soldDetailOpen.utility_crc) || 0) >= 0 ? "#10b981" : "#e11d48"}}>₡{fmt0(soldDetailOpen.utility_crc || 0)}</div>
                      <div style={{fontSize: 12, color: "#8b8fa4"}}>≈ ${fmt0(soldDetailOpen.utility_usd || 0)}</div>
                    </div>
                  </div>

                  {soldDetailOpen.notes && (
                    <div style={{marginTop: 12, padding: 10, background: "#1e2130", borderRadius: 8, fontSize: 12}}>
                      <div style={{fontSize: 10, color: "#8b8fa4", marginBottom: 4}}>NOTAS</div>
                      {soldDetailOpen.notes}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (<></>)}

        {/* ===================== VISTA NORMAL DISPONIBLES ===================== */}
        {!showSoldTab && (<>

        <div style={{...S.card,padding:16,marginBottom:16}}>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
            <input
              type="text"
              placeholder="🔍 Buscar por marca, modelo, placa..."
              value={srQ}
              onChange={e => setShowroomQ(e.target.value)}
              style={{...S.input,flex:"1 1 260px",minWidth:200}}
            />
            <select value={srSort} onChange={e => setShowroomSort(e.target.value)} style={S.select}>
              <option value="precio_desc">Precio: mayor a menor</option>
              <option value="precio_asc">Precio: menor a mayor</option>
              <option value="anio_desc">Año: más nuevo primero</option>
              <option value="anio_asc">Año: más viejo primero</option>
              <option value="km_asc">Km: menor a mayor</option>
              <option value="km_desc">Km: mayor a menor</option>
            </select>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div style={{...S.card,padding:40,textAlign:"center",color:"#8b8fa4"}}>
            {all.length === 0
              ? "No hay vehículos sincronizados. Presioná '🔄 Sincronizar con Google Sheets' para cargarlos."
              : "No se encontraron vehículos con ese criterio."}
          </div>
        ) : (
          <div style={{...S.card,overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:"#1f2230",borderBottom:"1px solid #2a2d3d"}}>
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Estado</th>
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Placa</th>
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Vehículo</th>
                  <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Año</th>
                  <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Estilo</th>
                  <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Km</th>
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Color</th>
                  <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Combust.</th>
                  <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Precio</th>
                  <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4}}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(v => {
                  const isDisp = v.estado === "DISPONIBLE";
                  return (
                    <tr
                      key={v.id}
                      style={{borderBottom:"1px solid #2a2d3d",transition:"background 0.15s",opacity: isDisp ? 1 : 0.7}}
                      onMouseEnter={e => e.currentTarget.style.background = "#1f2230"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{padding:"10px 12px",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>
                        <span style={{...S.badge(isDisp ? "#10b981" : "#f59e0b"),fontSize:10}}>
                          {isDisp ? "DISPONIBLE" : "RESERVADO"}
                        </span>
                      </td>
                      <td style={{padding:"10px 12px",fontWeight:700,color:"#4f8cff",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.plate || "-"}</td>
                      <td style={{padding:"10px 12px",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.brand} {v.model}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.year || "-"}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",color:"#8b8fa4",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.style || "-"}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",color:"#8b8fa4",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.km ? Number(v.km).toLocaleString("es-CR") : "-"}</td>
                      <td style={{padding:"10px 12px",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.color || "-"}</td>
                      <td style={{padding:"10px 12px",color:"#8b8fa4",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{v.fuel || "-"}</td>
                      <td style={{padding:"10px 12px",textAlign:"right",fontWeight:700,color:"#10b981",cursor:"pointer"}} onClick={() => { setCotState({}); setFotoElegida(null); setShowroomPicked(v.id); }}>{fmt(v.price, v.currency)}</td>
                      <td style={{padding:"10px 12px",textAlign:"center",whiteSpace:"nowrap"}}>
                        <button onClick={(e) => { e.stopPropagation(); marcarVendido(v); }} style={{background:"#10b981",border:"none",color:"#fff",padding:"4px 8px",borderRadius:4,cursor:"pointer",fontSize:11,marginRight:4}} title="Marcar como vendido">💰</button>
                        <button onClick={(e) => { e.stopPropagation(); openEditCarModal(v); }} style={{background:"#4f8cff",border:"none",color:"#fff",padding:"4px 8px",borderRadius:4,cursor:"pointer",fontSize:11,marginRight:4}} title="Editar">✏️</button>
                        <button onClick={(e) => { e.stopPropagation(); deleteCarShowroom(v.plate, v.brand, v.model); }} style={{background:"#ef4444",border:"none",color:"#fff",padding:"4px 8px",borderRadius:4,cursor:"pointer",fontSize:11}} title="Borrar">🗑️</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {showAddCarModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={() => !addingCar && setShowAddCarModal(false)}>
            <div style={{background:"#1a1d2b",borderRadius:12,padding:24,maxWidth:720,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e => e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <h2 style={{fontSize:20,fontWeight:800,margin:0}}>{editingPlate ? `✏️ Editar ${editingPlate}` : '➕ Agregar carro al Showroom'}</h2>
                <button onClick={() => !addingCar && (setShowAddCarModal(false), setEditingPlate(null))} style={{background:"transparent",border:"none",color:"#8b8fa4",fontSize:24,cursor:"pointer"}}>×</button>
              </div>

              <div style={{fontSize:12,color:"#8b8fa4",marginBottom:16,padding:10,background:"#2a2d3d",borderRadius:6}}>
                {editingPlate
                  ? 'Los cambios se guardarán en el Sheets (misma fila del carro) y en el Showroom.'
                  : 'Este carro se agregará al Sheets y al Showroom. Las fotos las llenás manualmente después.'}
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>ESTADO *</label>
                  <select value={newCar.estado} onChange={e => setNewCar({...newCar, estado: e.target.value})} style={S.select}>
                    <option value="DISPONIBLE">DISPONIBLE</option>
                    <option value="RESERVADO">RESERVADO</option>
                    <option value="VENDIDO">VENDIDO</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>PLACA *</label>
                  <input type="text" value={newCar.plate} onChange={e => setNewCar({...newCar, plate: e.target.value.toUpperCase()})} placeholder="BXX-123" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>MARCA *</label>
                  <input type="text" value={newCar.brand} onChange={e => setNewCar({...newCar, brand: e.target.value.toUpperCase()})} placeholder="TOYOTA" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>MODELO *</label>
                  <input type="text" value={newCar.model} onChange={e => setNewCar({...newCar, model: e.target.value.toUpperCase()})} placeholder="COROLLA" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>AÑO *</label>
                  <input type="number" value={newCar.year} onChange={e => setNewCar({...newCar, year: e.target.value})} placeholder="2023" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>PRECIO *</label>
                  <input type="number" value={newCar.price} onChange={e => setNewCar({...newCar, price: e.target.value})} placeholder="15000" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>MONEDA *</label>
                  <select value={newCar.currency} onChange={e => setNewCar({...newCar, currency: e.target.value})} style={S.select}>
                    <option value="USD">USD (Dólares)</option>
                    <option value="CRC">CRC (Colones)</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>TRANSMISIÓN</label>
                  <select value={newCar.transmission} onChange={e => setNewCar({...newCar, transmission: e.target.value})} style={S.select}>
                    <option value="">-</option>
                    <option value="Automática">Automática</option>
                    <option value="Manual">Manual</option>
                    <option value="CVT">CVT</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>COLOR</label>
                  <input type="text" value={newCar.color} onChange={e => setNewCar({...newCar, color: e.target.value})} placeholder="Blanco" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>KILOMETRAJE</label>
                  <input type="number" value={newCar.km} onChange={e => setNewCar({...newCar, km: e.target.value})} placeholder="50000" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>COMBUSTIBLE</label>
                  <select value={newCar.fuel} onChange={e => setNewCar({...newCar, fuel: e.target.value})} style={S.select}>
                    <option value="">-</option>
                    <option value="Gasolina">Gasolina</option>
                    <option value="Diesel">Diesel</option>
                    <option value="Híbrido">Híbrido</option>
                    <option value="Eléctrico">Eléctrico</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>MOTOR (CC)</label>
                  <input type="text" value={newCar.engine_cc} onChange={e => setNewCar({...newCar, engine_cc: e.target.value})} placeholder="1600" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>CILINDROS</label>
                  <input type="text" value={newCar.cylinders} onChange={e => setNewCar({...newCar, cylinders: e.target.value})} placeholder="4" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>PROCEDENCIA</label>
                  <select value={newCar.origin} onChange={e => setNewCar({...newCar, origin: e.target.value})} style={S.select}>
                    <option value="">-</option>
                    <option value="Nacional">Nacional</option>
                    <option value="Importado">Importado</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>TRACCIÓN</label>
                  <select value={newCar.drivetrain} onChange={e => setNewCar({...newCar, drivetrain: e.target.value})} style={S.select}>
                    <option value="">-</option>
                    <option value="4x2">4x2</option>
                    <option value="4x4">4x4</option>
                    <option value="AWD">AWD</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>PASAJEROS</label>
                  <input type="text" value={newCar.passengers} onChange={e => setNewCar({...newCar, passengers: e.target.value})} placeholder="5" style={S.input} />
                </div>
                <div>
                  <label style={{fontSize:11,color:"#8b8fa4",fontWeight:600,display:"block",marginBottom:4}}>ESTILO</label>
                  <select value={newCar.style} onChange={e => setNewCar({...newCar, style: e.target.value})} style={S.select}>
                    <option value="">-</option>
                    <option value="SEDAN">SEDAN</option>
                    <option value="SUV">SUV</option>
                    <option value="PICK UP">PICK UP</option>
                    <option value="HATCHBACK">HATCHBACK</option>
                    <option value="VAN">VAN</option>
                    <option value="COUPE">COUPE</option>
                  </select>
                </div>
              </div>

              <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
                <button onClick={() => { if (!addingCar) { setShowAddCarModal(false); setEditingPlate(null); } }} style={S.btnGhost} disabled={addingCar}>Cancelar</button>
                <button
                  onClick={() => editingPlate ? editCarShowroom(newCar) : addCarToShowroom()}
                  disabled={addingCar}
                  style={{...S.btn, background: addingCar ? "#10b98177" : "#10b981"}}
                >
                  {addingCar
                    ? (editingPlate ? "⏳ Guardando..." : "⏳ Agregando...")
                    : (editingPlate ? "💾 Guardar cambios" : "✅ Agregar al Sheets")}
                </button>
              </div>
            </div>
          </div>
        )}
        </>)}
      </div>
    );
  };

  // ===== SHOWROOM - FICHA + COTIZADOR =====
  const renderShowroomDetail = (v) => {
    if (!v) return <div style={{padding:20}}>Cargando...</div>;
    const precioOrig = { val: parseFloat(v.price) || 0, cur: v.currency || "USD" };
    const anioNum = parseInt(v.year) || 2020;
    const bancosDisp = bancosDispAnio(anioNum);

    // Tomar state de cotizador o usar defaults
    // Si el banco del state NO esta disponible para este año, usar el primer disponible
    const cotBancoState = cotState.banco;
    const cotBanco = (cotBancoState && bancosDisp.includes(cotBancoState))
      ? cotBancoState
      : (bancosDisp[0] || null);

    if (!cotBanco) {
      return (
        <div>
          <button onClick={() => { setShowroomPicked(null); setCotState({}); }} style={{...S.btnGhost,marginBottom:16}}>← Volver al Showroom</button>
          <div style={{...S.card,padding:24}}>
            <h1 style={{fontSize:22,fontWeight:800}}>{v.brand} {v.model} {v.year}</h1>
            <div style={{padding:20,background:"#f59e0b22",borderRadius:10,color:"#f59e0b",marginTop:20}}>
              Año sin opciones de financiamiento configuradas ({v.year || "sin año"})
            </div>
          </div>
        </div>
      );
    }

    const cotMoneda = cotState.moneda || precioOrig.cur;
    const cotTC = cotState.tc || 500;

    // Convertir precio si la moneda cambia
    let valorAutoC;
    if (cotMoneda === precioOrig.cur) {
      valorAutoC = precioOrig.val;
    } else if (precioOrig.cur === "USD" && cotMoneda === "CRC") {
      valorAutoC = precioOrig.val * cotTC;
    } else {
      valorAutoC = precioOrig.val / cotTC;
    }
    // Permitir override manual
    const valorAuto = cotState.valorAuto != null ? cotState.valorAuto : valorAutoC;
    // Traspaso: default 3.5% del valor, editable
    const traspasoAuto = valorAuto * 0.035;
    const traspaso = cotState.traspaso != null ? cotState.traspaso : traspasoAuto;

    // Prima default al minimo del banco
    let primaMin = 0;
    if (cotBanco === 'BAC') primaMin = primaMinBAC(anioNum) || 0.25;
    if (cotBanco === 'RAPIMAX') primaMin = primaMinRM(anioNum) || 0.25;
    const primaPct = cotState.primaPct != null ? cotState.primaPct : primaMin;

    // Plazo default al maximo del banco
    let plazoMax = 96;
    if (cotBanco === 'BAC') plazoMax = plazoMaxBAC(anioNum) || 96;
    if (cotBanco === 'RAPIMAX') plazoMax = plazoMaxRM(anioNum) || 96;
    const plazo = cotState.plazo != null ? cotState.plazo : plazoMax;

    const esPickup = cotState.esPickup != null ? cotState.esPickup : (v.style || '').toUpperCase().includes("PICK");
    const esAsalariado = cotState.esAsalariado != null ? cotState.esAsalariado : true;

    // Calcular cotizacion segun banco (envuelto en try para no romper la UI)
    let cot = null;
    try {
      if (cotBanco === 'BAC') {
        cot = cotizarBAC({ valorAuto, traspaso, moneda: cotMoneda, anio: anioNum, plazo, primaPct, esPickup, esAsalariado });
      } else if (cotBanco === 'RAPIMAX') {
        cot = cotizarRAPIMAX({ valorAuto, traspaso, moneda: cotMoneda, anio: anioNum, plazo, primaPct });
      } else if (cotBanco === 'CP') {
        cot = cotizarCP({ valorAuto: precioOrig.val, traspaso: precioOrig.val * 0.035, monedaAuto: precioOrig.cur, tipoCambio: cotTC });
      }
    } catch (e) {
      cot = { error: 'Error calculando cotización: ' + e.message };
    }

    const updCot = (patch) => setCotState(prev => ({ ...prev, ...patch }));

    // Generar texto de cotizacion para copiar
    const textoCot = () => {
      if (!cot || cot.error) return '';
      let t = `🚗 ${v.brand} ${v.model} ${v.year} - Placa ${v.plate}\n`;
      t += `💰 Precio: ${fmt(precioOrig.val, precioOrig.cur)}\n\n`;
      t += `━━━ COTIZACIÓN ${cot.banco} ━━━\n`;
      if (cot.banco === 'Crédito Personal') {
        t += `Valor + Traspaso: ${fmt(cot.precioCRC, 'CRC')}\n`;
        t += `Cuota mensual: ${fmt(cot.cuotaMensual, 'CRC')}\n`;
        t += `(Solo asalariados)`;
      } else {
        t += `Moneda: ${cot.moneda}\n`;
        t += `Prima (${(cot.primaPct*100).toFixed(0)}%): ${fmt(cot.primaMonto, cot.moneda)}\n`;
        t += `Plazo: ${cot.plazo} meses\n\n`;
        if (cot.banco === 'BAC') {
          if (cot.cuotaTotalVariable) {
            t += `Cuota primeros 24 meses: ${fmt(cot.cuotaTotalInicial, cot.moneda)}\n`;
            t += `Cuota resto del plazo: ${fmt(cot.cuotaTotalVariable, cot.moneda)}`;
          } else {
            t += `Cuota mensual: ${fmt(cot.cuotaTotalInicial, cot.moneda)}`;
          }
        } else {
          t += `Cuota primeros ${cot.plazoFijo} meses: ${fmt(cot.cuotaTotalFija, cot.moneda)}\n`;
          if (cot.cuotaTotalVariable) t += `Cuota resto (${cot.plazoVariable} m): ${fmt(cot.cuotaTotalVariable, cot.moneda)}`;
        }
      }
      return t;
    };

    const copyToClipboard = () => {
      navigator.clipboard.writeText(textoCot()).then(() => alert("Cotización copiada"));
    };

    const shareWhatsApp = () => {
      const msg = encodeURIComponent(textoCot());
      window.open(`https://wa.me/?text=${msg}`, '_blank');
    };

    const descargarFicha = async () => {
      try {
        // Cargar html2canvas si no esta cargado
        if (typeof window.html2canvas === 'undefined') {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
          });
        }

        // Armar ficha en DOM oculto
        // Usar foto elegida por el usuario; si no, la primera
        const fotoFichaUrl = fotoElegida || (v.photos ? v.photos.split(',')[0].trim() : '');
        const precioTxt = fmt(precioOrig.val, precioOrig.cur);

        // Convertir URL a base64 para evitar CORS en html2canvas
        // Usamos proxy publico images.weserv.nl que maneja CORS automaticamente
        const urlToBase64 = async (url) => {
          if (!url) return '';
          try {
            // Primero intentar directo (si el host soporta CORS)
            try {
              const r1 = await fetch(url, { mode: 'cors' });
              if (r1.ok) {
                const b1 = await r1.blob();
                return await new Promise((resolve, reject) => {
                  const rd = new FileReader();
                  rd.onloadend = () => resolve(rd.result);
                  rd.onerror = reject;
                  rd.readAsDataURL(b1);
                });
              }
            } catch (e1) { /* cae al proxy */ }

            // Si falla, usar proxy weserv (funciona con Drive, sitios sin CORS, etc)
            // weserv acepta URLs sin el protocolo
            const cleanUrl = url.replace(/^https?:\/\//, '');
            const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&output=jpg`;
            const r2 = await fetch(proxyUrl);
            if (!r2.ok) throw new Error(`Proxy fallo: ${r2.status}`);
            const b2 = await r2.blob();
            return await new Promise((resolve, reject) => {
              const rd = new FileReader();
              rd.onloadend = () => resolve(rd.result);
              rd.onerror = reject;
              rd.readAsDataURL(b2);
            });
          } catch (err) {
            console.warn('No se pudo cargar imagen:', url, err);
            return '';
          }
        };

        const fotoFicha = fotoFichaUrl ? await urlToBase64(fotoFichaUrl) : '';
        // Logo tambien a base64 para evitar cualquier problema
        const logoBase64 = await urlToBase64('/logo-vcr.png');

        let cotInfo = '';
        if (cot && !cot.error) {
          if (cot.banco === 'Crédito Personal') {
            cotInfo = `
              <div style="background:#f8f9fb;padding:16px;border-radius:10px;border-left:4px solid #cc0033;margin-top:16px;">
                <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">Crédito Personal</div>
                <div style="font-size:14px;color:#333;margin-bottom:4px;">Monto: ${fmt(cot.precioCRC, 'CRC')}</div>
                <div style="font-size:22px;color:#cc0033;font-weight:800;">Cuota mensual: ${fmt(cot.cuotaMensual, 'CRC')}</div>
                <div style="font-size:11px;color:#888;margin-top:6px;">Solo asalariados</div>
              </div>`;
          } else if (cot.banco === 'BAC') {
            const cuotaUno = cot.cuotaTotalInicial;
            const cuotaDos = cot.cuotaTotalVariable;
            cotInfo = `
              <div style="background:#f8f9fb;padding:16px;border-radius:10px;border-left:4px solid #cc0033;margin-top:16px;">
                <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:8px;">Crédito Prendario</div>
                <div style="font-size:13px;color:#555;margin-bottom:2px;">Prima (${(cot.primaPct*100).toFixed(0)}%): ${fmt(cot.primaMonto, cot.moneda)}</div>
                <div style="font-size:13px;color:#555;margin-bottom:2px;">Plazo: ${cot.plazo} meses</div>
                <div style="font-size:13px;color:#555;margin-bottom:10px;">A financiar: ${fmt(cot.monto, cot.moneda)}</div>
                ${cuotaDos ? `
                  <div style="font-size:20px;color:#cc0033;font-weight:800;line-height:1.3;">Primeros 24 meses: ${fmt(cuotaUno, cot.moneda)}</div>
                  <div style="font-size:16px;color:#cc0033;font-weight:700;line-height:1.3;">Resto del plazo: ${fmt(cuotaDos, cot.moneda)}</div>
                ` : `<div style="font-size:22px;color:#cc0033;font-weight:800;">Cuota mensual: ${fmt(cuotaUno, cot.moneda)}</div>`}
                <div style="font-size:11px;color:#888;margin-top:8px;">Incluye seguro cobertura total y gastos de traspaso</div>
              </div>`;
          } else if (cot.banco === 'RAPIMAX') {
            cotInfo = `
              <div style="background:#f8f9fb;padding:16px;border-radius:10px;border-left:4px solid #cc0033;margin-top:16px;">
                <div style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:8px;">Leasing</div>
                <div style="font-size:13px;color:#555;margin-bottom:2px;">Prima (${(cot.primaPct*100).toFixed(0)}%): ${fmt(cot.primaMonto, cot.moneda)}</div>
                <div style="font-size:13px;color:#555;margin-bottom:2px;">Plazo: ${cot.plazo} meses</div>
                <div style="font-size:13px;color:#555;margin-bottom:10px;">A financiar: ${fmt(cot.monto, cot.moneda)}</div>
                <div style="font-size:20px;color:#cc0033;font-weight:800;line-height:1.3;">Cuota FIJA (${cot.plazoFijo}m): ${fmt(cot.cuotaTotalFija, cot.moneda)}</div>
                ${cot.cuotaTotalVariable ? `<div style="font-size:16px;color:#cc0033;font-weight:700;line-height:1.3;">Cuota VARIABLE (${cot.plazoVariable}m): ${fmt(cot.cuotaTotalVariable, cot.moneda)}</div>` : ''}
                <div style="font-size:11px;color:#888;margin-top:8px;">Incluye seguro cobertura total y gastos de traspaso</div>
              </div>`;
          }
        }

        const specs = [];
        if (v.year) specs.push(['AÑO', v.year]);
        if (v.km != null) specs.push(['KM', Number(v.km).toLocaleString('es-CR')]);
        if (v.engine_cc) specs.push(['MOTOR', `${v.engine_cc} CC`]);
        if (v.transmission) specs.push(['TRANSMISIÓN', v.transmission]);
        if (v.fuel) specs.push(['COMBUSTIBLE', v.fuel]);
        if (v.color) specs.push(['COLOR', v.color]);
        if (v.drivetrain) specs.push(['TRACCIÓN', v.drivetrain]);
        if (v.style) specs.push(['ESTILO', v.style]);

        const specsHtml = specs.map(([l, val]) => `
          <div style="background:#f8f9fb;padding:10px 12px;border-radius:8px;">
            <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:3px;">${l}</div>
            <div style="font-size:14px;color:#111;font-weight:600;">${val}</div>
          </div>`).join('');

        const disclaimerHtml = cot && !cot.error ? `
          <div style="margin-top:14px;padding:10px 14px;background:#fff8e1;border:1px solid #f0d78e;border-radius:8px;">
            <div style="font-size:11px;color:#8a6d1e;font-style:italic;line-height:1.4;">
              * Datos del financiamiento aproximados. Los datos aquí descritos pueden variar sin previo aviso.
            </div>
          </div>` : '';

        const container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;background:#fff;font-family:Arial,sans-serif;';
        container.innerHTML = `
          <div style="padding:28px;">
            <div style="border-bottom:2px solid #cc0033;padding-bottom:14px;margin-bottom:16px;position:relative;">
              <div style="position:absolute;left:0;top:50%;transform:translateY(-50%);text-align:left;">
                <div style="font-size:13px;color:#333;font-weight:600;">📞 2240-8082</div>
                <div style="font-size:13px;color:#333;font-weight:600;margin-top:3px;">💬 2235-8869</div>
              </div>
              <div style="text-align:center;">
                <img src="${logoBase64 || '/logo-vcr.png'}" style="height:100px;" />
              </div>
              <div style="position:absolute;right:0;top:50%;transform:translateY(-50%);text-align:right;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Ficha de vehículo</div>
                <div style="font-size:13px;color:#333;">${new Date().toLocaleDateString('es-CR', { day:'2-digit', month:'long', year:'numeric' })}</div>
              </div>
            </div>

            ${fotoFicha ? `<div style="text-align:center;margin-bottom:18px;"><img src="${fotoFicha}" style="width:560px;max-width:100%;height:380px;object-fit:cover;border-radius:12px;" /></div>` : ''}

            <div style="margin-bottom:16px;">
              <div style="font-size:28px;font-weight:800;color:#111;line-height:1.2;">${v.brand} ${v.model}</div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
              ${specsHtml}
            </div>

            <div style="background:#cc0033;padding:20px 22px;border-radius:12px;color:#fff;">
              <div style="font-size:12px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;margin-bottom:6px;">Precio</div>
              <div style="font-size:36px;font-weight:800;">${precioTxt}</div>
            </div>

            ${cotInfo}

            ${disclaimerHtml}

            <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e4e4e7;text-align:center;">
              <div style="font-size:13px;color:#666;font-weight:600;">Vehículos de Costa Rica S.A.</div>
              <div style="font-size:13px;color:#333;margin-top:6px;font-weight:600;">
                📞 2240-8082 &nbsp;&nbsp;•&nbsp;&nbsp; 💬 WhatsApp 2235-8869
              </div>
              <div style="font-size:12px;color:#888;margin-top:4px;">www.vehiculosdecr.com</div>
            </div>
          </div>
        `;
        document.body.appendChild(container);

        // Esperar que carguen las imágenes
        const imgs = container.querySelectorAll('img');
        await Promise.all(Array.from(imgs).map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve; // no bloquear si alguna foto falla
          });
        }));

        // Capturar a canvas
        const canvas = await window.html2canvas(container, {
          backgroundColor: '#fff',
          scale: 2,
          useCORS: true,
          allowTaint: false,
          logging: false,
        });

        document.body.removeChild(container);

        // Descargar como PNG
        canvas.toBlob(blob => {
          if (!blob) { alert('Error al generar imagen'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${v.brand}_${v.model}_${v.plate}.png`.replace(/\s+/g, '_');
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      } catch (e) {
        alert('Error generando ficha: ' + e.message);
      }
    };

    return (
      <div>
        <button onClick={() => { setShowroomPicked(null); setCotState({}); setShowCostPanel(false); }} style={{...S.btnGhost,marginBottom:16}}>← Volver al Showroom</button>

        {/* ==================== PANEL DE COSTOS (SOLO ADMIN) ==================== */}
        {isAdmin && (() => {
          // Calcular totales
          const costCur = vehicleCost?.purchase_cost_currency || "USD";
          const costTc = parseFloat(vehicleCost?.purchase_cost_tc) || 0;
          const costAmt = parseFloat(vehicleCost?.purchase_cost_amount) || 0;
          const { crc: costCRC, usd: costUSD } = convertirMontos(costAmt, costCur, costTc);

          let autoTotalCRC = 0, autoTotalUSD = 0;
          invoiceCosts.forEach(inv => {
            const amt = parseFloat(inv.total) || 0;
            const cur = inv.currency || "CRC";
            const tc = parseFloat(inv.exchange_rate) || costTc || 500;
            const { crc, usd } = convertirMontos(amt, cur, tc);
            autoTotalCRC += crc;
            autoTotalUSD += usd;
          });

          let manualTotalCRC = 0, manualTotalUSD = 0;
          manualCosts.forEach(m => {
            const { crc, usd } = convertirMontos(m.amount, m.currency, m.tc);
            manualTotalCRC += crc;
            manualTotalUSD += usd;
          });

          const totalCostCRC = costCRC + autoTotalCRC + manualTotalCRC;
          const totalCostUSD = costUSD + autoTotalUSD + manualTotalUSD;

          // Precio de venta (del showroom)
          const ventaCur = v.currency || "USD";
          const ventaAmt = parseFloat(v.price) || 0;
          const ventaTC = costTc || 500;
          const { crc: ventaCRC, usd: ventaUSD } = convertirMontos(ventaAmt, ventaCur, ventaTC);

          const utilidadCRC = ventaCRC - totalCostCRC;
          const utilidadUSD = ventaUSD - totalCostUSD;
          const margenPct = ventaCRC > 0 ? (utilidadCRC / ventaCRC * 100) : 0;

          return (
            <div style={{...S.card, padding: 20, marginBottom: 16, border: "2px solid #4f8cff33"}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12}}>
                <div style={{display: "flex", alignItems: "center", gap: 10}}>
                  <span style={{fontSize: 16, fontWeight: 800, color: "#4f8cff"}}>💰 Panel de Costos (Admin)</span>
                  {loadingCosts && <span style={{fontSize: 12, color: "#8b8fa4"}}>Cargando...</span>}
                </div>
                <button
                  onClick={() => setShowCostPanel(!showCostPanel)}
                  style={{...S.btnGhost, fontSize: 12, padding: "6px 12px"}}
                >
                  {showCostPanel ? "Ocultar detalles" : "Ver detalles"}
                </button>
              </div>

              {/* Resumen siempre visible */}
              <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: showCostPanel ? 16 : 0}}>
                <div style={{padding: 12, background: "#1e2130", borderRadius: 8}}>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, textTransform: "uppercase"}}>Precio Venta</div>
                  <DualAmount amount={ventaAmt} currency={ventaCur} tc={ventaTC} bigSize={16} />
                </div>
                <div style={{padding: 12, background: "#1e2130", borderRadius: 8}}>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, textTransform: "uppercase"}}>Costo Total</div>
                  <div style={{fontSize: 16, fontWeight: 700, color: "#e8eaf0"}}>
                    ₡{fmt0(totalCostCRC)}
                  </div>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginTop: 2}}>
                    ≈ ${fmt0(totalCostUSD)}
                  </div>
                </div>
                <div style={{padding: 12, background: utilidadCRC >= 0 ? "#10b98118" : "#e11d4818", borderRadius: 8}}>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, textTransform: "uppercase"}}>Utilidad</div>
                  <div style={{fontSize: 16, fontWeight: 700, color: utilidadCRC >= 0 ? "#10b981" : "#e11d48"}}>
                    ₡{fmt0(utilidadCRC)}
                  </div>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginTop: 2}}>
                    ≈ ${fmt0(utilidadUSD)}
                  </div>
                </div>
                <div style={{padding: 12, background: margenPct >= 10 ? "#10b98118" : margenPct >= 0 ? "#f59e0b18" : "#e11d4818", borderRadius: 8}}>
                  <div style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, textTransform: "uppercase"}}>Margen</div>
                  <div style={{fontSize: 20, fontWeight: 800, color: margenPct >= 10 ? "#10b981" : margenPct >= 0 ? "#f59e0b" : "#e11d48"}}>
                    {margenPct.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Detalles expandibles */}
              {showCostPanel && (
                <div style={{borderTop: "1px solid #2a2d3d", paddingTop: 16}}>
                  {/* COSTO DE COMPRA */}
                  <div style={{marginBottom: 20}}>
                    <div style={{fontSize: 13, fontWeight: 700, color: "#e8eaf0", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                      <span>🛒 Costo de compra</span>
                      <button
                        onClick={() => {
                          const currentAmt = vehicleCost?.purchase_cost_amount || "";
                          const currentCur = vehicleCost?.purchase_cost_currency || "USD";
                          const currentDate = vehicleCost?.purchase_cost_date || new Date().toISOString().slice(0, 10);
                          const amt = prompt(`Monto del costo de compra en ${currentCur}:`, currentAmt);
                          if (amt == null) return;
                          const cur = prompt("Moneda (USD o CRC):", currentCur);
                          if (cur == null || !["USD", "CRC"].includes(cur.toUpperCase())) { alert("Moneda inválida"); return; }
                          const fecha = prompt("Fecha de compra (YYYY-MM-DD):", currentDate);
                          if (fecha == null) return;
                          savePurchaseCost(v.plate, amt, cur.toUpperCase(), fecha).then(r => {
                            if (r.ok) alert(`✓ Costo guardado. TC usado: ${r.tc}`);
                            else alert(`Error: ${r.error}`);
                          });
                        }}
                        style={{...S.btn, fontSize: 12, padding: "4px 10px", background: "#4f8cff"}}
                        disabled={savingPurchaseCost}
                      >
                        {vehicleCost ? "Editar" : "Agregar"}
                      </button>
                    </div>
                    {vehicleCost ? (
                      <div style={{padding: 12, background: "#1e2130", borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                        <div>
                          <DualAmount
                            amount={vehicleCost.purchase_cost_amount}
                            currency={vehicleCost.purchase_cost_currency}
                            tc={vehicleCost.purchase_cost_tc}
                            bigSize={18}
                          />
                          <div style={{fontSize: 10, color: "#8b8fa4", marginTop: 4}}>
                            Fecha: {vehicleCost.purchase_cost_date}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={{padding: 12, background: "#1e2130", borderRadius: 8, color: "#8b8fa4", fontSize: 12}}>
                        Sin costo de compra registrado. Hacé click en "Agregar" para ingresarlo.
                      </div>
                    )}
                  </div>

                  {/* COSTOS AUTOMÁTICOS (FACTURAS) */}
                  <div style={{marginBottom: 20}}>
                    <div style={{fontSize: 13, fontWeight: 700, color: "#e8eaf0", marginBottom: 8}}>
                      📄 Costos automáticos (facturas con placa {v.plate}) — {invoiceCosts.length}
                    </div>
                    {invoiceCosts.length === 0 ? (
                      <div style={{padding: 12, background: "#1e2130", borderRadius: 8, color: "#8b8fa4", fontSize: 12}}>
                        No hay facturas con esta placa. Las facturas se asignan automáticamente cuando su XML contiene la placa.
                      </div>
                    ) : (
                      <div style={{background: "#1e2130", borderRadius: 8, overflow: "hidden"}}>
                        {invoiceCosts.map((inv, i) => {
                          const tc = parseFloat(inv.exchange_rate) || costTc || 500;
                          return (
                            <div key={inv.id} style={{padding: "10px 12px", borderBottom: i < invoiceCosts.length - 1 ? "1px solid #2a2d3d" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10}}>
                              <div style={{flex: 1, minWidth: 0}}>
                                <div style={{fontSize: 12, fontWeight: 600, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{inv.supplier_name}</div>
                                <div style={{fontSize: 10, color: "#8b8fa4"}}>{inv.emission_date?.slice(0, 10)}</div>
                              </div>
                              <DualAmount amount={inv.total} currency={inv.currency || "CRC"} tc={tc} align="right" bigSize={14} />
                            </div>
                          );
                        })}
                        <div style={{padding: "10px 12px", background: "#2a2d3d", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between"}}>
                          <span>Subtotal facturas:</span>
                          <span>₡{fmt0(autoTotalCRC)} · ${fmt0(autoTotalUSD)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* COSTOS MANUALES */}
                  <div>
                    <div style={{fontSize: 13, fontWeight: 700, color: "#e8eaf0", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                      <span>✍️ Costos manuales — {manualCosts.length}</span>
                      <button
                        onClick={() => {
                          const concept = prompt("Concepto (ej: Mecánica, Detailing, Traspaso):");
                          if (!concept) return;
                          const amount = prompt("Monto:");
                          if (!amount) return;
                          const currency = prompt("Moneda (USD o CRC):", "CRC");
                          if (!currency || !["USD", "CRC"].includes(currency.toUpperCase())) { alert("Moneda inválida"); return; }
                          const cost_date = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
                          if (!cost_date) return;
                          const description = prompt("Descripción (opcional):") || "";
                          addManualCost(v.plate, { concept, amount, currency: currency.toUpperCase(), cost_date, description }).then(r => {
                            if (r.ok) alert("✓ Costo manual agregado");
                            else alert(`Error: ${r.error}`);
                          });
                        }}
                        style={{...S.btn, fontSize: 12, padding: "4px 10px", background: "#10b981"}}
                      >
                        + Agregar
                      </button>
                    </div>
                    {manualCosts.length === 0 ? (
                      <div style={{padding: 12, background: "#1e2130", borderRadius: 8, color: "#8b8fa4", fontSize: 12}}>
                        Sin costos manuales. Usá "+ Agregar" para registrar pagos en efectivo, traspaso, etc.
                      </div>
                    ) : (
                      <div style={{background: "#1e2130", borderRadius: 8, overflow: "hidden"}}>
                        {manualCosts.map((m, i) => (
                          <div key={m.id} style={{padding: "10px 12px", borderBottom: i < manualCosts.length - 1 ? "1px solid #2a2d3d" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10}}>
                            <div style={{flex: 1, minWidth: 0}}>
                              <div style={{fontSize: 12, fontWeight: 600, color: "#e8eaf0"}}>{m.concept}</div>
                              <div style={{fontSize: 10, color: "#8b8fa4"}}>{m.cost_date}{m.description ? ` · ${m.description}` : ""}</div>
                            </div>
                            <DualAmount amount={m.amount} currency={m.currency} tc={m.tc} align="right" bigSize={14} />
                            <button
                              onClick={() => deleteManualCost(m.id, v.plate)}
                              style={{background: "transparent", border: "none", color: "#e11d48", cursor: "pointer", fontSize: 16, padding: 4}}
                              title="Borrar"
                            >×</button>
                          </div>
                        ))}
                        <div style={{padding: "10px 12px", background: "#2a2d3d", fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between"}}>
                          <span>Subtotal manuales:</span>
                          <span>₡{fmt0(manualTotalCRC)} · ${fmt0(manualTotalUSD)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        <div style={{...S.card,padding:24,marginBottom:16}}>
          <h1 style={{fontSize:26,fontWeight:800,marginBottom:6}}>{v.brand} {v.model} {v.year}</h1>
          <div style={{fontSize:15,color:"#4f8cff",fontWeight:700,marginBottom:12}}>{v.plate}</div>

          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12,marginBottom:16}}>
            {v.year && <div><div style={S.detailLabel}>AÑO</div><div style={S.detailValue}>{v.year}</div></div>}
            {v.engine_cc && <div><div style={S.detailLabel}>MOTOR</div><div style={S.detailValue}>{v.engine_cc} CC</div></div>}
            {v.cylinders && <div><div style={S.detailLabel}>CILINDROS</div><div style={S.detailValue}>{v.cylinders}</div></div>}
            {v.transmission && <div><div style={S.detailLabel}>TRANSMISIÓN</div><div style={S.detailValue}>{v.transmission}</div></div>}
            {v.drivetrain && <div><div style={S.detailLabel}>TRACCIÓN</div><div style={S.detailValue}>{v.drivetrain}</div></div>}
            {v.fuel && <div><div style={S.detailLabel}>COMBUSTIBLE</div><div style={S.detailValue}>{v.fuel}</div></div>}
            {v.km != null && <div><div style={S.detailLabel}>KILOMETRAJE</div><div style={S.detailValue}>{Number(v.km).toLocaleString("es-CR")} km</div></div>}
            {v.color && <div><div style={S.detailLabel}>COLOR</div><div style={S.detailValue}>{v.color}</div></div>}
            {v.passengers && <div><div style={S.detailLabel}>PASAJEROS</div><div style={S.detailValue}>{v.passengers}</div></div>}
            {v.style && <div><div style={S.detailLabel}>ESTILO</div><div style={S.detailValue}>{v.style}</div></div>}
            {v.origin && <div><div style={S.detailLabel}>PROCEDENCIA</div><div style={S.detailValue}>{v.origin}</div></div>}
          </div>

          {v.photos && (
            <div style={{marginBottom:16}}>
              <div style={S.detailLabel}>FOTOS — click para elegir cuál va en la ficha de WhatsApp</div>
              <div style={{display:"flex",gap:8,overflowX:"auto",padding:"6px 0"}}>
                {v.photos.split(',').map((url, i) => {
                  const urlClean = url.trim();
                  const isSelected = fotoElegida === urlClean;
                  return (
                    <div key={i} style={{flexShrink:0,position:"relative",cursor:"pointer"}} onClick={() => setFotoElegida(isSelected ? null : urlClean)}>
                      <img src={urlClean} alt={`Foto ${i+1}`} style={{
                        height:140,
                        borderRadius:8,
                        border: isSelected ? "3px solid #cc0033" : "1px solid #2a2d3d",
                        boxShadow: isSelected ? "0 0 0 2px rgba(204,0,51,0.25)" : "none",
                        cursor:"pointer",
                        display:"block"
                      }} />
                      {isSelected && (
                        <div style={{position:"absolute",top:6,right:6,background:"#cc0033",color:"#fff",fontSize:10,fontWeight:700,padding:"3px 7px",borderRadius:4,letterSpacing:0.5}}>ELEGIDA</div>
                      )}
                      <a href={urlClean} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{position:"absolute",bottom:6,right:6,background:"rgba(0,0,0,0.6)",color:"#fff",fontSize:10,padding:"2px 6px",borderRadius:3,textDecoration:"none"}}>ver</a>
                    </div>
                  );
                })}
              </div>
              <div style={{fontSize:11,color:"#8b8fa4",marginTop:4}}>
                {fotoElegida ? "✓ Esta foto saldrá en la ficha" : "Si no elegís ninguna, se usa la primera por defecto."}
              </div>
            </div>
          )}

          <div style={{padding:"14px 18px",background:"#10b98122",border:"1px solid #10b981",borderRadius:10,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:22,fontWeight:800,color:"#10b981"}}>💰 Precio: {fmt(precioOrig.val, precioOrig.cur)}</div>
              {(() => {
                const eq = precioEquivalenteBac(precioOrig.val, precioOrig.cur);
                if (!eq) return null;
                const symbol = eq.currency === "USD" ? "$" : "₡";
                return (
                  <div style={{fontSize:13,color:"#8b8fa4",marginTop:4}}>
                    Equivalente: <span style={{color:"#e8eaf0",fontWeight:600}}>{symbol}{fmt0(eq.value)}</span>
                    <span style={{fontSize:11,marginLeft:6,opacity:0.7}}>(TC BAC {eq.tcTipo}: {eq.tc})</span>
                  </div>
                );
              })()}
            </div>
            {v.web_url && <a href={v.web_url} target="_blank" rel="noreferrer" style={{...S.btnGhost,fontSize:13,textDecoration:"none"}}>🌐 Ver en web</a>}
          </div>
        </div>

        {/* COTIZADOR */}
        <div style={{...S.card,padding:24}}>
          <h2 style={{fontSize:18,fontWeight:800,marginBottom:16}}>💳 Cotizador de Financiamiento</h2>

          {bancosDisp.length === 0 ? (
            <div style={{color:"#f59e0b",padding:14,background:"#f59e0b22",borderRadius:8}}>No hay opciones de financiamiento para este año.</div>
          ) : (
            <>
              {/* Selector Banco */}
              <div style={{marginBottom:14}}>
                <div style={S.detailLabel}>BANCO / OPCIÓN</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                  {bancosDisp.map(b => {
                    const lbl = b === 'BAC' ? 'BAC Prendario' : b === 'RAPIMAX' ? 'RAPIMAX Leasing' : 'Crédito Personal';
                    return (
                      <button
                        key={b}
                        onClick={() => setCotState({ banco: b })}
                        style={cotBanco === b ? {...S.btn,background:"#4f8cff"} : S.btnGhost}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Parametros */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:16}}>
                {cotBanco !== 'CP' && (
                  <div>
                    <div style={S.detailLabel}>MONEDA COTIZACIÓN</div>
                    <select value={cotMoneda} onChange={e => updCot({moneda: e.target.value, valorAuto: null})} style={{...S.select,width:"100%"}}>
                      <option value="USD">USD (Dólares)</option>
                      <option value="CRC">CRC (Colones)</option>
                    </select>
                  </div>
                )}

                {(cotMoneda !== precioOrig.cur || cotBanco === 'CP') && (
                  <div>
                    <div style={S.detailLabel}>TIPO DE CAMBIO (₡/$)</div>
                    <input type="number" value={cotTC} onChange={e => updCot({tc: parseFloat(e.target.value) || 0, valorAuto: null})} style={{...S.input,width:"100%"}} />
                  </div>
                )}

                {cotBanco !== 'CP' && (
                  <div>
                    <div style={S.detailLabel}>VALOR DEL CARRO</div>
                    <input type="number" value={Math.round(valorAuto)} onChange={e => updCot({valorAuto: parseFloat(e.target.value) || 0})} style={{...S.input,width:"100%"}} />
                  </div>
                )}

                {cotBanco !== 'CP' && (
                  <div>
                    <div style={S.detailLabel}>TRASPASO (3.5% auto)</div>
                    <input type="number" value={Math.round(traspaso)} onChange={e => updCot({traspaso: parseFloat(e.target.value) || 0})} style={{...S.input,width:"100%"}} />
                  </div>
                )}
              </div>

              {cotBanco !== 'CP' && (
                <>
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <div style={S.detailLabel}>PRIMA: {(primaPct*100).toFixed(1)}% — {fmt((valorAuto + traspaso) * primaPct, cotMoneda)}</div>
                      <div style={{fontSize:11,color:"#8b8fa4"}}>Mínima: {(primaMin*100).toFixed(0)}%</div>
                    </div>
                    <input
                      type="range" min={primaMin} max={1} step={0.01}
                      value={primaPct}
                      onChange={e => updCot({primaPct: parseFloat(e.target.value)})}
                      style={{width:"100%"}}
                    />
                  </div>

                  <div style={{marginBottom:14}}>
                    <div style={S.detailLabel}>PLAZO (meses) — máximo {plazoMax}</div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:6}}>
                      {[36, 48, 60, 72, 84, 96].filter(p => p <= plazoMax).map(p => (
                        <button
                          key={p}
                          onClick={() => updCot({plazo: p})}
                          style={plazo === p ? {...S.btn,background:"#4f8cff"} : S.btnGhost}
                        >
                          {p}m
                        </button>
                      ))}
                    </div>
                  </div>

                  {cotBanco === 'BAC' && (
                    <div style={{display:"flex",gap:20,marginBottom:16}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                        <input type="checkbox" checked={esPickup} onChange={e => updCot({esPickup: e.target.checked})}/>
                        <span style={{fontSize:13}}>Pick Up / Carga Liviana</span>
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                        <input type="checkbox" checked={esAsalariado} onChange={e => updCot({esAsalariado: e.target.checked})}/>
                        <span style={{fontSize:13}}>Cliente asalariado (incluye seguro desempleo)</span>
                      </label>
                    </div>
                  )}
                </>
              )}

              {/* RESULTADO */}
              {cot && cot.error ? (
                <div style={{color:"#f59e0b",padding:14,background:"#f59e0b22",borderRadius:8}}>⚠️ {cot.error}</div>
              ) : cot && (
                <div style={{background:"#1f2230",padding:18,borderRadius:10,border:"1px solid #4f8cff44"}}>
                  <div style={{fontSize:12,color:"#8b8fa4",marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Resultado</div>

                  {cotBanco === 'CP' ? (
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13,color:"#8b8fa4"}}>
                        <span>Monto total:</span>
                        <span>{fmt(cot.precioCRC, 'CRC')}</span>
                      </div>
                      <div style={{fontSize:24,fontWeight:800,color:"#10b981",marginTop:8}}>
                        Cuota mensual: {fmt(cot.cuotaMensual, 'CRC')}
                      </div>
                      <div style={{fontSize:11,color:"#8b8fa4",marginTop:8}}>Factor: {cot.factor.toLocaleString()} por millón. Solo asalariados.</div>
                    </div>
                  ) : (
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,fontSize:13,marginBottom:14,color:"#b8bcc8"}}>
                        <div><div style={{fontSize:10,color:"#8b8fa4"}}>Prima</div>{fmt(cot.primaMonto, cot.moneda)}</div>
                        <div><div style={{fontSize:10,color:"#8b8fa4"}}>Comisión ({(cot.comisionPct*100).toFixed(2)}%)</div>{fmt(cot.comision, cot.moneda)}</div>
                        {cotBanco === 'BAC' && cot.controlCar && <div><div style={{fontSize:10,color:"#8b8fa4"}}>Control Car</div>{fmt(cot.controlCar, cot.moneda)}</div>}
                        <div><div style={{fontSize:10,color:"#8b8fa4"}}>A financiar</div>{fmt(cot.monto, cot.moneda)}</div>
                        <div><div style={{fontSize:10,color:"#8b8fa4"}}>Plazo</div>{cot.plazo} meses</div>
                      </div>

                      {cotBanco === 'BAC' && (
                        <div>
                          <div style={{fontSize:11,color:"#8b8fa4",marginBottom:4}}>{cot.tipoPlan}</div>
                          {cot.cuotaTotalVariable ? (
                            <>
                              <div style={{fontSize:20,fontWeight:800,color:"#10b981",marginBottom:6}}>
                                Primeros 24 meses: {fmt(cot.cuotaTotalInicial, cot.moneda)}/mes
                              </div>
                              <div style={{fontSize:18,fontWeight:700,color:"#f59e0b"}}>
                                Resto del plazo: {fmt(cot.cuotaTotalVariable, cot.moneda)}/mes (estimado)
                              </div>
                            </>
                          ) : (
                            <div style={{fontSize:22,fontWeight:800,color:"#10b981"}}>
                              Cuota mensual: {fmt(cot.cuotaTotalInicial, cot.moneda)}
                            </div>
                          )}
                          <div style={{fontSize:11,color:"#8b8fa4",marginTop:8}}>Incluye seguro del auto{esAsalariado ? ' + desempleo' : ''}</div>
                        </div>
                      )}

                      {cotBanco === 'RAPIMAX' && (
                        <div>
                          <div style={{fontSize:20,fontWeight:800,color:"#10b981",marginBottom:6}}>
                            Cuota FIJA ({cot.plazoFijo}m): {fmt(cot.cuotaTotalFija, cot.moneda)}/mes
                          </div>
                          {cot.cuotaTotalVariable && (
                            <div style={{fontSize:18,fontWeight:700,color:"#f59e0b"}}>
                              Cuota VARIABLE ({cot.plazoVariable}m): {fmt(cot.cuotaTotalVariable, cot.moneda)}/mes
                            </div>
                          )}
                          <div style={{fontSize:11,color:"#8b8fa4",marginTop:8}}>
                            Incluye: seguro activo {fmt(cot.segActivo, cot.moneda)}, saldo deudor {fmt(cot.segSaldoDeudor, cot.moneda)}, desempleo, GPS {fmt(cot.gps, cot.moneda)}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div style={{display:"flex",gap:8,marginTop:16,flexWrap:"wrap"}}>
                    <button onClick={descargarFicha} style={S.btn}>🖼️ Descargar Ficha</button>
                    <button onClick={copyToClipboard} style={S.btnGhost}>📋 Copiar texto</button>
                    <button onClick={shareWhatsApp} style={S.btnGhost}>📱 Solo texto WhatsApp</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const renderPage = () => {
    if (tab==="Dashboard") return renderDash();
    if (tab==="Inventario") return renderInv();
    if (tab==="Showroom") return renderShowroom();
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
      <div style={{display:"flex",height:"100vh",overflow:"hidden",position:"relative"}}>
        {/* BOTÓN HAMBURGUESA - solo visible en móvil */}
        {isMobile && !sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              position: "fixed",
              top: 12,
              left: 12,
              zIndex: 1001,
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#181a23",
              border: "1px solid #2a2d3d",
              color: "#e8eaf0",
              fontSize: 20,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            }}
            aria-label="Abrir menú"
          >
            ☰
          </button>
        )}

        {/* OVERLAY cuando sidebar está abierto en móvil */}
        {isMobile && sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 999,
            }}
          />
        )}

        {/* SIDEBAR */}
        <div style={{
          width: 220,
          background: "#181a23",
          borderRight: "1px solid #2a2d3d",
          padding: "20px 8px",
          flexShrink: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          // En móvil: oculto por default (off-screen), se muestra cuando sidebarOpen
          position: isMobile ? "fixed" : "relative",
          left: isMobile ? (sidebarOpen ? 0 : -240) : 0,
          top: 0,
          bottom: 0,
          height: isMobile ? "100vh" : "auto",
          zIndex: 1000,
          transition: "left 0.25s ease-out",
          boxShadow: isMobile && sidebarOpen ? "4px 0 16px rgba(0,0,0,0.4)" : "none",
        }}>
          {/* Logo VCR con botón cerrar en móvil */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"0 10px 20px",borderBottom:"1px solid #2a2d3d",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
              <img
                src="/logo-vcr.png"
                alt="VCR"
                style={{
                  height: 36,
                  width: "auto",
                  maxWidth: 150,
                  objectFit: "contain",
                  filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
                }}
              />
            </div>
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b8fa4",
                  fontSize: 22,
                  cursor: "pointer",
                  padding: 4,
                  lineHeight: 1,
                }}
                aria-label="Cerrar menú"
              >
                ×
              </button>
            )}
          </div>
          <div style={{flex:1}}>
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); if (isMobile) setSidebarOpen(false); }}
                style={{width:"100%",textAlign:"left",padding:"10px 12px",borderRadius:8,border:"none",cursor:"pointer",background:tab===t?"#4f8cff14":"transparent",color:tab===t?"#4f8cff":"#8b8fa4",fontWeight:tab===t?600:400,fontSize:13,fontFamily:"inherit",marginBottom:2}}
              >
                {t}
              </button>
            ))}
          </div>
          {/* Footer usuario + logout */}
          <div style={{borderTop:"1px solid #2a2d3d",paddingTop:12,marginTop:12}}>
            {profile && (
              <div style={{padding:"0 10px 10px"}}>
                <div style={{fontSize:10,color:"#8b8fa4",textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>Conectado</div>
                <div style={{fontSize:12,fontWeight:600,color:"#e8eaf0"}}>{profile.name || profile.email}</div>
                {profile.role && <div style={{fontSize:10,color:"#4f8cff",textTransform:"uppercase",letterSpacing:0.4,marginTop:2}}>{profile.role}</div>}
              </div>
            )}
            <button
              onClick={()=>{
                if (confirm("¿Cerrar sesión?")) signOut();
              }}
              style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid #e11d4840",cursor:"pointer",background:"#e11d4810",color:"#e11d48",fontWeight:600,fontSize:12,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}
            >
              🚪 Cerrar sesión
            </button>
          </div>
        </div>
        <main style={{flex:1,overflow:"auto",padding: isMobile ? "60px 12px 12px" : 22, width: isMobile ? "100%" : "auto"}}>
          {renderPage()}

          {/* ======= MODAL CONFIRMAR VENTA ======= */}
          {soldModalOpen && soldCar && (
            <div style={S.modal} onClick={() => !savingSold && setSoldModalOpen(false)}>
              <div style={{...S.mbox, maxWidth: 560}} onClick={e => e.stopPropagation()}>
                <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14}}>
                  <div>
                    <h3 style={{fontSize: 17, fontWeight: 700, margin: 0}}>Confirmar venta</h3>
                    <p style={{fontSize: 12, color: "#8b8fa4", marginTop: 4}}>{soldCar.brand} {soldCar.model} {soldCar.year} · {soldCar.plate}</p>
                  </div>
                  <button onClick={() => !savingSold && setSoldModalOpen(false)} style={{background: "none", border: "none", cursor: "pointer", color: "#8b8fa4", fontSize: 18}}>✕</button>
                </div>

                <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12}}>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>TIPO DE OPERACIÓN *</label>
                    <select value={soldForm.tipo_operacion} onChange={e => setSoldForm({...soldForm, tipo_operacion: e.target.value})} style={{...S.sel, width: "100%"}}>
                      <option value="propia">🚗 Venta propia</option>
                      <option value="consignacion_grupo">🤝 Consignación grupo (1%)</option>
                      <option value="consignacion_externa">🌐 Consignación externa (5%)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>FECHA VENTA *</label>
                    <input type="date" value={soldForm.sold_at} onChange={e => setSoldForm({...soldForm, sold_at: e.target.value})} style={{...S.input, width: "100%"}} />
                  </div>
                </div>

                <div style={{display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 12}}>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>PRECIO FINAL VENDIDO *</label>
                    <input type="number" value={soldForm.sold_price} onChange={e => setSoldForm({...soldForm, sold_price: e.target.value})} placeholder="Precio al que se vendió" style={{...S.input, width: "100%"}} />
                  </div>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>MONEDA</label>
                    <select value={soldForm.sold_currency} onChange={e => setSoldForm({...soldForm, sold_currency: e.target.value})} style={{...S.sel, width: "100%"}}>
                      <option value="USD">USD</option>
                      <option value="CRC">CRC</option>
                    </select>
                  </div>
                </div>

                <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12}}>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>CLIENTE</label>
                    <input type="text" value={soldForm.client_name} onChange={e => setSoldForm({...soldForm, client_name: e.target.value})} placeholder="Nombre completo" style={{...S.input, width: "100%"}} />
                  </div>
                  <div>
                    <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>CÉDULA</label>
                    <input type="text" value={soldForm.client_id} onChange={e => setSoldForm({...soldForm, client_id: e.target.value})} placeholder="Cédula" style={{...S.input, width: "100%"}} />
                  </div>
                </div>

                {(soldForm.tipo_operacion === 'consignacion_grupo' || soldForm.tipo_operacion === 'consignacion_externa') && (
                  <div style={{display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 12, padding: 10, background: "#4f8cff11", borderRadius: 8}}>
                    <div>
                      <label style={{fontSize: 11, color: "#4f8cff", marginBottom: 4, display: "block"}}>COMISIÓN COBRADA *</label>
                      <input type="number" value={soldForm.commission_amount} onChange={e => setSoldForm({...soldForm, commission_amount: e.target.value})} placeholder={soldForm.tipo_operacion === 'consignacion_grupo' ? '1% del precio' : '5% del precio'} style={{...S.input, width: "100%"}} />
                    </div>
                    <div>
                      <label style={{fontSize: 11, color: "#4f8cff", marginBottom: 4, display: "block"}}>MONEDA</label>
                      <select value={soldForm.commission_currency} onChange={e => setSoldForm({...soldForm, commission_currency: e.target.value})} style={{...S.sel, width: "100%"}}>
                        <option value="CRC">CRC</option>
                        <option value="USD">USD</option>
                      </select>
                    </div>
                  </div>
                )}

                <div style={{marginBottom: 14}}>
                  <label style={{fontSize: 11, color: "#8b8fa4", marginBottom: 4, display: "block"}}>NOTAS (opcional)</label>
                  <textarea value={soldForm.notes} onChange={e => setSoldForm({...soldForm, notes: e.target.value})} placeholder="Cualquier detalle relevante de la venta..." rows={2} style={{...S.input, width: "100%", resize: "vertical"}} />
                </div>

                <div style={{display: "flex", gap: 8, justifyContent: "flex-end"}}>
                  <button onClick={() => setSoldModalOpen(false)} disabled={savingSold} style={{...S.btnGhost}}>Cancelar</button>
                  <button onClick={confirmarVenta} disabled={savingSold} style={{...S.btn, background: savingSold ? "#4f8cff77" : "#10b981"}}>
                    {savingSold ? '⏳ Guardando...' : '✅ Confirmar venta'}
                  </button>
                </div>
              </div>
            </div>
          )}

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
                            <select value={vehicleForm.style||""} onChange={e=>{const val=e.target.value;setVehicleForm(prev=>({...prev,style:val,cabys_code:suggestCabys(val,prev.engine_cc,prev.fuel)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}>
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
                            <select value={vehicleForm.fuel||""} onChange={e=>{const val=e.target.value;setVehicleForm(prev=>({...prev,fuel:val,cabys_code:suggestCabys(prev.style,prev.engine_cc,val)||prev.cabys_code}));}} style={{...S.sel,width:"100%",fontSize:12}}>
                              <option value="">Seleccionar</option>{FUEL_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{fontSize:10,color:"#8b8fa4",marginBottom:2}}>Cilindrada (CC)</div>
                            <input type="number" value={vehicleForm.engine_cc||""} onChange={e=>{const val=e.target.value;setVehicleForm(prev=>({...prev,engine_cc:val,cabys_code:suggestCabys(prev.style,val,prev.fuel)||prev.cabys_code}));}} style={{...S.inp,width:"100%",fontSize:12}} />
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
                    <span style={S.badge(pickedSale.status === "aprobada" ? "#10b981" : pickedSale.status === "rechazada" ? "#e11d48" : pickedSale.status === "reservado" ? "#f59e0b" : "#f59e0b")}>
                      {pickedSale.status === "aprobada" ? "Aprobada" : pickedSale.status === "rechazada" ? "Rechazada" : pickedSale.status === "reservado" ? "📝 Reservada" : "Pendiente"}
                    </span>
                    {pickedSale.pdf_url && (
                      <a
                        href={pickedSale.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...S.sel, background: "#10b98118", color: "#10b981", fontWeight: 600, fontSize: 12, padding: "6px 12px", textDecoration: "none" }}
                      >
                        📄 Ver PDF
                      </a>
                    )}
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
                          ["Valor", fmt(pickedSale.tradein_value, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")],
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
                      <span>Precio de venta</span><span style={{ fontWeight: 800, color: "#4f8cff", fontSize: 16 }}>{fmt(pickedSale.sale_price, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span>
                    </div>
                    {pickedSale.tradein_amount > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Vehículo recibido</span><span>- {fmt(pickedSale.tradein_amount, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span></div>}
                    {pickedSale.down_payment > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Prima</span><span>- {fmt(pickedSale.down_payment, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span></div>}
                    {pickedSale.deposit_signal > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Señal de trato</span><span>- {fmt(pickedSale.deposit_signal, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span></div>}
                    {(pickedSale.deposits_total > 0 || (pickedSale.deposits && pickedSale.deposits.length > 0)) && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #2a2d3d" }}><span style={{ color: "#8b8fa4" }}>Depósitos ({(pickedSale.deposits || []).length})</span><span>- {fmt(pickedSale.deposits_total || (pickedSale.deposits || []).reduce((s, d) => s + (d.amount || 0), 0), pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span></div>}
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "8px 0", fontWeight: 700 }}>
                      <span>Saldo total</span><span style={{ color: "#e11d48" }}>{fmt(pickedSale.total_balance, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span>
                    </div>
                  </div>
                </div>

                {/* Vendedor (con opción de cambiar si admin) */}
                <div style={{ ...S.card, marginBottom: 12, padding: "10px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#8b8fa4", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                        Vendedor{pickedSale.sale_agents && pickedSale.sale_agents.length > 1 ? "es" : ""}
                      </div>
                      {pickedSale.sale_agents && pickedSale.sale_agents.length > 0 ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e8eaf0" }}>
                          {pickedSale.sale_agents.map((a, i) => (
                            <span key={i}>
                              {i > 0 && <span style={{ color: "#8b8fa4" }}> + </span>}
                              {a.agent_name}
                              {pickedSale.sale_agents.length > 1 && <span style={{ fontSize: 11, color: "#8b8fa4", marginLeft: 4 }}>({(a.commission_pct * 100).toFixed(0)}%)</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: "#e11d48" }}>Sin vendedor asignado</div>
                      )}
                      {pickedSale.sale_agents && pickedSale.sale_agents.length > 0 && (
                        <div style={{ fontSize: 11, color: "#10b981", marginTop: 2 }}>
                          Comisión total: {fmt2(pickedSale.sale_agents.reduce((s, a) => s + (a.commission_crc || 0), 0))}
                        </div>
                      )}
                    </div>
                    {profile?.role === "admin" && !changingVendor && (
                      <button
                        onClick={() => { setChangingVendor(true); setNewVendorId(""); }}
                        style={{ ...S.sel, color: "#f97316", background: "#f9731610", fontWeight: 600, fontSize: 11 }}
                      >
                        ✏️ Cambiar vendedor
                      </button>
                    )}
                  </div>
                  {changingVendor && (
                    <div style={{ marginTop: 10, padding: "10px 12px", background: "#1e2130", borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: "#f97316", marginBottom: 6, fontWeight: 600 }}>
                        ⚠️ Al cambiar el vendedor se eliminarán todos los agentes anteriores. El nuevo vendedor se lleva el 100% de la comisión.
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <select
                          value={newVendorId}
                          onChange={(e) => setNewVendorId(e.target.value)}
                          style={{ ...S.inp, flex: 1 }}
                        >
                          <option value="">Seleccione nuevo vendedor...</option>
                          {agents.filter(a => a.active).map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => changeSaleVendor(pickedSale, newVendorId)}
                          disabled={!newVendorId}
                          style={{ ...S.sel, background: newVendorId ? "#10b981" : "#10b98150", color: "#fff", fontWeight: 700, border: "none", fontSize: 11 }}
                        >
                          Confirmar
                        </button>
                        <button
                          onClick={() => { setChangingVendor(false); setNewVendorId(""); }}
                          style={{ ...S.sel, color: "#8b8fa4", fontSize: 11 }}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
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
                      {pickedSale.sale_type !== "propio" && <div style={{ color: "#10b981", marginBottom: 4 }}>Comisión: {fmt(pickedSale.commission_amount, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</div>}
                      {pickedSale.payment_method && <div style={{ color: "#8b8fa4" }}>Pago: {pickedSale.payment_method}</div>}
                      {pickedSale.financing_term_months && <div style={{ color: "#8b8fa4" }}>Plazo: {pickedSale.financing_term_months}m al {pickedSale.financing_interest_pct}%</div>}
                      {pickedSale.financing_amount && <div style={{ color: "#8b8fa4" }}>Monto financiado: {fmt(pickedSale.financing_amount, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</div>}
                    </div>
                  </div>
                  <div style={S.card}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #2a2d3d", fontWeight: 700, fontSize: 13, color: "#4f8cff" }}>Depósitos</div>
                    <div style={{ padding: "10px 16px", fontSize: 12 }}>
                      {(pickedSale.deposits && pickedSale.deposits.length > 0) ? pickedSale.deposits.map((dep, di) => (
                        <div key={di} style={{ padding: "6px 0", borderBottom: di < pickedSale.deposits.length - 1 ? "1px solid #2a2d3d" : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: "#e8eaf0", fontWeight: 600 }}>{fmt(dep.amount, pickedSale.sale_currency === "CRC" ? "CRC" : "USD")}</span>
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
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
                    {profile?.role === "admin" && (
                      <button onClick={() => deleteSale(pickedSale)}
                        style={{ ...S.sel, color: "#fff", background: "#991b1b", fontWeight: 600, padding: "12px 20px", border: "none" }}>
                        🗑️ Eliminar
                      </button>
                    )}
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
                {pickedSale.status === "reservado" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
                    {profile?.role === "admin" && (
                      <button onClick={() => deleteSale(pickedSale)}
                        style={{ ...S.sel, color: "#fff", background: "#991b1b", fontWeight: 600, padding: "12px 20px", border: "none" }}>
                        🗑️ Eliminar
                      </button>
                    )}
                    <button onClick={() => { const r = prompt("Razón del rechazo (opcional):"); if (r !== null) rejectSale(pickedSale.id, r); }}
                      style={{ ...S.sel, color: "#e11d48", background: "#e11d4810", fontWeight: 600, padding: "12px 24px" }}>
                      Rechazar
                    </button>
                    <button onClick={() => editSale(pickedSale)}
                      style={{ ...S.sel, color: "#f59e0b", background: "#f59e0b10", fontWeight: 600, padding: "12px 24px" }}>
                      Corregir / Completar
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("¿Enviar esta reserva a estado Pendiente para aprobación final?")) return;
                        const { error } = await supabase.from('sales').update({ status: 'pendiente' }).eq('id', pickedSale.id);
                        if (error) { alert("Error: " + error.message); return; }
                        await loadSales();
                        setPickedSale(prev => ({ ...prev, status: 'pendiente' }));
                      }}
                      style={{ ...S.sel, background: "#4f8cff", color: "#fff", fontWeight: 700, padding: "12px 24px", border: "none" }}>
                      Enviar a Pendiente
                    </button>
                    <button onClick={() => setConfirmApprove(pickedSale.id)}
                      style={{ ...S.sel, background: "#10b981", color: "#fff", fontWeight: 700, padding: "12px 30px", border: "none" }}>
                      Aprobar directo
                    </button>
                  </div>
                )}
                {pickedSale.status === "aprobada" && (
                  <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
                    {profile?.role === "admin" && (
                      <button onClick={() => deleteSale(pickedSale)}
                        style={{ ...S.sel, color: "#fff", background: "#991b1b", fontWeight: 600, padding: "12px 20px", border: "none" }}>
                        🗑️ Eliminar
                      </button>
                    )}
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
                {pickedSale.status === "rechazada" && profile?.role === "admin" && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                    <button onClick={() => deleteSale(pickedSale)}
                      style={{ ...S.sel, color: "#fff", background: "#991b1b", fontWeight: 600, padding: "10px 20px", border: "none" }}>
                      🗑️ Eliminar venta
                    </button>
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
                            <td style={P.td}>{s.tradein_plate}</td><td style={P.td}>{s.tradein_brand}</td><td style={P.td}>{s.tradein_model}</td><td style={P.td}>{s.tradein_year}</td><td style={P.td}>{s.tradein_color}</td><td style={P.td}>{s.tradein_km ? fK(s.tradein_km) : "-"}</td><td style={{ ...P.td, fontWeight: 700 }}>{fmt(s.tradein_value, s.sale_currency === "CRC" ? "CRC" : "USD")}</td>
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
                          <tr><td style={P.td}>Precio de venta</td><td style={{ ...P.tdR, fontSize: 15, color: "#1a1a2e" }}>{fmt(s.sale_price, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>
                          {s.tradein_amount > 0 && <tr><td style={P.td}>Vehículo recibido</td><td style={P.tdR}>- {fmt(s.tradein_amount, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>}
                          {s.down_payment > 0 && <tr><td style={P.td}>Prima</td><td style={P.tdR}>- {fmt(s.down_payment, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>}
                          {s.deposit_signal > 0 && <tr><td style={P.td}>Señal de trato</td><td style={P.tdR}>- {fmt(s.deposit_signal, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>}
                          {depsSum > 0 && <tr><td style={P.td}>Depósitos ({deps.length})</td><td style={P.tdR}>- {fmt(depsSum, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>}
                          <tr style={P.total}><td style={{ ...P.td, fontWeight: 800 }}>SALDO PENDIENTE</td><td style={{ ...P.tdR, fontSize: 16, color: "#e11d48" }}>{fmt(s.total_balance, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>
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
                                <td style={P.tdR}>{fmt(d.amount, s.sale_currency === "CRC" ? "CRC" : "USD")}</td>
                              </tr>
                            ))}
                            {deps.length > 1 && <tr style={P.total}><td style={P.td} colSpan={4}><strong>Total depósitos</strong></td><td style={P.tdR}>{fmt(depsSum, s.sale_currency === "CRC" ? "CRC" : "USD")}</td></tr>}
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
                      {s.financing_amount && R("Monto financiado", fmt(s.financing_amount, s.sale_currency === "CRC" ? "CRC" : "USD"))}
                      {s.transfer_included && R("Traspaso", s.transfer_in_price ? "Incluido en precio" : s.transfer_in_financing ? "Incluido en financiamiento" : "Incluido")}
                      {s.has_insurance && R("Seguro", `${s.insurance_months} meses`)}
                      {s.sale_type !== "propio" && R("Comisión consignación", `${s.commission_pct}% = ${fmt(s.commission_amount, s.sale_currency === "CRC" ? "CRC" : "USD")}`)}
                    </div>

                    {/* Agents */}
                    {sAgents.length > 0 && (
                      <div style={P.sect}>
                        <div style={P.title}>Vendedores</div>
                        <table style={P.tbl}>
                          <thead><tr><th style={P.th}>Nombre</th><th style={{ ...P.th, textAlign: "right" }}>Comisión</th></tr></thead>
                          <tbody>
                            {sAgents.map((a, i) => (
                              <tr key={i}><td style={P.td}>{a.agent_name}</td><td style={P.tdR}>{a.commission_pct}% = {fmt(a.commission_amount, s.sale_currency === "CRC" ? "CRC" : "USD")}{a.commission_crc > 0 ? ` (${fmt(a.commission_crc)})` : ""}</td></tr>
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
                  {(pickedPay.status === "confirmed" || pickedPay.status === "paid") && !pickedPay.alegra_journal_id && pickedPay.period_type === "mensual" && (
                    <button onClick={()=>setShowJournalPreview(true)} style={{...S.sel,background:"#8b5cf6",color:"#fff",fontWeight:700,border:"none",padding:"10px 24px"}}>📊 Ver Asiento Contable</button>
                  )}
                  {pickedPay.alegra_journal_id && (
                    <div style={{...S.sel,background:"#10b98118",color:"#10b981",fontWeight:700,padding:"10px 16px",display:"flex",alignItems:"center",gap:6}}>
                      ✅ Asiento Alegra #{pickedPay.alegra_journal_id}
                    </div>
                  )}
                  <button onClick={()=>{setPrintPay(pickedPay);setPickedPay(null);}} style={{...S.sel,background:"#4f8cff18",color:"#4f8cff",fontWeight:600}}>Imprimir</button>
                </div>

                {/* JOURNAL PREVIEW MODAL */}
                {showJournalPreview && (() => {
                  const preview = buildJournalPreview(pickedPay);
                  if (!preview) return null;
                  return (
                    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={() => !sendingJournal && setShowJournalPreview(false)}>
                      <div style={{background:"#1a1d2b",borderRadius:12,padding:24,maxWidth:820,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e => e.stopPropagation()}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                          <h2 style={{fontSize:20,fontWeight:800,margin:0}}>📊 Asiento Contable</h2>
                          <button onClick={()=>setShowJournalPreview(false)} disabled={sendingJournal} style={{background:"transparent",border:"none",color:"#8b8fa4",fontSize:24,cursor:"pointer"}}>×</button>
                        </div>

                        <div style={{fontSize:12,color:"#8b8fa4",marginBottom:14,padding:"10px 12px",background:"#2a2d3d",borderRadius:6}}>
                          Planilla: <strong style={{color:"#e8eaf0"}}>{pickedPay.name}</strong> · Estado: {pickedPay.status}
                        </div>

                        {preview.missing.length > 0 && (
                          <div style={{fontSize:12,color:"#e11d48",marginBottom:12,padding:"10px 14px",background:"#e11d4815",border:"1px solid #e11d4840",borderRadius:6}}>
                            ⚠️ Faltan {preview.missing.length} cuentas por configurar en Settings → Cuentas Contables:<br/>
                            <code style={{fontSize:10}}>{preview.missing.join(', ')}</code>
                          </div>
                        )}

                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
                          <thead><tr style={{background:"#1e2130"}}>
                            <th style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#8b8fa4",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Cuenta Contable</th>
                            <th style={{padding:"8px 10px",textAlign:"right",fontSize:10,color:"#8b8fa4",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Débito</th>
                            <th style={{padding:"8px 10px",textAlign:"right",fontSize:10,color:"#8b8fa4",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Crédito</th>
                          </tr></thead>
                          <tbody>
                            {preview.debits.map((e,i) => (
                              <tr key={'d'+i} style={{borderBottom:"1px solid #2a2d3d"}}>
                                <td style={{padding:"8px 10px"}}>
                                  <div style={{fontWeight:600,color:"#e8eaf0"}}>{e.label}</div>
                                  <div style={{fontSize:10,color:e.configured?"#10b981":"#e11d48",marginTop:2}}>
                                    {e.configured ? `✓ Alegra #${e.alegra_id}` : "✗ Sin configurar"}
                                  </div>
                                </td>
                                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:"#10b981"}}>{fmt2(e.amount)}</td>
                                <td style={{padding:"8px 10px",textAlign:"right",color:"#8b8fa4"}}>-</td>
                              </tr>
                            ))}
                            {preview.credits.map((e,i) => (
                              <tr key={'c'+i} style={{borderBottom:"1px solid #2a2d3d"}}>
                                <td style={{padding:"8px 10px"}}>
                                  <div style={{fontWeight:600,color:"#e8eaf0"}}>{e.label}</div>
                                  <div style={{fontSize:10,color:e.configured?"#10b981":"#e11d48",marginTop:2}}>
                                    {e.configured ? `✓ Alegra #${e.alegra_id}` : "✗ Sin configurar"}
                                  </div>
                                </td>
                                <td style={{padding:"8px 10px",textAlign:"right",color:"#8b8fa4"}}>-</td>
                                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:"#4f8cff"}}>{fmt2(e.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{background:"#1e2130",fontWeight:800}}>
                              <td style={{padding:"10px",color:"#e8eaf0"}}>TOTAL</td>
                              <td style={{padding:"10px",textAlign:"right",color:"#10b981"}}>{fmt2(preview.totalDebit)}</td>
                              <td style={{padding:"10px",textAlign:"right",color:"#4f8cff"}}>{fmt2(preview.totalCredit)}</td>
                            </tr>
                          </tfoot>
                        </table>

                        <div style={{padding:"10px 14px",background:preview.balanced?"#10b98118":"#e11d4818",border:`1px solid ${preview.balanced?"#10b98140":"#e11d4840"}`,borderRadius:6,fontSize:13,marginBottom:14,display:"flex",justifyContent:"space-between"}}>
                          <span style={{color:preview.balanced?"#10b981":"#e11d48",fontWeight:700}}>
                            {preview.balanced ? "✅ Asiento balanceado" : "❌ Asiento descuadrado"}
                          </span>
                          {!preview.balanced && (
                            <span style={{color:"#e11d48"}}>Diferencia: {fmt2(preview.totalDebit - preview.totalCredit)}</span>
                          )}
                        </div>

                        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                          <button onClick={()=>setShowJournalPreview(false)} disabled={sendingJournal} style={{...S.sel,color:"#8b8fa4",fontWeight:600}}>Cerrar</button>
                          <button
                            onClick={()=>sendJournalToAlegra(pickedPay.id)}
                            disabled={sendingJournal || !preview.balanced || preview.missing.length > 0}
                            style={{...S.sel,background:(!preview.balanced || preview.missing.length > 0)?"#8b5cf677":"#8b5cf6",color:"#fff",fontWeight:700,border:"none",padding:"10px 20px"}}
                          >
                            {sendingJournal ? "⏳ Enviando..." : "📤 Enviar a Alegra"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

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
