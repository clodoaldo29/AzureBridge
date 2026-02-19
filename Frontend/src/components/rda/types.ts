import type { RDAPeriodType } from '@/types';

export interface RDAWizardFormData {
    projectId: string;
    periodType: RDAPeriodType;
    periodStart: string;
    periodEnd: string;
    documentIds: string[];
    wikiPageIds: string[];
    generatedBy: string;
}
