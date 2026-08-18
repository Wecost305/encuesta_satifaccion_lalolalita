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

  const query = event.queryStringParameters || {};
  const from = normalizeIsoDate(query.from);
  const to = normalizeIsoDate(query.to);

  if ((query.from && !from) || (query.to && !to)) {
    return json(400, {
      success: false,
      error: 'Formato de fecha inválido. Usa YYYY-MM-DD.'
    });
  }

  if ((from && !to) || (!from && to)) {
    return json(400, {
      success: false,
      error: 'Para filtrar se requieren las fechas from y to.'
    });
  }

  if (from && to && from > to) {
    return json(400, {
      success: false,
      error: 'La fecha inicial no puede ser posterior a la fecha final.'
    });
  }

  try {
    let total = 0;
    let analyzed = 0;
    let withoutVisitDate = 0;
    let offset = null;
    let pages = 0;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      // Solo necesitamos Fecha_Visita para los dos conteos.
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

      const records = Array.isArray(payload.records) ? payload.records : [];
      total += records.length;

      for (const record of records) {
        const visitDate = normalizeIsoDate(record?.fields?.Fecha_Visita);
        if (!visitDate) {
          withoutVisitDate += 1;
          continue;
        }

        if (!from || !to || (visitDate >= from && visitDate <= to)) {
          analyzed += 1;
        }
      }

      offset = payload.offset || null;
      pages += 1;

      if (pages > 1000) {
        throw new Error('Se alcanzó el límite interno de paginación.');
      }
    } while (offset);

    return json(200, {
      success: true,
      total,
      analyzed,
      from: from || null,
      to: to || null,
      withoutVisitDate,
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

function normalizeIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

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
