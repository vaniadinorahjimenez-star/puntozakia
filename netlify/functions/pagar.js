/**
 * Netlify Serverless Function: pagar.js
 * Ruta de acceso: /.netlify/functions/pagar
 * 
 * Endpoint intermediario para procesar cobros con la API de Clip Pinpad (F2F):
 * URL Oficial: https://api.payclip.io/f2f/pinpad/v1/payment
 */

const CLIP_PAYMENT_URL = 'https://api.payclip.io/f2f/pinpad/v1/payment';

// Encabezados CORS universales para permitir peticiones desde cualquier origen y navegador
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Pinpad-Include-Detail',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

// Credenciales por defecto del comercio registradas para la terminal
const DEFAULT_API_KEY = 'a7c54f1f-9bea-4405-a128-83e8f18f9d32';
const DEFAULT_SECRET_KEY = '9d0167db-964e-459b-bada-b758d301f792';
const DEFAULT_SERIAL = 'P8C2240805000156';

/**
 * Genera el encabezado Authorization requerido por Clip:
 * "Authorization: Basic <base64(api_key:secret_key)>"
 */
function buildAuthorizationHeader(rawApiKey, rawSecretKey, authHeaderFromRequest) {
  // 1. Si el frontend ya envió un encabezado Authorization directo
  if (authHeaderFromRequest && typeof authHeaderFromRequest === 'string' && authHeaderFromRequest.trim()) {
    const trimmed = authHeaderFromRequest.trim();
    if (/^basic\s+/i.test(trimmed) || /^bearer\s+/i.test(trimmed)) {
      return trimmed;
    }
    return `Basic ${trimmed}`;
  }

  let apiKey = (rawApiKey || '').trim();
  let secretKey = (rawSecretKey || '').trim();

  // Limpiar comillas accidentales si se copiaron de variables de entorno
  if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
    apiKey = apiKey.slice(1, -1).trim();
  }
  if ((secretKey.startsWith('"') && secretKey.endsWith('"')) || (secretKey.startsWith("'") && secretKey.endsWith("'"))) {
    secretKey = secretKey.slice(1, -1).trim();
  }

  // Si alguna de las llaves ya viene como 'Basic ...'
  if (/^basic\s+/i.test(apiKey)) return apiKey;
  if (/^basic\s+/i.test(secretKey)) return secretKey;

  // Si ambas llaves están presentes, se combinan en Base64
  if (apiKey && secretKey) {
    const combined = `${apiKey}:${secretKey}`;
    return `Basic ${Buffer.from(combined, 'utf-8').toString('base64')}`;
  }

  // Token único
  const single = apiKey || secretKey;
  if (single) {
    if (single.includes(':')) {
      return `Basic ${Buffer.from(single, 'utf-8').toString('base64')}`;
    }
    return `Basic ${single}`;
  }

  return '';
}

export async function handler(event, context) {
  // Manejo de solicitudes Pre-flight CORS (OPTIONS)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: ''
    };
  }

  // Validar que el método HTTP sea estrictamente POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'METHOD_NOT_ALLOWED',
        message: `Método ${event.httpMethod} no permitido. Utiliza POST.`
      })
    };
  }

  // Bloque try...catch robusto para atrapar cualquier resultado o excepción
  try {
    // 1. Recibir y parsear el cuerpo JSON de la petición
    let payload = {};
    if (event.body) {
      try {
        payload = JSON.parse(event.body);
      } catch (err) {
        console.error('❌ [PAGAR] Error al parsear JSON recibido en la petición:', err.message);
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            error: 'INVALID_JSON_BODY',
            message: 'El cuerpo de la petición no contiene un JSON válido.'
          })
        };
      }
    }

    // 2. Resolver credenciales de autenticación (de headers, body o variables de entorno)
    const clientAuthHeader = event.headers?.authorization || event.headers?.Authorization;
    const rawApiKey = payload.api_key || process.env.CLIP_API_KEY || process.env.CLIP_KEY || DEFAULT_API_KEY;
    const rawSecretKey = payload.secret_key || process.env.CLIP_SECRET_KEY || process.env.CLIP_SECRET || DEFAULT_SECRET_KEY;
    const authHeader = buildAuthorizationHeader(rawApiKey, rawSecretKey, clientAuthHeader);

    if (!authHeader) {
      console.error('❌ [PAGAR] No se encontraron credenciales válidas de Clip.');
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          error: 'MISSING_CREDENTIALS',
          message: 'No se encontraron credenciales de Clip (API Key / Secret Key).'
        })
      };
    }

    // 3. Preparar los datos del cobro para la API de Clip Pinpad
    // Nota: Clip requiere el monto como String con dos decimales ("10.00")
    let rawAmount = payload.amount;
    let formattedAmount;
    if (typeof rawAmount === 'number') {
      formattedAmount = rawAmount.toFixed(2);
    } else if (typeof rawAmount === 'string' && !isNaN(Number(rawAmount))) {
      formattedAmount = Number(rawAmount).toFixed(2);
    } else {
      formattedAmount = String(rawAmount || '0.00');
    }

    const serialNumber = (
      payload.serial_number_pos || 
      payload.serial_number || 
      process.env.CLIP_TERMINAL_SERIAL || 
      process.env.CLIP_SERIAL_NUMBER || 
      DEFAULT_SERIAL
    ).trim();

    const reference = (payload.reference || `VENTA-${Date.now()}`).toString().substring(0, 40);

    // Estructura oficial del cuerpo según la documentación de Clip
    const clipRequestBody = {
      amount: formattedAmount,
      reference: reference,
      serial_number_pos: serialNumber
    };

    // Propina opcional
    if (payload.tip_amount !== undefined && payload.tip_amount !== null) {
      clipRequestBody.tip_amount = String(payload.tip_amount);
    }

    // Preferencias opcionales
    if (payload.preferences && typeof payload.preferences === 'object') {
      clipRequestBody.preferences = payload.preferences;
    }

    console.log('====================================================');
    console.log('🚀 [PAGAR] ENVIANDO SOLICITUD A LA API DE CLIP:');
    console.log('URL de destino:', CLIP_PAYMENT_URL);
    console.log('Headers enviados:', {
      'Content-Type': 'application/json',
      'Authorization': authHeader.substring(0, 15) + '...[REDACTED]'
    });
    console.log('Request Body enviado a Clip:\n', JSON.stringify(clipRequestBody, null, 2));
    console.log('====================================================');

    // 4. Realizar la petición HTTP fetch hacia la API de Clip
    const clipResponse = await fetch(CLIP_PAYMENT_URL, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(clipRequestBody)
    });

    // 5. Capturar con precisión el Status Code y Response Body exactos
    const clipStatusCode = clipResponse.status;
    const rawResponseText = await clipResponse.text();

    let clipResponseBody;
    try {
      clipResponseBody = JSON.parse(rawResponseText);
    } catch {
      clipResponseBody = rawResponseText;
    }

    // 6. Log detallado para diagnóstico inmediato en los Logs de Netlify
    console.log('====================================================');
    console.log('📥 [PAGAR] RESPUESTA RECIBIDA DE LA API DE CLIP:');
    console.log('Status Code:', clipStatusCode, clipResponse.statusText);
    console.log('Response Body:\n', typeof clipResponseBody === 'object' ? JSON.stringify(clipResponseBody, null, 2) : clipResponseBody);
    console.log('====================================================');

    // 7. Retornar la respuesta correspondiente al cliente
    return {
      statusCode: clipStatusCode,
      headers: CORS_HEADERS,
      body: typeof clipResponseBody === 'string' ? clipResponseBody : JSON.stringify(clipResponseBody)
    };

  } catch (error) {
    // Captura cualquier fallo de red o excepción inesperada
    console.error('====================================================');
    console.error('❌ [PAGAR] ERROR EXCEPCIONAL AL COMUNICARSE CON CLIP:');
    console.error('Nombre del error:', error.name);
    console.error('Mensaje de error:', error.message);
    console.error('Stack trace:\n', error.stack);
    console.error('====================================================');

    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'CLIP_GATEWAY_ERROR',
        message: 'No fue posible completar la comunicación con la API de Clip.',
        details: error.message
      })
    };
  }
}

export default handler;
