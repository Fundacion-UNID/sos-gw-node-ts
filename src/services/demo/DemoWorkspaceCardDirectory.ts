import { createHash } from 'node:crypto';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { buildDemoWorkspaceScope, type DemoWorkspaceScope } from 'sos-data-utils-ts/demo-workspace-scope';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';

const COLLECTION = 'host';
const SECTION = 'demo_workspace_card_directory';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export type DemoWorkspaceCardRecord = RecordBase & Readonly<{
  scopeKey: string;
  generationId: string;
  cardLocatorHash: string;
  subjectIdentifier: string;
  displayName: string;
  controllerActorIdentifier: string;
  subjectKind: 'person' | 'animal';
  sourceSector: string;
  createdAt: string;
  expiresAt: number;
  revokedAt?: string;
}>;

/** Non-production cross-portal directory backed by the GW storage adapter. */
export class DemoWorkspaceCardDirectory {
  public constructor(private readonly repository: IVaultRepository, private readonly now: () => number = Date.now) {}

  public async register(input: Readonly<{
    scope: DemoWorkspaceScope; generationId: string; cardNumber: string; subjectIdentifier: string;
    displayName: string; controllerActorIdentifier: string; subjectKind: 'person' | 'animal'; sourceSector: string;
  }>): Promise<DemoWorkspaceCardRecord> {
    const scope = buildDemoWorkspaceScope(input.scope);
    const cardLocatorHash = locatorHash(scope.key, input.cardNumber);
    const id = recordId(scope.key, cardLocatorHash);
    const existing = await this.repository.get<DemoWorkspaceCardRecord>(COLLECTION, id, SECTION);
    const comparable = {
      scopeKey: scope.key,
      generationId: required(input.generationId, 'demo_workspace_generation_required'),
      cardLocatorHash,
      subjectIdentifier: required(input.subjectIdentifier, 'demo_workspace_subject_required'),
      displayName: required(input.displayName, 'demo_workspace_display_name_required'),
      controllerActorIdentifier: required(input.controllerActorIdentifier, 'demo_workspace_controller_required'),
      subjectKind: input.subjectKind,
      sourceSector: required(input.sourceSector, 'demo_workspace_sector_required'),
    } as const;
    if (!['person', 'animal'].includes(comparable.subjectKind)) throw new Error('demo_workspace_subject_kind_invalid');
    if (existing && !existing.revokedAt && existing.expiresAt > this.now()) {
      for (const [key, value] of Object.entries(comparable)) {
        if ((existing as unknown as Record<string, unknown>)[key] !== value) throw new Error('demo_workspace_card_conflict');
      }
      return existing;
    }
    const record: DemoWorkspaceCardRecord = { id, ...comparable, createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + DEFAULT_TTL_MS };
    await this.repository.put(COLLECTION, [record], SECTION);
    return record;
  }

  public async resolve(scopeInput: DemoWorkspaceScope, cardNumber: string): Promise<DemoWorkspaceCardRecord | undefined> {
    const scope = buildDemoWorkspaceScope(scopeInput);
    const hash = locatorHash(scope.key, cardNumber);
    const record = await this.repository.get<DemoWorkspaceCardRecord>(COLLECTION, recordId(scope.key, hash), SECTION);
    return !record || record.scopeKey !== scope.key || record.revokedAt || record.expiresAt <= this.now() ? undefined : record;
  }

  public async revoke(scopeInput: DemoWorkspaceScope, generationIdInput: string): Promise<void> {
    const scope = buildDemoWorkspaceScope(scopeInput);
    const generationId = required(generationIdInput, 'demo_workspace_generation_required');
    const records = (await this.repository.getContainersInSection<DemoWorkspaceCardRecord>(COLLECTION, SECTION))
      .filter(record => record.scopeKey === scope.key && record.generationId === generationId);
    const revokedAt = new Date(this.now()).toISOString();
    await Promise.all(records.filter(record => !record.revokedAt).map(record => this.repository.put(COLLECTION, [{ ...record, revokedAt }], SECTION)));
  }
}

function locatorHash(scopeKey: string, cardNumberInput: string): string {
  const cardNumber = required(cardNumberInput, 'demo_workspace_card_number_required');
  if (!/^[0-9]{16,32}$/u.test(cardNumber)) throw new Error('demo_workspace_card_number_invalid');
  return createHash('sha256').update(`${scopeKey}\0${cardNumber}`).digest('base64url');
}
function recordId(scopeKey: string, locator: string) { return createHash('sha256').update(`${scopeKey}\0${locator}`).digest('base64url'); }
function required(value: unknown, code: string) { const result = String(value || '').trim(); if (!result || result.length > 512) throw new Error(code); return result; }
