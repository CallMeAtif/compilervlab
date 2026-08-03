/**
 * Authentication context and hooks.
 *
 * Security contract:
 *  - Only @somaiya.edu email addresses are accepted.
 *  - Email/password: the domain is checked client-side BEFORE calling Firebase,
 *    so Firebase never stores an unauthorised account.
 *  - "Remember me": toggles between browserLocalPersistence (survives the tab
 *    closing) and browserSessionPersistence (cleared on tab close).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type User,
} from 'firebase/auth';
import { auth, firebaseConfigured } from './firebase';

const ALLOWED_DOMAIN = '@somaiya.edu';

function isDomainAllowed(email: string | null): boolean {
  return email?.toLowerCase().endsWith(ALLOWED_DOMAIN) ?? false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!firebaseConfigured || !auth) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // A signed-in user that somehow bypassed domain checks should be evicted.
      if (firebaseUser && !isDomainAllowed(firebaseUser.email)) {
        void firebaseSignOut(auth);
        setUser(null);
      } else {
        setUser(firebaseUser);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // ── Sign in (email / password) ─────────────────────────────────────────────

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      setError(null);
      if (!firebaseConfigured || !auth) {
        setError('Firebase is not configured. Set up your .env.local file.');
        return;
      }
      if (!isDomainAllowed(email)) {
        setError(`Only ${ALLOWED_DOMAIN} email addresses are allowed.`);
        return;
      }
      try {
        await setPersistence(
          auth,
          remember ? browserLocalPersistence : browserSessionPersistence,
        );
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: unknown) {
        setError(mapFirebaseError(err));
      }
    },
    [],
  );

  // ── Sign up (email / password) ─────────────────────────────────────────────

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    if (!firebaseConfigured || !auth) {
      setError('Firebase is not configured. Set up your .env.local file.');
      return;
    }
    if (!isDomainAllowed(email)) {
      setError(`Only ${ALLOWED_DOMAIN} email addresses are allowed.`);
      return;
    }
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: unknown) {
      setError(mapFirebaseError(err));
    }
  }, []);


  // ── Sign out ───────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    setError(null);
    await firebaseSignOut(auth);
  }, []);

  // ── Reset password ─────────────────────────────────────────────────────────

  const resetPassword = useCallback(async (email: string) => {
    setError(null);
    if (!firebaseConfigured || !auth) {
      setError('Firebase is not configured. Set up your .env.local file.');
      return;
    }
    if (!isDomainAllowed(email)) {
      setError(`Only ${ALLOWED_DOMAIN} email addresses are allowed.`);
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err: unknown) {
      setError(mapFirebaseError(err));
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, clearError, signIn, signUp, signOut, resetPassword }),
    [user, loading, error, clearError, signIn, signUp, signOut, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapFirebaseError(err: unknown): string {
  const code = (err as { code?: string }).code;
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
}
