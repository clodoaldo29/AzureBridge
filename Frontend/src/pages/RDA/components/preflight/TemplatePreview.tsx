import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PlaceholderInfo } from '@/pages/RDA/hooks/usePreflight';

interface TemplatePreviewProps {
    placeholders: PlaceholderInfo[];
}

function renderNode(node: PlaceholderInfo, level = 0): JSX.Element {
    return (
        <div key={`${node.name}-${level}`} className={`rounded border p-2 ${level > 0 ? 'ml-4 mt-2' : 'mt-2'}`}>
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{node.name}</div>
                <div className="flex items-center gap-2">
                    <Badge variant="secondary">{node.type}</Badge>
                    <Badge variant={node.required ? 'destructive' : 'outline'}>{node.required ? 'Obrigatorio' : 'Opcional'}</Badge>
                </div>
            </div>
            {node.description && <p className="mt-1 text-xs text-muted-foreground">{node.description}</p>}
            {node.guideType && <p className="text-xs text-muted-foreground">Tipo (guia): {node.guideType}</p>}
            {node.sourceHint && <p className="text-xs text-muted-foreground">Fonte: {node.sourceHint}</p>}
            {node.rules && node.rules.length > 0 && (
                <div className="mt-1 text-xs text-muted-foreground">
                    {node.rules.map((rule) => (
                        <p key={`${node.name}-${rule}`}>- {rule}</p>
                    ))}
                </div>
            )}
            {node.childPlaceholders?.map((child) => renderNode(child, level + 1))}
        </div>
    );
}

export function TemplatePreview({ placeholders }: TemplatePreviewProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Estrutura do template</CardTitle>
            </CardHeader>
            <CardContent>
                {placeholders.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum placeholder encontrado.</p>
                )}
                {placeholders.map((item) => renderNode(item))}
            </CardContent>
        </Card>
    );
}
