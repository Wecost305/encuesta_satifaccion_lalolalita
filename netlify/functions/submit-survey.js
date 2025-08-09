// netlify/functions/submit-survey.js

// IMPORTANTE: Pega aquí la URL de tu webhook de Airtable
const AIRTABLE_WEBHOOK_URL = 'https://hooks.airtable.com/workflows/v1/genericWebhook/appPSJjK5UqoxGnkl/wfli1mkUUsFF7GYWA/wtrbbLe2OT6CYbjk2';

exports.handler = async function(event, context) {
  // Solo permitir solicitudes POST
  if (event.httpMethod !== 'POST' ) {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Los datos enviados desde el formulario vienen en event.body
    const data = JSON.parse(event.body);

    // Reenviar los datos a Airtable
    const response = await fetch(AIRTABLE_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      // Si Airtable devuelve un error, lo pasamos
      return { statusCode: response.status, body: response.statusText };
    }

    // Si todo fue bien, devolvemos una respuesta de éxito
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Encuesta enviada con éxito' }),
    };

  } catch (error) {
    // Si hay algún otro error, lo registramos
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno del servidor' }),
    };
  }
};
