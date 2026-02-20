import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useUploadDocument } from '@/features/rda/queries/documents';
import { toast } from '@/hooks/use-toast';

interface DocumentUploaderProps {
    projectId: string;
    uploadedBy?: string;
}

interface UploadItem {
    id: string;
    name: string;
    status: 'pending' | 'uploading' | 'done' | 'error';
    progress: number;
}

export function DocumentUploader({ projectId, uploadedBy = 'user' }: DocumentUploaderProps) {
    const uploadMutation = useUploadDocument();
    const [uploads, setUploads] = useState<UploadItem[]>([]);

    const onDrop = useCallback(
        async (acceptedFiles: File[]) => {
            if (!projectId || acceptedFiles.length === 0) {
                return;
            }

            const batchId = Date.now();
            const queued = acceptedFiles.map((file, index) => ({
                id: `${batchId}-${index}-${file.name}`,
                name: file.name,
                status: 'pending' as const,
                progress: 0,
            }));

            setUploads((previous) => [...previous, ...queued]);

            let successCount = 0;
            let failCount = 0;

            for (const [index, file] of acceptedFiles.entries()) {
                const uploadId = queued[index].id;

                setUploads((previous) =>
                    previous.map((item) =>
                        item.id === uploadId ? { ...item, status: 'uploading', progress: Math.max(1, item.progress) } : item,
                    ),
                );

                try {
                    await uploadMutation.mutateAsync({
                        projectId,
                        file,
                        uploadedBy,
                        onProgress: (percentage) => {
                            setUploads((previous) =>
                                previous.map((item) => {
                                    if (item.id !== uploadId) {
                                        return item;
                                    }

                                    if (item.status === 'done' || item.status === 'error') {
                                        return item;
                                    }

                                    return {
                                        ...item,
                                        status: 'uploading',
                                        progress: Math.max(item.progress, Math.max(1, percentage)),
                                    };
                                }),
                            );
                        },
                    });

                    successCount += 1;
                    setUploads((previous) =>
                        previous.map((item) =>
                            item.id === uploadId ? { ...item, status: 'done', progress: 100 } : item,
                        ),
                    );
                } catch {
                    failCount += 1;
                    setUploads((previous) =>
                        previous.map((item) =>
                            item.id === uploadId ? { ...item, status: 'error', progress: 100 } : item,
                        ),
                    );
                }
            }

            if (successCount > 0) {
                toast({
                    title: 'Upload concluido',
                    description: `${successCount} documento(s) enviado(s) com sucesso.`,
                });
            }

            if (failCount > 0) {
                toast({
                    title: 'Falha em upload',
                    description: `${failCount} documento(s) falharam no envio.`,
                    variant: 'destructive',
                });
            }
        },
        [projectId, uploadMutation, uploadedBy],
    );

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        noClick: true,
        multiple: true,
        accept: {
            'application/pdf': ['.pdf'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });

    const doneCount = useMemo(() => uploads.filter((item) => item.status === 'done').length, [uploads]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Upload de Documentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div
                    {...getRootProps()}
                    className={`rounded-md border border-dashed p-6 text-center ${isDragActive ? 'border-blue-600 bg-blue-50' : 'border-input'}`}
                >
                    <input {...getInputProps()} />
                    <p className="text-sm">Arraste arquivos PDF/DOCX aqui</p>
                    <Button type="button" variant="outline" className="mt-3" onClick={open}>
                        Selecionar arquivos
                    </Button>
                </div>

                {uploads.length > 0 && (
                    <div className="space-y-2">
                        {uploads.map((item) => (
                            <div key={item.id} className="rounded border px-3 py-2 text-sm">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="truncate pr-4">{item.name}</span>
                                    <span>
                                        {item.status === 'pending' && 'Pendente'}
                                        {item.status === 'uploading' && `${item.progress}%`}
                                        {item.status === 'done' && 'Concluido'}
                                        {item.status === 'error' && 'Erro'}
                                    </span>
                                </div>
                                <Progress value={item.progress} />
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                            {doneCount} de {uploads.length} upload(s) concluido(s)
                        </p>
                        {uploads.some((item) => item.status === 'uploading') && (
                            <p className="text-xs text-muted-foreground">
                                Enviando arquivos, aguarde alguns segundos...
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
