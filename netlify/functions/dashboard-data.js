const fetch = require('node-fetch');

const AIRTABLE_API_BASE = 'https://api.airtable.com/v0';

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return json(405, { success: false, error: 'Method Not Allowed' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!token || !baseId || !tableName) {
    console.error('Faltan variables de entorno requeridas para Airtable.');
    return json(500, {
      success: false,
      error: 'Configuración incompleta del servidor.'
    });
  }

  try {
    let total = 0;
    let offset = null;
    let pages = 0;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      // Solo pedimos un campo para reducir el tamaño de la respuesta.
      params.append('fields[]', 'Fecha_Visita');
      if (offset) params.set('offset', offset);

      const url = `${AIRTABLE_API_BASE}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableName)}?${params.toString()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });

      const payload = await response.json();

      if (!response.ok) {
        console.error('Error de Airtable API:', response.status, payload);
        return json(response.status, {
          success: false,
          error: 'Airtable rechazó la consulta.'
        });
      }

      total += Array.isArray(payload.records) ? payload.records.length : 0;
      offset = payload.offset || null;
      pages += 1;

      // Protección contra bucles inesperados.
      if (pages > 1000) {
        throw new Error('Se alcanzó el límite interno de paginación.');
      }
    } while (offset);

    return json(200, {
      success: true,
      total,
      source: 'airtable',
      countedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error consultando Airtable:', error);
    return json(500, {
      success: false,
      error: 'No fue posible consultar Airtable.'
    });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0'
    },
    body: JSON.stringify(body)
  };
}
