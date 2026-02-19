import type { Project } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RDAWizardFormData } from './types';

interface Step1ProjectSelectionProps {
    projects: Project[];
    formData: RDAWizardFormData;
    onChange: (updates: Partial<RDAWizardFormData>) => void;
}

export function Step1ProjectSelection({ projects, formData, onChange }: Step1ProjectSelectionProps) {
    const isPeriodInvalid =
        formData.periodStart && formData.periodEnd && new Date(formData.periodEnd) <= new Date(formData.periodStart);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Step 1: Projeto e Periodo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Projeto</label>
                        <Select value={formData.projectId} onValueChange={(value) => onChange({ projectId: value })}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione um projeto" />
                            </SelectTrigger>
                            <SelectContent>
                                {projects.map((project) => (
                                    <SelectItem key={project.id} value={project.id}>
                                        {project.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Template</label>
                        <div className="rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
                            Template oficial global ativo (automatico)
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium">Tipo do periodo</label>
                    <div className="flex gap-4">
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="radio"
                                name="periodType"
                                value="monthly"
                                checked={formData.periodType === 'monthly'}
                                onChange={() => onChange({ periodType: 'monthly' })}
                            />
                            Mensal
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                            <input
                                type="radio"
                                name="periodType"
                                value="general"
                                checked={formData.periodType === 'general'}
                                onChange={() => onChange({ periodType: 'general' })}
                            />
                            Geral
                        </label>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Data inicial</label>
                        <input
                            type="date"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={formData.periodStart}
                            onChange={(event) => onChange({ periodStart: event.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Data final</label>
                        <input
                            type="date"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={formData.periodEnd}
                            onChange={(event) => onChange({ periodEnd: event.target.value })}
                        />
                    </div>
                </div>

                {isPeriodInvalid && (
                    <p className="text-sm text-red-600">A data final deve ser maior que a data inicial.</p>
                )}
            </CardContent>
        </Card>
    );
}
