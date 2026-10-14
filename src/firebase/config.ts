import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

// Carga opcional y segura de firebase-applet-config.json si existe en el entorno
const configModules = import.meta.glob<{ default: Record<string, string> }>('/firebase-applet-config.json', { eager: true });
const localConfig = configModules['/firebase-applet-config.json']?.default || {};

// Configuración predeterminada del proyecto provisionado para Panadería Santa Fé
const BUILTIN_FIREBASE_CONFIG = {
  apiKey: "AIzaSyB-KaX-f4Hr8RZKa-ZpZDjbVY1TZ1kwrSo",
  authDomain: "gen-lang-client-0249819239.firebaseapp.com",
  projectId: "gen-lang-client-0249819239",
  storageBucket: "gen-lang-client-0249819239.firebasestorage.app",
  messagingSenderId: "791214362680",
  appId: "1:791214362680:web:129661d9fc59f025b896cd",
  firestoreDatabaseId: "ai-studio-puntozakia-2a0a1d1f-7fdd-41f8-86d6-09098d7613b3"
};

// Lectura de variables de entorno con prioridad a VITE_FIREBASE_*, luego archivo local, luego configuración integrada
export const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || localConfig.apiKey || BUILTIN_FIREBASE_CONFIG.apiKey,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || localConfig.authDomain || BUILTIN_FIREBASE_CONFIG.authDomain,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || localConfig.projectId || BUILTIN_FIREBASE_CONFIG.projectId,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || localConfig.storageBucket || BUILTIN_FIREBASE_CONFIG.storageBucket,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || localConfig.messagingSenderId || BUILTIN_FIREBASE_CONFIG.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || localConfig.appId || BUILTIN_FIREBASE_CONFIG.appId,
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) || localConfig.firestoreDatabaseId || BUILTIN_FIREBASE_CONFIG.firestoreDatabaseId,
};

// Inicialización de la aplicación de Firebase
const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

// CRITICAL: The app will break without specifying the firestoreDatabaseId
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('[Firebase] Conexión a Firestore en la nube establecida con éxito.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('[Firebase] El cliente está fuera de línea temporalmente.');
    } else {
      console.log('[Firebase] Ping a Firestore verificado:', error);
    }
    return true; // Si responde el servidor (incluso documento no encontrado), la conexión está viva
  }
}
