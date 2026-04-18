// Busca un cliente en Alegra por su numero de identificacion.
// POST /api/alegra-lookup-client
// Body: { cedula: "123456789" }
//
// Response:
// - Si encuentra: { ok: true, found: true, client: {...mapeado al formato VCR...} }
// - Si no: { ok: true, found: false }
// - Error: { ok: false, error: "..." }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { cedula } = req.body || {};
  if (!cedula || String(cedula).trim() === "") {
    return res.status(400).json({ ok: false, error: 'Falta cedula' });
  }

  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  if (!email || !token) {
    return res.status(500).json({ ok: false, error: 'Faltan credenciales Alegra' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const ALEGRA_BASE = 'https://api.alegra.com/api/v1';

  try {
    // Alegra tiene parametro "identification" que filtra por numero de ID
    const cleanCedula = String(cedula).replace(/[\s-]/g, "").trim();
    const url = `${ALEGRA_BASE}/contacts?identification=${encodeURIComponent(cleanCedula)}&limit=10`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      return res.status(502).json({ ok: false, error: 'Error consultando Alegra', detail: errData });
    }

    const contacts = await resp.json();

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(200).json({ ok: true, found: false });
    }

    // Filtrar solo clientes (excluir proveedores puros)
    // type puede ser ["client"], ["provider"], o ["client","provider"]
    const clients = contacts.filter(c => {
      if (!c.type) return true;
      if (Array.isArray(c.type)) return c.type.includes('client');
      return c.type === 'client';
    });

    // Si no hay clientes puros, devolver cualquier contacto que tenga esa cedula
    const match = clients.length > 0 ? clients[0] : contacts[0];

    // Mapear identificationObject.type al formato VCR
    const idTypeMap = {
      '01': 'fisica',
      '02': 'juridica',
      '03': 'dimex',
      '04': 'extranjero'
    };
    const alegraIdType = match.identificationObject?.type || '01';
    const vcrIdType = idTypeMap[alegraIdType] || 'fisica';

    // Armar direccion completa
    let address = '';
    if (match.address) {
      if (typeof match.address === 'string') {
        address = match.address;
      } else {
        // Alegra a veces devuelve un objeto
        const parts = [
          match.address.address,
          match.address.city,
          match.address.department,
          match.address.country
        ].filter(Boolean);
        address = parts.join(', ');
      }
    }

    // Telefonos: priorizar mobile > phonePrimary
    const phone1 = match.mobile || match.phonePrimary || '';
    const phone2 = (match.mobile && match.phonePrimary && match.mobile !== match.phonePrimary)
      ? match.phonePrimary
      : (match.phoneSecondary || '');

    const mapped = {
      alegra_contact_id: match.id,
      client_id_type: vcrIdType,
      cedula: match.identification || cleanCedula,
      name: (match.name || '').toUpperCase(),
      phone1: phone1,
      phone2: phone2,
      email: (match.email || '').toLowerCase(),
      address: address,
      // Estos tres no existen en Alegra, quedan vacios
      workplace: '',
      occupation: '',
      civil_status: ''
    };

    return res.status(200).json({
      ok: true,
      found: true,
      client: mapped
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
