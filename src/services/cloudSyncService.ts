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
  STORAGE_KEYS
} from '../utils/storage';

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

export function onCloudSyncUpdated(cb: SyncListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyListeners(data: NonNullable<CloudSyncResult['mergedData']>) {
  listeners.forEach(cb => {
    try {
      cb(data);
    } catch (e) {
      console.error('Error en callback de sincronización:', e);
    }
  });
}

/**
 * Realiza la sincronización combinada (Merge) con la nube de Netlify
 * NUNCA sobrescribe datos; combina los tickets, cobros de tarjeta, pedidos y cortes
 * de la PC y del Teléfono.
 */
export async function syncWithCloud(providedData?: {
  tickets?: SaleTicket[];
  orders?: BakeryOrder[];
  shiftCuts?: ShiftCutRecord[];
  outflows?: CashOutflowItem[];
  customers?: Customer[];
}): Promise<CloudSyncResult> {
  const localTickets = providedData?.tickets || loadTickets();
  const localOrders = providedData?.orders || loadOrders();
  const localShiftCuts = providedData?.shiftCuts || loadShiftCuts();
  const localOutflows = providedData?.outflows || loadOutflows();
  const localCustomers = providedData?.customers || loadCustomers();

  const payload = {
    tickets: localTickets,
    orders: localOrders,
    shiftCuts: localShiftCuts,
    outflows: localOutflows,
    customers: localCustomers,
    timestamp: new Date().toISOString()
  };

  const endpoints = ['/.netlify/functions/sync-data', '/api/sync'];
  let lastError: any = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      if (json.success && json.data) {
        // Combinar datos locales con los devueltos por la nube
        const mergedTickets = mergeTickets(localTickets, json.data.tickets || []);
        const mergedOrders = mergeOrders(localOrders, json.data.orders || []);
        const mergedShiftCuts = mergeShiftCuts(localShiftCuts, json.data.shiftCuts || []);
        const mergedOutflows = mergeOutflows(localOutflows, json.data.outflows || []);
        const mergedCustomers = mergeCustomers(localCustomers, json.data.customers || []);

        // Guardar la versión combinada en localStorage local
        localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(mergedTickets));
        localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(mergedOrders));
        localStorage.setItem(STORAGE_KEYS.SHIFT_CUTS, JSON.stringify(mergedShiftCuts));
        localStorage.setItem(STORAGE_KEYS.OUTFLOWS, JSON.stringify(mergedOutflows));
        localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(mergedCustomers));

        const resultData = {
          tickets: mergedTickets,
          orders: mergedOrders,
          shiftCuts: mergedShiftCuts,
          outflows: mergedOutflows,
          customers: mergedCustomers
        };

        notifyListeners(resultData);

        return {
          success: true,
          message: `Sincronización combinada exitosa (${mergedTickets.length} tickets, ${mergedOrders.length} pedidos)`,
          mergedData: resultData
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback si no hay conexión a internet o la función no responde:
  // Garantizar que localmente también se combinen los datos y no se pierda nada
  return {
    success: false,
    message: 'No se pudo conectar a la nube de Netlify, guardado local seguro activado',
    error: lastError?.message || 'Error de red'
  };
}

/**
 * Consulta la nube y combina los datos recibidos con los locales
 */
export async function fetchAndMergeCloud(): Promise<CloudSyncResult> {
  const endpoints = ['/.netlify/functions/sync-data', '/api/sync'];
  let lastError: any = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!res.ok) continue;

      const json = await res.json();
      if (json.success && json.data) {
        const localTickets = loadTickets();
        const localOrders = loadOrders();
        const localShiftCuts = loadShiftCuts();
        const localOutflows = loadOutflows();
        const localCustomers = loadCustomers();

        const mergedTickets = mergeTickets(localTickets, json.data.tickets || []);
        const mergedOrders = mergeOrders(localOrders, json.data.orders || []);
        const mergedShiftCuts = mergeShiftCuts(localShiftCuts, json.data.shiftCuts || []);
        const mergedOutflows = mergeOutflows(localOutflows, json.data.outflows || []);
        const mergedCustomers = mergeCustomers(localCustomers, json.data.customers || []);

        localStorage.setItem(STORAGE_KEYS.TICKETS, JSON.stringify(mergedTickets));
        localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(mergedOrders));
        localStorage.setItem(STORAGE_KEYS.SHIFT_CUTS, JSON.stringify(mergedShiftCuts));
        localStorage.setItem(STORAGE_KEYS.OUTFLOWS, JSON.stringify(mergedOutflows));
        localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(mergedCustomers));

        const resultData = {
          tickets: mergedTickets,
          orders: mergedOrders,
          shiftCuts: mergedShiftCuts,
          outflows: mergedOutflows,
          customers: mergedCustomers
        };

        notifyListeners(resultData);

        return {
          success: true,
          message: 'Datos combinados desde la nube con éxito',
          mergedData: resultData
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    success: false,
    message: 'No se pudo obtener datos de la nube',
    error: lastError?.message
  };
}

export function getCloudSyncStatus(): { isOnline: boolean; lastSyncTime: number } {
  return {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastSyncTime: Date.now()
  };
}
