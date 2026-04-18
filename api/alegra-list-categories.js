// Lista TODAS las cuentas contables de Alegra con jerarquía (solo lectura)
// GET /api/alegra-list-categories

export default async function handler(req, res) {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;

  if (!email || !token) {
    return res.status(500).json({
      ok: false,
      error: 'Faltan env vars ALEGRA_EMAIL o ALEGRA_TOKEN'
    });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    // Probamos con format=tree para traer jerarquía completa
    const response = await fetch(
      'https://api.alegra.com/api/v1/categories?format=tree',
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: data });
    }

    // Aplanar el árbol para poder verlo fácil
    const flat = [];
    const walkTree = (nodes, level = 0, parentName = null) => {
      for (const node of nodes) {
        flat.push({
          id: node.id,
          name: node.name,
          type: node.type,
          level,
          parent_name: parentName,
          has_children: Array.isArray(node.children) && node.children.length > 0,
          num_children: Array.isArray(node.children) ? node.children.length : 0
        });
        if (Array.isArray(node.children) && node.children.length > 0) {
          walkTree(node.children, level + 1, node.name);
        }
      }
    };

    walkTree(data);

    return res.status(200).json({
      ok: true,
      total: flat.length,
      // Filtrar solo las cuentas de tipo gasto/costo (las que usas para facturas de compra)
      expense_and_cost_accounts: flat.filter(c => c.type === 'expense' || c.type === 'cost'),
      all_accounts: flat
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
