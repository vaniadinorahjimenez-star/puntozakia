import React, { useState, useMemo } from 'react';
import { 
  BreadProduct, 
  Settings, 
  Customer, 
  DriverCustomer, 
  SaleTicket, 
  BakeryOrder, 
  TicketItem 
} from '../types';
import { 
  ShoppingBag, 
  Receipt, 
  BarChart3, 
  ClipboardList, 
  CreditCard, 
  Banknote, 
  Printer, 
  Sun, 
  Moon, 
  Clock, 
  ChevronRight, 
  Sparkles, 
  Check, 
  CheckCircle2, 
  Trash2, 
  Plus, 
  Minus, 
  RefreshCw, 
  ArrowUpRight,
  TrendingUp,
  Eye,
  X,
  Flame,
  User,
  Phone,
  Mic
} from 'lucide-react';
import { 
  getTodayString, 
  getNextTicketFolio, 
  formatLocalDate, 
  resolveTicketShift, 
  getNowTimeString 
} from '../utils/storage';
import { playCashSound, playBeep } from '../utils/audio';
import { ThermalTicket } from './ThermalTicket';
import { CashShiftCutModal } from './ShiftCut/CashShiftCutModal';
import { VoiceAssistantModal } from './VoiceAssistant/VoiceAssistantModal';
import { VoiceCommandItem } from '../utils/voiceAssistant';

export type MobileTab = 'pos' | 'summary' | 'tickets' | 'orders';

interface MobileDashboardProps {
  products: BreadProduct[];
  settings: Settings;
  customers: Customer[];
  driverCustomers?: DriverCustomer[];
  tickets: SaleTicket[];
  orders: BakeryOrder[];
  onSaveTicket: (ticket: SaleTicket) => void;
  onUpdateTicket?: (ticket: SaleTicket) => void;
  onRegisterCustomer?: (name: string, phone: string) => Customer;
  onSaveOrder?: (order: BakeryOrder) => void;
  onUpdateOrder?: (order: BakeryOrder) => void;
  onSelectTab?: (tab: string) => void;
}

export const MobileDashboard: React.FC<MobileDashboardProps> = ({
  products,
  settings,
  customers,
  driverCustomers = [],
  tickets = [],
  orders = [],
  onSaveTicket,
  onUpdateTicket,
  onRegisterCustomer,
  onSaveOrder,
  onUpdateOrder,
  onSelectTab
}) => {
  const todayStr = getTodayString();
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('pos');

  // Active shift state (defaults to Turno 1 before 15:00, Turno 2 >= 15:00)
  const [activeShift, setActiveShift] = useState<'turno1' | 'turno2'>(() => {
    const saved = localStorage.getItem('santafe_active_shift');
    if (saved === 'turno1' || saved === 'turno2') return saved;
    const hour = new Date().getHours();
    return hour < 15 ? 'turno1' : 'turno2';
  });

  const handleToggleShift = (newShift: 'turno1' | 'turno2') => {
    playBeep(newShift === 'turno1' ? 600 : 750, 'sine', 0.05);
    setActiveShift(newShift);
    localStorage.setItem('santafe_active_shift', newShift);
  };

  // POS State
  const [multiplier, setMultiplier] = useState<number>(1);
  const [ticketItems, setTicketItems] = useState<TicketItem[]>([]);
  const [ticketToView, setTicketToView] = useState<SaleTicket | null>(null);
  const [showShiftCutModal, setShowShiftCutModal] = useState<boolean>(false);
  const [showVoiceAssistantModal, setShowVoiceAssistantModal] = useState<boolean>(false);
  const [isMobileVoiceListening, setIsMobileVoiceListening] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string>('');

  const handleAddVoiceItems = (voiceItems: VoiceCommandItem[]) => {
    if (!voiceItems || voiceItems.length === 0) return;
    playCashSound();
    setTicketItems(prev => {
      let updated = [...prev];
      for (const vItem of voiceItems) {
        const existingIdx = updated.findIndex(it => it.price === vItem.precio_unitario && it.name === vItem.concepto);
        if (existingIdx >= 0) {
          const cur = updated[existingIdx];
          const newQty = cur.quantity + vItem.cantidad;
          updated[existingIdx] = {
            ...cur,
            quantity: newQty,
            total: newQty * cur.price
          };
        } else {
          updated.push({
            id: `voice-mob-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            name: vItem.concepto,
            price: vItem.precio_unitario,
            quantity: vItem.cantidad,
            total: vItem.subtotal
          });
        }
      }
      return updated;
    });
    setSuccessToast(`¡${voiceItems.length} productos sumados con tu voz!`);
    setTimeout(() => setSuccessToast(''), 3000);
  };

  // Cart Totals
  const totalAmount = useMemo(() => {
    return ticketItems.reduce((acc, it) => acc + it.total, 0);
  }, [ticketItems]);

  const totalPieces = useMemo(() => {
    return ticketItems.reduce((acc, it) => acc + it.quantity, 0);
  }, [ticketItems]);

  // Today's tickets & summary
  const todayTickets = useMemo(() => {
    return tickets.filter(t => {
      if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date.trim())) {
        return t.date.trim() === todayStr;
      }
      if (t.timestamp) {
        try {
          const d = new Date(t.timestamp);
          if (!isNaN(d.getTime())) return formatLocalDate(d) === todayStr;
        } catch {}
      }
      return false;
    });
  }, [tickets, todayStr]);

  const todayTotal = useMemo(() => todayTickets.reduce((acc, t) => acc + t.total, 0), [todayTickets]);
  const todayCash = useMemo(() => todayTickets.filter(t => t.paymentMethod === 'efectivo').reduce((acc, t) => acc + t.total, 0), [todayTickets]);
  const todayCard = useMemo(() => todayTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((acc, t) => acc + t.total, 0), [todayTickets]);
  const todayPieces = useMemo(() => todayTickets.reduce((acc, t) => acc + t.items.reduce((sum, it) => sum + it.quantity, 0), 0), [todayTickets]);

  // Turnos today
  const turno1Tickets = useMemo(() => todayTickets.filter(t => resolveTicketShift(t) === 'turno1'), [todayTickets]);
  const turno1Total = useMemo(() => turno1Tickets.reduce((acc, t) => acc + t.total, 0), [turno1Tickets]);

  const turno2Tickets = useMemo(() => todayTickets.filter(t => resolveTicketShift(t) === 'turno2'), [todayTickets]);
  const turno2Total = useMemo(() => turno2Tickets.reduce((acc, t) => acc + t.total, 0), [turno2Tickets]);

  // Today's orders
  const todayOrders = useMemo(() => {
    return orders.filter(o => o.deliveryDate === todayStr && o.deliveryType !== 'domicilio');
  }, [orders, todayStr]);

  // Add Item to Quick Ticket
  const handleAddPrice = (price: number, name?: string) => {
    playBeep(520 + price * 10, 'sine', 0.04);
    const itemName = name || `Pan $${price}`;
    
    setTicketItems(prev => {
      const existingIdx = prev.findIndex(i => i.price === price && i.name === itemName);
      if (existingIdx !== -1) {
        const copy = [...prev];
        const item = copy[existingIdx];
        const newQty = item.quantity + multiplier;
        copy[existingIdx] = {
          ...item,
          quantity: newQty,
          total: newQty * price
        };
        return copy;
      }
      return [
        ...prev,
        {
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: itemName,
          price,
          quantity: multiplier,
          total: price * multiplier
        }
      ];
    });

    // Reset multiplier to 1 after adding
    setMultiplier(1);
  };

  const handleClearCart = () => {
    playBeep(350, 'sawtooth', 0.08);
    setTicketItems([]);
    setMultiplier(1);
  };

  // Checkout Actions
  const handleCheckout = (paymentMethod: 'efectivo' | 'tarjeta', showReceipt = false) => {
    if (ticketItems.length === 0) return;
    playCashSound();

    const nextFolio = getNextTicketFolio(tickets);
    const nowTime = getNowTimeString();

    const newTicket: SaleTicket = {
      id: `ticket-${Date.now()}`,
      folio: nextFolio,
      timestamp: new Date().toISOString(),
      date: todayStr,
      time: nowTime,
      items: [...ticketItems],
      subtotal: totalAmount,
      discount: 0,
      total: totalAmount,
      paymentMethod,
      amountPaid: totalAmount,
      change: 0,
      customerName: 'Público en Mostrador',
      pointsEarned: Math.floor(totalAmount / (settings.loyaltyPointsPerPesos || 20)),
      pointsRedeemed: 0,
      cashier: activeShift === 'turno1' ? 'Cajero Turno 1' : 'Cajero Turno 2',
      shift: activeShift
    };

    onSaveTicket(newTicket);
    setTicketItems([]);
    setMultiplier(1);

    if (showReceipt) {
      setTicketToView(newTicket);
    } else {
      setSuccessToast(`¡Venta #${nextFolio} cobrada ($${totalAmount}.00)!`);
      setTimeout(() => setSuccessToast(''), 3000);
    }
  };

  // Quick Preset Prices
  const quickPrices = settings.quickPrices || [5, 6.5, 12, 15, 18, 20, 25, 30, 35];

  // Common bakery catalog buttons
  const quickPanItems = [
    { name: 'Bolillo / Telera', price: 5, icon: '🥖' },
    { name: 'Concha Vainilla', price: 12, icon: '🥐' },
    { name: 'Dona Azúcar', price: 15, icon: '🍩' },
    { name: 'Baguette Rústica', price: 20, icon: '🥖' },
    { name: 'Panqué Nuez', price: 25, icon: '🍞' },
    { name: 'Arroz con Leche', price: 25, icon: '🍮' }
  ];

  return (
    <div className="w-full max-w-lg mx-auto pb-24 text-slate-800 space-y-3 px-1 sm:px-2 select-none">
      
      {/* 1. COMPACT MOBILE TOP BAR */}
      <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-200/80 flex items-center justify-between gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-base shadow-xs shrink-0">
            🥖
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-sm text-slate-900 leading-tight">
                Santa Fé Móvil
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium block">
              Sucursal Zakia • En Vivo
            </span>
          </div>
        </div>

        {/* Shift Switcher (Turno 1 / Turno 2) */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => handleToggleShift('turno1')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              activeShift === 'turno1' 
                ? 'bg-amber-500 text-slate-950 shadow-xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sun className="w-3 h-3" />
            <span>T1</span>
          </button>
          <button
            type="button"
            onClick={() => handleToggleShift('turno2')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              activeShift === 'turno2' 
                ? 'bg-indigo-600 text-white shadow-xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Moon className="w-3 h-3" />
            <span>T2</span>
          </button>
        </div>
      </div>

      {/* SUCCESS TOAST */}
      {successToast && (
        <div className="bg-emerald-600 text-white p-3 rounded-2xl shadow-md flex items-center justify-between gap-2 text-xs font-bold animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast('')} className="p-1 text-emerald-100 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. SUB-NAV TABS FOR MOBILE */}
      <div className="grid grid-cols-4 gap-1 bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
        <button
          type="button"
          onClick={() => setActiveMobileTab('pos')}
          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeMobileTab === 'pos'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShoppingBag className={`w-3.5 h-3.5 ${activeMobileTab === 'pos' ? 'text-amber-600' : ''}`} />
          <span className="text-[11px]">Cobro</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('summary')}
          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeMobileTab === 'summary'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BarChart3 className={`w-3.5 h-3.5 ${activeMobileTab === 'summary' ? 'text-amber-600' : ''}`} />
          <span className="text-[11px]">Caja Hoy</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('tickets')}
          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeMobileTab === 'tickets'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Receipt className={`w-3.5 h-3.5 ${activeMobileTab === 'tickets' ? 'text-amber-600' : ''}`} />
          <span className="text-[11px]">Tickets ({todayTickets.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveMobileTab('orders')}
          className={`py-2 px-1 rounded-xl text-xs font-bold transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
            activeMobileTab === 'orders'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardList className={`w-3.5 h-3.5 ${activeMobileTab === 'orders' ? 'text-purple-600' : ''}`} />
          <span className="text-[11px]">Encargos ({todayOrders.length})</span>
        </button>
      </div>

      {/* =========================================================================
          TAB 1: PUNTO DE VENTA RÁPIDO (COBRO TÁCTIL)
          ========================================================================= */}
      {activeMobileTab === 'pos' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          
          {/* ASISTENTE DE VOZ PUNTO ZÁKIA */}
          <button
            type="button"
            onClick={() => setShowVoiceAssistantModal(prev => !prev)}
            className={`w-full p-3 rounded-2xl shadow-md border transition-all active:scale-98 cursor-pointer group flex items-center justify-between ${
              isMobileVoiceListening
                ? 'bg-gradient-to-r from-red-600 via-rose-600 to-amber-600 text-white border-red-300 ring-2 ring-red-400 animate-pulse'
                : 'bg-gradient-to-r from-slate-900 via-amber-950 to-orange-950 text-white border-amber-500/30'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black shadow-sm shrink-0 transition-transform ${
                isMobileVoiceListening
                  ? 'bg-white text-red-600'
                  : 'bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 group-hover:scale-105'
              }`}>
                <Mic className="w-5 h-5 animate-pulse" />
              </div>
              <div className="text-left">
                <div className="text-xs font-black flex items-center gap-1.5">
                  <span className={isMobileVoiceListening ? 'text-white' : 'text-amber-300'}>
                    {isMobileVoiceListening ? '¡Escuchando ahora!' : 'Dictar con Voz'}
                  </span>
                  <span className="text-[9px] bg-black/20 text-amber-200 px-1.5 py-0.2 rounded-full border border-white/20">Punto Zákia</span>
                </div>
                <div className="text-[10px] text-slate-200 font-medium">
                  {isMobileVoiceListening ? 'Habla ahora: "2 de 5, 3 de 10 y un queso"' : 'Di "2 de 5", "3 de 10", "una lechita", etc.'}
                </div>
              </div>
            </div>

            {/* Sound Wave Equalizer on Mobile Button */}
            {isMobileVoiceListening ? (
              <div className="flex items-end gap-1 h-5 px-2 py-0.5 bg-black/30 rounded-xl">
                <span className="w-1 bg-white rounded-full animate-voice-wave-1"></span>
                <span className="w-1 bg-white rounded-full animate-voice-wave-2"></span>
                <span className="w-1 bg-white rounded-full animate-voice-wave-3"></span>
                <span className="w-1 bg-white rounded-full animate-voice-wave-4"></span>
              </div>
            ) : (
              <div className="bg-white/10 group-hover:bg-white/20 text-amber-200 px-2.5 py-1 rounded-xl text-[11px] font-bold border border-white/10 shrink-0">
                Hablar 🎙️
              </div>
            )}
          </button>

          {/* STEP 1: MULTIPLIER BAR (1, 2, 3, 4, 5, 6, 8, 10...) */}
          <div className="bg-white rounded-2xl p-2.5 shadow-xs border border-slate-200/80">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Multiplicador de Piezas:
              </span>
              <span className="text-xs font-black text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                {multiplier} {multiplier === 1 ? 'pieza' : 'piezas'}
              </span>
            </div>

            <div className="grid grid-cols-8 gap-1">
              {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    playBeep(450 + n * 25, 'sine', 0.03);
                    setMultiplier(n);
                  }}
                  className={`h-10 rounded-xl font-black font-mono text-sm transition-all cursor-pointer flex items-center justify-center active:scale-95 ${
                    multiplier === n
                      ? 'bg-slate-900 text-white shadow-xs ring-2 ring-slate-900/30'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* STEP 2: PRESET PRICES GRID */}
          <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Precios Rápidos Mostrador:
              </span>
              <span className="text-[10px] text-slate-400 font-medium">Toque para sumar</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {quickPrices.map(price => (
                <button
                  key={price}
                  type="button"
                  onClick={() => handleAddPrice(price)}
                  className="h-14 bg-slate-50 hover:bg-amber-50 active:scale-95 rounded-2xl border border-slate-200 hover:border-amber-400 p-2 flex flex-col items-center justify-center transition-all cursor-pointer shadow-2xs group"
                >
                  <span className="text-lg font-black font-mono text-slate-900 group-hover:text-amber-900 leading-none tabular-nums">
                    ${price}
                  </span>
                  <span className="text-[9px] text-slate-400 group-hover:text-amber-700 font-semibold mt-0.5">
                    +{multiplier} pz
                  </span>
                </button>
              ))}
            </div>

            {/* Common Bread Short-cuts */}
            <div className="pt-2 border-t border-slate-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5 px-1">
                Especiales del día:
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {quickPanItems.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleAddPrice(item.price, item.name)}
                    className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded-xl border border-slate-200 text-left transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
                  >
                    <span className="text-base select-none shrink-0">{item.icon}</span>
                    <div className="truncate min-w-0">
                      <div className="text-[11px] font-bold text-slate-800 truncate leading-tight">{item.name}</div>
                      <div className="text-[10px] font-mono text-emerald-700 font-black">${item.price}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* STEP 3: CURRENT TICKET CART (If has items) */}
          {ticketItems.length > 0 && (
            <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-200/80 space-y-2 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-700">
                  Canasta Activa ({totalPieces} piezas)
                </span>
                <button
                  type="button"
                  onClick={handleClearCart}
                  className="text-rose-600 hover:text-rose-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Vaciar</span>
                </button>
              </div>

              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 text-xs">
                {ticketItems.map(item => (
                  <div key={item.id} className="py-1.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-900">{item.name}</span>
                      <span className="text-slate-400 text-[10px] ml-1">({item.quantity} x ${item.price})</span>
                    </div>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      ${item.total}.00
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase">Total a Cobrar:</span>
                <span className="text-2xl font-black font-mono text-slate-900 tabular-nums">
                  ${totalAmount}.00
                </span>
              </div>
            </div>
          )}

          {/* STEP 4: FAST CHECKOUT BUTTONS */}
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={ticketItems.length === 0}
              onClick={() => handleCheckout('efectivo', false)}
              className="h-14 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 shadow-sm active:scale-95 transition-all cursor-pointer border border-emerald-500"
            >
              <Banknote className="w-4 h-4" />
              <span>Efectivo 💵</span>
            </button>

            <button
              type="button"
              disabled={ticketItems.length === 0}
              onClick={() => handleCheckout('tarjeta', false)}
              className="h-14 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 shadow-sm active:scale-95 transition-all cursor-pointer border border-sky-500"
            >
              <CreditCard className="w-4 h-4" />
              <span>Tarjeta 💳</span>
            </button>

            <button
              type="button"
              disabled={ticketItems.length === 0}
              onClick={() => handleCheckout('efectivo', true)}
              className="h-14 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 shadow-sm active:scale-95 transition-all cursor-pointer border border-slate-800"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Con Ticket 🧾</span>
            </button>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: RESUMEN Y CAJA HOY
          ========================================================================= */}
      {activeMobileTab === 'summary' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          
          {/* Main Today Card */}
          <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-sm border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-semibold uppercase tracking-wider text-amber-400">
                Arqueo en Vivo • Hoy {todayStr}
              </span>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded-md border border-slate-700 font-mono">
                {todayTickets.length} ventas
              </span>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-white tabular-nums">
                ${todayTotal.toLocaleString('es-MX')}.00
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                Total bruto cobrado en mostrador hoy (00:01 a 23:59 hrs)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs font-mono tabular-nums">
              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-emerald-400 uppercase font-bold block">💵 Efectivo</span>
                <span className="text-base font-bold text-white">${todayCash}.00</span>
              </div>
              <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/60">
                <span className="text-[10px] text-sky-400 uppercase font-bold block">💳 Tarjeta / Clip</span>
                <span className="text-base font-bold text-white">${todayCard}.00</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800 font-medium">
              <span>🥖 Total Pan: <strong>{todayPieces} piezas</strong></span>
              <span>Promedio: <strong>${todayTickets.length ? Math.round(todayTotal / todayTickets.length) : 0}/tk</strong></span>
            </div>
          </div>

          {/* Turnos Breakdown */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-bold text-amber-800">🌅 Turno 1</span>
                <span className="text-[10px]">00:01-15:00</span>
              </div>
              <div className="text-xl font-black font-mono text-slate-900 mt-1 tabular-nums">
                ${turno1Total}.00
              </div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                {turno1Tickets.length} tickets
              </div>
            </div>

            <div className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-xs">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span className="font-bold text-indigo-800">🌇 Turno 2</span>
                <span className="text-[10px]">15:01-23:59</span>
              </div>
              <div className="text-xl font-black font-mono text-slate-900 mt-1 tabular-nums">
                ${turno2Total}.00
              </div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                {turno2Tickets.length} tickets
              </div>
            </div>
          </div>

          {/* Fast Action Buttons */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowShiftCutModal(true)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-4 rounded-2xl text-xs flex items-center justify-between shadow-xs transition-all active:scale-98 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <span>Hacer Corte de Caja / Turno Oficial 📋</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

            {onSelectTab && (
              <button
                type="button"
                onClick={() => onSelectTab('history')}
                className="w-full bg-white hover:bg-slate-50 text-slate-800 font-bold py-3 px-4 rounded-2xl text-xs flex items-center justify-between border border-slate-200/80 shadow-xs transition-all active:scale-98 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-amber-600" />
                  <span>Ver Historial Financiero por Meses 📅</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: TICKETS DEL DÍA EN CELULAR
          ========================================================================= */}
      {activeMobileTab === 'tickets' && (
        <div className="space-y-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-600">
              Ventas Registradas Hoy ({todayTickets.length})
            </span>
            <span className="text-xs font-mono font-bold text-slate-900">
              ${todayTotal}.00
            </span>
          </div>

          {todayTickets.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200/80 text-slate-400 font-semibold text-xs">
              No hay tickets registrados hoy todavía
            </div>
          ) : (
            <div className="space-y-2">
              {todayTickets.slice().reverse().map(ticket => (
                <div
                  key={ticket.id}
                  onClick={() => setTicketToView(ticket)}
                  className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-2xs hover:border-slate-400 transition-all cursor-pointer flex items-center justify-between gap-2 active:scale-98"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {ticket.folio}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                        ticket.paymentMethod === 'tarjeta' 
                          ? 'bg-sky-50 text-sky-700 border border-sky-200' 
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {ticket.paymentMethod === 'tarjeta' ? 'Tarjeta' : 'Efectivo'}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {ticket.time}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {ticket.items.reduce((s, it) => s + it.quantity, 0)} pzs • {ticket.customerName || 'Público Mostrador'}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-black font-mono text-sm text-slate-900 tabular-nums">
                      ${ticket.total}.00
                    </div>
                    <span className="text-[10px] text-amber-700 font-semibold flex items-center gap-0.5 justify-end">
                      <span>Ver</span>
                      <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 4: ENCARGOS PIDE Y RECOGE HOY
          ========================================================================= */}
      {activeMobileTab === 'orders' && (
        <div className="space-y-2 animate-in fade-in duration-150">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-slate-600">
              Pedidos para Recoger Hoy ({todayOrders.length})
            </span>
            {onSelectTab && (
              <button
                type="button"
                onClick={() => onSelectTab('orders')}
                className="text-xs font-bold text-purple-700 hover:underline cursor-pointer"
              >
                Abrir Administrador
              </button>
            )}
          </div>

          {todayOrders.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center border border-slate-200/80 text-slate-400 font-semibold text-xs">
              No hay encargos para recoger en mostrador hoy
            </div>
          ) : (
            <div className="space-y-2">
              {todayOrders.map(order => (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl p-3 border border-slate-200/80 shadow-2xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs text-purple-900">
                      #{order.folio}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      order.paymentStatus === 'pagado'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}>
                      {order.paymentStatus === 'pagado' ? 'Pagado' : `Saldo: $${order.pendingAmount || (order.total - (order.deposit || 0))}`}
                    </span>
                  </div>

                  <div>
                    <div className="font-bold text-xs text-slate-900">{order.customerName}</div>
                    {order.customerPhone && (
                      <div className="text-[10px] text-slate-500 font-mono">{order.customerPhone}</div>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-medium">
                      {order.items.reduce((s, it) => s + it.quantity, 0)} piezas • {order.deliveryTime || 'Hora no especificada'}
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      ${order.total}.00
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. MODALS */}
      {ticketToView && (
        <ThermalTicket
          ticket={ticketToView}
          settings={settings}
          onClose={() => setTicketToView(null)}
        />
      )}

      {showShiftCutModal && (
        <CashShiftCutModal
          isOpen={showShiftCutModal}
          onClose={() => setShowShiftCutModal(false)}
          tickets={tickets}
          orders={orders}
          settings={settings}
          onSaveCutSuccess={() => {
            setShowShiftCutModal(false);
            setSuccessToast('¡Corte de caja guardado exitosamente!');
            setTimeout(() => setSuccessToast(''), 3000);
          }}
        />
      )}

      {/* Voice Assistant Modal for Mobile */}
      <VoiceAssistantModal
        isOpen={showVoiceAssistantModal}
        onClose={() => {
          setShowVoiceAssistantModal(false);
          setIsMobileVoiceListening(false);
        }}
        onAddItemsToTicket={handleAddVoiceItems}
        currentTicketCount={ticketItems.length}
        onListeningStateChange={setIsMobileVoiceListening}
      />

    </div>
  );
};
