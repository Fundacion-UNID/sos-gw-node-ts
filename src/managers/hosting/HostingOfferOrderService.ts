import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { v4 as uuidv4 } from 'uuid';
import { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { IServerConfig } from '../../config';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import type { IHostRuntime } from '../IHostRuntime';
import {
  buildOfferOrderIndexedAttributes,
  buildOfferOrderSearchRow,
  extractOfferOrderSearchClaims,
  matchOfferOrderSearchClaims,
  readProjectedOfferOrderClaims,
} from '../../utils/offer-order-read-model';
import { getEnvSectionId } from '../../utils/section-env';
import { composeHostDidWebId } from '../../utils/did-backend';
import { getTenantVaultId } from '../../utils/tenant';
import { buildPaymentCommunication, readOfferPaymentContext } from '../../utils/order-communication';
import { buildGatewayInvoiceBundle } from '../../utils/invoice-bundle';
import { verifyOrderPaymentConfirmation } from '../../utils/payment-confirmation';
import { generateLicenseOffer } from '../../utils/offer';
import { getClaimValue, normalizeContextualizedClaims } from '../../utils/claims';
import { LICENSE_CATEGORY_PROFESSIONAL } from '../../constants/domain';
import { buildSearchResponseEntries } from '../../utils/didcomm-response';
import { GatewayResponseEntryTypes } from '../../shared/gateway-response-types';

export class HostingOfferOrderService {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: IHostingTenantRegistry,
    private readonly config: IServerConfig,
    private readonly hostRuntime: IHostRuntime,
  ) {}

  /**
   * Reads the portable plaintext projection when present and otherwise opens
   * the host-owned JWE. Firestore persists the confidential document boundary
   * (`jwe` plus protected indexes), so administrative Offer/Order reads must
   * not assume the in-memory adapter's optional `meta.claims` projection.
   */
  private async readClaims(secureDoc: ConfidentialStorageDoc): Promise<Record<string, unknown>> {
    const projected = readProjectedOfferOrderClaims(secureDoc);
    if (Object.keys(projected).length > 0) return projected;
    const content = await this.kmsService.unprotectConfidentialData(secureDoc, 'host');
    return readProjectedOfferOrderClaims({ content } as ConfidentialStorageDoc);
  }

  /**
   * Uses protected attributes when the stored generation contains them. Older
   * pending registrations indexed only status and Offer identifier, so an
   * empty indexed result falls back to the host-authorized section scan; the
   * caller still decrypts and applies the exact requested claims afterwards.
   */
  private async findSearchCandidates(
    sectionId: string,
    where: Array<{ name: string; value: string }>,
  ): Promise<ConfidentialStorageDoc[]> {
    if (where.length === 0) {
      return this.vaultRepository.listContainersInSection(this.hostRuntime.hostCollectionName, sectionId);
    }
    const indexed = await this.vaultRepository.query(
      this.hostRuntime.hostCollectionName,
      { sectionId, where },
      { hydrate: false },
    );
    return indexed.length > 0
      ? indexed as ConfidentialStorageDoc[]
      : this.vaultRepository.listContainersInSection(this.hostRuntime.hostCollectionName, sectionId);
  }

  /**
   * Creates a host-authored professional-seat Offer for an already active
   * tenant. The signed controller request supplies only the requested seat
   * quantity; price, currency, payment methods and identifier remain host
   * policy. Serial numbers are created only after an accepted Order, never in
   * the quotation. Persisting the Offer in the host communication section
   * lets the existing host `Order/_batch` continuation resolve it without
   * moving tenant keys or trusting browser-authored commercial evidence.
   */
  async processEmployeeLicenseOfferCreateEntry(
    job: Pick<import('gdc-common-utils-ts/models/confidential-job').JobRequest, 'tenantId' | 'sector'>,
    entry: BundleEntry,
  ): Promise<BundleEntry> {
    const tenantId = String(job.tenantId || '').trim();
    const sector = String(job.sector || '').trim() as Sector;
    if (!tenantId || !sector) {
      throw new ManagerError('Professional-seat Offer requires tenantId and sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(sector, tenantId);
    if (!(await this.tenantsCacheManager.isTenantOperational(tenantVaultId))) {
      throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    }

    const requestedClaims = normalizeContextualizedClaims(entry.resource?.meta?.claims || {});
    const category = String(getClaimValue<string>(
      requestedClaims,
      'org.schema.IndividualProduct.category',
    ) || '').trim();
    const quantity = Number(getClaimValue<unknown>(
      requestedClaims,
      ClaimsOfferSchemaorg.eligibleQuantityValue,
    ));
    if (category !== LICENSE_CATEGORY_PROFESSIONAL) {
      throw new ManagerError('Professional-seat Offer requires the professional category.', IssueType.Invalid);
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new ManagerError('Professional-seat Offer quantity must be an integer from 1 to 100.', IssueType.Value);
    }

    const claims: ClaimsRecord = {
      ...generateLicenseOffer(
        quantity,
        composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain),
        this.config.host.jurisdiction || '',
        sector,
        this.config.allowedPaymentMethods,
      ),
      [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
      [ClaimsServiceSchemaorg.category]: sector,
    };
    delete claims[ClaimsOfferSchemaorg.serialNumber];
    const offerId = String(claims[ClaimsOfferSchemaorg.identifier]);
    const document: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: uuidv4(),
      status: EntityLifecycleStatus.Pending,
      sequence: 0,
      meta: { claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims },
    };
    const protectedDocument = await this.kmsService.protectConfidentialData(document, 'host');
    await this.vaultRepository.put(
      this.hostRuntime.hostCollectionName,
      [protectedDocument],
      getEnvSectionId('communications'),
    );

    return {
      type: GatewayResponseEntryTypes.OrganizationLicenseOffer,
      resource: { id: offerId, meta: { claims } } as any,
      response: { status: String(HttpStatusCodes.Created) },
    };
  }

  async processOfferSearchEntry(job: { tenantId?: string }, entry: BundleEntry): Promise<BundleEntry[]> {
    const filters = extractOfferOrderSearchClaims(entry);
    const routedTenantId = String(job.tenantId || '').trim();
    const tenantIdFilter = routedTenantId.toLowerCase() === 'host' ? '' : routedTenantId;
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const tenantWhere = tenantIdFilter
      ? [...where, { name: ClaimsOrganizationSchemaorg.alternateName, value: tenantIdFilter }]
      : where;
    const tenantRecords = await this.findSearchCandidates(getEnvSectionId('tenants'), tenantWhere);
    const communicationRecords = await this.findSearchCandidates(getEnvSectionId('communications'), tenantWhere);

    const matches: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();
    for (const secureDoc of [...tenantRecords, ...communicationRecords] as ConfidentialStorageDoc[]) {
      const claims = { ...await this.readClaims(secureDoc) };
      if (!claims[ClaimsOfferSchemaorg.identifier] && claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]) {
        claims[ClaimsOfferSchemaorg.identifier] = claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier];
      }
      const alternateName = String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
      if (tenantIdFilter && alternateName && alternateName !== tenantIdFilter) continue;
      if (!claims[ClaimsOfferSchemaorg.identifier]) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      const row = buildOfferOrderSearchRow(secureDoc, claims, ClaimsOfferSchemaorg.identifier);
      const rowId = String(row.id || '').trim();
      if (rowId && seenIds.has(rowId)) continue;
      if (rowId) seenIds.add(rowId);
      matches.push(row);
    }

    return buildSearchResponseEntries(GatewayResponseEntryTypes.OfferSearch, matches);
  }

  async processOrderSearchEntry(job: { tenantId?: string }, entry: BundleEntry): Promise<BundleEntry[]> {
    const filters = extractOfferOrderSearchClaims(entry);
    const routedTenantId = String(job.tenantId || '').trim();
    const tenantIdFilter = routedTenantId.toLowerCase() === 'host' ? '' : routedTenantId;
    const where = Object.entries(filters)
      .filter(([key, value]) => !key.startsWith('@') && value !== undefined && value !== null && String(value).trim() !== '')
      .map(([name, value]) => ({ name, value: String(value).trim() }));
    const tenantWhere = tenantIdFilter
      ? [...where, { name: ClaimsOrganizationSchemaorg.alternateName, value: tenantIdFilter }]
      : where;
    const tenantRecords = await this.findSearchCandidates(getEnvSectionId('tenants'), tenantWhere);
    const orderRecords = await this.findSearchCandidates(getEnvSectionId('communications'), tenantWhere);

    const allowedOfferIds = new Set<string>();
    for (const secureDoc of tenantRecords as ConfidentialStorageDoc[]) {
      const claims = await this.readClaims(secureDoc);
      const alternateName = String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
      if (tenantIdFilter && alternateName && alternateName !== tenantIdFilter) continue;
      const offerId = String(claims[ClaimsOfferSchemaorg.identifier] || '').trim();
      if (offerId) allowedOfferIds.add(offerId);
    }

    const matches: Record<string, unknown>[] = [];
    for (const secureDoc of orderRecords as ConfidentialStorageDoc[]) {
      const claims = await this.readClaims(secureDoc);
      const acceptedOfferId = String(claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] || '').trim();
      const alternateName = String(claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
      if (!acceptedOfferId) continue;
      if (allowedOfferIds.size > 0 && !allowedOfferIds.has(acceptedOfferId) && (!tenantIdFilter || alternateName !== tenantIdFilter)) continue;
      if (!matchOfferOrderSearchClaims(claims, filters)) continue;
      matches.push(buildOfferOrderSearchRow(secureDoc, claims, ClaimsOrderSchemaorg.acceptedOfferIdentifier));
    }

    return buildSearchResponseEntries(GatewayResponseEntryTypes.OrderSearch, matches);
  }

  async processLicenseOrderEntry(orderClaims: ClaimsRecord, offerId: string): Promise<BundleEntry> {
    const hostCollectionName = this.hostRuntime.hostCollectionName;

    const communicationRecords = await this.vaultRepository.query(
      hostCollectionName,
      { sectionId: getEnvSectionId('communications'), where: [{ name: ClaimsOfferSchemaorg.identifier, value: offerId }] },
      { hydrate: false },
    );

    let matchedOfferClaims: Record<string, unknown> | undefined;
    for (const secureDoc of communicationRecords as ConfidentialStorageDoc[]) {
      const candidateClaims = await this.readClaims(secureDoc);
      if (String(candidateClaims[ClaimsOfferSchemaorg.identifier] || '').trim() === offerId) {
        matchedOfferClaims = candidateClaims;
        break;
      }
    }
    if (!matchedOfferClaims) {
      throw new ManagerError(`No pending registration or commercial offer found for offerId: '${offerId}'`, IssueType.NotFound);
    }

    const verification = await verifyOrderPaymentConfirmation({ orderClaims, offerClaims: matchedOfferClaims });
    if (!verification.verified) {
      throw new ManagerError(`Payment confirmation failed for offerId '${offerId}'.`, IssueType.Conflict);
    }

    const tenantId = String(matchedOfferClaims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
    const sector = String(matchedOfferClaims[ClaimsOfferSchemaorg.category] || matchedOfferClaims[ClaimsServiceSchemaorg.category] || '').trim();
    if (!tenantId || !sector) {
      throw new ManagerError('Commercial license offer is missing tenant alternateName or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(sector as Sector, tenantId);
    const quantity = Number(matchedOfferClaims[ClaimsOfferSchemaorg.eligibleQuantityValue] || 1);
    const expiryDate = new Date(Date.now());
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      const license: DeviceLicense = {
        id: licenseId,
        tenantId,
        orderId: verification.invoiceId || offerId,
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'available',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp,
      };
      licenseDocs.push({ id: licenseId, status: license.status, sequence: 0, content: license });
    }
    await this.vaultRepository.put(tenantVaultId, licenseDocs, getEnvSectionId('device-licenses'));

    const hostDid = composeHostDidWebId(this.config.apiBaseUrl, this.config.hostExternalDomain);
    const paymentCommunication = await buildPaymentCommunication({
      offerId,
      tenantId,
      tenantDid: '',
      senderDid: hostDid,
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
      invoiceId: verification.invoiceId,
      paymentConfirmed: true,
      ...readOfferPaymentContext(matchedOfferClaims),
    });
    paymentCommunication.claims[ClaimsOrganizationSchemaorg.alternateName] = tenantId;
    const invoiceBundle = buildGatewayInvoiceBundle({
      invoiceId: String(paymentCommunication.claims[ClaimsOrderSchemaorg.partOfInvoice] || verification.invoiceId || offerId),
      subjectReference: `urn:tenant:${tenantId}`,
      issuerReference: hostDid,
      recipientReference: `urn:tenant:${tenantId}`,
      issuedAt: String(paymentCommunication.claims['org.schema.Order.invoiceIssuedAt'] || new Date().toISOString()),
      amount: String(matchedOfferClaims[ClaimsOfferSchemaorg.price] || ''),
      currency: String(matchedOfferClaims[ClaimsOfferSchemaorg.priceCurrency] || ''),
      paymentMethod: verification.paymentMethod,
      paymentUrl: verification.paymentUrl,
    });

    const communicationDoc: ConfidentialStorageDoc & { meta?: Record<string, unknown> } = {
      id: paymentCommunication.communicationId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims: paymentCommunication.claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(paymentCommunication.claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims: paymentCommunication.claims, invoiceBundle },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, 'host');
    await this.vaultRepository.put(hostCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));

    return {
      type: GatewayResponseEntryTypes.OrganizationOrder,
      resource: { ...(invoiceBundle as any), meta: { ...((invoiceBundle as any).meta || {}), claims: paymentCommunication.claims } },
      response: { status: String(HttpStatusCodes.Created) },
    };
  }
}
