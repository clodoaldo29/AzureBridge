import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores/appStore';
import { RDAList } from '@/components/rda/RDAList';
import { TemplateFactoryWizard } from '@/pages/RDA/components/template-factory/TemplateFactoryWizard';
import { UnifiedRDAWorkspace } from '@/pages/RDA/components/unified-rda/UnifiedRDAWorkspace';
import { api } from '@/services/api';
import type { Project } from '@/types';

type TabKey = 'generate' | 'history' | 'factory';
const ENABLE_TEMPLATE_FACTORY = import.meta.env.VITE_ENABLE_TEMPLATE_FACTORY === 'true';

export function RDAGenerator() {
    const [activeTab, setActiveTab] = useState<TabKey>('generate');
    const { selectedProjectId, setSelectedProjectId } = useAppStore();

    const { data: projectsResponse } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });

    const projects = projectsResponse?.data || [];
    const hasValidSelection = useMemo(
        () => projects.some((project) => project.id === selectedProjectId),
        [projects, selectedProjectId],
    );

    useEffect(() => {
        if (!projects.length) {
            return;
        }

        if (!selectedProjectId || !hasValidSelection) {
            setSelectedProjectId(projects[0].id);
        }
    }, [projects, selectedProjectId, hasValidSelection, setSelectedProjectId]);

    return (
        <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold">Relatorio Demonstrativo Anual (RDA)</h1>
                    <p className="text-sm text-muted-foreground">Geracao assistida por IA com historico e templates.</p>
                </div>
            </div>

            <div className="flex gap-2 rounded-md bg-muted p-1 w-fit">
                <button
                    className={`rounded px-3 py-1 text-sm ${activeTab === 'generate' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                    onClick={() => setActiveTab('generate')}
                >
                    Iniciar Novo
                </button>
                <button
                    className={`rounded px-3 py-1 text-sm ${activeTab === 'history' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                    onClick={() => setActiveTab('history')}
                >
                    Historico
                </button>
                {ENABLE_TEMPLATE_FACTORY && (
                    <button
                        className={`rounded px-3 py-1 text-sm ${activeTab === 'factory' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
                        onClick={() => setActiveTab('factory')}
                    >
                        Template Factory
                    </button>
                )}
            </div>

            {activeTab === 'generate' && (
                <div className="space-y-4">
                    <UnifiedRDAWorkspace
                        selectedProjectId={selectedProjectId || ''}
                        onProjectChange={(projectId) => setSelectedProjectId(projectId)}
                    />
                </div>
            )}
            {activeTab === 'history' && <RDAList projectId={selectedProjectId || ''} />}
            {ENABLE_TEMPLATE_FACTORY && activeTab === 'factory' && <TemplateFactoryWizard projectId={selectedProjectId || ''} />}
        </div>
    );
}
