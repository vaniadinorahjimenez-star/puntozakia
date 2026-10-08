import { GoogleGenAI } from '@google/genai';

// Voice Assistant Netlify Function & API Handler with Session Accumulation
interface SessionState {
  items: Array<{
    cantidad: number;
    concepto: string;
    precio_unitario: number;
    subtotal: number;
  }>;
  total: number;
  lastUpdated: number;
}

// In-memory sessions store (keyed by sessionId or 'global_active')
const voiceSessions = new Map<string, SessionState>();

// Helper number parser
const NUMBER_WORDS: Record<string, number> = {
  'un': 1, 'uno': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5,
  'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10, 'once': 11,
  'doce': 12, 'trece': 13, 'catorce': 14, 'quince': 15, 'dieciseis': 16,
  'dieciséis': 16, 'diecisiete': 17, 'dieciocho': 18, 'diecinueve': 19,
  'veinte': 20, 'veintiuno': 21, 'veintidos': 22, 'veintidós': 22,
  'veintitres': 23, 'veintitrés': 23, 'veinticuatro': 24, 'veinticinco': 25,
  'treinta': 30, 'treinta y cinco': 35, 'cincuenta': 50, 'noventa': 90,
  'cien': 100, 'ciento cincuenta': 150
};

function parseNum(token: string): number | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  const direct = parseInt(t, 10);
  if (!isNaN(direct) && direct > 0) return direct;
  if (NUMBER_WORDS[t] !== undefined) return NUMBER_WORDS[t];
  return null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:¿?¡!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLocalCommand(text: string) {
  const norm = normalize(text);
  const items: Array<{
    cantidad: number;
    concepto: string;
    precio_unitario: number;
    subtotal: number;
  }> = [];

  let working = norm;

  // 1. Postres
  const postreRegex = /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?postres?(?:\s+de\s+(\d+|veinticinco|veinte))?\b/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = postreRegex.exec(working)) !== null) {
    const rawQty = pMatch[1];
    const qty = rawQty ? (parseNum(rawQty) || 1) : 1;
    const rawPrice = pMatch[2];
    let unitPrice = 20.00;
    if (rawPrice) {
      const p = parseNum(rawPrice);
      if (p === 25) unitPrice = 25.00;
    }
    items.push({
      cantidad: qty,
      concepto: 'Postre',
      precio_unitario: unitPrice,
      subtotal: Math.round(qty * unitPrice * 100) / 100
    });
  }
  working = working.replace(postreRegex, ' ');

  // 2. Acompañamientos y lácteos
  const fixedList = [
    { name: 'Lechita', price: 18.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?lechitas?\b/g },
    { name: 'Leche', price: 35.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?leches?\b/g },
    { name: 'Nata', price: 90.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?natas?\b/g },
    { name: 'Queso', price: 150.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?quesos?\b/g },
    { name: 'Domo', price: 25.00, regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?domos?\b/g }
  ];

  for (const prod of fixedList) {
    let match: RegExpExecArray | null;
    while ((match = prod.regex.exec(working)) !== null) {
      const rawQty = match[1];
      const qty = rawQty ? (parseNum(rawQty) || 1) : 1;
      items.push({
        cantidad: qty,
        concepto: prod.name,
        precio_unitario: prod.price,
        subtotal: Math.round(qty * prod.price * 100) / 100
      });
    }
    working = working.replace(prod.regex, ' ');
  }

  // 3. X de Y (e.g. 2 de 5, 3 de 10, 5 de 3)
  const qtyWords = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco';
  const priceWords = 'tres|cinco|ocho|diez|doce|quince|dieciocho|veinte|veinticinco|treinta|treinta y cinco|cincuenta|noventa|cien|ciento cincuenta';
  const xDeYRegex = new RegExp(`\\b(\\d+|${qtyWords})\\s+(?:piezas?|panes?|pzas?)?\\s*de\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');

  let xDeYMatch: RegExpExecArray | null;
  while ((xDeYMatch = xDeYRegex.exec(working)) !== null) {
    const rawQty = xDeYMatch[1];
    const rawPrice = xDeYMatch[2];
    const qty = parseNum(rawQty) || 1;
    const price = parseNum(rawPrice);
    if (price && price > 0) {
      items.push({
        cantidad: qty,
        concepto: `Pieza $${price}`,
        precio_unitario: price,
        subtotal: Math.round(qty * price * 100) / 100
      });
    }
  }
  working = working.replace(xDeYRegex, ' ');

  // 4. Standalone de Y
  const standaloneRegex = new RegExp(`\\bde\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');
  let standMatch: RegExpExecArray | null;
  while ((standMatch = standaloneRegex.exec(working)) !== null) {
    const rawPrice = standMatch[1];
    const price = parseNum(rawPrice);
    if (price && price > 0) {
      items.push({
        cantidad: 1,
        concepto: `Pieza $${price}`,
        precio_unitario: price,
        subtotal: price
      });
    }
  }

  const total = Math.round(items.reduce((acc, it) => acc + it.subtotal, 0) * 100) / 100;
  return { items, total };
}
