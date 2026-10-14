// src/utils/naming.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Creates a unique and informative name for a job to be placed in the queue.
 * The name follows the structure: <priority>-<timestamp>:<jobContextId>:<resourceType>:<action>
 * 
 * Job Priority is based on a Triage scale, similar to the Manchester Triage System (MTS),
 * where 1 is the highest priority and 5 is the lowest. If not specified, priority defaults to 5.
 * 
 * @param jobContextId A unique identifier for the job's context. In the API layer, this **MUST** be the tenant's `vaultId` (e.g., 'health-care_acme') to ensure job name uniqueness across sectors.
 * @param resourceType The type of the resource being processed.
 * @param action The action being performed (e.g., '_batch', '_update').
 * @param priority The priority of the job, from 1 (highest) to 5 (lowest).
 * @returns A unique, priority-sorted job name string.
 */
export function createJobName(jobContextId: string, resourceType: string, action: string, priority: 1 | 2 | 3 | 4 | 5 = 5): string {
  const timestamp = Date.now();
  return `${priority}-${timestamp}:${jobContextId}:${resourceType}:${action}`;
}

/**
 * Parses a job name to extract its constituent parts.
 * 
 * @param jobName The unique job name.
 * @returns An object containing the parts of the name, or null if the name is invalid. The `jobContextId` will correspond to the `vaultId` passed during creation.
 */
export function parseJobName(jobName: string): { priority: number, timestamp: number, jobContextId: string, resourceType: string, action: string } | null {
  const [priorityTime, jobContextId, resourceType, action] = jobName.split(':');
  if (!priorityTime || !jobContextId || !resourceType || !action) {
    return null;
  }
  const [priority, timestamp] = priorityTime.split('-').map(Number);

  if (isNaN(priority) || isNaN(timestamp)) {
    return null;
  }

  return {
    priority,
    timestamp,
    jobContextId,
    resourceType,
    action: action // The action already includes the underscore
  };
}

/**
 * Creates a unique and informative identifier for a messaging section (e.g., an inbox or sent folder).
 * The name follows the structure: <timestamp>_<parentId>_<destinationId>_<type>
 * 
 * @param parentId The ID of the containing vault (e.g., a Group ID, a List ID).
 * @param destinationId The ID of the group or member the message is for/from.
 * @param type The type of the box (e.g., 'inbox', 'sent').
 * @returns A unique section ID string.
 */
export function createMessageSectionId(parentId: string, destinationId: string, type: 'inbox' | 'sent'): string {
  const timestamp = Date.now();
  return `${timestamp}_${parentId}_${destinationId}_${type}`;
}

