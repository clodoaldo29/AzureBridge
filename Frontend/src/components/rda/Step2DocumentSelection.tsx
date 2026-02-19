import type { Document, WikiPage } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSyncWiki } from '@/features/rda/queries/wiki';
import { toast } from '@/hooks/use-toast';

interface Step2DocumentSelectionProps {
    projectId: string;
    documents: Document[];
    wikiPages: WikiPage[];
    selectedDocumentIds: string[];
    selectedWikiPageIds: string[];
    onDocumentSelectionChange: (ids: string[]) => void;
    onWikiSelectionChange: (ids: string[]) => void;
}

export function Step2DocumentSelection({
    projectId,
    documents,
    wikiPages,
    selectedDocumentIds,
    selectedWikiPageIds,
    onDocumentSelectionChange,
    onWikiSelectionChange,
}: Step2DocumentSelectionProps) {
    const syncWikiMutation = useSyncWiki();

    const toggleItem = (selected: string[], id: string, onChange: (ids: string[]) => void) => {
        if (selected.includes(id)) {
            onChange(selected.filter((value) => value !== id));
            return;
        }
        onChange([...selected, id]);
    };

    const handleSyncWiki = async () => {
        if (!projectId) {
            toast({
                title: 'Projeto obrigatorio',
                description: 'Selecione um projeto no Step 1 para sincronizar a Wiki.',
                variant: 'destructive',
            });
            return;
        }

        try {
            const result = await syncWikiMutation.mutateAsync(projectId);
            toast({
                title: 'Wiki sincronizada',
                description: `${result.synced} pagina(s) atualizada(s) de ${result.total}.`,
            });
        } catch {
            toast({
                title: 'Falha na sincronizacao',
                description: 'Nao foi possivel sincronizar a Wiki do projeto.',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Documentos</CardTitle>
                    <div className="flex gap-2 text-xs">
                        <button
                            className="text-blue-600"
                            onClick={() => onDocumentSelectionChange(documents.map((document) => document.id))}
                        >
                            Selecionar todos
                        </button>
                        <span>|</span>
                        <button className="text-blue-600" onClick={() => onDocumentSelectionChange([])}>
                            Limpar selecao
                        </button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-2">
                    {documents.length === 0 && <p className="text-sm text-muted-foreground">Sem documentos.</p>}
                    {documents.map((document) => (
                        <label key={document.id} className="flex items-start gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={selectedDocumentIds.includes(document.id)}
                                onChange={() => toggleItem(selectedDocumentIds, document.id, onDocumentSelectionChange)}
                            />
                            <span>
                                <strong>{document.filename}</strong>
                                <span className="block text-xs text-muted-foreground">{document.mimeType}</span>
                            </span>
                        </label>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">Wiki Pages</CardTitle>
                        <Button type="button" variant="outline" size="sm" onClick={handleSyncWiki} disabled={syncWikiMutation.isPending || !projectId}>
                            {syncWikiMutation.isPending ? 'Sincronizando...' : 'Sincronizar Wiki'}
                        </Button>
                    </div>
                    <div className="flex gap-2 text-xs">
                        <button className="text-blue-600" onClick={() => onWikiSelectionChange(wikiPages.map((page) => page.id))}>
                            Selecionar todos
                        </button>
                        <span>|</span>
                        <button className="text-blue-600" onClick={() => onWikiSelectionChange([])}>
                            Limpar selecao
                        </button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-2">
                    {wikiPages.length === 0 && <p className="text-sm text-muted-foreground">Sem paginas wiki.</p>}
                    {wikiPages.map((page) => (
                        <label key={page.id} className="flex items-start gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={selectedWikiPageIds.includes(page.id)}
                                onChange={() => toggleItem(selectedWikiPageIds, page.id, onWikiSelectionChange)}
                            />
                            <span>
                                <strong>{page.title}</strong>
                                <span className="block text-xs text-muted-foreground">{page.path}</span>
                            </span>
                        </label>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
