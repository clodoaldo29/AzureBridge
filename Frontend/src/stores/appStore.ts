import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface AppState {
    selectedProjectId: string | null;
    selectedSprintId: string | null;
    sidebarCollapsed: boolean;
    setSelectedProjectId: (projectId: string | null) => void;
    setSelectedSprintId: (sprintId: string | null) => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useAppStore = create<AppState>()(
    devtools(
        persist(
            (set) => ({
                selectedProjectId: null,
                selectedSprintId: null,
                sidebarCollapsed: false,
                setSelectedProjectId: (projectId) => set({ selectedProjectId: projectId }),
                setSelectedSprintId: (sprintId) => set({ selectedSprintId: sprintId }),
                setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
            }),
            {
                name: 'azurebridge-storage',
            }
        )
    )
);
