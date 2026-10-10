import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  X, 
  Sparkles, 
  Plus, 
  Code2, 
  HelpCircle, 
  Send,
  Zap,
  ShoppingBag,
  Minus,
  Maximize2,
  Trash2,
  Radio,
  CheckCircle,
  RotateCcw,
  GripHorizontal,
  Pin
} from 'lucide-react';
import { 
  parseVoiceCommandLocally, 
  resetVoiceSession,
  removeVoiceSessionItem,
  speakText,
  normalizeSpokenText,
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
  onRemoveItemFromTicket?: (concepto: string, precio_unitario: number, quantity: number) => void;
  currentTicketCount?: number;
  currentTicketTotal?: number;
  onListeningStateChange?: (isListening: boolean) => void;
  onTriggerCheckout?: (total: number) => void;
  onTriggerCardCheckout?: (total: number) => void;
  onCashReceived?: (cash: number, change: number) => void;
}

export const VoiceAssistantModal: React.FC<VoiceAssistantModalProps> = ({
  isOpen,
  onClose,
  onAddItemsToTicket,
  onRemoveItemFromTicket,
  currentTicketCount = 0,
  currentTicketTotal = 0,
  onListeningStateChange,
  onTriggerCheckout,
  onTriggerCardCheckout,
  onCashReceived
}) => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isCobroActive, setIsCobroActive] = useState<boolean>(false);
  const [activeSessionText, setActiveSessionText] = useState<string>('');
  const [interimText, setInterimText] = useState<string>('');
  const [recentTranscripts, setRecentTranscripts] = useState<Array<{ text: string; itemsCount: number; total: number; time: string }>>([]);
  const [manualInput, setManualInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [parsedResult, setParsedResult] = useState<VoiceCommandResult | null>(null);
  const [autoAddToTicket, setAutoAddToTicket] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string>('');
  const [showJsonView, setShowJsonView] = useState<boolean>(false);
  const [showHelpGuide, setShowHelpGuide] = useState<boolean>(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [sessionTotalAccumulated, setSessionTotalAccumulated] = useState<number>(0);
  const [sessionItemsAccumulated, setSessionItemsAccumulated] = useState<VoiceCommandItem[]>([]);

  const recognitionRef = useRef<any>(null);
  const shouldKeepListeningRef = useRef<boolean>(false);
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);
  const interimDebounceTimerRef = useRef<any>(null);
  const lastProcessedTextRef = useRef<string>('');
  const lastProcessedTimeRef = useRef<number>(0);
  const speechSupported = isSpeechRecognitionSupported();

  // Inform parent component about listening state
  useEffect(() => {
    onListeningStateChange?.(isListening);
  }, [isListening, onListeningStateChange]);

  // Quick test phrases for 1-touch testing
  const examplePhrases = [
    '2 bolillos',
    'más 2 tradicionales',
    'más 1 relleno',
    'recibo 200',
    'cobro con tarjeta',
    'cuenta'
  ];

  // Stop listening helper
  const stopListening = () => {
    shouldKeepListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsListening(false);
  };

  // Reset entire current voice session
  const handleResetSession = async () => {
    playBeep(450, 'sawtooth', 0.05);
    setSessionItemsAccumulated([]);
    setSessionTotalAccumulated(0);
    setParsedResult(null);
    setActiveSessionText('');
    setErrorMessage('');
    await resetVoiceSession(sessionIdRef.current);
    sessionIdRef.current = `session_${Date.now()}`;
    setSuccessToast('Sesión de voz reiniciada');
    setTimeout(() => setSuccessToast(''), 2500);
  };

  // Delete a specific row/item from voice session WITHOUT stopping microphone
  const handleRemoveSessionRow = async (indexToRemove: number) => {
    const targetItem = sessionItemsAccumulated[indexToRemove];
    if (!targetItem) return;

    playBeep(420, 'sawtooth', 0.05);

    // 1. Remove from local session state immediately so UI updates instantly
    const updatedItems = sessionItemsAccumulated.filter((_, idx) => idx !== indexToRemove);
    const newTotal = updatedItems.reduce((acc, it) => acc + (it.subtotal || 0), 0);
    setSessionItemsAccumulated(updatedItems);
    setSessionTotalAccumulated(newTotal);

    if (parsedResult) {
      setParsedResult({
        ...parsedResult,
        items: updatedItems,
        total: newTotal
      });
    }

    // 2. If ticket was synced, remove corresponding item quantity from the actual ticket
    if (onRemoveItemFromTicket) {
      onRemoveItemFromTicket(targetItem.concepto, targetItem.precio_unitario, targetItem.cantidad);
    }

    setSuccessToast(`Eliminado: ${targetItem.concepto}`);
    setTimeout(() => setSuccessToast(''), 2000);

    // 3. Sync deletion to server session state in background without interrupting microphone
    try {
      await removeVoiceSessionItem(sessionIdRef.current, indexToRemove, targetItem.concepto, targetItem.precio_unitario);
    } catch (err) {
      console.warn('Could not sync removal to server session:', err);
    }
  };

  const handleActivateCobro = () => {
    setIsCobroActive(true);
    playCashSound();
    playBeep(880, 'sine', 0.08);
    speakText("Cobro activo");
    setSuccessToast("🎙️ Cobro Activo — Dicta productos o cobro");
    setTimeout(() => setSuccessToast(''), 3000);
  };

  const handleCloseAudio = () => {
    setIsCobroActive(false);
    stopListening();
    shouldKeepListeningRef.current = false;
    onClose();
  };

  // Process text instantly using local deterministic parser (Sub-1ms reaction time)
  const processDictation = (rawText: string, shouldAutoAdd: boolean = autoAddToTicket) => {
    const cleanText = rawText.trim();
    if (!cleanText) return;

    // Prevent duplicate processing of exact same string within 800ms
    const now = Date.now();
    if (cleanText === lastProcessedTextRef.current && (now - lastProcessedTimeRef.current) < 800) {
      return;
    }
    lastProcessedTextRef.current = cleanText;
    lastProcessedTimeRef.current = now;

    const norm = normalizeSpokenText(cleanText);

    // 1. If cobro is not active: ONLY activate when they say "cobrar" or "cobro"
    // "solo activa el audio cuando diga cobrar, antes no, porque marca mal y de más cualquier palabra que digo"
    if (!isCobroActive) {
      if (/\b(cobrar|cobro|iniciar cobro|activar)\b/.test(norm)) {
        handleActivateCobro();
      }
      return; // Ignore any other word completely while not in active cobro mode!
    }

    // 2. Cobro is ACTIVE: Parse locally in <0.1ms with zero network lag!
    const result = parseVoiceCommandLocally(cleanText);
    setParsedResult(result);

    // Check if closing/finalizing keywords spoken:
    // "y cierra el audio cuando diga cobrar"
    const hasCobrarFinal = /\b(cobrar|cobro|cierre|cuenta|la cuenta|cerrar|terminar|finalizar|listo)\b/.test(norm);

    // Card payment direct to Clip terminal:
    // "que no mande ticket cuando le diga pagar con tarjeta, que mande directo a cobro a la terminal"
    if (result.isCardPayment) {
      playCashSound();
      playBeep(950, 'sine', 0.1);
      const finalTotal = (currentTicketTotal && currentTicketTotal > 0)
        ? currentTicketTotal
        : (result.total > 0 ? result.total : sessionTotalAccumulated);

      const itemsToAdd = (result.newItems && result.newItems.length > 0) ? result.newItems : result.items;
      if (itemsToAdd.length > 0 && shouldAutoAdd) {
        onAddItemsToTicket(itemsToAdd);
      }

      speakText("Cobro con tarjeta, abriendo terminal");
      setSuccessToast(`💳 Enviando cobro directo a la terminal Clip... Total: $${finalTotal.toFixed(2)}`);

      setTimeout(() => {
        onTriggerCardCheckout?.(finalTotal);
      }, 100);

      // Cierra el audio al mandar a terminal
      setTimeout(() => {
        handleCloseAudio();
      }, 700);
      return;
    }

    // Cash received & change calculation:
    // "y si dice recibo 500, o 200, etc, le diga cuanto cambio dar"
    if (result.cashReceived !== undefined) {
      const cash = result.cashReceived;
      const effectiveTotal = (currentTicketTotal && currentTicketTotal > 0)
        ? currentTicketTotal
        : (result.total > 0 ? result.total : sessionTotalAccumulated);
      const change = Math.round((cash - effectiveTotal) * 100) / 100;

      const itemsToAdd = (result.newItems && result.newItems.length > 0) ? result.newItems : result.items;
      if (itemsToAdd.length > 0 && shouldAutoAdd) {
        onAddItemsToTicket(itemsToAdd);
      }

      onCashReceived?.(cash, change);

      if (change >= 0) {
        const speechMsg = change === 0 ? "Pago exacto, sin cambio" : `El cambio es de ${change} pesos`;
        speakText(speechMsg);
        setSuccessToast(`💵 Recibido: $${cash}.00 | 🪙 Cambio: $${change}.00`);
      } else {
        const shortage = Math.abs(change);
        speakText(`Faltan ${shortage} pesos`);
        setSuccessToast(`⚠️ Recibido: $${cash}.00 | Faltan: $${shortage}.00`);
      }

      setTimeout(() => setSuccessToast(''), 5000);
      return;
    }

    // Normal items dictation (Bolillo $5, Tradicional $12, Relleno $18, etc.)
    const itemsToAdd = (result.newItems && result.newItems.length > 0) ? result.newItems : result.items;
    if (itemsToAdd.length > 0) {
      playCashSound();
      playBeep(880, 'sine', 0.06);

      const updatedAccumulated = [...sessionItemsAccumulated, ...itemsToAdd];
      const newTotal = Math.round(updatedAccumulated.reduce((a, b) => a + b.subtotal, 0) * 100) / 100;
      setSessionItemsAccumulated(updatedAccumulated);
      setSessionTotalAccumulated(newTotal);

      if (shouldAutoAdd) {
        onAddItemsToTicket(itemsToAdd);
        setSuccessToast(`+${itemsToAdd.length} añadido(s) ($${itemsToAdd.reduce((a, b) => a + b.subtotal, 0).toFixed(2)})`);
        setTimeout(() => setSuccessToast(''), 2500);
      }

      const nowD = new Date();
      const timeStr = `${nowD.getHours().toString().padStart(2, '0')}:${nowD.getMinutes().toString().padStart(2, '0')}:${nowD.getSeconds().toString().padStart(2, '0')}`;
      setRecentTranscripts(prev => [
        { text: rawText, itemsCount: itemsToAdd.length, total: result.total, time: timeStr },
        ...prev.slice(0, 9)
      ]);
    }

    // If "cobrar" or "cuenta" spoken to finalize:
    // "y cierra el audio cuando diga cobrar"
    if (hasCobrarFinal && (itemsToAdd.length === 0 || norm.includes('cobrar') || norm.includes('cuenta'))) {
      const finalTotal = (currentTicketTotal && currentTicketTotal > 0)
        ? currentTicketTotal
        : (result.total > 0 ? result.total : sessionTotalAccumulated);

      playCashSound();
      playBeep(950, 'sine', 0.1);
      setSuccessToast(`¡Cobro completado! Total: $${finalTotal.toFixed(2)}`);
      onTriggerCheckout?.(finalTotal);
      speakText("Cobro listo");

      handleCloseAudio();
    }
  };

  // Start continuous listening
  const startListening = () => {
    if (!speechSupported) {
      setErrorMessage('Reconocimiento por voz no disponible en este navegador. Escribe la frase o usa los botones rápidos.');
      return;
    }

    // Set flag so if Chrome pauses or onend fires unexpectedly, we restart automatically
    shouldKeepListeningRef.current = true;
    setErrorMessage('');

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }

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
        let newlyFinalizedChunk = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            newlyFinalizedChunk += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        const cleanFinal = newlyFinalizedChunk.trim();
        const cleanInterim = interim.trim();

        if (cleanFinal) {
          if (interimDebounceTimerRef.current) {
            clearTimeout(interimDebounceTimerRef.current);
            interimDebounceTimerRef.current = null;
          }
          setActiveSessionText(cleanFinal);
          setInterimText('');
          processDictation(cleanFinal);
        } else if (cleanInterim) {
          setInterimText(cleanInterim);
          setActiveSessionText(cleanInterim);

          const normInterim = normalizeSpokenText(cleanInterim);

          // Fast-path immediate detection for wake word "cobrar"
          if (!isCobroActive && /\b(cobrar|cobro|iniciar cobro)\b/.test(normInterim)) {
            handleActivateCobro();
            setInterimText('');
            return;
          }

          // Fast-path immediate detection for card payment
          if (isCobroActive && /\b(cobro\s+con\s+tarjeta|pago\s+con\s+tarjeta|pagar\s+con\s+tarjeta|terminal)\b/.test(normInterim)) {
            if (interimDebounceTimerRef.current) clearTimeout(interimDebounceTimerRef.current);
            processDictation(cleanInterim);
            setInterimText('');
            return;
          }

          // Ultra-fast streaming debounce (180ms) for real-time dictation reaction!
          if (isCobroActive) {
            if (interimDebounceTimerRef.current) clearTimeout(interimDebounceTimerRef.current);
            interimDebounceTimerRef.current = setTimeout(() => {
              if (cleanInterim && shouldKeepListeningRef.current) {
                processDictation(cleanInterim);
                setInterimText('');
              }
            }, 180);
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition event error:', event.error);
        if (event.error === 'not-allowed') {
          shouldKeepListeningRef.current = false;
          setErrorMessage('Permiso de micrófono bloqueado. Haz clic en el candado del navegador y permite el micrófono.');
          setIsListening(false);
        } else if (event.error === 'no-speech') {
          // Normal pause in talking, don't stop the persistent session
        } else {
          console.warn('Temporary voice error:', event.error);
        }
      };

      recognition.onend = () => {
        // CONTINUOUS LISTENING: If the user didn't explicitly pause/close, restart automatically!
        if (shouldKeepListeningRef.current && isOpen) {
          try {
            recognition.start();
          } catch {
            setTimeout(() => {
              if (shouldKeepListeningRef.current && isOpen) {
                try { recognition.start(); } catch {}
              }
            }, 250);
          }
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
    } catch (err: any) {
      console.error(err);
      setErrorMessage('No se pudo iniciar el micrófono. Revisa los permisos.');
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

  // Auto-start listening as soon as modal opens, and stop on close
  useEffect(() => {
    if (isOpen) {
      shouldKeepListeningRef.current = true;
      const timer = setTimeout(() => {
        startListening();
      }, 150);
      return () => clearTimeout(timer);
    } else {
      stopListening();
    }
  }, [isOpen]);

  // Draggable position state (null means default position adjacent to ticket)
  const [customPosition, setCustomPosition] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ isDragging: boolean; startX: number; startY: number; initialLeft: number; initialTop: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    if (!containerRef.current || e.touches.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    dragRef.current = {
      isDragging: true,
      startX: touch.clientX,
      startY: touch.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current?.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(8, Math.min(window.innerWidth - 320, dragRef.current.initialLeft + dx));
      const newY = Math.max(8, Math.min(window.innerHeight - 120, dragRef.current.initialTop + dy));
      setCustomPosition({ x: newX, y: newY });
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragRef.current?.isDragging || e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = touch.clientX - dragRef.current.startX;
      const dy = touch.clientY - dragRef.current.startY;
      const newX = Math.max(8, Math.min(window.innerWidth - 320, dragRef.current.initialLeft + dx));
      const newY = Math.max(8, Math.min(window.innerHeight - 120, dragRef.current.initialTop + dy));
      setCustomPosition({ x: newX, y: newY });
    };

    const handleEndDrag = () => {
      if (dragRef.current) {
        dragRef.current.isDragging = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEndDrag);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleEndDrag);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEndDrag);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEndDrag);
    };
  }, []);

  // Keyboard shortcut listener when widget is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Render MINIMIZED FLOATING PILL (Docked beside ticket on desktop or bottom-left on mobile)
  if (isMinimized) {
    return (
      <div 
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`z-50 bg-slate-900/95 backdrop-blur-md text-white px-2.5 py-1.5 rounded-2xl shadow-2xl border-2 border-emerald-500 flex items-center gap-2 animate-in slide-in-from-top-2 duration-200 cursor-move select-none ${
          customPosition
            ? 'fixed'
            : 'fixed bottom-2 left-2 sm:bottom-3 sm:left-3 lg:bottom-auto lg:left-auto lg:top-20 lg:right-[calc(41.66%+1rem)]'
        }`}
        style={customPosition ? { left: `${customPosition.x}px`, top: `${customPosition.y}px`, right: 'auto', bottom: 'auto' } : undefined}
      >
        <GripHorizontal className="w-3 h-3 text-slate-500 shrink-0" />
        <button
          type="button"
          onClick={toggleListening}
          className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
            isListening ? 'bg-red-500 text-white animate-pulse ring-2 ring-red-400' : 'bg-emerald-700 text-white'
          }`}
          title={isListening ? 'Micrófono encendido continuo' : 'Encender micrófono'}
        >
          {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <div className="flex flex-col">
          <span className="text-[11px] font-black text-emerald-300 leading-tight">
            Voz (Junto al Pedido)
          </span>
          <span className="text-[9px] text-slate-400 leading-none">
            {isListening ? 'Escuchando continuo...' : 'Pausado'}
          </span>
        </div>

        {sessionTotalAccumulated > 0 && (
          <span className="bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-emerald-500/30">
            ${sessionTotalAccumulated.toFixed(2)}
          </span>
        )}

        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="p-1 hover:bg-white/10 rounded-lg text-slate-300 hover:text-white transition-colors cursor-pointer ml-1"
          title="Ver recuadro completo"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Cerrar asistente"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // Render COMPACT FLOATING DOCK (Ubicado exactamente en el recuadro verde a un lado de la previsualización del pedido sin taparla)
  return (
    <div 
      ref={containerRef}
      className={`z-50 w-[315px] sm:w-[345px] max-w-[calc(100vw-1rem)] bg-white/98 backdrop-blur-md rounded-2xl shadow-2xl border-2 border-emerald-500 ring-2 ring-emerald-500/20 overflow-hidden flex flex-col max-h-[82vh] animate-in slide-in-from-top-2 duration-200 ${
        customPosition
          ? 'fixed'
          : 'fixed bottom-2 left-2 sm:bottom-3 sm:left-3 lg:bottom-auto lg:left-auto lg:top-20 lg:right-[calc(41.66%+1rem)] xl:right-[calc(41.66%+1.5rem)]'
      }`}
      style={{
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.45), 0 0 16px rgba(16, 185, 129, 0.35)',
        ...(customPosition ? { left: `${customPosition.x}px`, top: `${customPosition.y}px`, right: 'auto', bottom: 'auto' } : {})
      }}
    >
      
      {/* Header Compacto del Recuadro Verde (Permite arrastrar con cursor-move) */}
      <div 
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="bg-gradient-to-r from-emerald-950 via-slate-900 to-emerald-950 text-white px-3 py-2 flex items-center justify-between shrink-0 border-b border-emerald-800/50 cursor-move select-none"
        title="Arrastra para mover el recuadro libremente por la pantalla"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
          <div className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all shadow-inner ${
            isListening ? 'bg-red-500 text-white animate-pulse ring-2 ring-red-400' : 'bg-emerald-700 text-white'
          }`}>
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <h4 className="font-black text-xs text-emerald-200">
                Voz Punto Zákia
              </h4>
              <span className="bg-emerald-500/25 text-emerald-300 text-[8px] font-black uppercase px-1 py-0.2 rounded border border-emerald-400/40">
                Recuadro de Voz
              </span>
            </div>
            <p className="text-[10px] text-slate-300 font-medium mt-0.5 leading-none">
              {isListening ? 'Micrófono continuo activo' : 'Micrófono pausado'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {customPosition && (
            <button
              type="button"
              onClick={() => setCustomPosition(null)}
              className="p-1 text-emerald-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              title="Restablecer posición (Reanclar al lado del pedido)"
            >
              <Pin className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleResetSession}
            className="p-1 text-slate-300 hover:text-amber-300 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Reiniciar sesión acumulativa de voz"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowHelpGuide(!showHelpGuide)}
            className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Palabras clave y ayuda"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Minimizar (dejar solo botón flotante)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
            title="Cerrar asistente"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Body (Super Compacto y Despejado) */}
      <div className="p-2.5 space-y-2 overflow-y-auto max-h-[calc(82vh-55px)] text-xs">

        {/* Indicador de Estado y Modo Cobro */}
        <div className={`p-2 rounded-xl border transition-all ${
          isCobroActive
            ? 'bg-emerald-50/95 border-emerald-400 shadow-sm ring-1 ring-emerald-400/40' 
            : 'bg-amber-50/90 border-amber-300 shadow-2xs'
        }`}>
          <div className="flex items-center justify-between gap-1.5">
            
            <div className="flex items-center gap-2">
              {isCobroActive ? (
                <>
                  <div className="relative flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping absolute"></span>
                    <span className="w-2 rounded-full bg-emerald-600 relative h-2"></span>
                  </div>
                  <div>
                    <span className="text-[11px] font-black text-emerald-800 block leading-none">
                      🎙️ COBRO ACTIVO — DICTA LIBREMENTE
                    </span>
                    <span className="text-[9px] text-emerald-700 font-medium">
                      Di "COBRAR" para finalizar la cuenta y cerrar el audio
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative flex items-center justify-center">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse absolute"></span>
                    <span className="w-2 rounded-full bg-amber-500 relative h-2"></span>
                  </div>
                  <div>
                    <span className="text-[11px] font-black text-amber-900 block leading-none">
                      💤 EN ESPERA — Di "COBRAR" para activar
                    </span>
                    <span className="text-[9px] text-amber-700 font-medium">
                      Audio inactivo para no marcar palabras accidentales
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Visualizer Sound Wave */}
            <div className="flex items-end gap-1 h-5 px-1.5 py-0.5 bg-slate-950 rounded-md">
              {isListening ? (
                isCobroActive ? (
                  <>
                    <span className="w-1 bg-emerald-400 rounded-full animate-voice-wave-1"></span>
                    <span className="w-1 bg-teal-400 rounded-full animate-voice-wave-2"></span>
                    <span className="w-1 bg-emerald-300 rounded-full animate-voice-wave-3"></span>
                    <span className="w-1 bg-green-400 rounded-full animate-voice-wave-4"></span>
                    <span className="w-1 bg-emerald-500 rounded-full animate-voice-wave-5"></span>
                  </>
                ) : (
                  <>
                    <span className="w-1 bg-amber-400 rounded-full animate-voice-wave-2"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-voice-wave-3"></span>
                    <span className="w-1 bg-amber-400 rounded-full animate-voice-wave-4"></span>
                  </>
                )
              ) : (
                <>
                  <span className="w-1 bg-slate-700 rounded-full h-1"></span>
                  <span className="w-1 bg-slate-700 rounded-full h-1.5"></span>
                  <span className="w-1 bg-slate-700 rounded-full h-1"></span>
                </>
              )}
            </div>

            {/* Cobro / Audio Action Button */}
            {isCobroActive ? (
              <button
                type="button"
                onClick={handleCloseAudio}
                className="px-2 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center gap-1 shadow-2xs bg-rose-600 hover:bg-rose-700 text-white shrink-0"
                title="Cerrar audio y finalizar"
              >
                <MicOff className="w-3 h-3" />
                <span>Cerrar Audio</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleActivateCobro}
                className="px-2.5 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer flex items-center gap-1 shadow-2xs bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                title="Activar cobro por voz"
              >
                <Mic className="w-3 h-3" />
                <span>Activar Cobro</span>
              </button>
            )}
          </div>

          {/* Feedback de lo que se escuchó */}
          <div className="mt-1.5 bg-white rounded-lg p-1.5 border border-slate-200 min-h-[30px] flex items-center justify-between">
            {activeSessionText || interimText ? (
              <div className="text-[11px] leading-tight flex-1">
                <span className="font-bold text-slate-800">{activeSessionText}</span>
                {interimText && (
                  <span className="text-amber-600 italic font-medium ml-1 animate-pulse">
                    {interimText}...
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-slate-400 italic">
                {isListening ? 'Ej: "2 de 5 más 3 de 10 más un queso", luego "cuenta"...' : 'Micrófono apagado'}
              </span>
            )}

            {isProcessing && (
              <span className="text-[9px] bg-amber-100 text-amber-800 px-1 py-0.2 rounded font-bold shrink-0 ml-1">
                Sumando
              </span>
            )}
          </div>
        </div>

        {/* Total Acumulado de la Sesión en Vivo */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl p-2 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider block text-amber-100 leading-none">
              Total Acumulado Sesión:
            </span>
            <span className="text-[10px] text-amber-100/90 font-medium">
              {sessionItemsAccumulated.length} partidas en memoria
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-black text-xl leading-none text-white drop-shadow-xs">
              ${sessionTotalAccumulated.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => {
                if (sessionTotalAccumulated > 0 && onTriggerCheckout) {
                  playCashSound();
                  onTriggerCheckout(sessionTotalAccumulated);
                  setSuccessToast(`¡Cuenta enviada! Total: $${sessionTotalAccumulated.toFixed(2)}`);
                  setTimeout(() => setSuccessToast(''), 3000);
                }
              }}
              className="bg-white/20 hover:bg-white/30 text-white font-black text-[10px] px-2 py-1 rounded-lg transition-colors cursor-pointer"
              title="Enviar cuenta directamente al mostrador"
            >
              Cuenta ➔
            </button>
          </div>
        </div>

        {/* Guía de Palabras Clave */}
        {showHelpGuide && (
          <div className="bg-amber-50/95 border border-amber-300 rounded-xl p-2 space-y-1 text-[11px] text-amber-950 animate-in fade-in">
            <div className="font-black flex items-center gap-1 text-amber-900">
              <Radio className="w-3.5 h-3.5 text-amber-600" />
              <span>Palabras Clave Admitidas:</span>
            </div>
            <ul className="list-disc pl-4 space-y-0.5 text-[10px]">
              <li><strong>"Bolillo" ($5)</strong>: ej. <em>"2 bolillos"</em>, <em>"un bolillo"</em> ($5 pesos c/u).</li>
              <li><strong>"Tradicional" ($12)</strong>: ej. <em>"3 tradicionales"</em> ($12 pesos c/u).</li>
              <li><strong>"Relleno" ($18)</strong>: ej. <em>"2 rellenos"</em> ($18 pesos c/u).</li>
              <li><strong>"X de Y"</strong>: ej. <em>"2 de 5"</em>, <em>"3 de 10"</em>, <em>"5 de 18"</em>.</li>
              <li><strong>"MÁS"</strong>: Suma a la venta acumulativa actual (ej. <em>"más 2 bolillos más un queso"</em>).</li>
              <li><strong>"Cobro con tarjeta" / "Pago con tarjeta"</strong>: Envía el ticket automáticamente pagado con tarjeta.</li>
              <li><strong>"Recibo 500" / "Recibo 200"</strong>: Dice en voz alta cuánto cambio dar y lo calcula en pantalla.</li>
              <li><strong>"CUENTA"</strong>: Envía el total final acumulado al mostrador.</li>
              <li><strong>"CERRAR" / "TERMINAR"</strong>: Palabra de cierre que apaga el micrófono.</li>
            </ul>
          </div>
        )}

        {/* Alertas y Notificaciones */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-300 text-red-700 px-2 py-1 rounded-lg text-[10px] leading-tight">
            {errorMessage}
          </div>
        )}

        {successToast && (
          <div className="bg-emerald-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold text-center animate-in zoom-in-95 shadow-sm">
            {successToast}
          </div>
        )}

        {/* Lista de Partidas Acumuladas en la Sesión de Voz con opción de Borrar Fila sin apagar micro */}
        {sessionItemsAccumulated.length > 0 && (
          <div className="bg-slate-900 text-white rounded-xl p-2 space-y-1 border border-slate-800 shadow-inner">
            <div className="flex items-center justify-between pb-1 border-b border-slate-800 text-[11px]">
              <span className="font-bold text-amber-300 flex items-center gap-1">
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Partidas ({sessionItemsAccumulated.length}):</span>
              </span>
              <span className="font-mono font-black text-emerald-400">
                ${sessionTotalAccumulated.toFixed(2)}
              </span>
            </div>

            <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
              {sessionItemsAccumulated.map((item, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between bg-slate-800/90 hover:bg-slate-800 px-2 py-1 rounded-lg text-[10px] group border border-slate-700/60 transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="bg-amber-400 text-slate-950 font-black px-1.5 py-0.2 rounded font-mono text-[9px] shrink-0">
                      {item.cantidad}×
                    </span>
                    <span className="text-white font-medium truncate">
                      {item.concepto}
                    </span>
                    <span className="text-slate-400 font-mono text-[9px] shrink-0">
                      (@${item.precio_unitario})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-1">
                    <span className="font-mono font-bold text-amber-300 text-[11px]">
                      ${item.subtotal.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSessionRow(idx)}
                      className="text-slate-400 hover:text-rose-400 hover:bg-rose-950/60 p-1 rounded transition-colors cursor-pointer"
                      title="Borrar esta fila de voz (sin detener el micrófono)"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <button
                type="button"
                onClick={() => setShowJsonView(!showJsonView)}
                className="text-[9px] text-slate-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
              >
                <Code2 className="w-2.5 h-2.5" />
                {showJsonView ? 'Ocultar JSON' : 'Ver JSON'}
              </button>

              <span className="text-[9px] text-slate-400 italic">
                Toca <Trash2 className="w-2.5 h-2.5 inline text-rose-400" /> para borrar error sin parar micro
              </span>
            </div>

            {showJsonView && (
              <pre className="mt-1 bg-black text-emerald-400 p-1.5 rounded font-mono text-[9px] overflow-x-auto max-h-24 border border-slate-800">
                {JSON.stringify({
                  items: sessionItemsAccumulated,
                  total: sessionTotalAccumulated
                }, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Historial de Frases Dictadas en esta sesión */}
        {recentTranscripts.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-1">
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold">
              <span>Historial de dictados:</span>
              <button
                type="button"
                onClick={() => setRecentTranscripts([])}
                className="text-slate-400 hover:text-red-600 p-0.5"
                title="Limpiar historial"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {recentTranscripts.map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] bg-white p-1 rounded border border-slate-100">
                  <span className="truncate max-w-[170px] text-slate-800">"{entry.text}"</span>
                  <span className="font-mono font-bold text-emerald-600">${entry.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Botones de Prueba Rápida con 1 Clic */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[9px] font-bold text-slate-500">
            <span className="flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-amber-600" />
              Prueba con 1 clic:
            </span>
            <span>Toca para simular</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {examplePhrases.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setActiveSessionText(phrase);
                  processDictation(phrase, true);
                }}
                className="text-[9px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-950 font-semibold px-1.5 py-0.5 rounded border border-slate-200 transition-colors cursor-pointer active:scale-95"
              >
                "{phrase}"
              </button>
            ))}
          </div>
        </div>

        {/* Entrada manual por teclado */}
        <div className="flex gap-1">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualInput.trim()) {
                setActiveSessionText(manualInput);
                processDictation(manualInput);
                setManualInput('');
              }
            }}
            placeholder="O escribe: 2 de 5 más 3 de 10..."
            className="flex-1 bg-white border border-slate-300 focus:border-amber-500 rounded-lg px-2 py-0.5 text-[11px] text-slate-900 outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (manualInput.trim()) {
                setActiveSessionText(manualInput);
                processDictation(manualInput);
                setManualInput('');
              }
            }}
            className="bg-slate-900 hover:bg-amber-600 text-white font-bold px-2 py-0.5 rounded-lg text-[10px] flex items-center gap-1 cursor-pointer"
          >
            <Send className="w-2.5 h-2.5" />
          </button>
        </div>

        {/* Checkbox auto-sumar */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-600">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAddToTicket}
              onChange={(e) => setAutoAddToTicket(e.target.checked)}
              className="w-3 h-3 text-amber-600 rounded focus:ring-amber-500"
            />
            <span className="font-bold flex items-center gap-1 text-slate-700 text-[10px]">
              <Zap className="w-2.5 h-2.5 text-amber-600" />
              Sumar de inmediato al ticket
            </span>
          </label>

          <span className="text-[9px] text-slate-400 font-mono">
            {currentTicketCount} en ticket
          </span>
        </div>

      </div>

    </div>
  );
};
