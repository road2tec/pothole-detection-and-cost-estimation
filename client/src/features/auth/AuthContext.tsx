import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionExpiredHandler } from '@/lib/api';
import type { Role, User } from '@/lib/types';

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const qc = useQueryClient();

  const clear = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setSessionExpiredHandler(clear);
    // Restore the session from the HttpOnly refresh cookie on page load.
    refreshSession().then(async (token) => {
      if (!token) return setStatus('anonymous');
      try {
        const r = await api.get('/auth/me');
        setUser(r.data.user);
        setStatus('authenticated');
      } catch {
        clear();
      }
    });
  }, [clear]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    setAccessToken(r.data.accessToken);
    setUser(r.data.user);
    setStatus('authenticated');
    return r.data.user as User;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({ user, status, login, logout, setUser, hasRole: (...roles) => !!user && roles.includes(user.role) }),
    [user, status, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
