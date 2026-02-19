import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { AnalyzeModelsResponse, PlaceholderDefinition, PlaceholderType } from './types';

interface Step2AnalysisReviewProps {
    analysis: AnalyzeModelsResponse;
    placeholders: PlaceholderDefinition[];
    onChangePlaceholders: (placeholders: PlaceholderDefinition[]) => void;
    onBack: () => void;
    onGenerate: () => void;
    isGenerating: boolean;
}

const PLACEHOLDER_TYPES: PlaceholderType[] = ['text', 'date', 'number', 'list', 'table', 'enum', 'date_range'];

export function Step2AnalysisReview({
    analysis,
    placeholders,
    onChangePlaceholders,
    onBack,
    onGenerate,
    isGenerating,
}: Step2AnalysisReviewProps) {
    const sectionCount = analysis.analysis.sections.length;
    const fixedCount = analysis.analysis.fixedElements.length;
    const canGenerate = placeholders.length > 0 && !isGenerating;

    const placeholderBySection = useMemo(() => {
        return placeholders.reduce<Record<string, PlaceholderDefinition[]>>((acc, placeholder) => {
            const section = placeholder.section || 'GERAL';
            if (!acc[section]) {
                acc[section] = [];
            }
            acc[section].push(placeholder);
            return acc;
        }, {});
    }, [placeholders]);

    const updatePlaceholder = (index: number, updates: Partial<PlaceholderDefinition>) => {
        const next = [...placeholders];
        next[index] = { ...next[index], ...updates };
        onChangePlaceholders(next);
    };

    const removePlaceholder = (index: number) => {
        const next = placeholders.filter((_, itemIndex) => itemIndex !== index);
        onChangePlaceholders(next);
    };

    const addPlaceholder = () => {
        const next = [
            ...placeholders,
            {
                name: `NOVO_CAMPO_${placeholders.length + 1}`,
                type: 'text' as PlaceholderType,
                required: false,
                section: 'GERAL',
                description: 'Campo adicionado manualmente',
                examples: [],
            },
        ];
        onChangePlaceholders(next);
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Step 2: Revisao da Analise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">Secoes: {sectionCount}</Badge>
                    <Badge variant="secondary">Placeholders: {placeholders.length}</Badge>
                    <Badge variant="secondary">Elementos fixos: {fixedCount}</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                    {Object.entries(placeholderBySection).map(([section, values]) => (
                        <Card key={section}>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm">{section}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-xs text-muted-foreground">
                                {values.map((item) => (
                                    <p key={`${section}-${item.name}`}>{item.name}</p>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <div className="space-y-3">
                    {placeholders.map((placeholder, index) => (
                        <div key={`${placeholder.name}-${index}`} className="rounded border p-3">
                            <div className="grid gap-2 md:grid-cols-4">
                                <input
                                    className="rounded-md border px-3 py-2 text-sm"
                                    value={placeholder.name}
                                    onChange={(event) => updatePlaceholder(index, { name: event.target.value.toUpperCase() })}
                                    placeholder="Nome"
                                />

                                <Select
                                    value={placeholder.type}
                                    onValueChange={(value: PlaceholderType) => updatePlaceholder(index, { type: value })}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Tipo" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PLACEHOLDER_TYPES.map((type) => (
                                            <SelectItem key={type} value={type}>{type}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <input
                                    className="rounded-md border px-3 py-2 text-sm"
                                    value={placeholder.section}
                                    onChange={(event) => updatePlaceholder(index, { section: event.target.value })}
                                    placeholder="Secao"
                                />

                                <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={placeholder.required}
                                        onChange={(event) => updatePlaceholder(index, { required: event.target.checked })}
                                    />
                                    Obrigatorio
                                </label>
                            </div>

                            <textarea
                                className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
                                value={placeholder.description}
                                onChange={(event) => updatePlaceholder(index, { description: event.target.value })}
                                placeholder="Descricao"
                            />

                            <div className="mt-2 flex justify-end">
                                <Button type="button" variant="outline" size="sm" onClick={() => removePlaceholder(index)}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Remover
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <details className="rounded border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Elementos fixos encontrados</summary>
                    <div className="mt-2 space-y-2 text-sm text-muted-foreground">
                        {analysis.analysis.fixedElements.map((item, index) => (
                            <p key={`${item.type}-${index}`}>[{item.type}] {item.content}</p>
                        ))}
                        {analysis.analysis.fixedElements.length === 0 && <p>Nenhum elemento fixo identificado.</p>}
                    </div>
                </details>

                <div className="flex flex-wrap justify-between gap-2">
                    <Button variant="outline" onClick={onBack}>Voltar</Button>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={addPlaceholder}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar placeholder
                        </Button>
                        <Button onClick={onGenerate} disabled={!canGenerate}>
                            {isGenerating ? 'Gerando template...' : 'Gerar template'}
                        </Button>
                    </div>
                </div>
                {placeholders.length === 0 && (
                    <p className="text-sm text-red-600">
                        Nenhum placeholder identificado. Adicione ao menos um placeholder antes de gerar o template.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
