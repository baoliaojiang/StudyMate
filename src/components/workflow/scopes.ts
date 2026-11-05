import type { WorkflowScope } from '../../core/types';
import { SCOPE_LABEL, SCOPE_NOTE } from '../../workflow/graph';

export const SCOPES: { key: WorkflowScope; label: string; note: string }[] = [
  { key: 'project', label: SCOPE_LABEL.project, note: SCOPE_NOTE.project },
  { key: 'stage', label: SCOPE_LABEL.stage, note: SCOPE_NOTE.stage },
  { key: 'report', label: SCOPE_LABEL.report, note: SCOPE_NOTE.report },
];
