import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage';

export const FUNCTIONS_REGION = 'asia-southeast1';
export const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

interface Services {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  storage: FirebaseStorage;
}

let cached: Services | null = null;

/** Khởi tạo Firebase một lần (an toàn với HMR). Nối emulator khi NEXT_PUBLIC_USE_EMULATORS=true. */
export function firebase(): Services {
  if (cached) return cached;
  const fresh = getApps().length === 0;
  const app = fresh ? initializeApp(config) : getApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const storage = getStorage(app);
  if (fresh && USE_EMULATORS) {
    connectAuthEmulator(auth, `http://127.0.0.1:${process.env.NEXT_PUBLIC_EMU_AUTH_PORT ?? 9099}`, { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', Number(process.env.NEXT_PUBLIC_EMU_FIRESTORE_PORT ?? 8080));
    connectFunctionsEmulator(functions, '127.0.0.1', Number(process.env.NEXT_PUBLIC_EMU_FUNCTIONS_PORT ?? 5001));
    connectStorageEmulator(storage, '127.0.0.1', Number(process.env.NEXT_PUBLIC_EMU_STORAGE_PORT ?? 9199));
  }
  cached = { app, auth, db, functions, storage };
  return cached;
}
