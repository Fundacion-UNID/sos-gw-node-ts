export const STORAGE_LAYOUTS = ['legacy-v1', 'scoped-v2'] as const;
export type StorageLayout = typeof STORAGE_LAYOUTS[number];

export const DEPLOYMENT_ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type DeploymentEnvironment = typeof DEPLOYMENT_ENVIRONMENTS[number];

export const LEDGER_NETWORK_MODES = ['test', 'test-network', 'network'] as const;
export type LedgerNetworkMode = typeof LEDGER_NETWORK_MODES[number];

export type StorageScope = Readonly<{
  layout: StorageLayout;
  prefix?: string;
}>;

function readAllowed<T extends readonly string[]>(
  key: string,
  values: T,
): T[number] {
  const value = String(process.env[key] || '').trim().toLowerCase();
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`${key} must be one of: ${values.join(', ')}.`);
  }
  return value as T[number];
}

/**
 * Resolves the physical persistence layout without deriving it from NODE_ENV,
 * public domains, Kubernetes namespaces or legal identifiers.
 *
 * `legacy-v1` is the compatibility default and preserves every historical
 * collection/section path. `scoped-v2` fails closed unless deployment, ledger
 * mode and stable host scope are explicitly configured.
 */
export function resolveStorageScope(): StorageScope {
  const rawLayout = String(process.env.STORAGE_LAYOUT || 'legacy-v1').trim().toLowerCase();
  if (!(STORAGE_LAYOUTS as readonly string[]).includes(rawLayout)) {
    throw new Error(`STORAGE_LAYOUT must be one of: ${STORAGE_LAYOUTS.join(', ')}.`);
  }
  const layout = rawLayout as StorageLayout;
  if (layout === 'legacy-v1') return { layout };

  const deploymentEnvironment = readAllowed('DEPLOYMENT_ENV', DEPLOYMENT_ENVIRONMENTS);
  const networkMode = readAllowed('NETWORK_MODE', LEDGER_NETWORK_MODES);
  const rawHostScope = String(process.env.HOST_STORAGE_SCOPE || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rawHostScope)) {
    throw new Error('HOST_STORAGE_SCOPE must be a non-empty lowercase slug.');
  }

  return {
    layout,
    prefix: `${deploymentEnvironment}_${networkMode}_${rawHostScope}`,
  };
}

export function scopePhysicalCollectionName(collectionName: string): string {
  const scope = resolveStorageScope();
  return scope.prefix ? `${scope.prefix}__${collectionName}` : collectionName;
}

/**
 * Resolves the reserved physical collection for host-owned registry state.
 *
 * The canonical name is independent from the legal organization operating the
 * deployment. `HOST_LEGACY_PHYSICAL_COLLECTION` is an explicit migration-only
 * pin for an already deployed host; it must never be derived from current
 * organization claims.
 */
export function resolveHostPhysicalCollectionName(): string {
  const legacyCollection = String(process.env.HOST_LEGACY_PHYSICAL_COLLECTION || '').trim();
  if (legacyCollection && !/^[A-Za-z0-9._-]+$/.test(legacyCollection)) {
    throw new Error('HOST_LEGACY_PHYSICAL_COLLECTION must be one exact collection identifier.');
  }
  return legacyCollection || scopePhysicalCollectionName('host');
}
