// Copyright 2025 Connecting Solution & Applications Ltd under the Apache License, Version 2.0.

import { createTaskService } from 'tasks-core-node-ts';
import { TaskManager } from '../../managers/TaskManager';
import type { ITenantsManager } from '../../managers/ITenantsManager';

export function buildUnidManagers(options: { tenantManager: ITenantsManager }) {
  const { tenantManager } = options;
  const taskService = createTaskService({ defaultChannels: ['phone'] });
  const taskManager = new TaskManager({ taskService, tenantsCacheManager: tenantManager });

  return { taskService, taskManager };
}
