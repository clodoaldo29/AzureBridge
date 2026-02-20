import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ReviewField } from '@/pages/RDA/hooks/useReview';
import { useRemoveOverride, useSaveOverride } from '@/pages/RDA/hooks/useReview';

interface FieldEditorProps {
    field: ReviewField;
    projectId: string;
    generationId: string;
    onClose: () => void;
}

const LONG_TEXT_FIELDS = new Set([
    'DESCRICAO_ATIVIDADE',
    'JUSTIFICATIVA_ATIVIDADE',
    'RESULTADO_OBTIDO_ATIVIDADE',
    'RESULTADOS_ALCANCADOS',
    'JUSTIFICATIVA_RESPONSAVEL',
]);

function stringValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
}

export function FieldEditor({ field, projectId, generationId, onClose }: FieldEditorProps) {
    const saveMutation = useSaveOverride(projectId, generationId);
    const removeMutation = useRemoveOverride(projectId, generationId);
    const [newValue, setNewValue] = useState<string>(stringValue(field.hasOverride ? field.override?.newValue : field.value));
    const [reason, setReason] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    const isLongText = LONG_TEXT_FIELDS.has(field.fieldName);

    const validate = (): boolean => {
        if (field.isRequired && newValue.trim().length === 0) {
            setValidationError('Este campo e obrigatorio.');
            return false;
        }

        if (LONG_TEXT_FIELDS.has(field.fieldName) && newValue.trim().length > 0 && newValue.trim().length < 50) {
            setValidationError('Campos narrativos devem conter pelo menos 50 caracteres.');
            return false;
        }

        if (field.fieldName === 'CPF_RESPONSAVEL') {
            const digits = newValue.replace(/\D/g, '');
            if (digits.length !== 11) {
                setValidationError('CPF deve conter 11 digitos.');
                return false;
            }
        }

        setValidationError(null);
        return true;
    };

    const handleSave = async () => {
        if (!validate()) return;
        await saveMutation.mutateAsync({
            fieldKey: field.fieldKey,
            newValue,
            reason: reason.trim().length > 0 ? reason.trim() : undefined,
        });
        onClose();
    };

    const handleRevert = async () => {
        await removeMutation.mutateAsync(field.fieldKey);
        onClose();
    };

    return (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Editando: {field.label}</h4>
                {field.hasOverride && <Badge variant="outline">Editado</Badge>}
            </div>

            <div>
                <label className="text-xs text-muted-foreground">Valor original (IA)</label>
                <div className="mt-1 rounded border bg-background p-2 text-sm text-muted-foreground">
                    {stringValue(field.originalValue) || '[vazio]'}
                </div>
            </div>

            <div>
                <label className="text-xs font-medium">Novo valor</label>
                {isLongText ? (
                    <textarea
                        value={newValue}
                        onChange={(event) => setNewValue(event.target.value)}
                        className="mt-1 min-h-[120px] w-full rounded border bg-background p-2 text-sm"
                    />
                ) : (
                    <input
                        type="text"
                        value={newValue}
                        onChange={(event) => setNewValue(event.target.value)}
                        className="mt-1 w-full rounded border bg-background p-2 text-sm"
                    />
                )}
                {isLongText && (
                    <p className="mt-1 text-xs text-muted-foreground">{newValue.length} caracteres</p>
                )}
            </div>

            <div>
                <label className="text-xs text-muted-foreground">Motivo da edicao (opcional)</label>
                <input
                    type="text"
                    value={reason}
                    maxLength={500}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-1 w-full rounded border bg-background p-2 text-sm"
                />
            </div>

            {validationError && (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
                    {validationError}
                </div>
            )}

            <div className="flex justify-end gap-2">
                {field.hasOverride && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleRevert}
                        disabled={removeMutation.isPending}
                    >
                        Reverter ao original
                    </Button>
                )}
                <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Salvando...' : 'Salvar edicao'}
                </Button>
            </div>
        </div>
    );
}
