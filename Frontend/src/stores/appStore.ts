import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

const AUTH_TOKEN_KEY = 'azurebridge-auth-token';

export interface AuthUser {
    id: string;
    email: string;
    displayName: string;
}

interface AppState {
    // App state
    selectedProjectId: string | null;
    selectedSprintId: string | null;
    sidebarCollapsed: boolean;
    setSelectedProjectId: (projectId: string | null) => void;
    setSelectedSprintId: (sprintId: string | null) => void;
    setSidebarCollapsed: (collapsed: boolean) => void;

    // Auth state
    authUser: AuthUser | null;
    isAuthenticated: boolean;
    setAuth: (token: string, user: AuthUser) => void;
    clearAuth: () => void;
}

export const useAppStore = create<AppState>()(
    devtools(
        persist(
            (set) => ({
                // App state
                selectedProjectId: null,
                selectedSprintId: null,
                sidebarCollapsed: false,
                setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),
                setSelectedSprintId: (sprintId) => set({ selectedSprintId: sprintId }),
                setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

                // Auth state
                authUser: null,
                isAuthenticated: false,
                setAuth: (token, user) => {
                    localStorage.setItem(AUTH_TOKEN_KEY, token);
                    set({ authUser: user, isAuthenticated: true });
                },
                clearAuth: () => {
                    localStorage.removeItem(AUTH_TOKEN_KEY);
                    set({ authUser: null, isAuthenticated: false });
                },
            }),
            {
                name: 'azurebridge-storage',
                // Não persistir o token no Zustand — fica só no localStorage direto
                partialize: (state) => ({
                    selectedProjectId: state.selectedProjectId,
                    selectedSprintId: state.selectedSprintId,
                    sidebarCollapsed: state.sidebarCollapsed,
                    authUser: state.authUser,
                    isAuthenticated: state.isAuthenticated,
                }),
            }
        )
    )
);
