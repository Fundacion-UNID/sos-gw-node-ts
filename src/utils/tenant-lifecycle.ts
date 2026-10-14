// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export const TENANT_AUTHORIZATION_META_KEY = 'tenantAuthorization';
export const TENANT_AUTHORIZATION_ARTIFACT_TYPE = 'local-demo-authorization-status-v1';

export type TenantAuthorizationLifecycleStatus = 'active' | 'suspended' | 'revoked';

export interface TenantAuthorizationLifecycleEvent {
  status: TenantAuthorizationLifecycleStatus;
  changedAt: string;
  changedBy?: string;
}

export interface TenantAuthorizationLifecycleRecord {
  artifactType: string;
  status: TenantAuthorizationLifecycleStatus;
  statusUpdatedAt: string;
  changedBy?: string;
  history: TenantAuthorizationLifecycleEvent[];
}

export function getTenantAuthorizationLifecycle(config: any): TenantAuthorizationLifecycleRecord | undefined {
  const candidate = config?.meta?.[TENANT_AUTHORIZATION_META_KEY];
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  return candidate as TenantAuthorizationLifecycleRecord;
}

export function getTenantAuthorizationStatus(config: any): TenantAuthorizationLifecycleStatus {
  const lifecycle = getTenantAuthorizationLifecycle(config);
  if (!lifecycle?.status) {
    return 'active';
  }
  return lifecycle.status;
}

export function isTenantAuthorizationOperational(config: any): boolean {
  return getTenantAuthorizationStatus(config) === 'active';
}

export function applyTenantAuthorizationStatus(
  config: any,
  status: TenantAuthorizationLifecycleStatus,
  changedBy?: string,
  changedAt: string = new Date().toISOString(),
): any {
  const previous = getTenantAuthorizationLifecycle(config);
  const history = Array.isArray(previous?.history) ? [...previous.history] : [];
  history.push({
    status,
    changedAt,
    ...(changedBy ? { changedBy } : {}),
  });

  return {
    ...config,
    meta: {
      ...(config?.meta || {}),
      lastUpdated: changedAt,
      [TENANT_AUTHORIZATION_META_KEY]: {
        artifactType: previous?.artifactType || TENANT_AUTHORIZATION_ARTIFACT_TYPE,
        status,
        statusUpdatedAt: changedAt,
        ...(changedBy ? { changedBy } : {}),
        history,
      } satisfies TenantAuthorizationLifecycleRecord,
    },
  };
}
