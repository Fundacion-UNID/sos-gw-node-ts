import type { TaskRecord, TaskService } from 'tasks-core-node-ts';

export interface UhcTaskOrchestratorOptions {
  taskService: TaskService;
}

export type NextCallSelection = {
  rootTask: TaskRecord;
  callTask: TaskRecord;
  childTasks: TaskRecord[];
  pendingChildTasks: TaskRecord[];
  pendingReminderCount: number;
};

export type NextCallSelectionNone = {
  rootTask: TaskRecord;
  reason: 'resolved' | 'not-due' | 'active-call-open';
};

function normalizePartOfReference(value: string | undefined): string | undefined {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  return raw.startsWith('Task/') ? raw.slice('Task/'.length) : raw;
}

function isResolvedStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'acknowledged';
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function isVoiceCallOpen(task: TaskRecord): boolean {
  return String(task.metadata?.['voice-call-open'] || '').trim().toLowerCase() === 'true';
}

function sortStableByCreation(left: TaskRecord, right: TaskRecord): number {
  const leftAt = left.createdAt || left.id;
  const rightAt = right.createdAt || right.id;
  return leftAt.localeCompare(rightAt);
}

export class UhcTaskOrchestrator {
  private readonly options: UhcTaskOrchestratorOptions;

  constructor(options: UhcTaskOrchestratorOptions) {
    this.options = options;
  }

  isRootTask(task: TaskRecord): boolean {
    return !normalizePartOfReference(task.metadata?.['part-of']);
  }

  async selectNextCallTask(rootTask: TaskRecord): Promise<NextCallSelection | NextCallSelectionNone> {
    const now = new Date();
    const subjectTasks = await this.options.taskService.listTasks({ subjectId: rootTask.subjectId });
    const childTasks = subjectTasks
      .filter((task) => normalizePartOfReference(task.metadata?.['part-of']) === rootTask.id)
      .sort(sortStableByCreation);

    if (childTasks.length === 0) {
      if (isResolvedStatus(rootTask.status)) {
        return { rootTask, reason: 'resolved' };
      }
      if (isVoiceCallOpen(rootTask)) {
        return { rootTask, reason: 'active-call-open' };
      }
      const rootDue = toDate(rootTask.scheduledFor);
      if (rootDue && rootDue > now) {
        return { rootTask, reason: 'not-due' };
      }
      return {
        rootTask,
        callTask: rootTask,
        childTasks,
        pendingChildTasks: [],
        pendingReminderCount: 1,
      };
    }

    const pendingChildTasks = childTasks.filter((task) => !isResolvedStatus(task.status));
    if (pendingChildTasks.length === 0) {
      return { rootTask, reason: 'resolved' };
    }
    if (pendingChildTasks.some((task) => isVoiceCallOpen(task))) {
      return { rootTask, reason: 'active-call-open' };
    }

    const nextChild = pendingChildTasks[0];
    const nextDue = toDate(nextChild.scheduledFor);
    if (nextDue && nextDue > now) {
      return { rootTask, reason: 'not-due' };
    }

    return {
      rootTask,
      callTask: nextChild,
      childTasks,
      pendingChildTasks,
      pendingReminderCount: pendingChildTasks.length,
    };
  }
}
