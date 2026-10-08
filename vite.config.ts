import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';

// Plugin para conectar directamente con la API real de Clip Pinpad F2F en desarrollo
function clipNetlifyFunctionDevPlugin(): Plugin {
  return {
    name: 'clip-netlify-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/.netlify/functions/clip-payment')) {
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization, Pinpad-Include-Detail',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            });
            return res.end();
          }

          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              let payload: any = {};
              if (bodyStr) {
                try { payload = JSON.parse(bodyStr); } catch (e) {}
              }

              const defaultApiKey = '44a3f5bb-52dc-48bd-8f14-fcf75b7cddee';
              const defaultSecretKey = '376ed357-eff3-4e80-a67e-a1f562ac18d9';
              const defaultSerial = 'P8C2240805000156';

              const rawApiKey = payload.api_key || process.env.CLIP_API_KEY || process.env.CLIP_KEY || defaultApiKey;
              const rawSecretKey = payload.secret_key || process.env.CLIP_SECRET_KEY || process.env.CLIP_SECRET || defaultSecretKey;
              const serial = (payload.serial_number_pos || process.env.CLIP_TERMINAL_SERIAL || defaultSerial).trim();
              const action = payload.action || 'create_payment';

              // Construir encabezado Authorization según especificaciones de Clip
              let authHeader = '';
              let apiKey = (rawApiKey || '').trim();
              let secretKey = (rawSecretKey || '').trim();

              if ((apiKey.startsWith('"') && apiKey.endsWith('"')) || (apiKey.startsWith("'") && apiKey.endsWith("'"))) {
                apiKey = apiKey.slice(1, -1).trim();
              }
              if ((secretKey.startsWith('"') && secretKey.endsWith('"')) || (secretKey.startsWith("'") && secretKey.endsWith("'"))) {
                secretKey = secretKey.slice(1, -1).trim();
              }

              if (/^basic\s+/i.test(apiKey) || /^bearer\s+/i.test(apiKey)) {
                authHeader = apiKey;
              } else if (/^basic\s+/i.test(secretKey) || /^bearer\s+/i.test(secretKey)) {
                authHeader = secretKey;
              } else if (apiKey && secretKey) {
                authHeader = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`;
              } else {
                const singleToken = apiKey || secretKey;
                if (singleToken) {
                  if (singleToken.includes(':')) {
                    authHeader = `Basic ${Buffer.from(singleToken).toString('base64')}`;
                  } else {
                    authHeader = `Basic ${singleToken}`;
                  }
                }
              }

              const headers = {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
              };

              // ACCIÓN: DIAGNÓSTICO EN VIVO
              if (action === 'diagnose') {
                if (!authHeader) {
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    status: 'MISSING_CREDENTIALS',
                    message: 'Faltan credenciales de Clip. Ingresa tu API Key y Secret Key en Ajustes de la Panadería.',
                    diagnosis: { has_api_key: false, has_secret_key: false, env_serial_value: serial }
                  }));
                }

                try {
                  // Consultar lectores registrados en la cuenta
                  const clipRes = await fetch('https://api.payclip.io/f2f/pinpad/v1/devices/status', {
                    method: 'GET',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
                  });
                  const clipData = await clipRes.json().catch(() => ({}));

                  let isSerialFound = false;
                  if (Array.isArray(clipData)) {
                    isSerialFound = clipData.some(d => 
                      (d.serial_number || d.serial_number_pos || d.serialNumber || d.ssn || '').toUpperCase() === serial.toUpperCase()
                    );
                  }

                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    status: clipRes.status === 401 ? 'AUTH_FAILED' : 'CONNECTED',
                    clip_http_status: clipRes.status,
                    clip_response: clipData,
                    is_serial_in_account: isSerialFound,
                    message: clipRes.status === 401 
                      ? 'Error 401: Clave no reconocida por Clip. Revisa tu API Key y Secret Key.'
                      : (isSerialFound ? `Terminal ${serial} conectada y registrada en tu cuenta.` : `Credenciales válidas (HTTP 200). La serie ${serial} no aparece en la lista de terminales activas de la cuenta.`),
                    diagnosis: {
                      has_api_key: Boolean(apiKey),
                      has_secret_key: Boolean(secretKey),
                      env_serial_value: serial,
                      auth_header_format: authHeader.startsWith('Basic ') ? 'Basic [Configurado]' : 'Bearer [Configurado]'
                    }
                  }));
                } catch (e: any) {
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({ status: 'NETWORK_ERROR', message: e.message }));
                }
              }

              // ACCIÓN: CHECK DEVICE STATUS (ESTADO EN VIVO DE LA TERMINAL)
              if (action === 'check_device_status' || action === 'device_status') {
                if (!authHeader) {
                  res.writeHead(400, headers);
                  return res.end(JSON.stringify({ error: 'MISSING_CREDENTIALS', message: 'Faltan credenciales de Clip' }));
                }

                try {
                  const clipRes = await fetch('https://api.payclip.io/f2f/pinpad/v1/devices/status', {
                    method: 'GET',
                    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
                  });
                  const clipData = await clipRes.json().catch(() => ([]));
                  let targetDevice = null;
                  if (Array.isArray(clipData)) {
                    targetDevice = clipData.find((d: any) => 
                      (d.serial_number || d.serial_number_pos || '').toUpperCase() === serial.toUpperCase()
                    );
                  }

                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    registered: Boolean(targetDevice),
                    status: targetDevice ? targetDevice.status : 'not_found',
                    model: targetDevice?.device_model || 'P8',
                    app_version: targetDevice?.app_version,
                    last_seen_at: targetDevice?.ua_last_seen_at,
                    device: targetDevice,
                    message: targetDevice
                      ? (targetDevice.status === 'expired'
                          ? `Terminal ${serial} registrada pero con sesión en reposo (expired). Abre la app Clip PinPad en la pantalla física.`
                          : `Terminal ${serial} activa (${targetDevice.status}).`)
                      : `Terminal ${serial} no encontrada en la lista de dispositivos.`
                  }));
                } catch (e: any) {
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({ registered: false, status: 'error', message: e.message }));
                }
              }

              // ACCIÓN: CHECK STATUS (POLLING REAL)
              if (action === 'check_status') {
                const reqId = payload.pinpad_request_id;
                if (!authHeader) {
                  res.writeHead(400, headers);
                  return res.end(JSON.stringify({ error: 'MISSING_API_KEY', message: 'Falta CLIP_API_KEY' }));
                }
                const clipRes = await fetch(`https://api.payclip.io/f2f/pinpad/v1/payment?pinpadRequestId=${encodeURIComponent(reqId)}`, {
                  method: 'GET',
                  headers: { 'Authorization': authHeader, 'Pinpad-Include-Detail': 'true' }
                });
                const clipData = await clipRes.json().catch(() => ({}));
                res.writeHead(clipRes.status, headers);
                return res.end(JSON.stringify(clipData));
              }

              // ACCIÓN: CREAR COBRO REAL EN LA TERMINAL
              if (!authHeader) {
                res.writeHead(400, headers);
                return res.end(JSON.stringify({
                  error: 'CLIP_AUTH_ERROR',
                  message: 'Faltan las credenciales de Clip. Ingrésalas en Ajustes de la Panadería o en tu panel de Netlify.'
                }));
              }

              const numAmount = Number(payload.amount);
              // CRUCIAL: "amount" debe ser un string con 2 decimales según la API de Clip
              const formattedAmount = isNaN(numAmount) ? '0.00' : numAmount.toFixed(2);

              const clipBody: any = {
                amount: formattedAmount,
                reference: (payload.reference || `PAN-${Date.now()}`).substring(0, 40),
                serial_number_pos: serial
              };
              if (payload.tip_amount) {
                clipBody.tip_amount = String(payload.tip_amount);
              }
              if (payload.preferences && typeof payload.preferences === 'object') {
                clipBody.preferences = payload.preferences;
              }

              const clipRes = await fetch('https://api.payclip.io/f2f/pinpad/v1/payment', {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify(clipBody)
              });

              const clipData = await clipRes.json().catch(() => ({}));

              if (!clipRes.ok) {
                const rawMsg = clipData.message || clipData.description || '';
                const rawCode = clipData.code || clipData.error || '';
                const lowerMsg = (rawMsg || '').toLowerCase();
                let errCode = 'UNKNOWN';
                if (clipRes.status === 401) errCode = 'CLIP_AUTH_ERROR';
                else if (clipRes.status === 404) errCode = 'DEVICE_NOT_FOUND';
                else if (rawCode === 'ERR10_04' || lowerMsg.includes('pinpad application is closed')) errCode = 'PINPAD_APP_CLOSED';
                else if (rawCode === 'ERR10_03' || lowerMsg.includes('unable to connect to pinpad')) errCode = 'PINPAD_APP_NOT_LISTENING';
                else if (clipRes.status === 503 || clipRes.status === 504 || clipRes.status === 408 || lowerMsg.includes('offline') || lowerMsg.includes('unavailable')) errCode = 'TERMINAL_OFFLINE';
                else if (clipRes.status === 409) errCode = 'TERMINAL_BUSY';

                let customMessage = rawMsg || `Clip API devolvió error HTTP ${clipRes.status}`;
                if (errCode === 'PINPAD_APP_CLOSED') {
                  customMessage = `La aplicación Clip PinPad en la terminal ${serial} está cerrada o en reposo (ERR10_04). Abre la app Clip PinPad en la pantalla de la terminal para activarla.`;
                } else if (errCode === 'PINPAD_APP_NOT_LISTENING') {
                  customMessage = `Tu terminal Clip ${serial} está activa en línea, pero la aplicación de integración PinPad aún no recibe órdenes automáticas (Código ERR10_03). Abre la app Clip PinPad en la terminal o usa Cobro Directo mientras tanto.`;
                }

                res.writeHead(clipRes.status, headers);
                return res.end(JSON.stringify({
                  error: errCode,
                  clip_code: rawCode,
                  http_status: clipRes.status,
                  message: customMessage,
                  details: clipData
                }));
              }

              res.writeHead(clipRes.status, headers);
              return res.end(JSON.stringify(clipData));

            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              return res.end(JSON.stringify({ error: 'DEV_PROXY_ERROR', message: err.message }));
            }
          });
          return;
        }

        // Endpoint /.netlify/functions/pagar y /api/pagar (Desarrollo local)
        if (req.url && (req.url.startsWith('/.netlify/functions/pagar') || req.url.startsWith('/api/pagar'))) {
          let bodyStr = '';
          req.on('data', chunk => { bodyStr += chunk; });
          req.on('end', async () => {
            try {
              const { handler: pagarHandler } = await import('./netlify/functions/pagar.js');
              const result = await pagarHandler({
                httpMethod: req.method || 'POST',
                headers: req.headers,
                body: bodyStr
              }, {});

              res.writeHead(result.statusCode, result.headers || {});
              return res.end(result.body);
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              return res.end(JSON.stringify({ error: 'DEV_PAGAR_ERROR', message: err.message }));
            }
          });
          return;
        }

        // Endpoint de sincronización en la nube (Desarrollo local)
        if (req.url && (req.url.startsWith('/.netlify/functions/sync-data') || req.url.startsWith('/api/sync'))) {
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            });
            return res.end();
          }

          const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*'
          };

          const tempStoreFile = path.join('/tmp', 'santafe_cloud_data_store.json');
          if (!(global as any).__santafe_store) {
            try {
              if (fs.existsSync(tempStoreFile)) {
                (global as any).__santafe_store = JSON.parse(fs.readFileSync(tempStoreFile, 'utf8'));
              }
            } catch (err) {
              // ignore
            }
          }

          if (req.method === 'GET') {
            res.writeHead(200, headers);
            return res.end(JSON.stringify({
              success: true,
              data: (global as any).__santafe_store || { tickets: [], orders: [], shiftCuts: [], outflows: [], customers: [] },
              message: 'Datos recuperados en dev'
            }));
          }

          if (req.method === 'POST') {
            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', () => {
              try {
                let payload: any = {};
                if (bodyStr) payload = JSON.parse(bodyStr);

                const current = (global as any).__santafe_store || { tickets: [], orders: [], shiftCuts: [], outflows: [], customers: [] };

                // Merge tickets (Garantizar que ventas en el mismo minuto o segundos nunca se pierdan)
                const ticketMap = new Map();
                const getTicketKey = (t: any) => {
                  if (t.id && String(t.id).trim() !== '') return `id:${String(t.id).trim()}`;
                  if (t.folio && String(t.folio).trim() !== '') return `folio:${String(t.folio).trim()}`;
                  const genId = `ticket-${t.timestamp ? new Date(t.timestamp).getTime() : Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
                  t.id = genId;
                  return `id:${genId}`;
                };

                for (const t of (current.tickets || [])) {
                  if (!t) continue;
                  ticketMap.set(getTicketKey(t), t);
                }
                for (const t of (payload.tickets || [])) {
                  if (!t) continue;
                  const key = getTicketKey(t);
                  if (ticketMap.has(key)) {
                    ticketMap.set(key, { ...ticketMap.get(key), ...t });
                  } else {
                    ticketMap.set(key, t);
                  }
                }

                // Merge orders
                const orderMap = new Map();
                for (const o of (current.orders || [])) {
                  if (o.id || o.folio) orderMap.set(o.id || o.folio, o);
                }
                for (const o of (payload.orders || [])) {
                  const key = o.id || o.folio;
                  if (!key) continue;
                  if (orderMap.has(key)) {
                    const prev = orderMap.get(key);
                    orderMap.set(key, {
                      ...prev,
                      ...o,
                      collectedAmount: Math.max(o.collectedAmount || 0, prev.collectedAmount || 0),
                      deposit: Math.max(o.deposit || 0, prev.deposit || 0)
                    });
                  } else {
                    orderMap.set(key, o);
                  }
                }

                // Merge shift cuts
                const cutsMap = new Map();
                for (const c of (current.shiftCuts || [])) {
                  cutsMap.set(c.id || c.folio || `${c.date}_${c.shiftType}`, c);
                }
                for (const c of (payload.shiftCuts || [])) {
                  cutsMap.set(c.id || c.folio || `${c.date}_${c.shiftType}`, {
                    ...(cutsMap.get(c.id || c.folio || `${c.date}_${c.shiftType}`) || {}),
                    ...c
                  });
                }

                // Merge outflows
                const outflowsMap = new Map();
                for (const o of (current.outflows || [])) {
                  if (o.id) outflowsMap.set(o.id, o);
                }
                for (const o of (payload.outflows || [])) {
                  if (o.id) outflowsMap.set(o.id, { ...(outflowsMap.get(o.id) || {}), ...o });
                }

                (global as any).__santafe_store = {
                  tickets: Array.from(ticketMap.values()),
                  orders: Array.from(orderMap.values()),
                  shiftCuts: Array.from(cutsMap.values()),
                  outflows: Array.from(outflowsMap.values()),
                  customers: payload.customers || current.customers || [],
                  lastUpdated: new Date().toISOString()
                };

                try {
                  fs.writeFileSync(tempStoreFile, JSON.stringify((global as any).__santafe_store, null, 2), 'utf8');
                } catch {
                  // ignore
                }

                res.writeHead(200, headers);
                return res.end(JSON.stringify({
                  success: true,
                  merged: true,
                  data: (global as any).__santafe_store,
                  message: 'Datos combinados correctamente en dev'
                }));
              } catch (e: any) {
                res.writeHead(500, headers);
                return res.end(JSON.stringify({ error: e.message }));
              }
            });
            return;
          }

          // Voice Assistant Endpoint for Punto Zákia - Panadería Santa Fe with Cumulative Session State
          if (req.url && (req.url.startsWith('/api/voice-assistant') || req.url.startsWith('/.netlify/functions/voice-assistant'))) {
            if (req.method === 'OPTIONS') {
              res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
              });
              return res.end();
            }

            let bodyStr = '';
            req.on('data', chunk => { bodyStr += chunk; });
            req.on('end', async () => {
              const headers = {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
              };

              try {
                let payload: any = {};
                if (bodyStr) {
                  try { payload = JSON.parse(bodyStr); } catch (e) {}
                }
                const transcript = (payload.transcript || '').trim();
                const sessionId = payload.sessionId || 'global_active_session';
                const action = payload.action; // 'reset' | 'get_state' | 'process'

                // Global cumulative session storage
                if (!(global as any).__voice_sessions) {
                  (global as any).__voice_sessions = new Map();
                }
                const sessionsMap: Map<string, any> = (global as any).__voice_sessions;

                if (action === 'reset' || req.method === 'DELETE') {
                  sessionsMap.delete(sessionId);
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    success: true,
                    action: 'reset',
                    sessionId,
                    items: [],
                    total: 0,
                    message: 'Sesión reiniciada con éxito'
                  }));
                }

                if (action === 'get_state') {
                  const currentSession = sessionsMap.get(sessionId) || { items: [], total: 0 };
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    sessionId,
                    items: currentSession.items,
                    total: currentSession.total
                  }));
                }

                if (action === 'remove_item') {
                  let currentSession = sessionsMap.get(sessionId);
                  if (currentSession && Array.isArray(currentSession.items)) {
                    const itemIndex = typeof payload.index === 'number' ? payload.index : -1;
                    if (itemIndex >= 0 && itemIndex < currentSession.items.length) {
                      currentSession.items.splice(itemIndex, 1);
                    } else if (payload.concepto) {
                      const matchIdx = currentSession.items.findIndex(
                        (it: any) => it.concepto === payload.concepto && (payload.precio_unitario ? it.precio_unitario === payload.precio_unitario : true)
                      );
                      if (matchIdx >= 0) {
                        currentSession.items.splice(matchIdx, 1);
                      }
                    }
                    currentSession.total = Math.round(
                      currentSession.items.reduce((acc: number, it: any) => acc + it.subtotal, 0) * 100
                    ) / 100;
                    currentSession.lastUpdated = Date.now();
                  }
                  const safeSession = currentSession || { items: [], total: 0 };
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    success: true,
                    action: 'remove_item',
                    sessionId,
                    items: safeSession.items,
                    total: safeSession.total
                  }));
                }

                // Retrieve or initialize current session state
                let currentSession = sessionsMap.get(sessionId);
                if (!currentSession) {
                  currentSession = {
                    sessionId,
                    items: [],
                    total: 0,
                    lastUpdated: Date.now()
                  };
                  sessionsMap.set(sessionId, currentSession);
                }

                // If no transcript provided, return current cumulative state
                if (!transcript) {
                  res.writeHead(200, headers);
                  return res.end(JSON.stringify({
                    items: currentSession.items,
                    total: currentSession.total,
                    isFinalCheckout: false,
                    shouldCloseMic: false
                  }));
                }

                const normTranscript = transcript
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[\u0300-\u036f]/g, '')
                  .replace(/[.,;:¿?¡!]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();

                // 1. Detect close words: "cerrar", "terminar", "salir", "apagar microfono", "apagar", "listo cerrar"
                const isCloseWord = /\b(cerrar|terminar|finalizar|salir|apagar microfono|apagar micro|apagar|adios)\b/.test(normTranscript);

                // 2. Detect "cuenta" or "cobrar" (sends final total to POS / triggers checkout)
                const isCuentaFinal = /\b(cuenta|la cuenta|dar cuenta|cobrar|cierre de cuenta|terminar cuenta|total cuenta|cobro)\b/.test(normTranscript);

                // Deterministic local parser for items in current transcript
                const parseItemsFromText = (text: string) => {
                  const NUMBER_MAP: Record<string, number> = {
                    'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
                    'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11,
                    'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15, 'dieciseis': 16,
                    'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19,
                    'veinte': 20, 'veintiuno': 21, 'veintidos': 22, 'veintitres': 23,
                    'veinticuatro': 24, 'veinticinco': 25, 'treinta': 30, 'treinta y cinco': 35,
                    'cincuenta': 50, 'noventa': 90, 'cien': 100, 'ciento cincuenta': 150
                  };
                  const parseNum = (tok: string): number | null => {
                    if (!tok) return null;
                    const cleanTok = tok.trim();
                    const n = parseInt(cleanTok, 10);
                    if (!isNaN(n) && n > 0) return n;
                    return NUMBER_MAP[cleanTok] || null;
                  };

                  let w = text
                    .replace(/\b(cuenta|abrir cuenta|iniciar|cobrar|ehh|eh|a ver|aver|ponle|pon|dame|agrega|sumale|sumar|por favor|porfa|favor|cerrar|terminar|apagar)\b/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                  const parsedItems: Array<{ cantidad: number; concepto: string; precio_unitario: number; subtotal: number }> = [];

                  // Postre
                  const postreRegex = /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?postres?(?:\s+de\s+(\d+|veinticinco|veinte))?\b/g;
                  let pMatch: RegExpExecArray | null;
                  while ((pMatch = postreRegex.exec(w)) !== null) {
                    const rawQty = pMatch[1];
                    const qty = rawQty ? (parseNum(rawQty) || 1) : 1;
                    const rawP = pMatch[2];
                    let uPrice = 20.00;
                    if (rawP && parseNum(rawP) === 25) uPrice = 25.00;
                    parsedItems.push({
                      cantidad: qty,
                      concepto: 'Postre',
                      precio_unitario: uPrice,
                      subtotal: Math.round(qty * uPrice * 100) / 100
                    });
                  }
                  w = w.replace(postreRegex, ' ');

                  // Fixed products
                  const fixedProds = [
                    { name: 'Lechita', price: 18.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?lechitas?\b/g },
                    { name: 'Leche', price: 35.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?leches?\b/g },
                    { name: 'Nata', price: 90.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?natas?\b/g },
                    { name: 'Queso', price: 150.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?quesos?\b/g },
                    { name: 'Domo', price: 25.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?domos?\b/g }
                  ];

                  for (const prod of fixedProds) {
                    let match: RegExpExecArray | null;
                    while ((match = prod.regex.exec(w)) !== null) {
                      const qty = match[1] ? (parseNum(match[1]) || 1) : 1;
                      parsedItems.push({
                        cantidad: qty,
                        concepto: prod.name,
                        precio_unitario: prod.price,
                        subtotal: Math.round(qty * prod.price * 100) / 100
                      });
                    }
                    w = w.replace(prod.regex, ' ');
                  }

                  // X de Y (e.g. 2 de 5, 3 de 10, 5 de 3, 3 de 12)
                  const qtyWords = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco';
                  const priceWords = 'tres|cinco|ocho|diez|doce|quince|dieciocho|veinte|veinticinco|treinta|treinta y cinco|cincuenta|noventa|cien|ciento cincuenta';
                  const xDeYRegex = new RegExp(`\\b(\\d+|${qtyWords})\\s+(?:piezas?|panes?|pzas?)?\\s*de\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');

                  let xyMatch: RegExpExecArray | null;
                  while ((xyMatch = xDeYRegex.exec(w)) !== null) {
                    const qty = parseNum(xyMatch[1]) || 1;
                    const price = parseNum(xyMatch[2]);
                    if (price && price > 0) {
                      parsedItems.push({
                        cantidad: qty,
                        concepto: `Pieza $${price}`,
                        precio_unitario: price,
                        subtotal: Math.round(qty * price * 100) / 100
                      });
                    }
                  }
                  w = w.replace(xDeYRegex, ' ');

                  // Standalone "de Y"
                  const standaloneRegex = new RegExp(`\\bde\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');
                  let stMatch: RegExpExecArray | null;
                  while ((stMatch = standaloneRegex.exec(w)) !== null) {
                    const price = parseNum(stMatch[1]);
                    if (price && price > 0) {
                      parsedItems.push({
                        cantidad: 1,
                        concepto: `Pieza $${price}`,
                        precio_unitario: price,
                        subtotal: price
                      });
                    }
                  }

                  return parsedItems;
                };

                let newlyDetectedItems = parseItemsFromText(normTranscript);

                // Optional Gemini fallback if no items were extracted and GEMINI_API_KEY is present
                if (newlyDetectedItems.length === 0 && process.env.GEMINI_API_KEY && !isCloseWord) {
                  try {
                    const ai = new GoogleGenAI();
                    const systemInstruction = `Eres el asistente de voz del punto de venta "Punto Zákia" de Panadería Santa Fe.
Interpreta lo que dicta el cajero y devuelve EXCLUSIVAMENTE un objeto JSON válido con los productos dictados en esta frase.
REGLAS:
- "X de Y" (ej. 2 de 5, 3 de 10) -> X es cantidad, Y es precio ($5, $10, $12, $18, $20, $25, $35, $150). Concepto: "Pieza $Y".
- "Lechita" -> 18.00, "Leche" -> 35.00, "Nata" -> 90.00, "Queso" -> 150.00, "Domo" -> 25.00
- "Postre" -> 20.00 (o 25.00 si especifican de 25)
- "un", "una" -> cantidad 1
- Ignora muletillas ("ehh", "a ver", "ponle", "y", "más", "cuenta").
Devuelve: { "items": [{ "cantidad": 2, "concepto": "Pieza $5", "precio_unitario": 5.0, "subtotal": 10.0 }], "total": 10.0 }`;

                    const aiResp = await ai.models.generateContent({
                      model: 'gemini-3.8-flash',
                      contents: `Interpreta: "${transcript}"`,
                      config: {
                        systemInstruction,
                        responseMimeType: 'application/json',
                      }
                    });

                    const parsed = JSON.parse(aiResp.text?.trim() || '{}');
                    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
                      newlyDetectedItems = parsed.items;
                    }
                  } catch (aiErr) {
                    console.warn('Gemini parser fallback error:', aiErr);
                  }
                }

                // ACCUMULATE STATE: Add newly detected items to the ongoing session
                if (newlyDetectedItems.length > 0) {
                  for (const nItem of newlyDetectedItems) {
                    const existIdx = currentSession.items.findIndex(
                      (it: any) => it.concepto === nItem.concepto && it.precio_unitario === nItem.precio_unitario
                    );
                    if (existIdx >= 0) {
                      const existing = currentSession.items[existIdx];
                      const newQty = existing.cantidad + nItem.cantidad;
                      currentSession.items[existIdx] = {
                        ...existing,
                        cantidad: newQty,
                        subtotal: Math.round(newQty * existing.precio_unitario * 100) / 100
                      };
                    } else {
                      currentSession.items.push({
                        cantidad: nItem.cantidad,
                        concepto: nItem.concepto,
                        precio_unitario: nItem.precio_unitario,
                        subtotal: Math.round(nItem.cantidad * nItem.precio_unitario * 100) / 100
                      });
                    }
                  }

                  // Recalculate session total
                  currentSession.total = Math.round(
                    currentSession.items.reduce((acc: number, it: any) => acc + it.subtotal, 0) * 100
                  ) / 100;
                  currentSession.lastUpdated = Date.now();
                }

                const responseData = {
                  sessionId,
                  // The items added in this specific turn:
                  newItems: newlyDetectedItems,
                  // The complete cumulative items in the session:
                  items: currentSession.items,
                  // The overall cumulative total:
                  total: currentSession.total,
                  // Trigger sending final total / checkout in POS when 'cuenta' is spoken:
                  isFinalCheckout: isCuentaFinal,
                  // Close recognition only when user says a closing word:
                  shouldCloseMic: isCloseWord,
                  transcript
                };

                // If close word said, reset session
                if (isCloseWord) {
                  sessionsMap.delete(sessionId);
                }

                res.writeHead(200, headers);
                return res.end(JSON.stringify(responseData));
              } catch (err: any) {
                res.writeHead(500, headers);
                return res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }
        }
        next();
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), clipNetlifyFunctionDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
