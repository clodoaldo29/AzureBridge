import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useActivateTemplate, useDeleteTemplate, useTemplates, useUploadTemplate } from '@/services/queries/templates';
import { toast } from '@/hooks/use-toast';

interface TemplateManagerProps {
    projectId: string;
}

export function TemplateManager({ projectId }: TemplateManagerProps) {
    const { data: templates = [], isLoading } = useTemplates();
    const uploadMutation = useUploadTemplate();
    const activateMutation = useActivateTemplate();
    const deleteMutation = useDeleteTemplate();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const filteredTemplates = useMemo(
        () => templates.filter((template) => !projectId || template.projectId === projectId),
        [projectId, templates],
    );

    const handleUpload = async () => {
        if (!file || !name || !projectId) {
            return;
        }

        try {
            await uploadMutation.mutateAsync({
                projectId,
                file,
                name,
                description,
                uploadedBy: 'user',
            });

            setName('');
            setDescription('');
            setFile(null);

            toast({
                title: 'Template enviado',
                description: 'Template cadastrado com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha no upload',
                description: 'Não foi possível enviar o template.',
                variant: 'destructive',
            });
        }
    };

    const handleActivate = async (id: string) => {
        try {
            await activateMutation.mutateAsync(id);
            toast({
                title: 'Template ativado',
                description: 'Template ativo atualizado com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha ao ativar',
                description: 'Não foi possível ativar este template.',
                variant: 'destructive',
            });
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteMutation.mutateAsync(id);
            toast({
                title: 'Template removido',
                description: 'Template removido com sucesso.',
            });
        } catch {
            toast({
                title: 'Falha ao remover',
                description: 'Não foi possível remover este template.',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="space-y-4">
            {!projectId && (
                <Card>
                    <CardContent className="p-4 text-sm text-muted-foreground">
                        Selecione um projeto para gerenciar templates de RDA.
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Novo Template</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <input
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder="Nome do template"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <textarea
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder="Descrição"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                    />
                    <input
                        type="file"
                        accept=".docx"
                        onChange={(event) => setFile(event.target.files?.[0] || null)}
                    />
                    <Button onClick={handleUpload} disabled={uploadMutation.isPending || !file || !name || !projectId}>
                        {uploadMutation.isPending ? 'Enviando...' : 'Upload Template'}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isLoading && <p className="text-sm text-muted-foreground">Carregando templates...</p>}
                    {filteredTemplates.length === 0 && !isLoading && (
                        <p className="text-sm text-muted-foreground">Nenhum template cadastrado.</p>
                    )}
                    {filteredTemplates.map((template) => (
                        <div key={template.id} className="rounded border p-3">
                            <p className="font-medium text-sm">
                                {template.name} {template.isActive ? '(Ativo)' : ''}
                            </p>
                            {template.description && <p className="text-xs text-muted-foreground">{template.description}</p>}
                            <p className="text-xs text-muted-foreground mt-1">
                                Placeholders: {template.placeholders.join(', ') || 'Nenhum'}
                            </p>
                            <div className="mt-2 flex gap-2">
                                <Button size="sm" variant="outline" onClick={() => handleActivate(template.id)}>
                                    Ativar
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleDelete(template.id)}>
                                    Deletar
                                </Button>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
