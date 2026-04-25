import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Role = 'caregiver' | 'patient' | null;

interface UserContext {
  id: string;
  name: string;
  photo?: string;
}

interface AuthState {
  user: UserContext | null;
  role: Role;
  login: (userData: UserContext, userRole: Role) => void;
  logout: () => void;
  updateUser: (updates: Partial<UserContext>) => void;
  isBiometricEnabled: boolean;
  toggleBiometric: (enabled: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      role: null,
      login: (userData, userRole) => set({ user: userData, role: userRole }),
      logout: () => set({ user: null, role: null }),
      updateUser: (updates) => set((state) => ({ 
        user: state.user ? { ...state.user, ...updates } : null 
      })),
      isBiometricEnabled: false,
      toggleBiometric: (enabled) => set({ isBiometricEnabled: enabled }),
    }),
    {
      name: 'medmanage-auth',
    }
  )
);
