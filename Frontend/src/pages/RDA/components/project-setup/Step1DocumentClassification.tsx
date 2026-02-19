import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Document } from '@/types';
import type { ReactNode } from 'react';

interface Step1DocumentClassificationProps {
    projectId: string;
    documents: Document[];
    onNext: () => void;
    uploader: ReactNode;
}

export function Step1DocumentClassification({
    projectId,
    documents,
    onNext,
    uploader,
}: Step1DocumentClassificationProps) {
    const canProceed = Boolean(projectId && documents.length > 0);

    return (
        <div className="space-y-4">
            {uploader}

            <Card>
                <CardHeader>
                    <CardTitle>Step 1: Preparacao dos Documentos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {!projectId && (
                        <p className="text-sm text-muted-foreground">
                            Selecione um projeto na tela principal do RDA para iniciar o setup.
                        </p>
                    )}

                    {documents.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum documento encontrado para este projeto.</p>
                    ) : (
                        <div className="space-y-2">
                            {documents.map((doc) => (
                                <div key={doc.id} className="rounded border p-3 text-sm">
                                    <p className="font-medium">{doc.filename}</p>
                                    <p className="text-xs text-muted-foreground">{doc.mimeType}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground">
                        Classificacao manual desativada. A IA identifica automaticamente o conteudo dos documentos para gerar chunks, RAG e contexto do projeto.
                    </div>

                    <div className="flex justify-end">
                        <Button onClick={onNext} disabled={!canProceed}>Proximo</Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
