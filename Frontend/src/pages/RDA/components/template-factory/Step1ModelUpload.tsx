import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { FileUp, Files } from 'lucide-react';
import type { AxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useAnalyzeModels } from './hooks/useAnalyzeModels';
import type { AnalyzeModelsResponse } from './types';

interface Step1ModelUploadProps {
    projectId?: string;
    onAnalyzed: (payload: { analysis: AnalyzeModelsResponse; files: File[] }) => void;
}

export function Step1ModelUpload({ projectId, onAnalyzed }: Step1ModelUploadProps) {
    const [files, setFiles] = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const analyzeMutation = useAnalyzeModels();

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const docxFiles = acceptedFiles.filter((file) => file.name.toLowerCase().endsWith('.docx'));
        setFiles((previous) => {
            const merged = [...previous, ...docxFiles];
            return merged.slice(0, 5);
        });
    }, []);

    const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
        onDrop,
        noClick: true,
        multiple: true,
        accept: {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });

    const canAnalyze = files.length >= 2 && files.length <= 5 && !analyzeMutation.isPending;

    const handleAnalyze = async () => {
        try {
            setUploadProgress(0);
            const analysis = await analyzeMutation.mutateAsync({
                files,
                projectId,
                onUploadProgress: (percentage) => setUploadProgress(percentage),
            });

            onAnalyzed({ analysis, files });
            toast({
                title: 'Analise concluida',
                description: 'Modelos analisados com sucesso. Revise os placeholders no passo 2.',
            });
        } catch (cause) {
            const error = cause as AxiosError<{ message?: string; error?: string; details?: Array<{ message?: string }> }>;
            const detailMessage = error.response?.data?.details?.[0]?.message;
            const message = detailMessage || error.response?.data?.message || error.response?.data?.error;

            toast({
                title: 'Falha na analise',
                description: message || 'Nao foi possivel analisar os modelos enviados.',
                variant: 'destructive',
            });
        }
    };

    const selectedCountLabel = useMemo(() => `${files.length} arquivo(s) selecionado(s)`, [files.length]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Files className="h-5 w-5" />
                    Step 1: Upload dos Modelos
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div
                    {...getRootProps()}
                    className={`rounded-md border border-dashed p-8 text-center ${isDragActive ? 'border-blue-600 bg-blue-50' : 'border-input'}`}
                >
                    <input {...getInputProps()} />
                    <p className="text-sm">Arraste entre 2 e 5 modelos DOCX para analise</p>
                    <Button type="button" variant="outline" className="mt-3" onClick={open}>
                        <FileUp className="mr-2 h-4 w-4" />
                        Selecionar modelos
                    </Button>
                </div>

                <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">{selectedCountLabel}</Badge>
                    {files.length < 2 && <span className="text-muted-foreground">Minimo: 2 arquivos</span>}
                    {files.length > 5 && <span className="text-red-600">Maximo: 5 arquivos</span>}
                </div>

                {files.length > 0 && (
                    <div className="space-y-2">
                        {files.map((file) => (
                            <div key={`${file.name}-${file.size}`} className="rounded border px-3 py-2 text-sm">
                                {file.name}
                            </div>
                        ))}
                    </div>
                )}

                {analyzeMutation.isPending && (
                    <div className="space-y-2">
                        <Progress value={uploadProgress} />
                        <p className="text-xs text-muted-foreground">Enviando e analisando modelos...</p>
                    </div>
                )}

                <div className="flex justify-end">
                    <Button onClick={handleAnalyze} disabled={!canAnalyze}>
                        {analyzeMutation.isPending ? 'Analisando...' : 'Analisar modelos'}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
