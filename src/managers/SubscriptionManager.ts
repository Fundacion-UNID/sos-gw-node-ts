import { ResourceTypesFhirR5 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { randomUUID } from 'crypto';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import {
  buildFhirR5SubscriptionNotification,
  matchesFhirR5SubscriptionEvent,
} from 'gdc-common-utils-ts/models/fhir-r5-subscription';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { createOperationOutcome } from '../utils/outcome';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantVaultId } from '../utils/tenant';
import type { ITenantsManager } from './ITenantsManager';
import type { ISubscriptionProcessor } from './registry';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

export interface SubscriptionManagerDeps {
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantsCacheManager?: ITenantsManager;
  fetchFn?: FetchLike;
}

const TOPICS_SECTION = 'fhir-r5-subscription-topics';
const SUBSCRIPTIONS_SECTION = 'fhir-r5-subscriptions';
const OUTBOX_SECTION = 'fhir-r5-subscription-notifications';

/** Owns FHIR R5 SubscriptionTopic registration, matching and durable rest-hook delivery. */
export class SubscriptionManager implements ISubscriptionProcessor {
  private readonly fetchFn: FetchLike;
  private readonly scheduledOutboxIds = new Set<string>();

  constructor(private readonly deps: SubscriptionManagerDeps) {
    this.fetchFn = deps.fetchFn || globalThis.fetch.bind(globalThis);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (String(job.format).toLowerCase() !== 'org.hl7.fhir.r5' || job.action !== '_batch') {
      throw new Error('SubscriptionManager supports only org.hl7.fhir.r5 _batch registration.');
    }
    if (!['entity', SUBJECT_SECTION_INDIVIDUAL].includes(String(job.section))) {
      throw new Error('FHIR R5 subscriptions must use the entity or individual section.');
    }
    if (!job.tenantId || !job.sector) throw new Error('Missing tenantId or sector.');

    const vaultId = getTenantVaultId(job.sector as string, job.tenantId);
    const tenantExists = this.deps.tenantsCacheManager
      ? await this.deps.tenantsCacheManager.tenantExists(vaultId)
      : await this.deps.vaultRepository.vaultExists(vaultId);
    const entries = Array.isArray((job.content?.body as any)?.entry) ? (job.content?.body as any).entry : [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      const resource = entry?.resource;
      try {
        if (!tenantExists) throw new Error(`Tenant vault not found: ${vaultId}`);
        if (resource?.resourceType === 'SubscriptionTopic') {
          this.validateTopic(resource);
          await this.store(vaultId, TOPICS_SECTION, resource.id, resource.status, { resource });
        } else {
          this.validateSubscription(resource, String(job.section));
          const topic = await this.findTopic(vaultId, resource.topic);
          if (!topic || topic.status !== 'active') throw new Error(`Active SubscriptionTopic not found: ${resource.topic}`);
          this.validateFilters(resource, topic);
          const activated = resource.status !== 'off' && await this.sendHandshake(resource, topic);
          resource.status = resource.status === 'off' ? 'off' : activated ? 'active' : 'requested';
          await this.store(vaultId, SUBSCRIPTIONS_SECTION, resource.id, resource.status, {
            resource, scope: job.section, createdAt: new Date().toISOString(), eventCount: 0,
          });
        }
        responseEntries.push({
          type: resource.resourceType,
          response: {
            status: String(HttpStatusCodes.Created),
            location: `/${job.tenantId}/cds-${job.jurisdiction}/v1/${job.sector}/${job.section}/org.hl7.fhir.r5/${resource.resourceType}/${resource.id}`,
          },
          resource: { resourceType: resource.resourceType, id: resource.id, status: resource.status },
        });
      } catch (error: any) {
        responseEntries.push({
          type: resource?.resourceType || 'Subscription',
          response: {
            status: error.message.includes('not found') ? '404' : '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, error.message),
          },
        });
      }
    }

    return {
      jti: randomUUID(), type: 'transaction-response', thid: job.content?.thid as string,
      iss: job.content?.aud as string, aud: job.content?.iss as string,
      body: { resourceType: ResourceTypesFhirR4.Bundle, type: '_batch-response', data: responseEntries },
    };
  }

  /** Captures successful resource writes, matches active topics and delivers durable notifications. */
  public async captureEvents(job: JobRequest, result?: IDecodedDidcommPayload): Promise<void> {
    if (!job.tenantId || !job.sector) return;
    if (String(job.resourceType) === 'Subscription' || String(job.resourceType) === 'SubscriptionTopic') return;
    const entries = this.readEntries(job).filter((_, index) => {
      const responseEntry = ((result?.body as any)?.data || [])[index];
      return !responseEntry || /^2\d\d$/.test(String(responseEntry?.response?.status || ''));
    });
    if (!entries.length) return;
    const vaultId = getTenantVaultId(job.sector as string, job.tenantId);
    await this.retryPending(vaultId);
    const subscriptions = await this.readSection(vaultId, SUBSCRIPTIONS_SECTION);
    const topics = await this.readSection(vaultId, TOPICS_SECTION);

    for (const entry of entries) {
      const resource = entry?.resource;
      if (!resource?.resourceType || !resource.id) continue;
      for (const stored of subscriptions) {
        const subscription = stored.resource;
        if (subscription?.status !== 'active') continue;
        const topic = topics.find((candidate) => candidate.resource?.url === subscription.topic)?.resource;
        if (!topic || !matchesFhirR5SubscriptionEvent(subscription, topic, resource)) continue;
        const eventNumber = Number(stored.eventCount || 0) + 1;
        stored.eventCount = eventNumber;
        await this.store(vaultId, SUBSCRIPTIONS_SECTION, subscription.id, 'active', stored);
        const notification = this.buildNotification(subscription, topic, resource, eventNumber);
        const outboxId = randomUUID();
        const outbox = {
          id: outboxId, subscriptionId: subscription.id, endpoint: subscription.endpoint,
          parameters: subscription.parameter || [], notification, status: 'pending', attempts: 0,
          createdAt: new Date().toISOString(), nextAttemptAt: Date.now(),
        };
        await this.store(vaultId, OUTBOX_SECTION, outboxId, 'pending', outbox);
        await this.deliver(vaultId, outbox);
      }
    }
  }

  private readEntries(job: JobRequest): any[] {
    const body = job.content?.body as any;
    return (Array.isArray(body?.entry) && body.entry) || (Array.isArray(body?.data) && body.data) || [];
  }

  private async store(vaultId: string, section: string, id: string, status: string, content: any): Promise<void> {
    const existing = await this.deps.vaultRepository.get<ConfidentialStorageDoc>(vaultId, id, getEnvSectionId(section));
    const doc: ConfidentialStorageDoc = { id, status, sequence: Number(existing?.sequence ?? -1) + 1, content };
    const protectedDoc = await this.deps.kmsService.protectConfidentialData(doc, vaultId);
    await this.deps.vaultRepository.put(vaultId, [protectedDoc], getEnvSectionId(section));
  }

  private async readSection(vaultId: string, section: string): Promise<any[]> {
    const docs = await this.deps.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, getEnvSectionId(section));
    return Promise.all(docs.map((doc) => this.deps.kmsService.unprotectConfidentialData<any>(doc, vaultId)));
  }

  private async findTopic(vaultId: string, url: string): Promise<any | undefined> {
    return (await this.readSection(vaultId, TOPICS_SECTION)).find((item) => item.resource?.url === url)?.resource;
  }

  private validateTopic(topic: any): void {
    if (!topic?.id || !topic.url || !['draft', 'active', 'retired', 'unknown'].includes(topic.status)) {
      throw new Error('SubscriptionTopic requires id, canonical url and valid status.');
    }
    if (!Array.isArray(topic.resourceTrigger) || !topic.resourceTrigger.some((trigger: any) => trigger.resource)) {
      throw new Error('SubscriptionTopic requires at least one resourceTrigger.resource.');
    }
  }

  private validateSubscription(resource: any, section: string): void {
    if (!resource || resource.resourceType !== 'Subscription') throw new Error('Expected FHIR R5 Subscription resource.');
    if (!String(resource.id || '').trim()) throw new Error('Subscription.id is required.');
    if (!['requested', 'off'].includes(String(resource.status))) throw new Error('Subscription.status must be requested or off.');
    if (!String(resource.topic || '').trim()) throw new Error('Subscription.topic is required.');
    if (resource.channelType?.code !== 'rest-hook') throw new Error('The current profile requires channelType rest-hook.');
    let endpoint: URL;
    try { endpoint = new URL(String(resource.endpoint || '')); } catch { throw new Error('Subscription.endpoint must be HTTPS.'); }
    if (endpoint.protocol !== 'https:') throw new Error('Subscription.endpoint must be HTTPS.');
    this.assertEndpointAllowed(endpoint);
    if (section === SUBJECT_SECTION_INDIVIDUAL) {
      const exact = Array.isArray(resource.filterBy) && resource.filterBy.some((filter: any) =>
        ['patient', 'subject'].includes(String(filter?.filterParameter || '').toLowerCase())
        && String(filter?.value || '').trim() && !String(filter.value).includes('*') && !String(filter.value).includes(','));
      if (!exact) throw new Error('An individual Subscription requires an exact patient or subject filter.');
    }
  }

  private assertEndpointAllowed(endpoint: URL): void {
    if (process.env.NODE_ENV !== 'production') return;
    const allowed = String(process.env.FHIR_SUBSCRIPTION_ENDPOINT_HOSTS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(endpoint.hostname.toLowerCase())) throw new Error('Subscription endpoint host is not allowlisted.');
  }

  private validateFilters(subscription: any, topic: any): void {
    for (const filter of subscription.filterBy || []) {
      const allowed = (topic.canFilterBy || []).find((candidate: any) =>
        candidate.filterParameter === filter.filterParameter
        && (!candidate.resourceType || !filter.resourceType || candidate.resourceType === filter.resourceType));
      if (!allowed) throw new Error(`SubscriptionTopic does not allow filter '${filter.filterParameter}'.`);
      const comparator = filter.comparator || 'eq';
      if (allowed.comparator?.length && !allowed.comparator.includes(comparator)) {
        throw new Error(`SubscriptionTopic does not allow comparator '${comparator}'.`);
      }
    }
  }

  private async sendHandshake(subscription: any, topic: any): Promise<boolean> {
    const bundle = this.buildStatusBundle(subscription, topic, 'handshake');
    try { return (await this.post(subscription.endpoint, subscription.parameter || [], bundle)).ok; } catch { return false; }
  }

  private buildNotification(subscription: any, topic: any, resource: any, eventNumber: number): any {
    const bundle: any = buildFhirR5SubscriptionNotification({
      subscriptionReference: `Subscription/${subscription.id}`,
      topic: topic.url,
      eventNumber,
      eventsSinceSubscriptionStart: eventNumber,
      focusReference: `${resource.resourceType}/${resource.id}`,
    });
    if (subscription.content === 'full-resource') bundle.entry.push({ resource });
    return bundle;
  }

  private buildStatusBundle(subscription: any, topic: any, type: string, eventNumber?: number, focus?: string): any {
    const timestamp = new Date().toISOString();
    return { resourceType: ResourceTypesFhirR4.Bundle, type: 'subscription-notification', timestamp, entry: [{ resource: {
      resourceType: ResourceTypesFhirR5.SubscriptionStatus, status: subscription.status === 'requested' ? 'requested' : 'active', type,
      subscription: { reference: `Subscription/${subscription.id}` }, topic: topic.url,
      ...(eventNumber ? { eventsSinceSubscriptionStart: String(eventNumber), notificationEvent: [{ eventNumber: String(eventNumber), timestamp, focus: { reference: focus } }] } : {}),
    } }] };
  }

  private async post(endpoint: string, parameters: any[], body: any): Promise<Pick<Response, 'ok' | 'status'>> {
    const headers: Record<string, string> = { 'content-type': 'application/fhir+json' };
    for (const parameter of parameters) headers[String(parameter.name).toLowerCase()] = String(parameter.value);
    return this.fetchFn(endpoint, { method: HttpRequestMethods.Post, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  }

  private async deliver(vaultId: string, outbox: any): Promise<void> {
    try {
      const response = await this.post(outbox.endpoint, outbox.parameters, outbox.notification);
      outbox.attempts += 1;
      outbox.status = response.ok ? 'delivered' : outbox.attempts >= 5 ? 'failed' : 'retryable';
      outbox.lastStatus = response.status;
    } catch (error: any) {
      outbox.attempts += 1;
      outbox.status = outbox.attempts >= 5 ? 'failed' : 'retryable';
      outbox.lastError = String(error?.message || error);
    }
    outbox.updatedAt = new Date().toISOString();
    const retryDelay = Math.min(60_000, 1000 * (2 ** outbox.attempts));
    outbox.nextAttemptAt = Date.now() + retryDelay;
    await this.store(vaultId, OUTBOX_SECTION, outbox.id, outbox.status, outbox);
    if (outbox.status === 'retryable') this.scheduleRetry(vaultId, outbox, retryDelay);
  }

  private async retryPending(vaultId: string): Promise<void> {
    const pending = await this.readSection(vaultId, OUTBOX_SECTION).catch(() => []);
    for (const outbox of pending) {
      if (outbox.status === 'retryable'
        && !this.scheduledOutboxIds.has(outbox.id)
        && Number(outbox.nextAttemptAt || 0) <= Date.now()) await this.deliver(vaultId, outbox);
    }
  }

  private scheduleRetry(vaultId: string, outbox: any, delay: number): void {
    if (this.scheduledOutboxIds.has(outbox.id)) return;
    this.scheduledOutboxIds.add(outbox.id);
    const timer = setTimeout(() => {
      this.scheduledOutboxIds.delete(outbox.id);
      void this.deliver(vaultId, outbox).catch((error) =>
        console.error(`[FHIR Subscription] retry failed for ${outbox.id}:`, error));
    }, delay);
    timer.unref?.();
  }
}
