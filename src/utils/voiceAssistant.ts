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
  newItems?: VoiceCommandItem[];
  rawTranscript?: string;
  isFinalCheckout?: boolean;
  isCardPayment?: boolean;
  cashReceived?: number;
  changeToGive?: number;
  shouldCloseMic?: boolean;
  sessionId?: string;
  source?: 'local_rules' | 'gemini_ai' | 'session_api';
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
  'ciento': 100,
  'ciento cincuenta': 150,
  'doscientos': 200,
  'trescientos': 300,
  'cuatrocientos': 400,
  'quinientos': 500,
  'seiscientos': 600,
  'setecientos': 700,
  'ochocientos': 800,
  'novecientos': 900,
  'mil': 1000
};

// Normalize text for parsing
export function normalizeSpokenText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[.,;:¿?¡!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNumber(token: string): number | null {
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
 *    - X is quantity, Y is unit price.
 * 2. Fixed products:
 *    - Lechita -> 18.00
 *    - Leche -> 35.00
 *    - Nata -> 90.00
 *    - Queso -> 150.00
 *    - Domo -> 25.00
 * 3. Postres:
 *    - Postre -> 20.00 (or 25.00 if they say "de 25")
 * 4. "un", "una" -> 1
 * 5. Ignore filler words: "ehh", "a ver", "ponle", "y", "por favor", etc.
 * 6. "mas" / "más" is used as a connector to sum to current sale.
 * 7. "cuenta" commands send total to POS.
 * 8. Closing words like "cerrar", "terminar", "apagar", "salir" close the recognition.
 */
export function parseVoiceCommandLocally(transcript: string): VoiceCommandResult {
  const norm = normalizeSpokenText(transcript);
  const items: VoiceCommandItem[] = [];

  // Detect closing words
  const isCloseWord = /\b(cerrar|terminar|finalizar|salir|apagar microfono|apagar micro|apagar|adios)\b/.test(norm);

  // Detect 'cuenta' command
  const isCuentaFinal = /\b(cuenta|la cuenta|dar cuenta|cobrar|cierre de cuenta|terminar cuenta|total cuenta|cobro)\b/.test(norm);

  // Detect card payment command ("cobro con tarjeta", "pago con tarjeta", "pagar con tarjeta", "tarjeta", "terminal")
  const isCardPayment = /\b(cobro\s+con\s+tarjeta|pago\s+con\s+tarjeta|pagar\s+con\s+tarjeta|cobrar\s+con\s+tarjeta|cobro\s+tarjeta|pago\s+tarjeta|pagar\s+tarjeta|con\s+tarjeta|tarjeta|terminal)\b/.test(norm);

  // Detect cash received command (e.g., "recibo 500", "recibo 200", "pagan con 500", "me dan 200", "billete de 500", etc.)
  const cashRegex = /\b(?:recibo|recibe|pagan\s+con|paga\s+con|me\s+dan|dan|billete\s+de)\s+(\d+|cincuenta|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil)\b/g;
  const cashMatch = cashRegex.exec(norm);
  let cashReceived: number | undefined;
  if (cashMatch) {
    const parsedCash = parseNumber(cashMatch[1]);
    if (parsedCash && parsedCash > 0) {
      cashReceived = parsedCash;
    }
  }

  let workingText = norm;

  // Remove filler and activation words
  workingText = workingText
    .replace(/\b(cuenta|abrir cuenta|iniciar|cobrar|ehh|eh|a ver|aver|ponle|pon|dame|agrega|sumale|sumar|por favor|porfa|favor|cerrar|terminar|apagar|tarjeta|recibo|recibe|pagan con|paga con|me dan|billete de)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Extract "Postre" variations
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

  // 2. Extract Fixed Products including user's specific bakery dictionary:
  // - Bolillo -> $5 pesos (Pieza $5)
  // - Tradicional -> $12 pesos (Pieza $12)
  // - Relleno -> $18 pesos (Pieza $18)
  // - Lechita -> $18.00, Leche -> $35.00, Nata -> $90.00, Queso -> $150.00, Domo -> $25.00
  const fixedProductsConfig: Array<{ name: string; price: number; regex: RegExp }> = [
    {
      name: 'Bolillo ($5)',
      price: 5.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)\s+)?(?:de\s+)?(?:pan(?:es)?\s+)?(?:bolillos?|teleras?|pan\s+blanco)\b/g
    },
    {
      name: 'Pan Tradicional ($12)',
      price: 12.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)\s+)?(?:de\s+)?(?:pan(?:es)?\s+)?(?:dulces?\s+)?tradicional(?:es)?\b/g
    },
    {
      name: 'Pan Relleno ($18)',
      price: 18.00,
      regex: /\b(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte)\s+)?(?:de\s+)?(?:pan(?:es)?\s+)?rellenos?\b/g
    },
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

  // 3. Extract "X de Y" (e.g. "2 de 5", "3 de 10", "3 de 12", "5 de 18", "1 de 20", "5 de 3", "2 de 25")
  const qtyWords = 'un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco';
  const priceWords = 'tres|cinco|ocho|diez|doce|quince|dieciocho|veinte|veinticinco|treinta|treinta y cinco|cincuenta|noventa|cien|ciento cincuenta';

  const xDeYRegex = new RegExp(`\\b(\\d+|${qtyWords})\\s+(?:piezas?|panes?|pzas?)?\\s*de\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');

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

  // 4. Standalone "de Y" (implied quantity 1, e.g. "mas de 10", "y de 5")
  const standaloneDeRegex = new RegExp(`\\bde\\s+(?:a\\s+)?\\$?(\\d+|${priceWords})\\b`, 'g');
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
  workingText = workingText.replace(standaloneDeRegex, ' ');

  // Calculate total
  const total = Math.round(items.reduce((acc, curr) => acc + curr.subtotal, 0) * 100) / 100;
  const changeToGive = (cashReceived !== undefined && total > 0) ? Math.round((cashReceived - total) * 100) / 100 : undefined;

  return {
    items,
    newItems: items,
    total,
    isFinalCheckout: isCuentaFinal,
    isCardPayment,
    cashReceived,
    changeToGive,
    shouldCloseMic: isCloseWord,
    rawTranscript: transcript,
    source: 'local_rules'
  };
}

/**
 * Speaks text aloud using SpeechSynthesis API (Text-to-Speech) in Mexican Spanish.
 */
export function speakText(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX';
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith('es-MX')) || voices.find(v => v.lang.startsWith('es'));
    if (esVoice) utterance.voice = esVoice;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('Speech synthesis error:', err);
  }
}

/**
 * Call server-side /api/voice-assistant with session accumulation.
 * Keeps an ongoing cumulative state on the server while returning newItems and overall items/total.
 */
export async function parseVoiceCommandWithAI(
  transcript: string,
  sessionId: string = 'pos_main_session'
): Promise<VoiceCommandResult> {
  const localResult = parseVoiceCommandLocally(transcript);

  try {
    const response = await fetch('/api/voice-assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transcript,
        sessionId
      })
    });

    if (response.ok) {
      const data = await response.json();
      const currentItems = Array.isArray(data.items) ? data.items : localResult.items;
      const currentTotal = typeof data.total === 'number' ? data.total : localResult.total;
      const effectiveCashReceived = typeof data.cashReceived === 'number' ? data.cashReceived : localResult.cashReceived;
      const effectiveChange = (effectiveCashReceived !== undefined && currentTotal > 0)
        ? Math.round((effectiveCashReceived - currentTotal) * 100) / 100
        : localResult.changeToGive;

      return {
        items: currentItems,
        newItems: Array.isArray(data.newItems) && data.newItems.length > 0 ? data.newItems : localResult.items,
        total: currentTotal,
        isFinalCheckout: typeof data.isFinalCheckout === 'boolean' ? data.isFinalCheckout : localResult.isFinalCheckout,
        isCardPayment: typeof data.isCardPayment === 'boolean' ? data.isCardPayment : localResult.isCardPayment,
        cashReceived: effectiveCashReceived,
        changeToGive: effectiveChange,
        shouldCloseMic: typeof data.shouldCloseMic === 'boolean' ? data.shouldCloseMic : localResult.shouldCloseMic,
        rawTranscript: transcript,
        sessionId: data.sessionId || sessionId,
        source: 'session_api'
      };
    }
  } catch (err) {
    console.warn('Voice session endpoint fallback to local rules:', err);
  }

  return localResult;
}

/**
 * Reset server voice session state
 */
export async function resetVoiceSession(sessionId: string = 'pos_main_session'): Promise<void> {
  try {
    await fetch('/api/voice-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', sessionId })
    });
  } catch (e) {
    console.warn('Could not reset session on server:', e);
  }
}

/**
 * Remove an item from the server voice session by index or name
 */
export async function removeVoiceSessionItem(
  sessionId: string,
  index?: number,
  concepto?: string,
  precio_unitario?: number
): Promise<{ items: VoiceCommandItem[]; total: number } | null> {
  try {
    const res = await fetch('/api/voice-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_item', sessionId, index, concepto, precio_unitario })
    });
    if (res.ok) {
      const data = await res.json();
      return {
        items: Array.isArray(data.items) ? data.items : [],
        total: typeof data.total === 'number' ? data.total : 0
      };
    }
  } catch (e) {
    console.warn('Could not remove item from server session:', e);
  }
  return null;
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
  // Set continuous to true so the microphone stays ON continuously while dictating items!
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'es-MX'; // Mexican Spanish tailored for bakery cashier
  return recognition;
}
