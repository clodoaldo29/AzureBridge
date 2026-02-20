import { useMemo, useState } from 'react';
import { CheckCircle2, Circle, Database, FileText, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProjectSetupWizard } from '@/pages/RDA/components/project-setup/ProjectSetupWizard';
import { useSetupStatus } from '@/pages/RDA/hooks/useProjectSetup';
import { MonthlyPreparationPanel } from '@/pages/RDA/components/monthly-preparation/MonthlyPreparationPanel';

interface UnifiedRDAWorkspaceProps {
    selectedProjectId: string;
}

export function UnifiedRDAWorkspace({ selectedProjectId }: UnifiedRDAWorkspaceProps) {
    const [activeStage, setActiveStage] = useState<'setup' | 'monthly' | 'generate'>('setup');
    const { data: setupStatus } = useSetupStatus(selectedProjectId, true);

    const stageDone = useMemo(() => ({
        setup: Boolean(setupStatus?.isSetupComplete || setupStatus?.hasProjectContext),
        monthly: false,
        generate: false,
    }), [setupStatus]);

    const StepIcon = ({ done }: { done: boolean }) => (
        done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />
    );

    return (
        <div className="space-y-4">
            <Card className="border-blue-100 bg-gradient-to-r from-blue-50/50 to-white">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Sparkles className="h-4 w-4 text-blue-600" />
                        Iniciar Novo RDA
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <div className="grid gap-2 md:grid-cols-3">
                        <button
                            className={`flex items-center justify-between rounded border px-3 py-2 text-left ${activeStage === 'setup' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                            onClick={() => setActiveStage('setup')}
                        >
                            <span className="font-medium">1. Setup do projeto</span>
                            <StepIcon done={stageDone.setup} />
                        </button>
                        <button
                            className={`flex items-center justify-between rounded border px-3 py-2 text-left ${activeStage === 'monthly' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                            onClick={() => setActiveStage('monthly')}
                        >
                            <span className="font-medium">2. Preparacao mensal</span>
                            <StepIcon done={stageDone.monthly} />
                        </button>
                        <button
                            className={`flex items-center justify-between rounded border px-3 py-2 text-left ${activeStage === 'generate' ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}
                            onClick={() => setActiveStage('generate')}
                        >
                            <span className="font-medium">3. Geracao do RDA</span>
                            <StepIcon done={stageDone.generate} />
                        </button>
                    </div>

                    <p className="text-muted-foreground">
                        Fluxo sequencial: execute uma etapa por vez. Isso melhora clareza, estabilidade e rastreabilidade para auditoria.
                    </p>

                    <div className="flex flex-wrap gap-2">
                        <Button variant={activeStage === 'setup' ? 'default' : 'outline'} size="sm" onClick={() => setActiveStage('setup')}>
                            Etapa 1
                        </Button>
                        <Button variant={activeStage === 'monthly' ? 'default' : 'outline'} size="sm" onClick={() => setActiveStage('monthly')}>
                            Etapa 2
                        </Button>
                        <Button variant={activeStage === 'generate' ? 'default' : 'outline'} size="sm" onClick={() => setActiveStage('generate')}>
                            Etapa 3
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {activeStage === 'setup' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Database className="h-4 w-4 text-blue-600" />
                            Etapa 1: Preparacao da Base IA
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ProjectSetupWizard
                            projectId={selectedProjectId}
                            onGoToMonthly={() => setActiveStage('monthly')}
                        />
                    </CardContent>
                </Card>
            )}

            {activeStage === 'monthly' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Database className="h-4 w-4 text-blue-600" />
                            Etapa 2: Preparacao Mensal do Periodo
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <MonthlyPreparationPanel projectId={selectedProjectId} />
                    </CardContent>
                </Card>
            )}

            {activeStage === 'generate' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <FileText className="h-4 w-4 text-blue-600" />
                            Etapa 3: Geracao do Relatorio
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2 text-sm text-muted-foreground">
                            <p>A geracao agora segue exclusivamente o fluxo novo da Etapa 2.</p>
                            <p>Use "Preparacao mensal", execute o preflight e clique em "Iniciar geracao" para acompanhar em tempo real.</p>
                            <Button variant="outline" size="sm" onClick={() => setActiveStage('monthly')}>
                                Ir para Etapa 2
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
