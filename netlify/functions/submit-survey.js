// Importamos el paquete fetch
const fetch = require('node-fetch');

// IMPORTANTE: Pega aquí la URL de tu webhook de Airtable
const AIRTABLE_WEBHOOK_URL = 'https://hooks.airtable.com/workflows/v1/genericWebhook/appPSJjK5UqoxGnkl/wfli1mkUUsFF7GYWA/wtrbbLe2OT6CYbjk2';

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST' ) {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    const response = await fetch(AIRTABLE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    // Esta línea es clave: necesitamos leer la respuesta de Airtable
    const airtableResponse = await response.json();

    if (!response.ok) {
      // Si Airtable devuelve un error, lo registramos para poder verlo en los logs
      console.error('Error desde Airtable:', airtableResponse);
      return { statusCode: response.status, body: JSON.stringify(airtableResponse) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Encuesta enviada con éxito' }),
    };

  } catch (error) {
    console.error('Error en la función:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
