import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { DocumentUploader } from '@/components/rda/DocumentUploader';
import { useDocuments } from '@/features/rda/queries/documents';
import { useSyncWiki, useWikiPages } from '@/features/rda/queries/wiki';
import { useIngestWiki } from '@/pages/RDA/hooks/useDocumentIngestion';
import { useProjectContext, useRebuildContext, useUpdateContext } from '@/pages/RDA/hooks/useProjectContext';
import { useChunkStats, useRAGSearch } from '@/pages/RDA/hooks/useRAGSearch';
import { useResetProject, useSetupProject, useSetupStatus } from '@/pages/RDA/hooks/useProjectSetup';
import { Step1DocumentClassification } from './Step1DocumentClassification';
import { Step2WikiSync } from './Step2WikiSync';
import { Step3IngestionProgress } from './Step3IngestionProgress';
import { Step4ContextReview } from './Step4ContextReview';

interface ProjectSetupWizardProps {
    projectId: string;
}

export function ProjectSetupWizard({ projectId }: ProjectSetupWizardProps) {
    const [step, setStep] = useState(1);
    const [setupStartedAt, setSetupStartedAt] = useState<string | null>(null);
    const [includeWiki, setIncludeWiki] = useState(true);
    const [selectedWikiIds, setSelectedWikiIds] = useState<string[]>([]);
    const completedRef = useRef(false);

    const { data: documents = [] } = useDocuments(projectId);
    const { data: wikiPages = [] } = useWikiPages(projectId);

    const setupMutation = useSetupProject(projectId);
    const setupStatusQuery = useSetupStatus(projectId);
    const resetMutation = useResetProject(projectId);

    const contextQuery = useProjectContext(projectId);
    const rebuildContextMutation = useRebuildContext(projectId);
    const updateContextMutation = useUpdateContext(projectId);

    const chunkStatsQuery = useChunkStats(projectId);
    const ragSearchMutation = useRAGSearch();

    const syncWikiMutation = useSyncWiki();
    const ingestWikiMutation = useIngestWiki(projectId);

    useEffect(() => {
        if (!setupStatusQuery.data) {
            return;
        }

        if (setupStatusQuery.data.jobStatus === 'completed' && step < 4) {
            setStep(4);
        }
    }, [setupStatusQuery.data, step]);

    useEffect(() => {
        if (!setupStatusQuery.data) {
            return;
        }

        const isCompleted =
            setupStatusQuery.data.jobStatus === 'completed' || setupStatusQuery.data.hasProjectContext;

        if (isCompleted && !completedRef.current) {
            completedRef.current = true;
            contextQuery.refetch();
            chunkStatsQuery.refetch();
            return;
        }

        if (!isCompleted) {
            completedRef.current = false;
        }
    }, [setupStatusQuery.data, contextQuery, chunkStatsQuery]);

    useEffect(() => {
        if (!projectId) {
            setStep(1);
            setSelectedWikiIds([]);
        }
    }, [projectId]);

    useEffect(() => {
        if (step === 4 && !contextQuery.data && !contextQuery.isFetching) {
            contextQuery.refetch();
        }
    }, [step, contextQuery]);

    const handleSyncWiki = async () => {
        await syncWikiMutation.mutateAsync(projectId);
    };

    const handleStartSetup = async () => {
        setSetupStartedAt(new Date().toISOString());

        await setupMutation.mutateAsync({
            includeWiki,
            forceReprocess: false,
            syncOperationalData: true,
            syncMode: 'incremental',
        });

        if (includeWiki && selectedWikiIds.length > 0) {
            await ingestWikiMutation.mutateAsync(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardContent className="flex items-center gap-2 p-4 text-sm">
                    {[1, 2, 3, 4].map((item) => (
                        <div
                            key={item}
                            className={`rounded-full px-3 py-1 ${step === item ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}
                        >
                            Step {item}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {step === 1 && (
                <Step1DocumentClassification
                    projectId={projectId}
                    documents={documents}
                    onNext={() => setStep(2)}
                    uploader={<DocumentUploader projectId={projectId} uploadedBy="setup-user" />}
                />
            )}

            {step === 2 && (
                <Step2WikiSync
                    projectId={projectId}
                    wikiPages={wikiPages}
                    includeWiki={includeWiki}
                    selectedWikiIds={selectedWikiIds}
                    syncing={syncWikiMutation.isPending}
                    onIncludeWikiChange={setIncludeWiki}
                    onSelectedWikiIdsChange={setSelectedWikiIds}
                    onSyncWiki={handleSyncWiki}
                    onBack={() => setStep(1)}
                    onNext={() => setStep(3)}
                />
            )}

            {step === 3 && (
                <Step3IngestionProgress
                    status={setupStatusQuery.data}
                    setupStartedAt={setupStartedAt}
                    isStarting={setupMutation.isPending || ingestWikiMutation.isPending}
                    onStart={handleStartSetup}
                    onBack={() => setStep(2)}
                    onNext={() => setStep(4)}
                />
            )}

            {step === 4 && (
                <Step4ContextReview
                    context={contextQuery.data}
                    stats={chunkStatsQuery.data}
                    contextLoading={contextQuery.isLoading || contextQuery.isFetching}
                    contextError={contextQuery.isError}
                    onRetryContext={() => {
                        contextQuery.refetch();
                        chunkStatsQuery.refetch();
                    }}
                    isSaving={updateContextMutation.isPending}
                    onSave={(payload) => updateContextMutation.mutate(payload)}
                    onRebuild={() => rebuildContextMutation.mutate({})}
                    onReset={() => resetMutation.mutate()}
                    onSearch={(query) =>
                        ragSearchMutation.mutate({
                            projectId,
                            query,
                            topK: 5,
                        })
                    }
                    searchResults={ragSearchMutation.data ?? []}
                    searchLoading={ragSearchMutation.isPending}
                />
            )}
        </div>
    );
}
