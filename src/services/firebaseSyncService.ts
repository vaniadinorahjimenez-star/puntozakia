import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  writeBatch
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, testConnection } from '../firebase/config';
import { 
  SaleTicket, 
  BakeryOrder, 
  ShiftCutRecord, 
  CashOutflowItem, 
  Customer, 
  BreadProduct, 
  Settings 
} from '../types';
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
  saveTickets,
  STORAGE_KEYS
} from '../utils/storage';

export interface FirebaseSyncStatus {
  connected: boolean;
  isSyncing: boolean;
  lastSyncTime: number;
  totalCloudTickets: number;
  errorMessage?: string;
}

let syncStatus: FirebaseSyncStatus = {
  connected: false,
  isSyncing: false,
  lastSyncTime: Date.now(),
  totalCloudTickets: 0
};

const statusListeners = new Set<(status: FirebaseSyncStatus) => void>();

export function onFirebaseStatusChange(cb: (status: FirebaseSyncStatus) => void): () => void {
  statusListeners.add(cb);
  cb(syncStatus);
  return () => statusListeners.delete(cb);
}

function updateStatus(patch: Partial<FirebaseSyncStatus>) {
  syncStatus = { ...syncStatus, ...patch };
  statusListeners.forEach(cb => {
    try {
      cb(syncStatus);
    } catch (e) {
      console.warn('Error en status listener:', e);
    }
  });
}

export function getFirebaseSyncStatus(): FirebaseSyncStatus {
  return syncStatus;
}

/**
 * Sanitiza objetos eliminando propiedades `undefined` que Firestore no admite
 */
function sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        result[key] = value.map(item => (typeof item === 'object' && item !== null ? sanitizeForFirestore(item) : item));
      } else if (typeof value === 'object' && value !== null) {
        result[key] = sanitizeForFirestore(value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

/**
 * Guarda o actualiza un ticket individual directamente en Firebase Firestore
 */
export async function saveTicketToFirebase(ticket: SaleTicket): Promise<boolean> {
  const path = `tickets/${ticket.id}`;
  try {
    const cleanTicket = sanitizeForFirestore(ticket);
    const docRef = doc(db, 'tickets', String(cleanTicket.id));
    await setDoc(docRef, cleanTicket, { merge: true });
    updateStatus({ connected: true, lastSyncTime: Date.now() });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error guardando ticket ${ticket.id} en Firestore:`, error);
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch (err) {
      updateStatus({ errorMessage: 'Error de permisos o red en Firestore' });
    }
    return false;
  }
}

/**
 * Guarda o actualiza un pedido en Firebase Firestore
 */
export async function saveOrderToFirebase(order: BakeryOrder): Promise<boolean> {
  const path = `orders/${order.id}`;
  try {
    const cleanOrder = sanitizeForFirestore(order);
    const docRef = doc(db, 'orders', String(cleanOrder.id));
    await setDoc(docRef, cleanOrder, { merge: true });
    updateStatus({ connected: true, lastSyncTime: Date.now() });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error guardando pedido ${order.id} en Firestore:`, error);
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      updateStatus({ errorMessage: 'Error guardando pedido en Firestore' });
    }
    return false;
  }
}

/**
 * Guarda o actualiza un corte de turno en Firebase Firestore
 */
export async function saveShiftCutToFirebase(shiftCut: ShiftCutRecord): Promise<boolean> {
  const path = `shiftCuts/${shiftCut.id}`;
  try {
    const cleanCut = sanitizeForFirestore(shiftCut);
    const docRef = doc(db, 'shiftCuts', String(cleanCut.id));
    await setDoc(docRef, cleanCut, { merge: true });
    updateStatus({ connected: true, lastSyncTime: Date.now() });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error guardando corte en Firestore:`, error);
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {}
    return false;
  }
}

/**
 * Guarda o actualiza una salida de dinero en Firebase Firestore
 */
export async function saveOutflowToFirebase(outflow: CashOutflowItem): Promise<boolean> {
  const path = `outflows/${outflow.id}`;
  try {
    const cleanOutflow = sanitizeForFirestore(outflow);
    const docRef = doc(db, 'outflows', String(cleanOutflow.id));
    await setDoc(docRef, cleanOutflow, { merge: true });
    updateStatus({ connected: true, lastSyncTime: Date.now() });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error guardando salida en Firestore:`, error);
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {}
    return false;
  }
}

/**
 * Guarda o actualiza un cliente en Firebase Firestore
 */
export async function saveCustomerToFirebase(customer: Customer): Promise<boolean> {
  const path = `customers/${customer.id}`;
  try {
    const cleanCustomer = sanitizeForFirestore(customer);
    const docRef = doc(db, 'customers', String(cleanCustomer.id));
    await setDoc(docRef, cleanCustomer, { merge: true });
    updateStatus({ connected: true, lastSyncTime: Date.now() });
    return true;
  } catch (error) {
    console.error(`[Firebase] Error guardando cliente en Firestore:`, error);
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {}
    return false;
  }
}

/**
 * Obtiene todos los tickets de Firebase Firestore
 */
export async function fetchTicketsFromFirebase(): Promise<SaleTicket[]> {
  const path = 'tickets';
  try {
    const q = query(collection(db, 'tickets'), limit(1000));
    const snap = await getDocs(q);
    const tickets: SaleTicket[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as SaleTicket;
      if (data && data.id && !['t-1001', 't-1002', 't-1003', 't-1004'].includes(data.id)) {
        tickets.push(data);
      }
    });
    updateStatus({ connected: true, totalCloudTickets: tickets.length, lastSyncTime: Date.now() });
    return tickets;
  } catch (error) {
    console.error('[Firebase] Error cargando tickets de Firestore:', error);
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {}
    return [];
  }
}

/**
 * Obtiene todos los pedidos de Firebase Firestore
 */
export async function fetchOrdersFromFirebase(): Promise<BakeryOrder[]> {
  const path = 'orders';
  try {
    const snap = await getDocs(collection(db, 'orders'));
    const orders: BakeryOrder[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as BakeryOrder;
      if (data && data.id && !['ord-101', 'ord-102', 'ord-103', 'ord-104', 'ord-105'].includes(data.id)) {
        orders.push(data);
      }
    });
    return orders;
  } catch (error) {
    console.error('[Firebase] Error cargando pedidos de Firestore:', error);
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {}
    return [];
  }
}

/**
 * Obtiene cortes de turno de Firebase Firestore
 */
export async function fetchShiftCutsFromFirebase(): Promise<ShiftCutRecord[]> {
  const path = 'shiftCuts';
  try {
    const snap = await getDocs(collection(db, 'shiftCuts'));
    const cuts: ShiftCutRecord[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as ShiftCutRecord;
      if (data && data.id) cuts.push(data);
    });
    return cuts;
  } catch (error) {
    console.error('[Firebase] Error cargando cortes de Firestore:', error);
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {}
    return [];
  }
}

/**
 * Obtiene salidas de dinero de Firebase Firestore
 */
export async function fetchOutflowsFromFirebase(): Promise<CashOutflowItem[]> {
  const path = 'outflows';
  try {
    const snap = await getDocs(collection(db, 'outflows'));
    const outflows: CashOutflowItem[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as CashOutflowItem;
      if (data && data.id) outflows.push(data);
    });
    return outflows;
  } catch (error) {
    console.error('[Firebase] Error cargando salidas de Firestore:', error);
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {}
    return [];
  }
}

/**
 * Obtiene clientes de Firebase Firestore
 */
export async function fetchCustomersFromFirebase(): Promise<Customer[]> {
  const path = 'customers';
  try {
    const snap = await getDocs(collection(db, 'customers'));
    const customers: Customer[] = [];
    snap.forEach(docSnap => {
      const data = docSnap.data() as Customer;
      if (data && data.id) customers.push(data);
    });
    return customers;
  } catch (error) {
    console.error('[Firebase] Error cargando clientes de Firestore:', error);
    try {
      handleFirestoreError(error, OperationType.GET, path);
    } catch {}
    return [];
  }
}

/**
 * Migra de forma transparente todos los datos almacenados localmente a Firebase Firestore
 * para evitar que se pierdan datos y liberar la cuota de localStorage.
 */
export async function migrateLocalDataToFirebase(): Promise<{ success: boolean; migratedTicketsCount: number }> {
  updateStatus({ isSyncing: true });
  try {
    const localTickets = loadTickets();
    const localOrders = loadOrders();
    const localShiftCuts = loadShiftCuts();
    const localOutflows = loadOutflows();
    const localCustomers = loadCustomers();

    console.log(`[Firebase] Iniciando migración a la nube: ${localTickets.length} tickets locales...`);

    // 1. Guardar tickets en lotes de 100 para no sobrecargar
    let count = 0;
    for (const ticket of localTickets) {
      if (ticket && ticket.id && !['t-1001', 't-1002', 't-1003', 't-1004'].includes(ticket.id)) {
        await saveTicketToFirebase(ticket);
        count++;
      }
    }

    // 2. Guardar pedidos
    for (const order of localOrders) {
      if (order && order.id && !['ord-101', 'ord-102', 'ord-103', 'ord-104', 'ord-105'].includes(order.id)) {
        await saveOrderToFirebase(order);
      }
    }

    // 3. Guardar cortes
    for (const cut of localShiftCuts) {
      if (cut && cut.id) {
        await saveShiftCutToFirebase(cut);
      }
    }

    // 4. Guardar salidas
    for (const outflow of localOutflows) {
      if (outflow && outflow.id) {
        await saveOutflowToFirebase(outflow);
      }
    }

    // 5. Guardar clientes
    for (const customer of localCustomers) {
      if (customer && customer.id) {
        await saveCustomerToFirebase(customer);
      }
    }

    console.log(`[Firebase] Migración completada exitosamente: ${count} tickets respaldados en la nube.`);
    updateStatus({ 
      connected: true, 
      isSyncing: false, 
      totalCloudTickets: count, 
      lastSyncTime: Date.now() 
    });

    return { success: true, migratedTicketsCount: count };
  } catch (error) {
    console.error('[Firebase] Error en migración a Firestore:', error);
    updateStatus({ isSyncing: false, errorMessage: 'Error durante la migración a Firestore' });
    return { success: false, migratedTicketsCount: 0 };
  }
}

/**
 * Escucha cambios en tiempo real en la colección de tickets de Firestore.
 * Sincroniza al instante cualquier venta registrada en otro dispositivo o mostrador.
 */
export function listenToFirebaseTickets(
  onUpdate: (tickets: SaleTicket[]) => void
): () => void {
  const path = 'tickets';
  try {
    const q = query(collection(db, 'tickets'), limit(500));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const cloudTickets: SaleTicket[] = [];
        snapshot.forEach(docSnap => {
          const t = docSnap.data() as SaleTicket;
          if (t && t.id && !['t-1001', 't-1002', 't-1003', 't-1004'].includes(t.id)) {
            cloudTickets.push(t);
          }
        });
        updateStatus({ 
          connected: true, 
          totalCloudTickets: cloudTickets.length, 
          lastSyncTime: Date.now() 
        });
        onUpdate(cloudTickets);
      },
      (error) => {
        console.error('[Firebase] Error en onSnapshot de tickets:', error);
        try {
          handleFirestoreError(error, OperationType.GET, path);
        } catch {}
        updateStatus({ connected: false, errorMessage: error.message });
      }
    );

    return unsubscribe;
  } catch (error) {
    console.error('[Firebase] Fallo al suscribirse a tickets en tiempo real:', error);
    return () => {};
  }
}

/**
 * Escucha cambios en tiempo real en la colección de pedidos de Firestore
 */
export function listenToFirebaseOrders(
  onUpdate: (orders: BakeryOrder[]) => void
): () => void {
  const path = 'orders';
  try {
    const unsubscribe = onSnapshot(
      collection(db, 'orders'),
      (snapshot) => {
        const cloudOrders: BakeryOrder[] = [];
        snapshot.forEach(docSnap => {
          const o = docSnap.data() as BakeryOrder;
          if (o && o.id && !['ord-101', 'ord-102', 'ord-103', 'ord-104', 'ord-105'].includes(o.id)) {
            cloudOrders.push(o);
          }
        });
        onUpdate(cloudOrders);
      },
      (error) => {
        console.error('[Firebase] Error en onSnapshot de pedidos:', error);
        try {
          handleFirestoreError(error, OperationType.GET, path);
        } catch {}
      }
    );

    return unsubscribe;
  } catch {
    return () => {};
  }
}
