import React, { useState, useEffect, useMemo } from 'react';
import { SaleTicket, Settings, ShiftCutRecord, BakeryOrder, Driver, DriverCustomer } from '../../types';
import { 
  TrendingUp, 
  Banknote, 
  CreditCard, 
  Receipt, 
  Calendar, 
  CalendarRange,
  Search, 
  Printer, 
  Eye, 
  Sun, 
  Moon, 
  Clock, 
  CheckCircle2, 
  FileSpreadsheet,
  Trash2,
  Lock,
  ShieldAlert,
  AlertTriangle,
  Activity,
  BarChart3,
  X,
  KeyRound,
  Truck,
  ShoppingBag,
  Store,
  DollarSign,
  Phone,
  User,
  MapPin,
  MessageCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowDownCircle,
  HelpCircle,
  Sparkles,
  Percent,
  Wallet,
  Wheat,
  Coffee,
  Cloud,
  ArrowUpRight,
  Filter
} from 'lucide-react';
import { 
  getTodayString, 
  loadOutflows, 
  loadShiftCuts, 
  getNowTimeString, 
  resolveTicketShift,
  formatLocalDate,
  getCalendarWeekRange,
  getCalendarMonthRange
} from '../../utils/storage';
import { getCloudSyncStatus } from '../../services/cloudSyncService';
import { playCashSound, playBeep } from '../../utils/audio';
import { ThermalTicket } from '../ThermalTicket';
import { ThermalShiftCutTicket } from '../ShiftCut/ThermalShiftCutTicket';
import { printOrderTicketDirectToPrinter } from '../../utils/thermalPrinter';
import { calculateTicketsBreakdown } from '../../utils/productClassification';

interface SalesHistoryProps {
  tickets: SaleTicket[];
  orders?: BakeryOrder[];
  drivers?: Driver[];
  driverCustomers?: DriverCustomer[];
  settings: Settings;
  onDeleteTicket?: (ticketId: string) => void;
  onUpdateOrder?: (order: BakeryOrder) => void;
}

// Convert "08:30 AM", "14:15", "03:20 PM" to minutes from 00:00
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const str = timeStr.trim().toUpperCase();
  const isPM = str.includes('PM') || str.includes('P.M.');
  const isAM = str.includes('AM') || str.includes('A.M.');
  
  const clean = str.replace(/[^0-9:]/g, '');
  const parts = clean.split(':');
  let h = parseInt(parts[0] || '0', 10);
  const m = parseInt(parts[1] || '0', 10);
  
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;
  
  return h * 60 + m;
}

// Turno 1 (Matutino): 00:01 AM a 15:00 HRS (900 mins)
// Turno 2 (Vespertino / Noche): 15:01 HRS a 23:59 HRS / 11:59 PM (1439 mins)
// Abarca el día completo de 00:01 a 23:59 sin dejar ningún ticket ni corte fuera a las 10:00 PM (22:00)
export function getTicketShift(ticketOrTime: string | { shift?: 'turno1' | 'turno2'; time: string }): 'turno1' | 'turno2' {
  if (typeof ticketOrTime === 'string') {
    return resolveTicketShift({ time: ticketOrTime });
  }
  return resolveTicketShift(ticketOrTime);
}

// 12 Meses en Español para selector de Caja Box
export const MONTHS_SPANISH = [
  { index: 0, name: 'Enero', short: 'Ene' },
  { index: 1, name: 'Febrero', short: 'Feb' },
  { index: 2, name: 'Marzo', short: 'Mar' },
  { index: 3, name: 'Abril', short: 'Abr' },
  { index: 4, name: 'Mayo', short: 'May' },
  { index: 5, name: 'Junio', short: 'Jun' },
  { index: 6, name: 'Julio', short: 'Jul' },
  { index: 7, name: 'Agosto', short: 'Ago' },
  { index: 8, name: 'Septiembre', short: 'Sep' },
  { index: 9, name: 'Octubre', short: 'Oct' },
  { index: 10, name: 'Noviembre', short: 'Nov' },
  { index: 11, name: 'Diciembre', short: 'Dic' }
];

export const SalesHistory: React.FC<SalesHistoryProps> = ({
  tickets,
  orders = [],
  drivers = [],
  driverCustomers = [],
  settings,
  onDeleteTicket,
  onUpdateOrder
}) => {
  const todayStr = getTodayString();
  const now = new Date();

  // Helper para resolver la fecha del ticket de forma infalible en tiempo local (sin desfase UTC)
  const getTicketDate = (t: SaleTicket): string => {
    if (t.date && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date.trim())) {
      return t.date.trim();
    }
    if (t.timestamp) {
      try {
        const d = new Date(t.timestamp);
        if (!isNaN(d.getTime())) {
          return formatLocalDate(d);
        }
      } catch {}
    }
    return todayStr;
  };

  // Fecha ayer (hora local)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterdayStr = formatLocalDate(yesterday);

  // Fechas reales que tienen ventas registradas (ordenadas descendente)
  const availableSaleDates = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach(t => {
      const d = getTicketDate(t);
      if (d) set.add(d);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [tickets]);

  // Semanas reales con ventas registradas (Lunes a Domingo)
  const availableWeeksWithSales = useMemo(() => {
    const map = new Map<string, { startStr: string; endStr: string; label: string; count: number; total: number; refDate: Date }>();
    for (const t of tickets) {
      const dStr = getTicketDate(t);
      const [y, m, d] = dStr.split('-').map(Number);
      if (!y || !m || !d) continue;
      const ref = new Date(y, m - 1, d);
      const wr = getCalendarWeekRange(ref);
      if (!map.has(wr.startStr)) {
        map.set(wr.startStr, { ...wr, count: 0, total: 0, refDate: ref });
      }
      const entry = map.get(wr.startStr)!;
      entry.count += 1;
      entry.total += t.total;
    }
    return Array.from(map.values()).sort((a, b) => b.startStr.localeCompare(a.startStr));
  }, [tickets]);

  // Meses reales con ventas registradas (Mes Calendario: 1 al fin de mes)
  const availableMonthsWithSales = useMemo(() => {
    const map = new Map<string, { startStr: string; endStr: string; label: string; count: number; total: number; refDate: Date }>();
    for (const t of tickets) {
      const dStr = getTicketDate(t);
      const [y, m, d] = dStr.split('-').map(Number);
      if (!y || !m || !d) continue;
      const ref = new Date(y, m - 1, 1);
      const mr = getCalendarMonthRange(ref);
      if (!map.has(mr.startStr)) {
        map.set(mr.startStr, { ...mr, count: 0, total: 0, refDate: ref });
      }
      const entry = map.get(mr.startStr)!;
      entry.count += 1;
      entry.total += t.total;
    }
    return Array.from(map.values()).sort((a, b) => b.startStr.localeCompare(a.startStr));
  }, [tickets]);

  // 1. FECHA SELECCIONADA PARA VENTA DIARIA
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const hasToday = tickets.some(t => getTicketDate(t) === todayStr);
    if (hasToday) return todayStr;
    return availableSaleDates[0] || todayStr;
  });

  // 2. SEMANA SELECCIONADA: LUNES A DOMINGO
  const [selectedWeekDate, setSelectedWeekDate] = useState<Date>(() => {
    const curWeek = getCalendarWeekRange(now);
    const hasCurWeek = tickets.some(t => {
      const d = getTicketDate(t);
      return d >= curWeek.startStr && d <= curWeek.endStr;
    });
    if (hasCurWeek) return now;
    return availableWeeksWithSales[0]?.refDate || now;
  });

  const selectedWeekRange = useMemo(() => getCalendarWeekRange(selectedWeekDate), [selectedWeekDate]);
  const weekStartStr = selectedWeekRange.startStr;
  const weekEndStr = selectedWeekRange.endStr;
  const weekLabel = selectedWeekRange.label;

  // 3. MES SELECCIONADO: MES CALENDARIO (DÍA 1 AL FIN DE MES)
  const [selectedMonthDate, setSelectedMonthDate] = useState<Date>(() => {
    const curMonth = getCalendarMonthRange(now);
    const hasCurMonth = tickets.some(t => {
      const d = getTicketDate(t);
      return d >= curMonth.startStr && d <= curMonth.endStr;
    });
    if (hasCurMonth) return now;
    return availableMonthsWithSales[0]?.refDate || now;
  });

  const selectedMonthRange = useMemo(() => getCalendarMonthRange(selectedMonthDate), [selectedMonthDate]);
  const monthStartStr = selectedMonthRange.startStr;
  const monthEndStr = selectedMonthRange.endStr;
  const monthLabel = selectedMonthRange.label;

  // Filtro de período principal
  const [dateFilterMode, setDateFilterMode] = useState<'dia' | 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango' | 'todos'>(() => {
    const hasToday = tickets.some(t => getTicketDate(t) === todayStr);
    return hasToday ? 'hoy' : 'dia';
  });

  const [startDate, setStartDate] = useState<string>(todayStr);
  const [endDate, setEndDate] = useState<string>(todayStr);

  // Cloud sync status timer
  const [cloudSyncInfo, setCloudSyncInfo] = useState<{ status: string; lastSyncTime: number; pendingCount: number }>(getCloudSyncStatus());
  const [timeAgoStr, setTimeAgoStr] = useState<string>('En vivo');

  useEffect(() => {
    const updateSyncBadge = () => {
      const info = getCloudSyncStatus();
      setCloudSyncInfo(info);
      if (!info.lastSyncTime) {
        setTimeAgoStr('En vivo');
        return;
      }
      const diffSec = Math.max(0, Math.floor((Date.now() - info.lastSyncTime) / 1000));
      if (diffSec < 5) setTimeAgoStr('Sincronizado ahora');
      else if (diffSec < 60) setTimeAgoStr(`hace ${diffSec}s`);
      else setTimeAgoStr(`hace ${Math.floor(diffSec / 60)}m`);
    };

    updateSyncBadge();
    const interval = setInterval(updateSyncBadge, 2000);
    return () => clearInterval(interval);
  }, []);

  // Sub-Navigation Module
  const [activeModule, setActiveModule] = useState<'corte_caja' | 'pedidos_tienda' | 'por_cobrar'>('corte_caja');

  // Search & Specific Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<'todos' | 'efectivo' | 'tarjeta'>('todos');
  const [shiftFilter, setShiftFilter] = useState<'todos' | 'turno1' | 'turno2'>('todos');
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState<'todos' | 'entregado' | 'en_camino' | 'pendiente'>('todos');

  // Modals
  const [ticketToView, setTicketToView] = useState<SaleTicket | null>(null);
  const [shiftCutToPreview, setShiftCutToPreview] = useState<ShiftCutRecord | null>(null);
  const [orderToView, setOrderToView] = useState<BakeryOrder | null>(null);
  
  // Order Settlement / Cobro Modal
  const [orderToSettle, setOrderToSettle] = useState<BakeryOrder | null>(null);
  const [settleAmount, setSettleAmount] = useState<string>('');
  const [settleMethod, setSettleMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia'>('efectivo');
  const [settleNotes, setSettleNotes] = useState<string>('');
  const [settleSuccessNotice, setSettleSuccessNotice] = useState<string>('');

  // Admin PIN Delete Modal State (Clave 13579)
  const [ticketToDelete, setTicketToDelete] = useState<SaleTicket | null>(null);
  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [successDeleteNotice, setSuccessDeleteNotice] = useState<string>('');
  const [cloudSyncNotice, setCloudSyncNotice] = useState<string>('');
  const [allHistoricalCuts, setAllHistoricalCuts] = useState<ShiftCutRecord[]>(() => loadShiftCuts());

  useEffect(() => {
    setAllHistoricalCuts(loadShiftCuts());
  }, [tickets]);

  // 1. Venta Diaria: del día activo seleccionado
  const selectedDayTickets = useMemo(() => tickets.filter(t => getTicketDate(t) === selectedDate), [tickets, selectedDate]);
  const selectedDayTotal = useMemo(() => selectedDayTickets.reduce((sum, t) => sum + t.total, 0), [selectedDayTickets]);
  const selectedDayCash = useMemo(() => selectedDayTickets.filter(t => t.paymentMethod === 'efectivo').reduce((sum, t) => sum + t.total, 0), [selectedDayTickets]);
  const selectedDayCard = useMemo(() => selectedDayTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((sum, t) => sum + t.total, 0), [selectedDayTickets]);
  const selectedDayPieces = useMemo(() => selectedDayTickets.reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0), [selectedDayTickets]);

  // Venta de hoy
  const todayTickets = useMemo(() => tickets.filter(t => getTicketDate(t) === todayStr), [tickets, todayStr]);
  const todayTotal = useMemo(() => todayTickets.reduce((sum, t) => sum + t.total, 0), [todayTickets]);

  // 2. Venta Semanal: LUNES A DOMINGO
  const weekTickets = useMemo(() => tickets.filter(t => {
    const d = getTicketDate(t);
    return d >= weekStartStr && d <= weekEndStr;
  }), [tickets, weekStartStr, weekEndStr]);
  const weekTotal = useMemo(() => weekTickets.reduce((sum, t) => sum + t.total, 0), [weekTickets]);
  const weekCash = useMemo(() => weekTickets.filter(t => t.paymentMethod === 'efectivo').reduce((sum, t) => sum + t.total, 0), [weekTickets]);
  const weekCard = useMemo(() => weekTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((sum, t) => sum + t.total, 0), [weekTickets]);
  const weekPieces = useMemo(() => weekTickets.reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0), [weekTickets]);
  const weekUniqueDays = useMemo(() => new Set(weekTickets.map(t => getTicketDate(t))).size || 1, [weekTickets]);
  const weekAvgDaily = useMemo(() => Math.round(weekTotal / Math.max(1, weekUniqueDays)), [weekTotal, weekUniqueDays]);

  // 3. Venta Mensual: MES CALENDARIO
  const monthTickets = useMemo(() => tickets.filter(t => {
    const d = getTicketDate(t);
    return d >= monthStartStr && d <= monthEndStr;
  }), [tickets, monthStartStr, monthEndStr]);
  const monthTotal = useMemo(() => monthTickets.reduce((sum, t) => sum + t.total, 0), [monthTickets]);
  const monthCash = useMemo(() => monthTickets.filter(t => t.paymentMethod === 'efectivo').reduce((sum, t) => sum + t.total, 0), [monthTickets]);
  const monthCard = useMemo(() => monthTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((sum, t) => sum + t.total, 0), [monthTickets]);
  const monthPieces = useMemo(() => monthTickets.reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0), [monthTickets]);
  const monthUniqueDays = useMemo(() => new Set(monthTickets.map(t => getTicketDate(t))).size || 1, [monthTickets]);
  const monthAvgDaily = useMemo(() => Math.round(monthTotal / Math.max(1, monthUniqueDays)), [monthTotal, monthUniqueDays]);

  // DATE-MATCHED TICKETS
  const dateMatchedTickets = useMemo(() => {
    return tickets.filter(ticket => {
      const tDate = getTicketDate(ticket);
      if (dateFilterMode === 'dia') return tDate === selectedDate;
      if (dateFilterMode === 'hoy') return tDate === todayStr;
      if (dateFilterMode === 'ayer') return tDate === yesterdayStr;
      if (dateFilterMode === 'semana') return tDate >= weekStartStr && tDate <= weekEndStr;
      if (dateFilterMode === 'mes') return tDate >= monthStartStr && tDate <= monthEndStr;
      if (dateFilterMode === 'rango') return tDate >= startDate && tDate <= endDate;
      return true;
    });
  }, [tickets, dateFilterMode, selectedDate, todayStr, yesterdayStr, weekStartStr, weekEndStr, monthStartStr, monthEndStr, startDate, endDate]);

  // DATE-MATCHED ORDERS: Encargos en Tienda / Pide y Recoge
  const storePickupOrders = useMemo(() => {
    return orders.filter(order => {
      if (order.deliveryType === 'domicilio' || order.orderChannel === 'reparto' || order.assignedDriverId === 'osvaldo' || order.assignedDriverId === 'simon') {
        return false;
      }
      const orderDate = order.deliveryDate || (order.createdAt ? order.createdAt.split('T')[0] : todayStr);
      if (dateFilterMode === 'dia') return orderDate === selectedDate;
      if (dateFilterMode === 'hoy') return orderDate === todayStr;
      if (dateFilterMode === 'ayer') return orderDate === yesterdayStr;
      if (dateFilterMode === 'semana') return orderDate >= weekStartStr && orderDate <= weekEndStr;
      if (dateFilterMode === 'mes') return orderDate >= monthStartStr && orderDate <= monthEndStr;
      if (dateFilterMode === 'rango') return orderDate >= startDate && orderDate <= endDate;
      return true;
    });
  }, [orders, dateFilterMode, selectedDate, todayStr, yesterdayStr, weekStartStr, weekEndStr, monthStartStr, monthEndStr, startDate, endDate]);

  // Cortes Oficiales Guardados Filtrados
  const relevantHistoricalCuts = useMemo(() => {
    return allHistoricalCuts.filter(c => {
      if (!c.date) return false;
      const cDate = c.date.split(' ')[0];
      if (dateFilterMode === 'dia') return cDate === selectedDate;
      if (dateFilterMode === 'hoy') return cDate === todayStr;
      if (dateFilterMode === 'ayer') return cDate === yesterdayStr;
      if (dateFilterMode === 'semana') return cDate >= weekStartStr && cDate <= weekEndStr;
      if (dateFilterMode === 'mes') return cDate >= monthStartStr && cDate <= monthEndStr;
      if (dateFilterMode === 'rango') return cDate >= startDate && cDate <= endDate;
      return true;
    });
  }, [allHistoricalCuts, dateFilterMode, selectedDate, todayStr, yesterdayStr, weekStartStr, weekEndStr, monthStartStr, monthEndStr, startDate, endDate]);

  // DESGLOSE DIARIO DE TODAS LAS VENTAS (Conteo de Fechas Reales)
  const dailyBreakdown = useMemo(() => {
    const targetTickets = (dateFilterMode === 'dia' || dateFilterMode === 'hoy' || dateFilterMode === 'ayer')
      ? tickets
      : dateMatchedTickets;

    const map = new Map<string, {
      date: string;
      total: number;
      cash: number;
      card: number;
      ticketsCount: number;
      pieces: number;
    }>();

    for (const t of targetTickets) {
      const d = getTicketDate(t);
      if (!map.has(d)) {
        map.set(d, {
          date: d,
          total: 0,
          cash: 0,
          card: 0,
          ticketsCount: 0,
          pieces: 0
        });
      }
      const item = map.get(d)!;
      item.total += t.total;
      if (t.paymentMethod === 'tarjeta') item.card += t.total;
      else item.cash += t.total;
      item.ticketsCount += 1;
      item.pieces += t.items.reduce((sum, it) => sum + it.quantity, 0);
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [tickets, dateMatchedTickets, dateFilterMode]);

  // Handlers de navegación temporal
  const handlePrevDay = () => {
    const idx = availableSaleDates.indexOf(selectedDate);
    if (idx !== -1 && idx < availableSaleDates.length - 1) {
      setSelectedDate(availableSaleDates[idx + 1]);
    } else {
      const parts = selectedDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2] - 1);
      setSelectedDate(formatLocalDate(d));
    }
    setDateFilterMode('dia');
  };

  const handleNextDay = () => {
    const idx = availableSaleDates.indexOf(selectedDate);
    if (idx > 0) {
      setSelectedDate(availableSaleDates[idx - 1]);
    } else {
      const parts = selectedDate.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2] + 1);
      setSelectedDate(formatLocalDate(d));
    }
    setDateFilterMode('dia');
  };

  const handlePrevWeek = () => {
    setSelectedWeekDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7));
    setDateFilterMode('semana');
  };

  const handleNextWeek = () => {
    setSelectedWeekDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7));
    setDateFilterMode('semana');
  };

  const handlePrevMonth = () => {
    setSelectedMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setDateFilterMode('mes');
  };

  const handleNextMonth = () => {
    setSelectedMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setDateFilterMode('mes');
  };

  // Años disponibles para selector de Mes
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    set.add(now.getFullYear());
    set.add(2026);
    tickets.forEach(t => {
      const d = getTicketDate(t);
      const y = parseInt(d.split('-')[0], 10);
      if (!isNaN(y)) set.add(y);
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [tickets, now]);

  // Handler para seleccionar mes directamente desde el Caja Box
  const handleSelectMonthIndex = (monthIdx: number) => {
    const curYear = selectedMonthRange.year;
    setSelectedMonthDate(new Date(curYear, monthIdx, 1));
    setDateFilterMode('mes');
    playBeep(550, 'sine', 0.04);
  };

  // Handler para seleccionar año desde el Caja Box
  const handleSelectYear = (year: number) => {
    const curMonthIdx = selectedMonthRange.monthIndex;
    setSelectedMonthDate(new Date(year, curMonthIdx, 1));
    setDateFilterMode('mes');
    playBeep(550, 'sine', 0.04);
  };

  // --- MACRO FINANCIAL METRICS ---
  const mostradorTotal = dateMatchedTickets.reduce((acc, t) => acc + t.total, 0);
  const mostradorCash = dateMatchedTickets.filter(t => t.paymentMethod === 'efectivo').reduce((acc, t) => acc + t.total, 0);
  const mostradorCard = dateMatchedTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((acc, t) => acc + t.total, 0);
  const mostradorPieces = dateMatchedTickets.reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0);
  const mostradorBreakdown = calculateTicketsBreakdown(dateMatchedTickets);

  // Turnos en Mostrador
  const turno1Tickets = dateMatchedTickets.filter(t => getTicketShift(t) === 'turno1');
  const turno1Total = turno1Tickets.reduce((acc, t) => acc + t.total, 0);
  const turno1Cash = turno1Tickets.filter(t => t.paymentMethod === 'efectivo').reduce((acc, t) => acc + t.total, 0);
  const turno1Card = turno1Tickets.filter(t => t.paymentMethod === 'tarjeta').reduce((acc, t) => acc + t.total, 0);
  const turno1Breakdown = calculateTicketsBreakdown(turno1Tickets);

  const turno2Tickets = dateMatchedTickets.filter(t => getTicketShift(t) === 'turno2');
  const turno2Total = turno2Tickets.reduce((acc, t) => acc + t.total, 0);
  const turno2Cash = turno2Tickets.filter(t => t.paymentMethod === 'efectivo').reduce((acc, t) => acc + t.total, 0);
  const turno2Card = turno2Tickets.filter(t => t.paymentMethod === 'tarjeta').reduce((acc, t) => acc + t.total, 0);
  const turno2Breakdown = calculateTicketsBreakdown(turno2Tickets);

  // Totales de Pedidos en Tienda
  const storeOrdersTotalGenerated = storePickupOrders.reduce((sum, o) => sum + o.total, 0);
  const storeOrdersTotalCollected = storePickupOrders.reduce((sum, o) => sum + (o.deposit || 0) + (o.collectedAmount || 0), 0);
  const storeOrdersTotalPending = storePickupOrders.reduce((sum, o) => {
    const p = o.pendingAmount > 0 ? o.pendingAmount : Math.max(0, o.total - (o.deposit || 0) - (o.collectedAmount || 0));
    return sum + p;
  }, 0);
  const storeOrdersPiecesCount = storePickupOrders.reduce((sum, o) => sum + o.items.reduce((s, it) => s + it.quantity, 0), 0);

  // Cuentas globales por cobrar
  const allReceivableOrders = orders.filter(o => {
    if (o.deliveryType === 'domicilio' || o.orderChannel === 'reparto' || o.assignedDriverId === 'osvaldo' || o.assignedDriverId === 'simon') {
      return false;
    }
    const pending = o.pendingAmount > 0 ? o.pendingAmount : (o.paymentStatus !== 'pagado' ? Math.max(0, o.total - (o.deposit || 0)) : 0);
    return o.paymentStatus !== 'pagado' && pending > 0;
  });
  const totalGlobalPending = storeOrdersTotalPending;
  const countPendingOrders = allReceivableOrders.length;

  // --- FILTROS DE VISTA ---
  const filteredTickets = dateMatchedTickets.filter(ticket => {
    if (shiftFilter !== 'todos' && getTicketShift(ticket) !== shiftFilter) return false;
    if (paymentFilter !== 'todos' && ticket.paymentMethod !== paymentFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchFolio = ticket.folio.toLowerCase().includes(q);
      const matchCustomer = ticket.customerName?.toLowerCase().includes(q);
      const matchPhone = ticket.customerPhone?.includes(q);
      if (!matchFolio && !matchCustomer && !matchPhone) return false;
    }
    return true;
  });

  const filteredStoreOrders = storePickupOrders.filter(order => {
    if (deliveryStatusFilter !== 'todos' && order.deliveryStatus !== deliveryStatusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchFolio = order.folio.toLowerCase().includes(q);
      const matchCustomer = order.customerName.toLowerCase().includes(q);
      const matchPhone = order.customerPhone?.includes(q);
      if (!matchFolio && !matchCustomer && !matchPhone) return false;
    }
    return true;
  });

  const filteredReceivables = allReceivableOrders.filter(order => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchFolio = order.folio.toLowerCase().includes(q);
      const matchCustomer = order.customerName.toLowerCase().includes(q);
      const matchPhone = order.customerPhone?.includes(q);
      if (!matchFolio && !matchCustomer && !matchPhone) return false;
    }
    return true;
  });

  // --- ACTIONS ---
  const handleOpenDeleteModal = (ticket: SaleTicket) => {
    setTicketToDelete(ticket);
    setAdminPinInput('');
    setPinError('');
  };

  const handleConfirmDelete = () => {
    if (!ticketToDelete) return;
    const validPin = settings.adminPin || '13579';
    if (adminPinInput.trim() === '13579' || adminPinInput.trim() === validPin) {
      const deletedFolio = ticketToDelete.folio;
      if (onDeleteTicket) {
        onDeleteTicket(ticketToDelete.id);
      }
      playBeep(450, 'sawtooth', 0.15);
      if (ticketToView?.id === ticketToDelete.id) {
        setTicketToView(null);
      }
      setTicketToDelete(null);
      setAdminPinInput('');
      setPinError('');
      setSuccessDeleteNotice(`¡Venta ${deletedFolio} eliminada correctamente!`);
      setTimeout(() => setSuccessDeleteNotice(''), 4000);
    } else {
      playBeep(250, 'sawtooth', 0.2);
      setPinError('❌ Clave de administrador incorrecta. Se requiere la clave 13579.');
    }
  };

  const handleOpenSettleModal = (order: BakeryOrder) => {
    playBeep(650, 'sine', 0.03);
    const pending = order.pendingAmount > 0 ? order.pendingAmount : Math.max(0, order.total - (order.deposit || 0) - (order.collectedAmount || 0));
    setOrderToSettle(order);
    setSettleAmount(pending.toString());
    setSettleMethod('efectivo');
    setSettleNotes('');
  };

  const handleConfirmSettleOrder = () => {
    if (!orderToSettle || !onUpdateOrder) return;
    const amountNum = parseFloat(settleAmount) || 0;
    if (amountNum <= 0) return;

    const currentPending = orderToSettle.pendingAmount > 0 
      ? orderToSettle.pendingAmount 
      : Math.max(0, orderToSettle.total - (orderToSettle.deposit || 0) - (orderToSettle.collectedAmount || 0));
    
    const newPending = Math.max(0, currentPending - amountNum);
    const newCollected = (orderToSettle.collectedAmount || 0) + amountNum;
    const isFullyPaid = newPending === 0;

    const updatedOrder: BakeryOrder = {
      ...orderToSettle,
      collectedAmount: newCollected,
      pendingAmount: newPending,
      paymentStatus: isFullyPaid ? 'pagado' : 'anticipo',
      paidDate: todayStr,
      paidMethod: settleMethod,
      deliveryStatus: orderToSettle.deliveryStatus === 'pendiente' && isFullyPaid ? 'entregado' : orderToSettle.deliveryStatus,
      accountingNotes: settleNotes ? `${orderToSettle.accountingNotes || ''} | [Cobro Historial: $${amountNum} por ${settleMethod} - ${settleNotes}]`.trim() : orderToSettle.accountingNotes
    };

    onUpdateOrder(updatedOrder);
    playCashSound();
    
    setSettleSuccessNotice(`¡Cobro de $${amountNum}.00 registrado para pedido #${orderToSettle.folio}!`);
    setTimeout(() => setSettleSuccessNotice(''), 4000);
    setOrderToSettle(null);
  };

  // Print Shift Cut Ticket
  const handlePrintCut = (shiftType: 'turno1' | 'turno2' | 'dia_completo') => {
    let targetTickets = dateMatchedTickets;
    let shiftTitle = 'Corte Día Completo (00:01 a 23:59 hrs)';
    let shiftCashier = 'Responsable de Sucursal';

    if (shiftType === 'turno1') {
      targetTickets = turno1Tickets;
      shiftTitle = 'Turno 1 (Mañana 00:01 a 15:00)';
      shiftCashier = 'Cajero Turno 1';
    } else if (shiftType === 'turno2') {
      targetTickets = turno2Tickets;
      shiftTitle = 'Turno 2 (Tarde / Noche 15:01 a 23:59 - 11:59 PM)';
      shiftCashier = 'Cajero Turno 2';
    }

    const cutTotal = targetTickets.reduce((acc, t) => acc + t.total, 0);
    const cutCash = targetTickets.filter(t => t.paymentMethod === 'efectivo').reduce((acc, t) => acc + t.total, 0);
    const cutCard = targetTickets.filter(t => t.paymentMethod === 'tarjeta').reduce((acc, t) => acc + t.total, 0);
    const cutPieces = targetTickets.reduce((sum, t) => sum + t.items.reduce((s, it) => s + it.quantity, 0), 0);
    const cutBreakdown = calculateTicketsBreakdown(targetTickets);
    const allOutflows = loadOutflows();
    const targetDate = dateFilterMode === 'hoy' ? todayStr : (dateFilterMode === 'ayer' ? yesterdayStr : selectedDate);
    const relevantOutflows = allOutflows.filter(o => {
      const oDate = o.date || (o.createdAt ? o.createdAt.split('T')[0] : '');
      if (oDate && oDate !== targetDate) return false;
      if (!oDate) return false;
      if (shiftType !== 'dia_completo' && o.shiftCode && o.shiftCode !== shiftType) return false;
      return true;
    });
    const totalOutflows = relevantOutflows.reduce((sum, o) => sum + o.amount, 0);
    const expectedCash = 1000 + cutCash - totalOutflows;

    const cutRecord: ShiftCutRecord = {
      id: `cut-hist-${Date.now()}`,
      folio: `CORTE-${shiftType.toUpperCase()}`,
      date: dateFilterMode === 'hoy' ? todayStr : (dateFilterMode === 'ayer' ? yesterdayStr : (dateFilterMode === 'dia' ? selectedDate : (dateFilterMode === 'semana' ? `${weekStartStr} al ${weekEndStr}` : (dateFilterMode === 'mes' ? `${monthStartStr} al ${monthEndStr}` : (dateFilterMode === 'rango' ? `${startDate} al ${endDate}` : selectedDate))))),
      time: getNowTimeString(),
      cashierName: shiftCashier,
      shiftName: shiftTitle,
      initialCash: 1000,
      totalGrossSales: cutTotal,
      totalCashSales: cutCash,
      totalCardSales: cutCard,
      totalBreadSales: cutBreakdown.breadTotal,
      totalNonBreadSales: cutBreakdown.nonBreadTotal,
      breadPieces: cutBreakdown.breadPieces,
      nonBreadPieces: cutBreakdown.nonBreadPieces,
      totalPieces: cutPieces,
      ticketsCount: targetTickets.length,
      outflows: relevantOutflows,
      totalOutflows,
      expectedCashInDrawer: expectedCash,
      createdAt: new Date().toISOString()
    };

    setShiftCutToPreview(cutRecord);
  };

  // Export to CSV
  const handleExportCSV = () => {
    let headers: string[] = [];
    let rows: (string | number)[][] = [];

    if (activeModule === 'corte_caja') {
      headers = ['Folio', 'Fecha', 'Hora', 'Turno', 'Cliente', 'Telefono', 'Metodo Pago', 'Subtotal', 'Descuento', 'Total', 'Puntos'];
      rows = filteredTickets.map(t => [
        t.folio,
        t.date,
        t.time,
        getTicketShift(t) === 'turno1' ? 'Turno 1 (Matutino)' : 'Turno 2 (Vespertino)',
        `"${t.customerName || 'Publico General'}"`,
        t.customerPhone || '',
        t.paymentMethod,
        t.subtotal,
        t.discount,
        t.total,
        t.pointsEarned
      ]);
    } else if (activeModule === 'pedidos_tienda') {
      headers = ['Folio', 'Fecha', 'Hora Entrega', 'Cliente', 'Telefono', 'Piezas', 'Total', 'Anticipo', 'Saldo Pendiente', 'Estado Pago', 'Estado Entrega'];
      rows = filteredStoreOrders.map(o => [
        o.folio,
        o.deliveryDate,
        o.deliveryTime,
        `"${o.customerName}"`,
        o.customerPhone || '',
        o.items.reduce((s, it) => s + it.quantity, 0),
        o.total,
        o.deposit || 0,
        o.pendingAmount || 0,
        o.paymentStatus,
        o.deliveryStatus
      ]);
    } else {
      headers = ['Folio', 'Fecha', 'Cliente', 'Telefono', 'Total', 'Anticipo', 'Saldo Pendiente a Cobrar', 'Estado Pago'];
      rows = filteredReceivables.map(o => [
        o.folio,
        o.deliveryDate,
        `"${o.customerName}"`,
        o.customerPhone || '',
        o.total,
        o.deposit || 0,
        o.pendingAmount || Math.max(0, o.total - (o.deposit || 0)),
        o.paymentStatus
      ]);
    }

    const csvContent = '\uFEFF' + [
      headers.join(','),
      ...rows.map(e => e.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `SantaFe_${activeModule}_${selectedDate || 'reporte'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 pb-14 text-slate-800">
      
      {/* 1. HEADER: CLEAN, REFINED ARTISAN FINANCIAL DESIGN */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-slate-900 text-amber-400 flex items-center justify-center font-bold text-xl sm:text-2xl shadow-xs border border-slate-800 shrink-0">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 leading-tight">
                Historial & Arqueo de Caja
              </h1>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Nube en vivo • {timeAgoStr}</span>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              Turno 1 (00:01 - 15:00) · Turno 2 (15:01 - 23:59 hrs) · {tickets.length} ventas en mostrador registradas
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center flex-wrap gap-2">
          <button
            id="print-full-day-btn"
            type="button"
            onClick={() => handlePrintCut('dia_completo')}
            className="bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-semibold px-3.5 py-2.5 rounded-xl text-xs flex items-center space-x-2 shadow-xs transition-all cursor-pointer border border-slate-800"
            title="Imprimir ticket térmico de corte de caja de todo el día (00:01 a 23:59)"
          >
            <Printer className="w-3.5 h-3.5 text-amber-400" />
            <span>Corte Día Completo (Z)</span>
          </button>

          <button
            id="export-csv-btn"
            type="button"
            onClick={handleExportCSV}
            className="bg-white hover:bg-slate-50 text-slate-700 active:scale-95 font-semibold px-3.5 py-2.5 rounded-xl text-xs flex items-center space-x-1.5 shadow-2xs transition-all cursor-pointer border border-slate-200"
            title="Descargar reporte en formato Excel / CSV"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Exportar CSV</span>
          </button>
        </div>
      </div>

      {/* Notices */}
      {cloudSyncNotice && (
        <div className="bg-slate-900 text-white p-3 rounded-2xl shadow-xs flex items-center justify-between gap-2 text-xs font-semibold animate-in slide-in-from-top-1 border border-slate-800">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-sky-400 animate-pulse" />
            <span>{cloudSyncNotice}</span>
          </div>
          <button onClick={() => setCloudSyncNotice('')} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successDeleteNotice && (
        <div className="bg-emerald-700 text-white p-3 rounded-2xl shadow-xs flex items-center justify-between gap-2 text-xs font-semibold animate-in slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>{successDeleteNotice}</span>
          </div>
          <button onClick={() => setSuccessDeleteNotice('')} className="text-emerald-200 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {settleSuccessNotice && (
        <div className="bg-slate-900 text-white p-3 rounded-2xl shadow-xs flex items-center justify-between gap-2 text-xs font-semibold animate-in slide-in-from-top-1 border border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>{settleSuccessNotice}</span>
          </div>
          <button onClick={() => setSettleSuccessNotice('')} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. EXECUTIVE FINANCIAL CARDS (DÍA, SEMANA, MES) */}
      <div className="bg-slate-900 text-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm border border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3.5 pb-3 border-b border-slate-800">
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase text-amber-400">
              Panel Financiero Ejecutivo
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-white mt-0.5">
              Venta Diaria, Semanal y Mensual (100% Cifras Reales)
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>00:01 a 23:59 hrs sincronizado</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Venta Diaria */}
          <div 
            onClick={() => setDateFilterMode('dia')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
              dateFilterMode === 'dia' || dateFilterMode === 'hoy'
                ? 'bg-slate-800/90 text-white border-amber-400/80 shadow-md ring-1 ring-amber-400/30'
                : 'bg-slate-800/40 hover:bg-slate-800/70 text-slate-200 border-slate-700/60'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 truncate">
                Venta Diaria • {selectedDate === todayStr ? 'Hoy' : selectedDate === yesterdayStr ? 'Ayer' : selectedDate}
              </span>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handlePrevDay}
                  title="Día anterior"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextDay}
                  title="Día siguiente"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-white tabular-nums">
              ${selectedDayTotal.toLocaleString('es-MX')}.00
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums mt-2 pt-2 border-t border-slate-700/60 text-slate-300">
              <span className="text-emerald-400 font-semibold">💵 ${selectedDayCash}</span>
              <span className="text-sky-400 font-semibold">💳 ${selectedDayCard}</span>
              <span>🥖 {selectedDayPieces} pzs</span>
              <span className="text-slate-400 font-medium">{selectedDayTickets.length} tks</span>
            </div>
          </div>

          {/* Card 2: Venta Semanal */}
          <div 
            onClick={() => setDateFilterMode('semana')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
              dateFilterMode === 'semana'
                ? 'bg-slate-800/90 text-white border-amber-400/80 shadow-md ring-1 ring-amber-400/30'
                : 'bg-slate-800/40 hover:bg-slate-800/70 text-slate-200 border-slate-700/60'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="truncate">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
                  Venta Semana (Lun a Dom)
                </span>
                <span className="text-[10px] text-slate-400 font-medium block truncate">
                  {weekLabel}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={handlePrevWeek}
                  title="Semana anterior"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextWeek}
                  title="Semana siguiente"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-white tabular-nums">
              ${weekTotal.toLocaleString('es-MX')}.00
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums mt-2 pt-2 border-t border-slate-700/60 text-slate-300">
              <span className="text-emerald-400 font-semibold">💵 ${weekCash}</span>
              <span className="text-sky-400 font-semibold">💳 ${weekCard}</span>
              <span>Prom: ${weekAvgDaily}/día</span>
              <span className="text-slate-400 font-medium">{weekTickets.length} tks</span>
            </div>
          </div>

          {/* Card 3: Venta Mensual con Selector Caja Box */}
          <div 
            onClick={() => setDateFilterMode('mes')}
            className={`p-4 rounded-2xl border transition-all cursor-pointer relative ${
              dateFilterMode === 'mes'
                ? 'bg-slate-800/90 text-white border-amber-400/80 shadow-md ring-1 ring-amber-400/30'
                : 'bg-slate-800/40 hover:bg-slate-800/70 text-slate-200 border-slate-700/60'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <div className="truncate">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 block">
                  Venta Mes (Calendario)
                </span>
                <span className="text-[10px] text-slate-400 font-medium block truncate">
                  {monthLabel}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Caja Box Dropdown de Mes integrado en la tarjeta */}
                <select
                  id="card-month-select-box"
                  value={selectedMonthRange.monthIndex}
                  onChange={(e) => handleSelectMonthIndex(Number(e.target.value))}
                  className="bg-slate-800 text-white text-[11px] font-bold px-2 py-1 rounded-lg border border-slate-700 cursor-pointer focus:outline-none"
                  title="Seleccionar mes del año"
                >
                  {MONTHS_SPANISH.map(m => (
                    <option key={m.index} value={m.index} className="bg-slate-900 text-white">
                      {m.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handlePrevMonth}
                  title="Mes anterior"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  title="Mes siguiente"
                  className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-white tabular-nums">
              ${monthTotal.toLocaleString('es-MX')}.00
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums mt-2 pt-2 border-t border-slate-700/60 text-slate-300">
              <span className="text-emerald-400 font-semibold">💵 ${monthCash}</span>
              <span className="text-sky-400 font-semibold">💳 ${monthCard}</span>
              <span>Prom: ${monthAvgDaily}/día</span>
              <span className="text-slate-400 font-medium">{monthTickets.length} tks</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. DATE & TIME PERIOD FILTER BAR */}
      <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-200/80 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Segmented Filter Control */}
          <div className="flex items-center flex-wrap bg-slate-100 p-1 rounded-xl gap-1">
            <button
              id="date-filter-dia-btn"
              type="button"
              onClick={() => setDateFilterMode('dia')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'dia' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Por Día
            </button>
            <button
              id="date-filter-hoy-btn"
              type="button"
              onClick={() => {
                setSelectedDate(todayStr);
                setDateFilterMode('hoy');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'hoy' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hoy ({todayTickets.length})
            </button>
            <button
              id="date-filter-ayer-btn"
              type="button"
              onClick={() => {
                setSelectedDate(yesterdayStr);
                setDateFilterMode('ayer');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'ayer' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ayer
            </button>
            <button
              id="date-filter-semana-btn"
              type="button"
              onClick={() => setDateFilterMode('semana')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'semana' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semana (Lun-Dom)
            </button>
            <button
              id="date-filter-mes-btn"
              type="button"
              onClick={() => setDateFilterMode('mes')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'mes' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 Por Mes (Enero, Feb, Mar...)
            </button>
            <button
              id="date-filter-rango-btn"
              type="button"
              onClick={() => setDateFilterMode('rango')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'rango' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Rango Personalizado
            </button>
            <button
              id="date-filter-todos-btn"
              type="button"
              onClick={() => setDateFilterMode('todos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                dateFilterMode === 'todos' ? 'bg-white text-slate-900 shadow-xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todo el Historial
            </button>
          </div>

          {/* Search Input */}
          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar cliente, folio, teléfono..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 rounded-xl text-xs border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 font-medium"
              />
            </div>
          </div>
        </div>

        {/* CONTROLES ESPECÍFICOS SEGÚN EL MODO ACTIVO */}
        {(dateFilterMode === 'dia' || dateFilterMode === 'hoy' || dateFilterMode === 'ayer') && (
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevDay}
                className="p-1.5 bg-white hover:bg-slate-100 rounded-lg text-slate-700 font-semibold border border-slate-200 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                title="Día con ventas anterior"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Anterior</span>
              </button>

              <div className="flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                <span className="text-xs font-bold text-slate-700">Día:</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setDateFilterMode('dia');
                  }}
                  className="bg-transparent text-xs font-semibold text-slate-900 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleNextDay}
                className="p-1.5 bg-white hover:bg-slate-100 rounded-lg text-slate-700 font-semibold border border-slate-200 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                title="Día con ventas siguiente"
              >
                <span className="hidden sm:inline">Siguiente</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Chips de acceso rápido */}
            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                Fechas con ventas:
              </span>
              {availableSaleDates.map((dateStr) => {
                const daySales = tickets.filter(t => getTicketDate(t) === dateStr);
                const dayTotal = daySales.reduce((s, t) => s + t.total, 0);
                const isSelected = selectedDate === dateStr && (dateFilterMode === 'dia' || dateFilterMode === 'hoy' || dateFilterMode === 'ayer');
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => {
                      setSelectedDate(dateStr);
                      setDateFilterMode('dia');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 cursor-pointer border ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <span>{dateStr === todayStr ? 'Hoy' : dateStr === yesterdayStr ? 'Ayer' : dateStr}</span>
                    <span className={`ml-1 text-[10px] font-mono tabular-nums ${isSelected ? 'text-amber-300' : 'text-slate-500'}`}>
                      (${dayTotal})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {dateFilterMode === 'rango' && (
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex flex-wrap items-center gap-3 text-xs">
            <span className="font-bold text-slate-700">Rango de Fechas:</span>
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200">
              <span className="text-slate-500">Desde:</span>
              <input 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)}
                className="font-semibold text-slate-800 bg-transparent focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200">
              <span className="text-slate-500">Hasta:</span>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)}
                className="font-semibold text-slate-800 bg-transparent focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* CONTROLES ESPECÍFICOS PARA MODO MES: SELECTOR CAJA BOX (ENERO, FEBRERO, MARZO...) */}
        {dateFilterMode === 'mes' && (
          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200/80 flex flex-col gap-3 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-amber-600" />
                  <span>Caja Box de Meses:</span>
                </span>

                {/* Dropdown Select de Mes (Enero, Febrero, Marzo, etc.) */}
                <div className="relative">
                  <select
                    id="month-select-box"
                    value={selectedMonthRange.monthIndex}
                    onChange={(e) => handleSelectMonthIndex(Number(e.target.value))}
                    className="bg-white border-2 border-slate-300 hover:border-slate-400 focus:border-amber-600 text-slate-900 font-bold text-xs py-2 px-3 pr-8 rounded-xl shadow-xs cursor-pointer focus:outline-none transition-colors"
                  >
                    {MONTHS_SPANISH.map(m => (
                      <option key={m.index} value={m.index}>
                        {m.name} ({m.short})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Dropdown Select de Año */}
                <div className="relative">
                  <select
                    id="year-select-box"
                    value={selectedMonthRange.year}
                    onChange={(e) => handleSelectYear(Number(e.target.value))}
                    className="bg-white border-2 border-slate-300 hover:border-slate-400 focus:border-amber-600 text-slate-900 font-bold text-xs py-2 px-3 pr-8 rounded-xl shadow-xs cursor-pointer focus:outline-none transition-colors"
                  >
                    {availableYears.map(yr => (
                      <option key={yr} value={yr}>
                        Año {yr}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Flechas de navegación */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="p-2 bg-white hover:bg-slate-100 rounded-xl text-slate-700 font-semibold border border-slate-200 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    title="Mes anterior"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Anterior</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleNextMonth}
                    className="p-2 bg-white hover:bg-slate-100 rounded-xl text-slate-700 font-semibold border border-slate-200 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                    title="Mes siguiente"
                  >
                    <span className="hidden sm:inline">Siguiente</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Indicador de ventas del mes activo */}
              <div className="text-xs font-semibold text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-200 font-mono tabular-nums">
                Ventas de {MONTHS_SPANISH[selectedMonthRange.monthIndex].name} {selectedMonthRange.year}: <strong className="text-slate-900 font-bold">${monthTotal.toLocaleString('es-MX')}.00</strong> ({monthTickets.length} tickets)
              </div>
            </div>

            {/* Cuadrícula interactiva de los 12 Meses (Enero a Diciembre) */}
            <div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Selecciona cualquier mes con un toque directo:
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-1.5">
                {MONTHS_SPANISH.map(m => {
                  const isSelected = selectedMonthRange.monthIndex === m.index;
                  const monthTicketsCount = tickets.filter(t => {
                    const d = getTicketDate(t);
                    const [y, mon] = d.split('-').map(Number);
                    return y === selectedMonthRange.year && mon === (m.index + 1);
                  }).length;
                  const hasSales = monthTicketsCount > 0;

                  return (
                    <button
                      key={m.index}
                      type="button"
                      id={`month-chip-btn-${m.name.toLowerCase()}`}
                      onClick={() => handleSelectMonthIndex(m.index)}
                      className={`p-2 rounded-xl text-center transition-all cursor-pointer border flex flex-col items-center justify-center ${
                        isSelected
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs ring-2 ring-amber-400/40'
                          : hasSales
                          ? 'bg-white hover:bg-amber-50/60 text-slate-900 border-amber-300 shadow-2xs font-bold'
                          : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      <span className="text-xs font-bold leading-tight">{m.name}</span>
                      <span className={`text-[10px] font-mono tabular-nums mt-0.5 ${
                        isSelected ? 'text-amber-300' : hasSales ? 'text-emerald-700 font-semibold' : 'text-slate-400'
                      }`}>
                        {hasSales ? `${monthTicketsCount} tks` : '0 tks'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 4. MACRO METRIC KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* KPI 1: Total Mostrador */}
        <div 
          onClick={() => {
            setActiveModule('corte_caja');
            setShiftFilter('todos');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white ${
            activeModule === 'corte_caja' && shiftFilter === 'todos'
              ? 'border-slate-900 shadow-xs ring-1 ring-slate-900'
              : 'border-slate-200/80 hover:border-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-bold uppercase tracking-wider">Total Mostrador</span>
            <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
              T1 + T2
            </span>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-slate-900 tabular-nums">
            ${mostradorTotal.toLocaleString('es-MX')}.00
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span className="text-emerald-700 font-semibold">💵 ${mostradorCash}</span>
            <span className="text-sky-700 font-semibold">💳 ${mostradorCard}</span>
            <span>{filteredTickets.length} ventas</span>
          </div>
        </div>

        {/* KPI 2: Turno 1 Matutino */}
        <div 
          onClick={() => {
            setActiveModule('corte_caja');
            setShiftFilter(shiftFilter === 'turno1' ? 'todos' : 'turno1');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white ${
            activeModule === 'corte_caja' && shiftFilter === 'turno1'
              ? 'border-amber-600 shadow-xs ring-1 ring-amber-500'
              : 'border-slate-200/80 hover:border-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-bold uppercase tracking-wider text-amber-800">Turno 1 Matutino</span>
            <span className="text-[10px] font-semibold bg-amber-50 text-amber-800 px-2 py-0.5 rounded-md border border-amber-200">
              00:01 - 15:00
            </span>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-slate-900 tabular-nums">
            ${turno1Total.toLocaleString('es-MX')}.00
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span className="text-emerald-700 font-semibold">💵 ${turno1Cash}</span>
            <span className="text-sky-700 font-semibold">💳 ${turno1Card}</span>
            <span>{turno1Tickets.length} ventas</span>
          </div>
        </div>

        {/* KPI 3: Turno 2 Vespertino y Noche */}
        <div 
          onClick={() => {
            setActiveModule('corte_caja');
            setShiftFilter(shiftFilter === 'turno2' ? 'todos' : 'turno2');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white ${
            activeModule === 'corte_caja' && shiftFilter === 'turno2'
              ? 'border-indigo-600 shadow-xs ring-1 ring-indigo-500'
              : 'border-slate-200/80 hover:border-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-bold uppercase tracking-wider text-indigo-800">Turno 2 Tarde / Noche</span>
            <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-md border border-indigo-200">
              15:01 - 23:59 (11:59 PM)
            </span>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-slate-900 tabular-nums">
            ${turno2Total.toLocaleString('es-MX')}.00
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span className="text-emerald-700 font-semibold">💵 ${turno2Cash}</span>
            <span className="text-sky-700 font-semibold">💳 ${turno2Card}</span>
            <span>{turno2Tickets.length} ventas</span>
          </div>
        </div>

        {/* KPI 4: Piezas y Métodos */}
        <div 
          onClick={() => {
            setActiveModule('corte_caja');
            setPaymentFilter(paymentFilter === 'tarjeta' ? 'todos' : 'tarjeta');
          }}
          className={`p-4 rounded-2xl border transition-all cursor-pointer bg-white ${
            paymentFilter !== 'todos'
              ? 'border-sky-600 shadow-xs ring-1 ring-sky-500'
              : 'border-slate-200/80 hover:border-slate-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-bold uppercase tracking-wider">Efectivo vs Tarjeta</span>
            <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
              {mostradorPieces} piezas
            </span>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-slate-900 tabular-nums">
            ${mostradorTotal.toLocaleString('es-MX')}.00
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span className="text-emerald-700 font-semibold">💵 ${mostradorCash}</span>
            <span className="text-sky-700 font-semibold">💳 ${mostradorCard}</span>
            <span className="text-slate-400 font-medium">100% Mostrador</span>
          </div>
        </div>
      </div>

      {/* 5. DESGLOSE DÍA POR DÍA (CONTEO DE FECHAS REALES) */}
      {dailyBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 mb-3 gap-2 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Conteo Real Día por Día ({dailyBreakdown.length} {dailyBreakdown.length === 1 ? 'fecha' : 'fechas'} con ventas)
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Toca cualquier día para consultar sus tickets y cortes oficiales
              </p>
            </div>
            <div className="text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1 rounded-xl">
              Total Acumulado: ${mostradorTotal.toLocaleString('es-MX')}.00 ({filteredTickets.length} tickets)
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {dailyBreakdown.map(day => {
              const isSelectedDay = selectedDate === day.date && (dateFilterMode === 'dia' || dateFilterMode === 'hoy' || dateFilterMode === 'ayer');
              return (
                <div 
                  key={day.date} 
                  onClick={() => {
                    setSelectedDate(day.date);
                    setDateFilterMode('dia');
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelectedDay
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-slate-50/70 hover:bg-slate-100 text-slate-800 border-slate-200/80'
                  }`}
                  title={`Ver ventas del día ${day.date}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">
                      {day.date === todayStr ? 'Hoy' : day.date === yesterdayStr ? 'Ayer' : day.date}
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.2 rounded-md ${
                      isSelectedDay ? 'bg-slate-800 text-amber-300' : 'bg-white text-slate-600 border border-slate-200'
                    }`}>
                      {day.ticketsCount} tks
                    </span>
                  </div>
                  <div className="text-lg font-black font-mono tracking-tight mt-1 tabular-nums">
                    ${day.total.toLocaleString('es-MX')}.00
                  </div>
                  <div className={`flex items-center justify-between text-[10px] font-mono tabular-nums mt-1 pt-1 border-t ${
                    isSelectedDay ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-500'
                  }`}>
                    <span className="text-emerald-500 font-semibold">💵 ${day.cash}</span>
                    <span className="text-sky-400 font-semibold">💳 ${day.card}</span>
                    <span>🥖 {day.pieces} pzs</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. MAIN SUB-NAVIGATION MODULE SELECTOR */}
      <div className="flex items-center overflow-x-auto gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200/80">
        <button
          id="module-tab-corte-btn"
          type="button"
          onClick={() => setActiveModule('corte_caja')}
          className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeModule === 'corte_caja'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Receipt className="w-4 h-4 text-amber-400" />
          <span>1. Corte de Caja y Turnos ({filteredTickets.length})</span>
        </button>

        <button
          id="module-tab-tienda-btn"
          type="button"
          onClick={() => setActiveModule('pedidos_tienda')}
          className={`flex-1 min-w-[180px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeModule === 'pedidos_tienda'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white hover:bg-slate-50 text-slate-700'
          }`}
        >
          <ShoppingBag className="w-4 h-4 text-purple-400" />
          <span>2. Pide y Recoge Tienda ({storePickupOrders.length})</span>
        </button>

        <button
          id="module-tab-por-cobrar-btn"
          type="button"
          onClick={() => setActiveModule('por_cobrar')}
          className={`flex-1 min-w-[180px] py-2.5 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
            activeModule === 'por_cobrar'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-white hover:bg-slate-50 text-slate-700'
          }`}
        >
          <Clock className="w-4 h-4 text-rose-400" />
          <span>3. Pendientes por Cobrar (${totalGlobalPending})</span>
          {countPendingOrders > 0 && (
            <span className="bg-rose-100 text-rose-800 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {countPendingOrders}
            </span>
          )}
        </button>
      </div>

      {/* MODULE 1: CORTE DE CAJA / MOSTRADOR (TURNO 1 Y TURNO 2) */}
      {activeModule === 'corte_caja' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          
          {/* Turno 1 y Turno 2 Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CORTE TURNO 1 */}
            <div className={`bg-white rounded-2xl sm:rounded-3xl p-5 border transition-all ${
              shiftFilter === 'turno1' ? 'border-amber-600 ring-1 ring-amber-500 shadow-xs' : 'border-slate-200/80'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center border border-amber-200">
                    <Sun className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-sm text-slate-900">
                        Turno 1 - Matutino
                      </h3>
                      <span className="bg-amber-50 text-amber-800 font-semibold text-[10px] px-2 py-0.5 rounded-full border border-amber-200">
                        00:01 AM - 15:00 hrs
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {turno1Tickets.length} tickets emitidos
                    </p>
                  </div>
                </div>

                <button
                  id="print-shift1-btn"
                  type="button"
                  onClick={() => handlePrintCut('turno1')}
                  className="bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-semibold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-slate-800"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  <span>Imprimir T1</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3">
                <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Total Venta</div>
                  <div className="text-lg font-black font-mono tracking-tight text-slate-900 mt-0.5 tabular-nums">
                    ${turno1Total}.00
                  </div>
                </div>
                <div className="bg-emerald-50/50 rounded-xl p-2.5 border border-emerald-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-emerald-800">Efectivo</div>
                  <div className="text-lg font-black font-mono tracking-tight text-emerald-700 mt-0.5 tabular-nums">
                    ${turno1Cash}.00
                  </div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-2.5 border border-sky-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-sky-800">Tarjeta</div>
                  <div className="text-lg font-black font-mono tracking-tight text-sky-700 mt-0.5 tabular-nums">
                    ${turno1Card}.00
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs font-semibold">
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-slate-800 font-mono tabular-nums">
                  <span>🍞 Pan ({turno1Breakdown.breadPieces} pzs)</span>
                  <span className="font-bold">${turno1Breakdown.breadTotal}.00</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-slate-800 font-mono tabular-nums">
                  <span>🥛 Otros ({turno1Breakdown.nonBreadPieces} arts)</span>
                  <span className="font-bold">${turno1Breakdown.nonBreadTotal}.00</span>
                </div>
              </div>
            </div>

            {/* CORTE TURNO 2 */}
            <div className={`bg-white rounded-2xl sm:rounded-3xl p-5 border transition-all ${
              shiftFilter === 'turno2' ? 'border-indigo-600 ring-1 ring-indigo-500 shadow-xs' : 'border-slate-200/80'
            }`}>
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-200">
                    <Moon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-sm text-slate-900">
                        Turno 2 - Vespertino y Noche
                      </h3>
                      <span className="bg-indigo-50 text-indigo-800 font-semibold text-[10px] px-2 py-0.5 rounded-full border border-indigo-200">
                        15:01 a 23:59 hrs (11:59 PM)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium">
                      {turno2Tickets.length} tickets emitidos
                    </p>
                  </div>
                </div>

                <button
                  id="print-shift2-btn"
                  type="button"
                  onClick={() => handlePrintCut('turno2')}
                  className="bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-semibold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1.5 transition-all cursor-pointer border border-slate-800"
                >
                  <Printer className="w-3.5 h-3.5 text-amber-400" />
                  <span>Imprimir T2</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3">
                <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-slate-500">Total Venta</div>
                  <div className="text-lg font-black font-mono tracking-tight text-slate-900 mt-0.5 tabular-nums">
                    ${turno2Total}.00
                  </div>
                </div>
                <div className="bg-emerald-50/50 rounded-xl p-2.5 border border-emerald-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-emerald-800">Efectivo</div>
                  <div className="text-lg font-black font-mono tracking-tight text-emerald-700 mt-0.5 tabular-nums">
                    ${turno2Cash}.00
                  </div>
                </div>
                <div className="bg-sky-50/50 rounded-xl p-2.5 border border-sky-200 text-center">
                  <div className="text-[10px] font-bold uppercase text-sky-800">Tarjeta</div>
                  <div className="text-lg font-black font-mono tracking-tight text-sky-700 mt-0.5 tabular-nums">
                    ${turno2Card}.00
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs font-semibold">
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-slate-800 font-mono tabular-nums">
                  <span>🍞 Pan ({turno2Breakdown.breadPieces} pzs)</span>
                  <span className="font-bold">${turno2Breakdown.breadTotal}.00</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-slate-800 font-mono tabular-nums">
                  <span>🥛 Otros ({turno2Breakdown.nonBreadPieces} arts)</span>
                  <span className="font-bold">${turno2Breakdown.nonBreadTotal}.00</span>
                </div>
              </div>
            </div>
          </div>

          {/* CORTES DE CAJA OFICIALES GUARDADOS */}
          {relevantHistoricalCuts.length > 0 && (
            <div className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-xs border border-slate-200/80">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 mb-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-slate-700" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Cortes Oficiales Guardados ({relevantHistoricalCuts.length} registrados)
                    </h3>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Historial permanente de cierres de caja y arqueos efectuados (00:01 a 23:59 hrs)
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 font-mono tabular-nums">
                  Total en Cortes: ${relevantHistoricalCuts.reduce((s, c) => s + (c.totalGrossSales || 0), 0)}.00
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {relevantHistoricalCuts.map((cut) => (
                  <div key={cut.id} className="p-3.5 rounded-2xl bg-slate-50/60 border border-slate-200 flex flex-col justify-between gap-2 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold font-mono text-slate-900">{cut.folio}</span>
                      <span className="text-[10px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                        {cut.date} • {cut.time}
                      </span>
                    </div>

                    <div>
                      <div className="text-xs font-bold text-slate-900">{cut.shiftName}</div>
                      <div className="text-[11px] text-slate-500 font-medium">Cajero: <strong>{cut.cashierName}</strong></div>
                    </div>

                    <div className="text-xl font-black font-mono text-slate-900 tabular-nums">
                      ${cut.totalGrossSales || 0}.00
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-[10px] font-mono tabular-nums text-slate-600 pt-1 border-t border-slate-200">
                      <span>💵 Efec: ${cut.totalCashSales || 0}</span>
                      <span>💳 Tarj: ${cut.totalCardSales || 0}</span>
                      <span>🥖 {cut.totalPieces || 0} pzs</span>
                      <span>🎟️ {cut.ticketsCount || 0} tickets</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShiftCutToPreview(cut)}
                      className="w-full mt-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-1.5 px-3 rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Ver / Reimprimir Corte</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-Filters: Turno y Método de Pago */}
          <div className="bg-white rounded-2xl p-3 shadow-xs border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Turno:</span>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                <button
                  id="shift-filter-all-btn"
                  onClick={() => setShiftFilter('todos')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    shiftFilter === 'todos' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ambos Turnos
                </button>
                <button
                  id="shift-filter-t1-btn"
                  onClick={() => setShiftFilter('turno1')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    shiftFilter === 'turno1' ? 'bg-amber-100 text-amber-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Turno 1</span>
                </button>
                <button
                  id="shift-filter-t2-btn"
                  onClick={() => setShiftFilter('turno2')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    shiftFilter === 'turno2' ? 'bg-indigo-100 text-indigo-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Turno 2</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">Pago:</span>
              <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                <button
                  onClick={() => setPaymentFilter('todos')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    paymentFilter === 'todos' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos
                </button>
                <button
                  onClick={() => setPaymentFilter('efectivo')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    paymentFilter === 'efectivo' ? 'bg-emerald-100 text-emerald-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  💵 Efectivo
                </button>
                <button
                  onClick={() => setPaymentFilter('tarjeta')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    paymentFilter === 'tarjeta' ? 'bg-sky-100 text-sky-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  💳 Tarjeta
                </button>
              </div>
            </div>
          </div>

          {/* Tickets Table */}
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-slate-200/80 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Receipt className="w-4 h-4 text-slate-700" />
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Listado de Tickets de Mostrador ({filteredTickets.length})
                </h2>
              </div>
              <span className="text-xs text-slate-600 font-mono tabular-nums">
                Total: <strong className="text-slate-900 font-bold">${mostradorTotal}.00</strong> ({mostradorPieces} pzs)
              </span>
            </div>

            {/* Mobile View */}
            <div className="sm:hidden divide-y divide-slate-100 p-2">
              {filteredTickets.length === 0 ? (
                <div className="py-8 text-center text-slate-400 font-semibold text-xs">
                  No se encontraron tickets con los filtros seleccionados
                </div>
              ) : (
                filteredTickets.map((ticket) => {
                  const shift = getTicketShift(ticket);
                  return (
                    <div key={ticket.id} className="p-3 hover:bg-slate-50 rounded-xl transition-colors flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-slate-900">{ticket.folio}</span>
                        <span className="font-black font-mono text-base text-slate-900 tabular-nums">${ticket.total}.00</span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-medium">{ticket.time} • {shift === 'turno1' ? 'T1 (00:01-15:00)' : 'T2 (15:01-23:59)'}</span>
                        <span className={`font-semibold ${ticket.paymentMethod === 'tarjeta' ? 'text-sky-700' : 'text-emerald-700'}`}>
                          {ticket.paymentMethod === 'tarjeta' ? '💳 Tarjeta' : '💵 Efectivo'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span className="truncate max-w-[180px]">{ticket.customerName || 'Público en Mostrador'}</span>
                        <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                          {ticket.items.reduce((s, i) => s + i.quantity, 0)} pzs pan
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={() => setTicketToView(ticket)}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold px-2.5 py-1 rounded-lg text-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Ver Ticket</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDeleteModal(ticket)}
                          className="bg-rose-50 text-rose-700 font-semibold p-1.5 rounded-lg text-xs hover:bg-rose-100 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200/80">
                  <tr>
                    <th className="py-3 px-4">Folio</th>
                    <th className="py-3 px-3">Hora & Turno</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-3">Piezas / Desglose</th>
                    <th className="py-3 px-3">Método</th>
                    <th className="py-3 px-3 text-right">Puntos</th>
                    <th className="py-3 px-4 text-right">Total Cobrado</th>
                    <th className="py-3 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredTickets.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400 font-semibold">
                        No se encontraron tickets con los filtros seleccionados
                      </td>
                    </tr>
                  ) : (
                    filteredTickets.map((ticket) => {
                      const shift = getTicketShift(ticket);
                      return (
                        <tr key={ticket.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {ticket.folio}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-800">{ticket.time}</div>
                            <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.2 rounded mt-0.5 ${
                              shift === 'turno1' 
                                ? 'bg-amber-50 text-amber-900 border border-amber-200' 
                                : 'bg-indigo-50 text-indigo-900 border border-indigo-200'
                            }`}>
                              {shift === 'turno1' ? 'T1 (00:01-15:00)' : 'T2 (15:01-23:59)'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {ticket.customerName ? (
                              <div>
                                <strong className="text-slate-900 block font-semibold">{ticket.customerName}</strong>
                                {ticket.customerPhone && (
                                  <span className="text-[10px] text-slate-500 font-mono">{ticket.customerPhone}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">Público en Mostrador</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className="bg-slate-100 text-slate-800 font-semibold px-2 py-0.5 rounded text-[11px] font-mono tabular-nums">
                              {ticket.items.reduce((s, i) => s + i.quantity, 0)} pzs
                            </span>
                            <span className="text-slate-500 text-[10.5px] ml-1.5 truncate max-w-[150px] inline-block align-middle">
                              ({ticket.items.map(i => `${i.quantity}x$${i.price}`).join(', ')})
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            {ticket.paymentMethod === 'efectivo' ? (
                              <span className="bg-emerald-50 text-emerald-800 font-semibold px-2 py-0.5 rounded-full border border-emerald-200 text-[10px]">
                                💵 Efectivo
                              </span>
                            ) : (
                              <span className="bg-sky-50 text-sky-800 font-semibold px-2 py-0.5 rounded-full border border-sky-200 text-[10px]">
                                💳 Tarjeta
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 font-semibold">
                            +{ticket.pointsEarned} pts
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-bold text-sm text-slate-900 font-mono tabular-nums">
                              ${ticket.total}.00
                            </span>
                            {ticket.discount > 0 && (
                              <span className="text-[10px] text-emerald-700 font-semibold block font-mono tabular-nums">
                                Desc: -${ticket.discount}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setTicketToView(ticket)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1 rounded-lg text-xs transition-colors inline-flex items-center gap-1 cursor-pointer border border-slate-200"
                                title="Ver / Reimprimir Ticket"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Ver</span>
                              </button>

                              <button
                                onClick={() => handleOpenDeleteModal(ticket)}
                                className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold p-1 rounded-lg text-xs transition-colors inline-flex items-center justify-center cursor-pointer border border-rose-200"
                                title="Eliminar venta (Requiere PIN de administrador)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODULE 2: PEDIDOS PIDE Y RECOGE */}
      {activeModule === 'pedidos_tienda' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 text-white rounded-2xl sm:rounded-3xl p-5 shadow-xs border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center text-xl">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Pedidos Pide y Recoge (Tienda)</h3>
                <p className="text-xs text-slate-400 font-medium">
                  {storePickupOrders.length} pedidos registrados · {storeOrdersPiecesCount} piezas de pan
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div className="bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700/60 font-mono tabular-nums">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Total Generado</span>
                <p className="text-lg font-bold text-white">${storeOrdersTotalGenerated}.00</p>
              </div>
              <div className="bg-slate-800/80 px-3.5 py-2 rounded-xl border border-slate-700/60 font-mono tabular-nums">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Por Cobrar</span>
                <p className="text-lg font-bold text-rose-400">${storeOrdersTotalPending}.00</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-slate-200/80 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShoppingBag className="w-4 h-4 text-purple-700" />
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Listado de Clientes Pide y Recoge ({filteredStoreOrders.length})
                </h2>
              </div>
              <span className="text-xs text-slate-600 font-mono tabular-nums">
                Pagado: <strong>${storeOrdersTotalCollected}</strong> | Saldo Pendiente: <strong className="text-rose-600">${storeOrdersTotalPending}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200/80">
                  <tr>
                    <th className="py-3 px-4">Folio</th>
                    <th className="py-3 px-4">Cliente / Contacto</th>
                    <th className="py-3 px-3">Fecha & Entrega</th>
                    <th className="py-3 px-3">Piezas</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3 text-right">Anticipo</th>
                    <th className="py-3 px-4 text-right">Saldo Pendiente</th>
                    <th className="py-3 px-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredStoreOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-slate-400 font-semibold">
                        No se encontraron pedidos de tienda para este período
                      </td>
                    </tr>
                  ) : (
                    filteredStoreOrders.map((order) => {
                      const pending = order.pendingAmount > 0 
                        ? order.pendingAmount 
                        : (order.paymentStatus !== 'pagado' ? Math.max(0, order.total - (order.deposit || 0) - (order.collectedAmount || 0)) : 0);

                      return (
                        <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {order.folio}
                          </td>
                          <td className="py-3 px-4">
                            <strong className="text-slate-900 block font-semibold">{order.customerName}</strong>
                            {order.customerPhone && (
                              <span className="text-[10px] text-slate-500 font-mono">{order.customerPhone}</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-800">{order.deliveryDate}</div>
                            <span className="text-[10px] text-slate-500">{order.deliveryTime || 'Mostrador'}</span>
                          </td>
                          <td className="py-3 px-3 font-mono tabular-nums">
                            {order.items.reduce((s, it) => s + it.quantity, 0)} pzs
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                            ${order.total}.00
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                            ${order.deposit || 0}.00
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className={`font-mono tabular-nums font-bold px-2 py-0.5 rounded-md text-xs ${
                              pending > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}>
                              ${pending}.00
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              {pending > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSettleModal(order)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1"
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                  <span>Cobrar</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setOrderToView(order)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold p-1.5 rounded-lg text-xs transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODULE 3: PENDIENTES POR COBRAR */}
      {activeModule === 'por_cobrar' && (
        <div className="space-y-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 text-white rounded-2xl sm:rounded-3xl p-5 shadow-xs border border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/20 text-rose-300 flex items-center justify-center text-xl">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Cuentas Pendientes por Cobrar</h3>
                <p className="text-xs text-slate-400 font-medium">
                  Control de saldos por liquidar en mostrador y pedidos programados
                </p>
              </div>
            </div>

            <div className="bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-right font-mono tabular-nums">
              <span className="text-[10px] uppercase font-semibold text-slate-400">Total Pendiente</span>
              <div className="text-xl font-bold text-rose-400">
                ${totalGlobalPending}.00
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xs border border-slate-200/80 overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-rose-600" />
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 uppercase tracking-wider">
                  Listado de Cuentas por Cobrar ({filteredReceivables.length})
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-600">
                Total por Cobrar: <strong className="text-rose-700">${totalGlobalPending}.00</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-200/80">
                  <tr>
                    <th className="py-3 px-4">Folio</th>
                    <th className="py-3 px-4">Cliente / Contacto</th>
                    <th className="py-3 px-3">Fecha</th>
                    <th className="py-3 px-3 text-right">Total Pedido</th>
                    <th className="py-3 px-3 text-right">Anticipo</th>
                    <th className="py-3 px-4 text-right">Saldo por Cobrar</th>
                    <th className="py-3 px-4 text-center">Acción de Cobro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredReceivables.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 font-semibold">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                          <span className="text-sm font-bold text-slate-700">¡Al día! No hay cuentas pendientes por cobrar</span>
                          <span className="text-xs text-slate-400">Todos los encargos y ventas están liquidados.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredReceivables.map((order) => {
                      const pending = order.pendingAmount > 0 
                        ? order.pendingAmount 
                        : Math.max(0, order.total - (order.deposit || 0) - (order.collectedAmount || 0));

                      return (
                        <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {order.folio}
                          </td>
                          <td className="py-3 px-4">
                            <strong className="text-slate-900 block font-semibold text-xs">{order.customerName}</strong>
                            {order.customerPhone && (
                              <span className="text-[10px] text-slate-500 font-mono block">📞 {order.customerPhone}</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-600">
                            {order.deliveryDate || order.createdAt?.split('T')[0]}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                            ${order.total}.00
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                            ${order.deposit || 0}.00
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span className="font-mono tabular-nums font-bold text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
                              ${pending}.00
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenSettleModal(order)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-3 py-1.5 rounded-xl text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                                <span>Cobrar / Liquidar</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setOrderToView(order)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold p-1.5 rounded-xl text-xs transition-colors cursor-pointer border border-slate-200"
                                title="Ver Ticket"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {/* 1. Ticket Viewer Modal */}
      {ticketToView && (
        <ThermalTicket
          ticket={ticketToView}
          settings={settings}
          onClose={() => setTicketToView(null)}
        />
      )}

      {/* 2. Shift Cut Ticket Modal */}
      {shiftCutToPreview && (
        <ThermalShiftCutTicket
          cut={shiftCutToPreview}
          settings={settings}
          onClose={() => setShiftCutToPreview(null)}
        />
      )}

      {/* 3. Order Viewer Modal */}
      {orderToView && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="w-5 h-5 text-purple-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900">Pedido #{orderToView.folio}</h3>
                  <span className="text-xs text-slate-500 font-medium">{orderToView.deliveryDate} • {orderToView.deliveryTime}</span>
                </div>
              </div>
              <button onClick={() => setOrderToView(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                <div className="text-slate-500 font-medium">Cliente:</div>
                <div className="font-bold text-sm text-slate-900">{orderToView.customerName}</div>
                {orderToView.customerPhone && <div className="text-slate-500 font-mono">{orderToView.customerPhone}</div>}
              </div>

              <div>
                <div className="font-bold text-slate-700 mb-1.5 uppercase text-[10px] tracking-wider">Panes y Artículos:</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {orderToView.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center bg-slate-50 p-2 rounded-lg text-slate-800">
                      <span>{it.quantity}x {it.name}</span>
                      <span className="font-mono font-bold">${it.price * it.quantity}.00</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-sm">
                <span className="text-slate-500 font-medium">Total Pedido:</span>
                <span className="font-bold font-mono text-base text-slate-900">${orderToView.total}.00</span>
              </div>
              <div className="flex justify-between items-center text-xs text-emerald-700 font-mono">
                <span>Anticipo / Pagado:</span>
                <span className="font-bold">${(orderToView.deposit || 0) + (orderToView.collectedAmount || 0)}.00</span>
              </div>
              <div className="flex justify-between items-center text-xs text-rose-700 font-mono font-bold">
                <span>Saldo Pendiente:</span>
                <span>${orderToView.pendingAmount > 0 ? orderToView.pendingAmount : Math.max(0, orderToView.total - (orderToView.deposit || 0) - (orderToView.collectedAmount || 0))}.00</span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  printOrderTicketDirectToPrinter(orderToView, settings);
                }}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>Reimprimir Ticket</span>
              </button>
              <button
                type="button"
                onClick={() => setOrderToView(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Settle / Cobro Modal */}
      {orderToSettle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900">Cobrar Saldo Pedido</h3>
                  <span className="text-xs text-slate-500 font-mono font-semibold">#{orderToSettle.folio} • {orderToSettle.customerName}</span>
                </div>
              </div>
              <button onClick={() => setOrderToSettle(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-500">Total del Pedido:</span>
                <span className="font-bold font-mono">${orderToSettle.total}.00</span>
              </div>
              <div className="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <span className="text-slate-500">Anticipo Pagado:</span>
                <span className="font-bold font-mono text-emerald-700">${orderToSettle.deposit || 0}.00</span>
              </div>
              <div className="flex justify-between items-center bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                <span className="text-rose-800 font-semibold">Saldo Pendiente a Cobrar:</span>
                <span className="font-bold font-mono text-rose-700">${orderToSettle.pendingAmount > 0 ? orderToSettle.pendingAmount : Math.max(0, orderToSettle.total - (orderToSettle.deposit || 0) - (orderToSettle.collectedAmount || 0))}.00</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Monto a Cobrar ($):
                </label>
                <input
                  type="number"
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 rounded-xl text-base font-black font-mono border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-900"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Método de Pago:
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['efectivo', 'tarjeta', 'transferencia'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSettleMethod(m)}
                      className={`p-2 rounded-xl text-xs font-semibold capitalize transition-all border ${
                        settleMethod === m ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nota / Referencia:
                </label>
                <input
                  type="text"
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  placeholder="Ej. Liquidado en mostrador tarde"
                  className="w-full p-2 bg-slate-50 rounded-xl text-xs border border-slate-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={handleConfirmSettleOrder}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition-colors shadow-xs"
              >
                Confirmar Cobro
              </button>
              <button
                type="button"
                onClick={() => setOrderToSettle(null)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Delete Ticket PIN Modal (Clave 13579) */}
      {ticketToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-sm w-full border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Eliminar Venta de Caja</h3>
                <span className="text-xs text-slate-500 font-mono font-semibold">Folio #{ticketToDelete.folio} (${ticketToDelete.total}.00)</span>
              </div>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <p className="text-slate-600 font-medium">
                Esta acción elimina el ticket de la caja y del arqueo del día. Requiere clave de administrador:
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Clave de Administrador:
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    autoFocus
                    value={adminPinInput}
                    onChange={(e) => {
                      setAdminPinInput(e.target.value);
                      setPinError('');
                    }}
                    placeholder="Ingresa clave 13579..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-xl text-sm font-mono border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                {pinError && <p className="text-rose-600 font-semibold text-[11px] mt-1.5">{pinError}</p>}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 px-3 rounded-xl text-xs transition-colors shadow-xs"
              >
                Confirmar Eliminación
              </button>
              <button
                type="button"
                onClick={() => {
                  setTicketToDelete(null);
                  setAdminPinInput('');
                  setPinError('');
                }}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
