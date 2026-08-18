const fetch = require('node-fetch');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const airtableWebhookUrl = process.env.AIRTABLE_WEBHOOK_URL;
  if (!airtableWebhookUrl) {
    console.error('Falta AIRTABLE_WEBHOOK_URL en las variables de entorno.');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'Configuración incompleta del servidor.' })
    };
  }

  try {
    const data = JSON.parse(event.body || '{}');

    const response = await fetch(airtableWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    let airtableResponse = {};
    try {
      airtableResponse = await response.json();
    } catch (_) {
      airtableResponse = {};
    }

    if (!response.ok) {
      console.error('Error desde Airtable webhook:', response.status, airtableResponse);
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ error: 'Airtable rechazó la encuesta.' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message: 'Encuesta enviada con éxito' })
    };
  } catch (error) {
    console.error('Error en submit-survey:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ error: 'No fue posible procesar la encuesta.' })
    };
  }
};
