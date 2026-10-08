// Netlify serverless function for /api/voice-assistant with cumulative session state
const NUMBER_MAP = {
  'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
  'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11,
  'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15, 'dieciseis': 16,
  'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19,
  'veinte': 20, 'veintiuno': 21, 'veintidos': 22, 'veintitres': 23,
  'veinticuatro': 24, 'veinticinco': 25, 'treinta': 30, 'treinta y cinco': 35,
  'cincuenta': 50, 'noventa': 90, 'cien': 100, 'ciento cincuenta': 150
};

function parseNum(tok) {
  if (!tok) return null;
  const clean = tok.trim();
  const n = parseInt(clean, 10);
  if (!isNaN(n) && n > 0) return n;
  return NUMBER_MAP[clean] || null;
}

// In-memory sessions cache across invocations within same lambda instance
const sessionStore = new Map();

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    let payload = {};
    if (event.body) {
      try { payload = JSON.parse(event.body); } catch (e) {}
    }

    const transcript = (payload.transcript || '').trim();
    const sessionId = payload.sessionId || 'global_active_session';
    const action = payload.action;

    if (action === 'reset' || event.httpMethod === 'DELETE') {
      sessionStore.delete(sessionId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, action: 'reset', sessionId, items: [], total: 0 })
      };
    }

    if (action === 'remove_item') {
      let session = sessionStore.get(sessionId);
      if (session && Array.isArray(session.items)) {
        const itemIndex = typeof payload.index === 'number' ? payload.index : -1;
        if (itemIndex >= 0 && itemIndex < session.items.length) {
          session.items.splice(itemIndex, 1);
        } else if (payload.concepto) {
          const matchIdx = session.items.findIndex(
            it => it.concepto === payload.concepto && (payload.precio_unitario ? it.precio_unitario === payload.precio_unitario : true)
          );
          if (matchIdx >= 0) {
            session.items.splice(matchIdx, 1);
          }
        }
        session.total = Math.round(
          session.items.reduce((acc, it) => acc + it.subtotal, 0) * 100
        ) / 100;
        session.lastUpdated = Date.now();
      }
      const safe = session || { items: [], total: 0 };
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, action: 'remove_item', sessionId, items: safe.items, total: safe.total })
      };
    }

    let session = sessionStore.get(sessionId);
    if (!session) {
      session = { sessionId, items: [], total: 0, lastUpdated: Date.now() };
      sessionStore.set(sessionId, session);
    }

    if (!transcript) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          sessionId,
          items: session.items,
          total: session.total,
          isFinalCheckout: false,
          shouldCloseMic: false
        })
      };
    }

    const norm = transcript
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:¿?¡!]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const isCloseWord = /\b(cerrar|terminar|finalizar|salir|apagar microfono|apagar micro|apagar|adios)\b/.test(norm);
    const isCuentaFinal = /\b(cuenta|la cuenta|dar cuenta|cobrar|cierre de cuenta|terminar cuenta|total cuenta|cobro)\b/.test(norm);

    let w = norm
      .replace(/\b(cuenta|abrir cuenta|iniciar|cobrar|ehh|eh|a ver|aver|ponle|pon|dame|agrega|sumale|sumar|por favor|porfa|favor|cerrar|terminar|apagar)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const newlyDetectedItems = [];

    // Postres
    const postreRegex = /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?postres?(?:\s+de\s+(\d+|veinticinco|veinte))?\b/g;
    let pMatch;
    while ((pMatch = postreRegex.exec(w)) !== null) {
      const qty = pMatch[1] ? (parseNum(pMatch[1]) || 1) : 1;
      let uPrice = 20.00;
      if (pMatch[2] && parseNum(pMatch[2]) === 25) uPrice = 25.00;
      newlyDetectedItems.push({
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
      let match;
      while ((match = prod.regex.exec(w)) !== null) {
        const qty = match[1] ? (parseNum(match[1]) || 1) : 1;
        newlyDetectedItems.push({
          cantidad: qty,
          concepto: prod.name,
          precio_unitario: prod.price,
          subtotal: Math.round(qty * prod.price * 100) / 100
        });
      }
      w = w.replace(prod.regex, ' ');
    }

    // X de Y
    const qtyWords = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco';
    const priceWords = 'tres|cinco|ocho|diez|doce|quince|dieciocho|veinte|veinticinco|treinta|treinta y cinco|cincuenta|noventa|cien|ciento cincuenta';
    const xDeYRegex = new RegExp(`\\b(\\d+|${qtyWords})\\s+(?:piezas?|panes?|pzas?)?\\s*de\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');

    let xyMatch;
    while ((xyMatch = xDeYRegex.exec(w)) !== null) {
      const qty = parseNum(xyMatch[1]) || 1;
      const price = parseNum(xyMatch[2]);
      if (price && price > 0) {
        newlyDetectedItems.push({
          cantidad: qty,
          concepto: `Pieza $${price}`,
          precio_unitario: price,
          subtotal: Math.round(qty * price * 100) / 100
        });
      }
    }
    w = w.replace(xDeYRegex, ' ');

    // Standalone de Y
    const standaloneRegex = new RegExp(`\\bde\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');
    let stMatch;
    while ((stMatch = standaloneRegex.exec(w)) !== null) {
      const price = parseNum(stMatch[1]);
      if (price && price > 0) {
        newlyDetectedItems.push({
          cantidad: 1,
          concepto: `Pieza $${price}`,
          precio_unitario: price,
          subtotal: price
        });
      }
    }

    // Accumulate items in session
    if (newlyDetectedItems.length > 0) {
      for (const nItem of newlyDetectedItems) {
        const existIdx = session.items.findIndex(
          it => it.concepto === nItem.concepto && it.precio_unitario === nItem.precio_unitario
        );
        if (existIdx >= 0) {
          const existing = session.items[existIdx];
          const newQty = existing.cantidad + nItem.cantidad;
          session.items[existIdx] = {
            ...existing,
            cantidad: newQty,
            subtotal: Math.round(newQty * existing.precio_unitario * 100) / 100
          };
        } else {
          session.items.push({
            cantidad: nItem.cantidad,
            concepto: nItem.concepto,
            precio_unitario: nItem.precio_unitario,
            subtotal: Math.round(nItem.cantidad * nItem.precio_unitario * 100) / 100
          });
        }
      }

      session.total = Math.round(
        session.items.reduce((acc, it) => acc + it.subtotal, 0) * 100
      ) / 100;
      session.lastUpdated = Date.now();
    }

    if (isCloseWord) {
      sessionStore.delete(sessionId);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId,
        newItems: newlyDetectedItems,
        items: session.items,
        total: session.total,
        isFinalCheckout: isCuentaFinal,
        shouldCloseMic: isCloseWord,
        transcript
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
