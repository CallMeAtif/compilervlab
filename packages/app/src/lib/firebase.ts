/**
 * Firebase initialisation — loaded once at app boot.
 *
 * All config values come from Vite env vars so the file is safe to commit.
 * Copy `.env.example` to `.env.local` and fill in real values from:
 * Firebase Console → Project Settings → Your apps → Web app SDK snippet.
 */
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
};

// True only when all required env vars are present.
export const firebaseConfigured =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

if (!firebaseConfigured) {
  console.warn(
    '[DBMS Lab] Firebase env vars not set. Copy .env.example → .env.local and fill in your project credentials.',
  );
}

const app = firebaseConfigured ? initializeApp(firebaseConfig) : null;

// Cast to the full type — auth calls are gated by firebaseConfigured in auth.tsx.
export const auth = (app ? getAuth(app) : null) as ReturnType<typeof getAuth>;


