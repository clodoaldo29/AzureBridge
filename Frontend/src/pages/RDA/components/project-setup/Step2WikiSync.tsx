import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WikiPage } from '@/types';

interface Step2WikiSyncProps {
    projectId: string;
    wikiPages: WikiPage[];
    includeWiki: boolean;
    selectedWikiIds: string[];
    syncing: boolean;
    onIncludeWikiChange: (value: boolean) => void;
    onSelectedWikiIdsChange: (ids: string[]) => void;
    onSyncWiki: () => Promise<void>;
    onBack: () => void;
    onNext: () => void;
}

export function Step2WikiSync({
    projectId,
    wikiPages,
    includeWiki,
    selectedWikiIds,
    syncing,
    onIncludeWikiChange,
    onSelectedWikiIdsChange,
    onSyncWiki,
    onBack,
    onNext,
}: Step2WikiSyncProps) {
    const [previewId, setPreviewId] = useState<string | null>(null);
    const previewPage = wikiPages.find((page) => page.id === previewId);

    const toggleWiki = (id: string) => {
        if (selectedWikiIds.includes(id)) {
            onSelectedWikiIdsChange(selectedWikiIds.filter((value) => value !== id));
            return;
        }
        onSelectedWikiIdsChange([...selectedWikiIds, id]);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Sincronizacao da Wiki</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                    <input
                        id="include-wiki"
                        type="checkbox"
                        checked={includeWiki}
                        onChange={(event) => onIncludeWikiChange(event.target.checked)}
                    />
                    <label htmlFor="include-wiki">Incluir Wiki no setup do projeto</label>
                </div>

                {includeWiki && (
                    <>
                        <div className="flex items-center gap-2">
                            <Button variant="outline" onClick={() => onSyncWiki()} disabled={!projectId || syncing}>
                                {syncing ? 'Sincronizando...' : 'Sincronizar Wiki'}
                            </Button>
                            <button className="text-xs text-blue-600" onClick={() => onSelectedWikiIdsChange(wikiPages.map((w) => w.id))}>
                                Selecionar todas
                            </button>
                            <button className="text-xs text-blue-600" onClick={() => onSelectedWikiIdsChange([])}>
                                Limpar
                            </button>
                        </div>

                        {wikiPages.length === 0 && (
                            <p className="text-sm text-muted-foreground">Nenhuma pagina wiki disponivel.</p>
                        )}

                        {wikiPages.length > 0 && (
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-2">
                                    {wikiPages.map((page) => (
                                        <label key={page.id} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={selectedWikiIds.includes(page.id)}
                                                onChange={() => toggleWiki(page.id)}
                                            />
                                            <span className="flex-1">
                                                <strong>{page.title}</strong>
                                                <span className="block text-xs text-muted-foreground">{page.path}</span>
                                            </span>
                                            <button
                                                type="button"
                                                className="text-xs text-blue-600"
                                                onClick={() => setPreviewId(page.id)}
                                            >
                                                Preview
                                            </button>
                                        </label>
                                    ))}
                                </div>

                                <div className="rounded border p-3 text-sm">
                                    <p className="mb-2 font-medium">Preview da pagina</p>
                                    {previewPage ? (
                                        <>
                                            <p className="text-xs text-muted-foreground">{previewPage.path}</p>
                                            <p className="mt-2 line-clamp-12 whitespace-pre-wrap text-xs">
                                                {previewPage.content || 'Conteudo nao carregado nesta listagem.'}
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Selecione uma pagina para visualizar.</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}

                <div className="flex justify-between">
                    <Button variant="outline" onClick={onBack}>Voltar</Button>
                    <Button onClick={onNext}>Proximo</Button>
                </div>
            </CardContent>
        </Card>
    );
}
