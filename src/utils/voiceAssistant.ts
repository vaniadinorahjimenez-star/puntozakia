/**
 * Voice Assistant Parser & Speech Recognition Service for Punto Zákia - Panadería Santa Fe
 * Interprets cashier voice dictation and calculates subtotals & totals following strict store pricing rules.
 */

export interface VoiceCommandItem {
  cantidad: number;
  concepto: string;
  precio_unitario: number;
  subtotal: number;
}

export interface VoiceCommandResult {
  items: VoiceCommandItem[];
  total: number;
  rawTranscript?: string;
  source?: 'local_rules' | 'gemini_ai';
}

const NUMBER_WORDS: Record<string, number> = {
  'un': 1,
  'uno': 1,
  'una': 1,
  'dos': 2,
  'tres': 3,
  'cuatro': 4,
  'cinco': 5,
  'seis': 6,
  'siete': 7,
  'ocho': 8,
  'nueve': 9,
  'diez': 10,
  'once': 11,
  'doce': 12,
  'trece': 13,
  'catorce': 14,
  'quince': 15,
  'dieciseis': 16,
  'dieciséis': 16,
  'diecisiete': 17,
  'dieciocho': 18,
  'diecinueve': 19,
  'veinte': 20,
  'veintiuno': 21,
  'veintidos': 22,
  'veintidós': 22,
  'veintitres': 23,
  'veintitrés': 23,
  'veinticuatro': 24,
  'veinticinco': 25,
  'treinta': 30,
  'treinta y cinco': 35,
  'cincuenta': 50,
  'noventa': 90,
  'cien': 100,
  'ciento cincuenta': 150
};

// Normalize text for parsing
function normalizeSpokenText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[.,;:¿?¡!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(token: string): number | null {
  if (!token) return null;
  const trimmed = token.trim();
  const directNum = parseInt(trimmed, 10);
  if (!isNaN(directNum) && directNum > 0) return directNum;
  if (NUMBER_WORDS[trimmed] !== undefined) return NUMBER_WORDS[trimmed];
  return null;
}

/**
 * Deterministic local parser adhering strictly to the user's rules:
 * 1. "X de Y" (e.g., "2 de 5", "3 de 10", "3 de 12", "5 de 18", "1 de 20", etc.) -> Concept: "Pieza $Y"
 * 2. Fixed products:
 *    - Lechita -> 18.00
 *    - Leche -> 35.00
 *    - Nata -> 90.00
 *    - Queso -> 150.00
 *    - Domo -> 25.00
 * 3. Postres:
 *    - Postre -> 20.00 (o 25.00 si dicen "de 25")
 * 4. "un", "una" -> 1
 * 5. Ignore filler words: "ehh", "a ver", "ponle", "y", "mas", "favor"
 */
export function parseVoiceCommandLocally(transcript: string): VoiceCommandResult {
  const norm = normalizeSpokenText(transcript);
  const items: VoiceCommandItem[] = [];

  // Working copy of text
  let workingText = norm;

  // 1. Remove filler words that can be ignored
  // "ehh", "eh", "a ver", "ponle", "por favor", "porfa"
  workingText = workingText
    .replace(/\b(ehh|eh|a ver|ponle|por favor|porfa|dame|agrega|sumale|sumar|favor)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. Extract "Postre" variations first (to capture "postre de 25" or "postre de 20")
  // Matches: "(cantidad)? postre(s)? (de (25|20))?"
  const postreRegex = /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?postres?(?:\s+de\s+(\d+|veinticinco|veinte))?\b/g;
  let postreMatch: RegExpExecArray | null;
  while ((postreMatch = postreRegex.exec(workingText)) !== null) {
    const rawQty = postreMatch[1];
    const qty = rawQty ? (parseNumber(rawQty) || 1) : 1;
    const rawPrice = postreMatch[2];
    let unitPrice = 20.00;
    if (rawPrice) {
      const parsedP = parseNumber(rawPrice);
      if (parsedP === 25) unitPrice = 25.00;
    }
    items.push({
      cantidad: qty,
      concepto: 'Postre',
      precio_unitario: unitPrice,
      subtotal: Math.round(qty * unitPrice * 100) / 100
    });
  }
  workingText = workingText.replace(postreRegex, ' ');

  // 3. Extract Fixed Lácteos & Acompañamientos:
  // "Lechita" -> 18.00
  // "Leche" -> 35.00 (not lechita)
  // "Nata" -> 90.00
  // "Queso" -> 150.00
  // "Domo" -> 25.00
  const fixedProductsConfig: Array<{ name: string; price: number; regex: RegExp }> = [
    {
      name: 'Lechita',
      price: 18.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?lechitas?\b/g
    },
    {
      name: 'Leche',
      price: 35.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?leches?\b/g
    },
    {
      name: 'Nata',
      price: 90.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?natas?\b/g
    },
    {
      name: 'Queso',
      price: 150.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?quesos?\b/g
    },
    {
      name: 'Domo',
      price: 25.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+)?domos?\b/g
    }
  ];

  for (const prod of fixedProductsConfig) {
    let match: RegExpExecArray | null;
    while ((match = prod.regex.exec(workingText)) !== null) {
      const rawQty = match[1];
      const qty = rawQty ? (parseNumber(rawQty) || 1) : 1;
      items.push({
        cantidad: qty,
        concepto: prod.name,
        precio_unitario: prod.price,
        subtotal: Math.round(qty * prod.price * 100) / 100
      });
    }
    workingText = workingText.replace(prod.regex, ' ');
  }

  // 4. Extract "X de Y" (e.g. "2 de 5", "3 de 10", "3 de 12", "5 de 18", "1 de 20", "dos de veinticinco", etc.)
  // May include words like "panes de", "piezas de"
  // Patterns like: "(\d+|words) (?:piezas?|panes?)? de (?:a\s+)?(\$?\d+|words)"
  const xDeYRegex = /\b(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)\s+(?:piezas?|panes?|pzas?)?\s*de\s+(?:a\s+)?\$?(\d+|cinco|ocho|diez|doce|dieciocho|veinte|veinticinco|treinta y cinco|noventa|cien|ciento cincuenta)\b/g;

  let xDeYMatch: RegExpExecArray | null;
  while ((xDeYMatch = xDeYRegex.exec(workingText)) !== null) {
    const rawQty = xDeYMatch[1];
    const rawPrice = xDeYMatch[2];
    const qty = parseNumber(rawQty) || 1;
    const price = parseNumber(rawPrice);
    if (price && price > 0) {
      items.push({
        cantidad: qty,
        concepto: `Pieza $${price}`,
        precio_unitario: price,
        subtotal: Math.round(qty * price * 100) / 100
      });
    }
  }
  workingText = workingText.replace(xDeYRegex, ' ');

  // 5. Fallback for standalone "de 5", "de 10" (implied quantity 1)
  const standaloneDeRegex = /\bde\s+(?:a\s+)?\$?(\d+|cinco|ocho|diez|doce|dieciocho|veinte|veinticinco|treinta y cinco|noventa|cien|ciento cincuenta)\b/g;
  let standaloneMatch: RegExpExecArray | null;
  while ((standaloneMatch = standaloneDeRegex.exec(workingText)) !== null) {
    const rawPrice = standaloneMatch[1];
    const price = parseNumber(rawPrice);
    if (price && price > 0) {
      items.push({
        cantidad: 1,
        concepto: `Pieza $${price}`,
        precio_unitario: price,
        subtotal: price
      });
    }
  }

  // Calculate total
  const total = Math.round(items.reduce((acc, curr) => acc + curr.subtotal, 0) * 100) / 100;

  return {
    items,
    total,
    rawTranscript: transcript,
    source: 'local_rules'
  };
}

/**
 * Call server-side Gemini API with exact system instructions provided by user.
 * Falls back transparently to local parser if offline or error.
 */
export async function parseVoiceCommandWithAI(transcript: string): Promise<VoiceCommandResult> {
  const localResult = parseVoiceCommandLocally(transcript);

  // If local parser found items and confident, we can return it directly or attempt server AI
  try {
    const response = await fetch('/api/voice-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ transcript })
    });

    if (response.ok) {
      const data = await response.json();
      if (data && Array.isArray(data.items) && typeof data.total === 'number') {
        return {
          items: data.items,
          total: data.total,
          rawTranscript: transcript,
          source: 'gemini_ai'
        };
      }
    }
  } catch (err) {
    console.warn('Voice AI server call failed, using deterministic local parser:', err);
  }

  return localResult;
}

/**
 * Speech Recognition Web API utilities
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

export function createSpeechRecognitionInstance(): any | null {
  if (typeof window === 'undefined') return null;
  const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognitionClass) return null;

  const recognition = new SpeechRecognitionClass();
  recognition.continuous = false; // Capture phrase and finish on pause
  recognition.interimResults = true; // Show interim words in real time
  recognition.lang = 'es-MX'; // Mexican Spanish tailored for bakery cashier
  return recognition;
}
