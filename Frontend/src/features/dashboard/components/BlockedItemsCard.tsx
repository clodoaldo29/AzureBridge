import { useMemo, useState, type KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toAzureEditUrl } from '@/features/dashboard/utils/azure-url';
import { isBlockedWorkItem } from '@/features/dashboard/utils/blocked-work-items';
import type { WorkItem } from '@/types';

interface BlockedItemsCardProps {
    workItems: WorkItem[];
    projectName?: string;
    itemsArePreFiltered?: boolean;
}

type BlockedRow = {
    id: number;
    title: string;
    type: string;
    assignee: string;
    azureUrl: string | null;
};

export function BlockedItemsCard({ workItems, projectName, itemsArePreFiltered = false }: BlockedItemsCardProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const azureOrgUrl = (import.meta as any)?.env?.VITE_AZURE_DEVOPS_ORG_URL as string | undefined;

    const blockedRows = useMemo<BlockedRow[]>(() => {
        const sourceItems = itemsArePreFiltered ? workItems : workItems.filter((item) => isBlockedWorkItem(item));

        return sourceItems
            .map((item) => ({
                id: item.id,
                title: item.title,
                type: item.type,
                assignee: item.assignedTo?.displayName || 'Nao alocado',
                azureUrl:
                    toAzureEditUrl(item.azureUrl ?? item.url ?? null, item.id, {
                        fallbackOrgUrl: azureOrgUrl,
                        projectName,
                    }) || null,
            }))
            .sort((a, b) => b.id - a.id);
    }, [workItems, itemsArePreFiltered, azureOrgUrl, projectName]);

    const hasItems = blockedRows.length > 0;

    const openModal = () => {
        if (!hasItems) return;
        setIsModalOpen(true);
    };

    const onCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!hasItems) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openModal();
        }
    };

    return (
        <>
            <Card
                className={hasItems ? 'cursor-pointer transition-shadow hover:shadow-md' : ''}
                role={hasItems ? 'button' : undefined}
                tabIndex={hasItems ? 0 : undefined}
                onClick={openModal}
                onKeyDown={onCardKeyDown}
            >
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Impedimentos</CardTitle>
                    <div className="rounded-lg bg-blue-50 p-2">
                        <AlertTriangle className="h-4 w-4 text-blue-600" />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-foreground">{blockedRows.length}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                        {hasItems ? 'Clique para ver itens em impedimento' : 'Sem impedimentos na sprint'}
                    </div>
                </CardContent>
            </Card>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-3xl rounded-lg border border-border bg-background shadow-xl">
                        <div className="flex items-center justify-between border-b border-border p-4">
                            <div>
                                <h3 className="text-lg font-semibold">Itens em impedimento</h3>
                                <p className="text-sm text-muted-foreground">{blockedRows.length} itens</p>
                            </div>
                            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                                Fechar
                            </Button>
                        </div>

                        <div className="max-h-[65vh] space-y-3 overflow-auto p-4">
                            {blockedRows.map((row, index) => {
                                const rowKey = `${row.id}-${index}`;

                                return (
                                    <div key={rowKey} className="rounded-lg border border-border bg-card p-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium text-foreground">
                                                    #{row.id} - {row.title}
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline">{row.type}</Badge>
                                                </div>
                                                <div className="mt-2 text-xs text-muted-foreground">{row.assignee}</div>
                                                {row.azureUrl ? (
                                                    <div className="mt-3">
                                                        <a
                                                            href={row.azureUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="font-medium text-blue-600 hover:underline"
                                                        >
                                                            Abrir no Azure DevOps
                                                        </a>
                                                    </div>
                                                ) : (
                                                    <div className="mt-3 text-xs text-muted-foreground">
                                                        Link Azure indisponivel para este item.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
