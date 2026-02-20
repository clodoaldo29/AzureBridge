import { useMemo, useState } from 'react';
import { Download, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { GenerateTemplateResponse } from './types';

interface Step3TemplatePreviewProps {
    generation: GenerateTemplateResponse;
    isGenerating: boolean;
    isActivating: boolean;
    onActivate: () => void;
    onDownload: () => void;
    onRestart: () => void;
}

export function Step3TemplatePreview({
    generation,
    isGenerating,
    isActivating,
    onActivate,
    onDownload,
    onRestart,
}: Step3TemplatePreviewProps) {
    const [showSchema, setShowSchema] = useState(false);

    const progressValue = useMemo(() => {
        if (isGenerating) {
            return 70;
        }
        return generation.validationResult.valid ? 100 : 95;
    }, [generation.validationResult.valid, isGenerating]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Step 3: Preview e Ativacao</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                    <Badge variant={generation.validationResult.valid ? 'default' : 'destructive'}>
                        {generation.validationResult.valid ? 'Template valido' : 'Template com alertas'}
                    </Badge>
                    <Badge variant="secondary">Template ID: {generation.templateId}</Badge>
                    <Badge variant="secondary">Schema ID: {generation.schemaId}</Badge>
                </div>

                <Progress value={progressValue} />

                {!generation.validationResult.valid && (
                    <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <div className="mb-2 flex items-center gap-2 font-medium">
                            <XCircle className="h-4 w-4" />
                            Erros de validacao
                        </div>
                        {generation.validationResult.errors.map((error, index) => (
                            <p key={`${error}-${index}`}>{error}</p>
                        ))}
                    </div>
                )}

                {generation.validationResult.valid && (
                    <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                        <div className="flex items-center gap-2 font-medium">
                            <CheckCircle2 className="h-4 w-4" />
                            Validacao concluida com sucesso.
                        </div>
                    </div>
                )}

                <details className="rounded border p-3" open={showSchema} onToggle={(event) => setShowSchema(event.currentTarget.open)}>
                    <summary className="cursor-pointer text-sm font-medium">Schema JSON gerado</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                        {JSON.stringify(generation, null, 2)}
                    </pre>
                </details>

                <div className="flex flex-wrap justify-between gap-2">
                    <Button variant="outline" onClick={onRestart}>Novo fluxo</Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onDownload}>
                            <Download className="mr-2 h-4 w-4" />
                            Download template
                        </Button>
                        <Button onClick={onActivate} disabled={isActivating || isGenerating}>
                            {isActivating ? 'Ativando...' : 'Ativar template'}
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
