import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  X, 
  Sparkles, 
  Check, 
  Plus, 
  Volume2, 
  Code2, 
  RotateCcw, 
  HelpCircle, 
  Send,
  Zap,
  ShoppingBag,
  Info,
  CheckCircle2
} from 'lucide-react';
import { 
  parseVoiceCommandLocally, 
  parseVoiceCommandWithAI, 
  createSpeechRecognitionInstance, 
  isSpeechRecognitionSupported, 
  VoiceCommandResult, 
  VoiceCommandItem 
} from '../../utils/voiceAssistant';
import { playCashSound, playBeep } from '../../utils/audio';

interface VoiceAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItemsToTicket: (items: VoiceCommandItem[]) => void;
  currentTicketCount?: number;
}

export const VoiceAssistantModal: React.FC<VoiceAssistantModalProps> = ({
  isOpen,
  onClose,
  onAddItemsToTicket,
  currentTicketCount = 0
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [manualInput, setManualInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parsedResult, setParsedResult] = useState<VoiceCommandResult | null>(null);
  const [autoAddToTicket, setAutoAddToTicket] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string>('');
  const [showJsonView, setShowJsonView] = useState<boolean>(true);
  const [showHelpGuide, setShowHelpGuide] = useState<boolean>(false);

  const recognitionRef = useRef<any>(null);
  const speechSupported = isSpeechRecognitionSupported();

  // Test chips for instant testing
  const examplePhrases = [
    '2 de 5',
    '3 de 10 y una lechita',
    '3 de 12 y una nata',
    '5 de 18 y un domo',
    '1 de 20 y un queso',
    'un postre de 25 y 2 de 5',
    'más una nata y 4 de 10'
  ];

  // Stop listening helper
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // Process text and generate JSON + optionally add to ticket
  const processDictation = async (rawText: string, shouldAutoAdd: boolean = autoAddToTicket) => {
    if (!rawText.trim()) return;
    setIsProcessing(true);
    setErrorMessage('');

    try {
      // Parse with deterministic rules and AI fallback
      const result = await parseVoiceCommandWithAI(rawText);
      setParsedResult(result);

      if (result.items.length === 0) {
        setErrorMessage('No se detectaron productos válidos. Prueba con frases como "2 de 5", "3 de 10", "una lechita", etc.');
        playBeep(350, 'sawtooth', 0.15);
      } else {
        playBeep(880, 'sine', 0.08);

        if (shouldAutoAdd) {
          onAddItemsToTicket(result.items);
          playCashSound();
          setSuccessToast(`¡${result.items.length} productos sumados al ticket! ($${result.total.toFixed(2)})`);
          setTimeout(() => setSuccessToast(''), 3000);
        }
      }
    } catch (err: any) {
      console.error('Error processing voice:', err);
      // Fallback local
      const fallback = parseVoiceCommandLocally(rawText);
      setParsedResult(fallback);
      if (fallback.items.length > 0 && shouldAutoAdd) {
        onAddItemsToTicket(fallback.items);
        playCashSound();
        setSuccessToast(`¡Sumado al ticket! ($${fallback.total.toFixed(2)})`);
        setTimeout(() => setSuccessToast(''), 3000);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Start listening
  const startListening = () => {
    if (!speechSupported) {
      setErrorMessage('El reconocimiento de voz por micrófono no está disponible en este navegador. Puedes escribir o usar los botones de prueba abajo.');
      return;
    }

    stopListening();
    setErrorMessage('');
    setTranscript('');
    setInterimTranscript('');

    try {
      const recognition = createSpeechRecognitionInstance();
      if (!recognition) {
        setErrorMessage('No se pudo inicializar el micrófono.');
        return;
      }

      recognitionRef.current = recognition;

      recognition.onstart = () => {
        setIsListening(true);
        playBeep(600, 'sine', 0.05);
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        if (final) {
          const cleanFinal = final.trim();
          setTranscript(cleanFinal);
          setInterimTranscript('');
          processDictation(cleanFinal);
        } else {
          setInterimTranscript(interim);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setErrorMessage('Permiso de micrófono bloqueado. Haz clic en el ícono de candado o cámara en la barra de tu navegador y selecciona "Permitir micrófono".');
        } else if (event.error === 'no-speech') {
          setErrorMessage('No se escuchó audio. Intenta hablar más cerca del micrófono.');
        } else {
          setErrorMessage(`Error de voz: ${event.error}`);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (err: any) {
      console.error(err);
      setErrorMessage('No se pudo acceder al micrófono. Verifica los permisos de tu navegador.');
      setIsListening(false);
    }
  };

  // Toggle listening button
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  // Keyboard shortcut listener when modal is open
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopListening();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-amber-950 to-orange-950 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg transition-all ${
              isListening ? 'bg-red-500 animate-pulse ring-4 ring-red-400/40' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950'
            }`}>
              <Mic className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-amber-200 leading-tight">
                  Asistente de Voz Punto Zákia
                </h3>
                <span className="bg-amber-400/20 text-amber-300 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-amber-400/30">
                  Santa Fe
                </span>
              </div>
              <p className="text-xs text-slate-300 font-medium">
                Dicta productos y precios para sumarlos directamente al ticket
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowHelpGuide(!showHelpGuide)}
              className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              title="Instrucciones de voz"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-300 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              title="Cerrar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

          {/* Success / Added Toast */}
          {successToast && (
            <div className="bg-emerald-500 text-white px-4 py-3 rounded-2xl shadow-md flex items-center gap-3 animate-in zoom-in-95 duration-150">
              <CheckCircle2 className="w-6 h-6 shrink-0" />
              <div className="flex-1 font-bold text-sm">{successToast}</div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-2xl text-xs sm:text-sm flex items-start gap-2.5">
              <Info className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {/* Help Guide Accordion */}
          {showHelpGuide && (
            <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-2xl text-xs sm:text-sm text-amber-950 space-y-2 animate-in slide-in-from-top-2">
              <div className="font-extrabold text-amber-900 flex items-center gap-1.5 text-sm">
                <Sparkles className="w-4 h-4 text-amber-600" />
                Reglas de Interpretación de Voz (Punto Zákia)
              </div>
              <ul className="list-disc pl-5 space-y-1 text-slate-700">
                <li><strong>"X de Y"</strong>: Cantidad X y precio Y (ej. <em>"2 de 5"</em> = 2 piezas de $5 = $10, <em>"3 de 10"</em> = 3 piezas de $10).</li>
                <li><strong>Precios fijos</strong>: Lechita ($18), Leche ($35), Nata ($90), Queso ($150), Domo ($25).</li>
                <li><strong>Postre</strong>: $20.00 base (o $25.00 si dices <em>"postre de 25"</em>).</li>
                <li><strong>"un" / "una"</strong>: Se cuenta como 1 (ej. <em>"más una nata"</em> = 1 nata).</li>
                <li><strong>Ignora muletillas</strong>: Palabras como <em>"ehh", "a ver", "ponle", "y"</em> se limpian automáticamente.</li>
              </ul>
            </div>
          )}

          {/* Big Interactive Mic Action Card */}
          <div className="bg-gradient-to-b from-slate-50 to-orange-50/40 rounded-3xl p-5 border-2 border-slate-200 text-center space-y-4">
            
            {/* Pulsing Mic Button */}
            <div className="flex flex-col items-center justify-center">
              <button
                type="button"
                onClick={toggleListening}
                className={`relative w-24 h-24 sm:w-28 sm:h-28 rounded-full flex flex-col items-center justify-center shadow-xl transition-all duration-200 cursor-pointer ${
                  isListening
                    ? 'bg-red-600 text-white scale-105 ring-8 ring-red-400/40 shadow-red-500/50'
                    : 'bg-gradient-to-tr from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white shadow-orange-500/30 hover:scale-105 active:scale-95'
                }`}
              >
                {isListening ? (
                  <>
                    <Mic className="w-10 h-10 animate-bounce" />
                    <span className="text-[10px] font-black uppercase mt-1 tracking-wider">Escuchando</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-10 h-10" />
                    <span className="text-[10px] font-black uppercase mt-1 tracking-wider">Toca para Hablar</span>
                  </>
                )}

                {/* Animated wave rings when listening */}
                {isListening && (
                  <span className="absolute inset-0 rounded-full border-4 border-red-400 animate-ping opacity-60 pointer-events-none" />
                )}
              </button>

              <div className="mt-3">
                <span className={`text-xs sm:text-sm font-bold ${isListening ? 'text-red-600 animate-pulse' : 'text-slate-600'}`}>
                  {isListening ? '🎙️ Habla ahora: "2 de 5, 3 de 10 y una lechita"...' : 'Presiona el micrófono y dicta tus productos'}
                </span>
              </div>
            </div>

            {/* Live Transcript Box */}
            <div className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-inner min-h-[56px] flex items-center justify-center">
              {transcript || interimTranscript ? (
                <div className="text-slate-900 font-bold text-sm sm:text-base">
                  <span>{transcript}</span>
                  {interimTranscript && (
                    <span className="text-slate-400 italic font-medium ml-1">
                      {interimTranscript}...
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 text-xs italic">
                  Aquí aparecerá lo que digas con tu voz en tiempo real...
                </span>
              )}
            </div>

            {/* Auto-sum toggle switch */}
            <div className="flex items-center justify-center gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none bg-white px-3.5 py-1.5 rounded-full border border-slate-200 shadow-2xs">
                <input
                  type="checkbox"
                  checked={autoAddToTicket}
                  onChange={(e) => setAutoAddToTicket(e.target.checked)}
                  className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
                />
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5 text-amber-600" />
                  Sumar automáticamente al ticket al terminar frase
                </span>
              </label>
            </div>
          </div>

          {/* Quick Clickable Test Phrases (Prueba Rápida con 1 Clic) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600 px-1">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                Frases de ejemplo para probar con 1 toque:
              </span>
              <span className="text-[10px] text-slate-400 font-semibold">Toca cualquiera</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {examplePhrases.map((phrase, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setTranscript(phrase);
                    processDictation(phrase, true);
                  }}
                  className="text-xs bg-slate-100 hover:bg-orange-100 text-slate-800 hover:text-orange-950 font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 hover:border-orange-300 transition-all cursor-pointer active:scale-95"
                >
                  "{phrase}"
                </button>
              ))}
            </div>
          </div>

          {/* Manual Input Fallback */}
          <div className="space-y-1.5 pt-1">
            <span className="text-xs font-bold text-slate-600 px-1">
              O escribe la frase si tu micrófono no tiene permisos:
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setTranscript(manualInput);
                    processDictation(manualInput);
                    setManualInput('');
                  }
                }}
                placeholder="Ejemplo: 2 de 5, una lechita y un queso"
                className="flex-1 bg-white border border-slate-300 focus:border-orange-500 focus:ring-2 focus:ring-orange-200 rounded-xl px-3.5 py-2 text-sm text-slate-900 font-medium placeholder-slate-400 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (manualInput.trim()) {
                    setTranscript(manualInput);
                    processDictation(manualInput);
                    setManualInput('');
                  }
                }}
                className="bg-slate-900 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-xl text-xs sm:text-sm flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Interpretar
              </button>
            </div>
          </div>

          {/* Results Card */}
          {parsedResult && parsedResult.items.length > 0 && (
            <div className="bg-slate-900 text-white rounded-3xl p-4 sm:p-5 shadow-xl border border-slate-800 space-y-3 animate-in zoom-in-95">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-amber-400" />
                  <span className="font-extrabold text-sm text-slate-200">
                    Productos Interpretados ({parsedResult.items.length})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                    {parsedResult.source === 'gemini_ai' ? '✨ Gemini AI' : '⚡ Reglas Zákia'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowJsonView(!showJsonView)}
                    className="text-xs text-amber-300 hover:text-white flex items-center gap-1 font-bold cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {showJsonView ? 'Ocultar JSON' : 'Ver JSON'}
                  </button>
                </div>
              </div>

              {/* Items Breakdown Table */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {parsedResult.items.map((item, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs sm:text-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 h-6 rounded-lg bg-amber-500 text-slate-950 font-black font-mono flex items-center justify-center text-xs">
                        {item.cantidad}
                      </span>
                      <span className="font-bold text-white">
                        {item.concepto}
                      </span>
                      <span className="text-slate-400 text-xs">
                        @ ${item.precio_unitario.toFixed(2)}
                      </span>
                    </div>
                    <div className="font-mono font-black text-amber-300 text-sm">
                      ${item.subtotal.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Total & Action Button */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Total Calculado
                  </div>
                  <div className="text-2xl font-black font-mono text-emerald-400">
                    ${parsedResult.total.toFixed(2)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onAddItemsToTicket(parsedResult.items);
                    playCashSound();
                    setSuccessToast(`¡${parsedResult.items.length} productos sumados al ticket!`);
                    setTimeout(() => setSuccessToast(''), 3000);
                  }}
                  className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-black px-5 py-2.5 rounded-2xl shadow-lg flex items-center gap-2 text-sm transition-all cursor-pointer active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  Sumar al Ticket Ahora
                </button>
              </div>

              {/* Mandatory JSON Format Display */}
              {showJsonView && (
                <div className="mt-2 pt-2 border-t border-slate-800/80">
                  <div className="text-[10px] text-slate-400 font-mono mb-1">
                    OBJETO JSON EXACTO PRODUCIDO:
                  </div>
                  <pre className="bg-black/80 text-emerald-400 p-3 rounded-xl font-mono text-[11px] overflow-x-auto border border-emerald-900/50">
                    {JSON.stringify({
                      items: parsedResult.items,
                      total: parsedResult.total
                    }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-5 py-3 flex items-center justify-between shrink-0 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Ticket actual: <strong>{currentTicketCount} partidas</strong></span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl border border-slate-300 transition-colors cursor-pointer"
          >
            Listo / Volver al Mostrador
          </button>
        </div>

      </div>
    </div>
  );
};
