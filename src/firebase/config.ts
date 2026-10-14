import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

// Carga opcional y segura de firebase-applet-config.json si existe en el entorno
const configModules = import.meta.glob<{ default: Record<string, string> }>('/firebase-applet-config.json', { eager: true });
const localConfig = configModules['/firebase-applet-config.json']?.default || {};

// Lectura de variables de entorno con prioridad a VITE_FIREBASE_* para ocultar secretos en GitHub
export const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || localConfig.apiKey || '',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) || localConfig.authDomain || '',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || localConfig.projectId || '',
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) || localConfig.storageBucket || '',
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || localConfig.messagingSenderId || '',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || localConfig.appId || '',
  firestoreDatabaseId: (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) || localConfig.firestoreDatabaseId || 'ai-studio-puntozakia-2a0a1d1f-7fdd-41f8-86d6-09098d7613b3',
};

// Validación de claves
if (!firebaseConfig.apiKey) {
  console.warn(
    '[Firebase Config] No se encontró clave API en VITE_FIREBASE_API_KEY ni en configuración local.\n' +
    'Por favor copia el archivo .env.example como .env y agrega tus variables de entorno.'
  );
}

// Inicialización de la aplicación de Firebase
const app = getApps().length > 0 
  ? getApps()[0] 
  : initializeApp(
      firebaseConfig.apiKey
        ? firebaseConfig
        : {
            ...firebaseConfig,
            apiKey: 'AIza_PLACEHOLDER_KEY',
            projectId: firebaseConfig.projectId || 'unconfigured-project',
            appId: '1:000000000000:web:000000000000'
          }
    );

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
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes('PLACEHOLDER')) {
    console.warn('[Firebase] Claves no configuradas en variables de entorno.');
    return false;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('[Firebase] Conexión a Firestore en la nube establecida con éxito.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    } else {
      console.warn('[Firebase] Test connection ping:', error);
    }
    return false;
  }
}
