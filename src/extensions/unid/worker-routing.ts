// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import type { IJobProcessor, ManagerRegistry } from '../../managers/registry';

export function resolveUnidWorkerManager(
  resourceType: string,
  managers: ManagerRegistry,
): IJobProcessor | undefined {
  switch (resourceType) {
    case 'Task':
      return managers.taskManager;
    default:
      return undefined;
  }
}
