import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/services/api';
import { useGenerateRDA } from '@/services/queries/rda';
import { useRDAs } from '@/services/queries/rda';
import { useDocuments } from '@/features/rda/queries/documents';
import { useWikiPages } from '@/features/rda/queries/wiki';
import { toast } from '@/hooks/use-toast';
import { Step1ProjectSelection } from './Step1ProjectSelection';
import { Step2DocumentSelection } from './Step2DocumentSelection';
import { Step3PreviewGenerate } from './Step3PreviewGenerate';
import { Step4ProgressTracking } from './Step4ProgressTracking';
import { DocumentUploader } from './DocumentUploader';
import type { Project } from '@/types';
import type { RDAWizardFormData } from './types';
import type { AxiosError } from 'axios';

const initialFormData: RDAWizardFormData = {
    projectId: '',
    periodType: 'monthly',
    periodStart: '',
    periodEnd: '',
    documentIds: [],
    wikiPageIds: [],
    generatedBy: 'user',
};

interface RDAWizardProps {
    selectedProjectId?: string;
    onProjectChange?: (projectId: string) => void;
}

export function RDAWizard({ selectedProjectId = '', onProjectChange }: RDAWizardProps) {
    const [currentStep, setCurrentStep] = useState(1);
    const [generationId, setGenerationId] = useState<string | null>(null);
    const [formData, setFormData] = useState<RDAWizardFormData>(initialFormData);

    const { data: projectsResponse } = useQuery({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get<{ data: Project[] }>('/projects');
            return response.data;
        },
    });

    const projects = projectsResponse?.data || [];
    const { data: documents = [] } = useDocuments(formData.projectId);
    const { data: wikiPages = [] } = useWikiPages(formData.projectId);
    const { data: generations = [] } = useRDAs(selectedProjectId || formData.projectId);

    const generateMutation = useGenerateRDA();

    const selectedProjectName = useMemo(
        () => projects.find((project) => project.id === formData.projectId)?.name,
        [projects, formData.projectId],
    );

    useEffect(() => {
        if (!selectedProjectId || selectedProjectId === formData.projectId) {
            return;
        }

        setFormData((previous) => ({
            ...previous,
            projectId: selectedProjectId,
            documentIds: [],
            wikiPageIds: [],
        }));
    }, [selectedProjectId, formData.projectId]);

    useEffect(() => {
        if (!selectedProjectId) {
            return;
        }

        if (generationId) {
            return;
        }

        const activeGeneration = generations.find((item) => item.status === 'processing');
        if (!activeGeneration) {
            return;
        }

        setGenerationId(activeGeneration.id);
        setCurrentStep(4);
    }, [selectedProjectId, generations, generationId]);

    const updateForm = (updates: Partial<RDAWizardFormData>) => {
        if (updates.projectId && updates.projectId !== formData.projectId) {
            onProjectChange?.(updates.projectId);
        }

        setFormData((previous) => ({ ...previous, ...updates }));
    };

    const validateStep1 = () => {
        if (!formData.projectId || !formData.periodStart || !formData.periodEnd) {
            return false;
        }

        return new Date(formData.periodEnd) > new Date(formData.periodStart);
    };

    const handleGenerate = async () => {
        setCurrentStep(4);

        try {
            const generation = await generateMutation.mutateAsync(formData);
            setGenerationId(generation.id);
            toast({
                title: 'Geracao iniciada',
                description: 'O processamento do RDA foi iniciado com sucesso.',
            });
        } catch (error) {
            const axiosError = error as AxiosError<{ message?: string; error?: string }>;
            const message =
                axiosError.response?.data?.message ||
                axiosError.response?.data?.error ||
                'Nao foi possivel iniciar a geracao do RDA.';

            setCurrentStep(3);
            toast({
                title: 'Falha ao iniciar geracao',
                description: message,
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardContent className="flex items-center gap-2 p-4 text-sm">
                    {[1, 2, 3, 4].map((step) => (
                        <div
                            key={step}
                            className={`rounded-full px-3 py-1 ${currentStep === step ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}
                        >
                            Step {step}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {currentStep === 1 && (
                <>
                    <DocumentUploader projectId={formData.projectId} />
                    <Step1ProjectSelection
                        projects={projects}
                        formData={formData}
                        onChange={updateForm}
                    />
                    <div className="flex justify-end">
                        <Button onClick={() => setCurrentStep(2)} disabled={!validateStep1()}>
                            Proximo
                        </Button>
                    </div>
                </>
            )}

            {currentStep === 2 && (
                <>
                    <Step2DocumentSelection
                        projectId={formData.projectId}
                        documents={documents}
                        wikiPages={wikiPages}
                        selectedDocumentIds={formData.documentIds}
                        selectedWikiPageIds={formData.wikiPageIds}
                        onDocumentSelectionChange={(ids) => updateForm({ documentIds: ids })}
                        onWikiSelectionChange={(ids) => updateForm({ wikiPageIds: ids })}
                    />
                    <div className="flex justify-between">
                        <Button variant="outline" onClick={() => setCurrentStep(1)}>Voltar</Button>
                        <Button onClick={() => setCurrentStep(3)}>Proximo</Button>
                    </div>
                </>
            )}

            {currentStep === 3 && (
                <Step3PreviewGenerate
                    formData={formData}
                    projectName={selectedProjectName}
                    onBack={() => setCurrentStep(2)}
                    onGenerate={handleGenerate}
                    isGenerating={generateMutation.isPending}
                />
            )}

            {currentStep === 4 && <Step4ProgressTracking generationId={generationId} />}
        </div>
    );
}
