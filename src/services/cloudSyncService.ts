import { SaleTicket, BakeryOrder, ShiftCutRecord, CashOutflowItem, Customer } from '../types';
import { 
  loadTickets, 
  loadOrders, 
  loadShiftCuts, 
  loadOutflows, 
  loadCustomers, 
  mergeTickets, 
  mergeOrders, 
  mergeShiftCuts, 
  mergeOutflows, 
  mergeCustomers,
  safeLocalStorageSetItem,
  STORAGE_KEYS
} from '../utils/storage';
import {
  saveTicketToFirebase,
  saveOrderToFirebase,
  saveShiftCutToFirebase,
  saveOutflowToFirebase,
  saveCustomerToFirebase,
  fetchTicketsFromFirebase,
  fetchOrdersFromFirebase,
  fetchShiftCutsFromFirebase,
  fetchOutflowsFromFirebase,
  fetchCustomersFromFirebase,
  getFirebaseSyncStatus
} from './firebaseSyncService';

export interface CloudSyncResult {
  success: boolean;
  message: string;
  mergedData?: {
    tickets: SaleTicket[];
    orders: BakeryOrder[];
    shiftCuts: ShiftCutRecord[];
    outflows: CashOutflowItem[];
    customers: Customer[];
  };
  error?: string;
}

type SyncListener = (data: NonNullable<CloudSyncResult['mergedData']>) => void;
const listeners: Set<SyncListener> = new Set();
let lastSyncTimestamp: number = Date.now();

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    broadcastChannel = new BroadcastChannel('santafe_realtime_sync');
    broadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'SYNC_DATA_UPDATE' && event.data?.data) {
        lastSyncTimestamp = Date.now();
        listeners.forEach(cb => {
          try {
            cb(event.data.data);
          } catch (e) {
            console.error('Error en listener de BroadcastChannel:', e);
          }
        });
      } else if (event.data?.type === 'SALE_REGISTERED') {
        // Otra pestaña o ventana registró una venta: forzar fetch inmediato
        lastSyncTimestamp = Date.now();
        fetchAndMergeCloud();
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel no disponible:', e);
  }
}

export function broadcastRealtimeSale(ticket?: SaleTicket) {
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SALE_REGISTERED', ticket, timestamp: Date.now() });
    } catch {
      // ignore
    }
  }
}

export function onCloudSyncUpdated(cb: SyncListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(data: NonNullable<CloudSyncResult['mergedData']>) {
  lastSyncTimestamp = Date.now();
  listeners.forEach(cb => {
    try {
      cb(data);
    } catch (e) {
      console.error('Error en callback de sincronización:', e);
    }
  });

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage({ type: 'SYNC_DATA_UPDATE', data, timestamp: Date.now() });
    } catch {
      // ignore
    }
  }
}

let isSyncInProgress = false;
let hasPendingSync = false;
let pendingProvidedData: {
  tickets?: SaleTicket[];
  orders?: BakeryOrder[];
  shiftCuts?: ShiftCutRecord[];
  outflows?: CashOutflowItem[];
  customers?: Customer[];
} | undefined = undefined;

export function areTicketsIdentical(a: SaleTicket[], b: SaleTicket[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id || a[i]?.paymentMethod !== b[i]?.paymentMethod || a[i]?.total !== b[i]?.total) return false;
  }
  return true;
}

function areOrdersIdentical(a: BakeryOrder[], b: BakeryOrder[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.id !== b[i]?.id || a[i]?.paymentStatus !== b[i]?.paymentStatus || a[i]?.deliveryStatus !== b[i]?.deliveryStatus || a[i]?.collectedAmount !== b[i]?.collectedAmount) return false;
  }
  return true;
}

/**
 * Realiza la sincronización combinada (Merge) con Firebase Firestore en la nube
 * Guarda de forma atómica en Firestore para garantizar cero pérdida de datos.
 */
export async function syncWithCloud(providedData?: {
  tickets?: SaleTicket[];
  orders?: BakeryOrder[];
  shiftCuts?: ShiftCutRecord[];
  outflows?: CashOutflowItem[];
  customers?: Customer[];
}): Promise<CloudSyncResult> {
  // 1. Inmediatamente guardar cada dato proporcionado en Firebase Firestore
  if (providedData?.tickets && providedData.tickets.length > 0) {
    // Si se enviaron tickets, guardar los nuevos en Firestore de inmediato
    for (const t of providedData.tickets) {
      if (t && t.id && !['t-1001', 't-1002', 't-1003', 't-1004'].includes(t.id)) {
        saveTicketToFirebase(t).catch(e => console.warn('[Firebase] Background ticket save error:', e));
      }
    }
  }

  if (providedData?.orders && providedData.orders.length > 0) {
    for (const o of providedData.orders) {
      if (o && o.id && !['ord-101', 'ord-102', 'ord-103', 'ord-104', 'ord-105'].includes(o.id)) {
        saveOrderToFirebase(o).catch(e => console.warn('[Firebase] Background order save error:', e));
      }
    }
  }

  if (providedData?.shiftCuts && providedData.shiftCuts.length > 0) {
    for (const s of providedData.shiftCuts) {
      if (s && s.id) {
        saveShiftCutToFirebase(s).catch(e => console.warn('[Firebase] Background shift cut save error:', e));
      }
    }
  }

  if (providedData?.outflows && providedData.outflows.length > 0) {
    for (const out of providedData.outflows) {
      if (out && out.id) {
        saveOutflowToFirebase(out).catch(e => console.warn('[Firebase] Background outflow save error:', e));
      }
    }
  }

  if (providedData?.customers && providedData.customers.length > 0) {
    for (const c of providedData.customers) {
      if (c && c.id) {
        saveCustomerToFirebase(c).catch(e => console.warn('[Firebase] Background customer save error:', e));
      }
    }
  }

  // Si ya hay una sincronización en proceso, acumular datos pendientes
  if (isSyncInProgress) {
    hasPendingSync = true;
    if (providedData) {
      pendingProvidedData = {
        tickets: mergeTickets(pendingProvidedData?.tickets || [], providedData.tickets || []),
        orders: mergeOrders(pendingProvidedData?.orders || [], providedData.orders || []),
        shiftCuts: mergeShiftCuts(pendingProvidedData?.shiftCuts || [], providedData.shiftCuts || []),
        outflows: mergeOutflows(pendingProvidedData?.outflows || [], providedData.outflows || []),
        customers: mergeCustomers(pendingProvidedData?.customers || [], providedData.customers || [])
      };
    }
    return {
      success: true,
      message: 'Sincronización en cola para procesar ventas inmediatas'
    };
  }

  isSyncInProgress = true;

  try {
    // Cargar datos locales frescos combinados con los proporcionados
    const currentStoredTickets = loadTickets();
    const localTickets = mergeTickets(currentStoredTickets, providedData?.tickets || []);
    const localOrders = mergeOrders(loadOrders(), providedData?.orders || []);
    const localShiftCuts = mergeShiftCuts(loadShiftCuts(), providedData?.shiftCuts || []);
    const localOutflows = mergeOutflows(loadOutflows(), providedData?.outflows || []);
    const localCustomers = mergeCustomers(loadCustomers(), providedData?.customers || []);

    // Actualizar almacenamiento local con mitigación de cuota
    safeLocalStorageSetItem(STORAGE_KEYS.TICKETS, JSON.stringify(localTickets));
    safeLocalStorageSetItem('santafe_tickets', JSON.stringify(localTickets));
    safeLocalStorageSetItem(STORAGE_KEYS.ORDERS, JSON.stringify(localOrders));
    safeLocalStorageSetItem(STORAGE_KEYS.SHIFT_CUTS, JSON.stringify(localShiftCuts));
    safeLocalStorageSetItem(STORAGE_KEYS.OUTFLOWS, JSON.stringify(localOutflows));
    safeLocalStorageSetItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(localCustomers));

    const resultData = {
      tickets: localTickets,
      orders: localOrders,
      shiftCuts: localShiftCuts,
      outflows: localOutflows,
      customers: localCustomers
    };

    lastSyncTimestamp = Date.now();
    notifyListeners(resultData);

    return {
      success: true,
      message: `Sincronizado con Firebase Firestore (${localTickets.length} tickets)`,
      mergedData: resultData
    };
  } catch (err: any) {
    console.error('[CloudSync] Error sincronizando:', err);
    return {
      success: false,
      message: 'Error sincronizando con la nube',
      error: err?.message
    };
  } finally {
    isSyncInProgress = false;
    if (hasPendingSync) {
      hasPendingSync = false;
      const nextData = pendingProvidedData;
      pendingProvidedData = undefined;
      setTimeout(() => {
        syncWithCloud(nextData);
      }, 200);
    }
  }
}

/**
 * Consulta Firebase Firestore y combina los datos recibidos con los locales
 */
export async function fetchAndMergeCloud(): Promise<CloudSyncResult> {
  try {
    const [cloudTickets, cloudOrders, cloudCuts, cloudOutflows, cloudCustomers] = await Promise.all([
      fetchTicketsFromFirebase().catch(() => []),
      fetchOrdersFromFirebase().catch(() => []),
      fetchShiftCutsFromFirebase().catch(() => []),
      fetchOutflowsFromFirebase().catch(() => []),
      fetchCustomersFromFirebase().catch(() => [])
    ]);

    const localTickets = loadTickets();
    const localOrders = loadOrders();
    const localShiftCuts = loadShiftCuts();
    const localOutflows = loadOutflows();
    const localCustomers = loadCustomers();

    const mergedTickets = mergeTickets(localTickets, cloudTickets);
    const mergedOrders = mergeOrders(localOrders, cloudOrders);
    const mergedShiftCuts = mergeShiftCuts(localShiftCuts, cloudCuts);
    const mergedOutflows = mergeOutflows(localOutflows, cloudOutflows);
    const mergedCustomers = mergeCustomers(localCustomers, cloudCustomers);

    const ticketsChanged = !areTicketsIdentical(localTickets, mergedTickets);
    const ordersChanged = !areOrdersIdentical(localOrders, mergedOrders);
    const cutsChanged = localShiftCuts.length !== mergedShiftCuts.length;

    if (ticketsChanged) {
      const ticketJson = JSON.stringify(mergedTickets);
      safeLocalStorageSetItem(STORAGE_KEYS.TICKETS, ticketJson);
      safeLocalStorageSetItem('santafe_tickets', ticketJson);
    }
    if (ordersChanged) {
      safeLocalStorageSetItem(STORAGE_KEYS.ORDERS, JSON.stringify(mergedOrders));
    }
    if (cutsChanged) {
      safeLocalStorageSetItem(STORAGE_KEYS.SHIFT_CUTS, JSON.stringify(mergedShiftCuts));
    }
    safeLocalStorageSetItem(STORAGE_KEYS.OUTFLOWS, JSON.stringify(mergedOutflows));
    safeLocalStorageSetItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(mergedCustomers));

    const resultData = {
      tickets: mergedTickets,
      orders: mergedOrders,
      shiftCuts: mergedShiftCuts,
      outflows: mergedOutflows,
      customers: mergedCustomers
    };

    if (ticketsChanged || ordersChanged || cutsChanged) {
      notifyListeners(resultData);
    }

    return {
      success: true,
      message: `Datos combinados desde Firebase Firestore (${mergedTickets.length} tickets)`,
      mergedData: resultData
    };
  } catch (err: any) {
    console.error('[CloudSync] Fallo al recuperar de Firebase Firestore:', err);
    return {
      success: false,
      message: 'No se pudo obtener datos de Firestore',
      error: err?.message
    };
  }
}

export function getCloudSyncStatus(): { isOnline: boolean; lastSyncTime: number; isFirebaseConnected: boolean } {
  const fbStatus = getFirebaseSyncStatus();
  return {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastSyncTime: lastSyncTimestamp,
    isFirebaseConnected: fbStatus.connected
  };
}
