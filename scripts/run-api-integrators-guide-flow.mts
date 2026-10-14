import fs from 'node:fs';
import path from 'node:path';

import { invokeExpress } from '../src/__tests__/integration/helpers/invokeExpress';
import {
  ORGANIZATION_REGISTRATION_REQUEST,
  ORGANIZATION_ORDER_REQUEST,
  FIREBASE_CUSTOM_TOKEN_REQUEST,
  INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST,
  LICENSE_ISSUE_REQUEST,
  DEVICE_REGISTRATION_REQUEST,
  SMART_TOKEN_REQUEST,
  EMPLOYEE_REGISTRATION_REQUEST,
  FAMILY_REGISTRATION_REQUEST,
  FAMILY_ORDER_REQUEST,
  CONSENT_CREATION_MESSAGE,
  COMMUNICATION_CREATION_MESSAGE,
  COMPOSITION_UPDATE_MESSAGE,
} from '../src/__tests__/data/example-payloads';
import { AppAuthorizationManager } from '../src/managers/AppAuthorizationManager';
import { testConsentRulePermitOrgDid } from '../src/__tests__/data/consent-rules.data';
import { getTenantVaultId } from '../src/utils/tenant';
import { getIndividualSectionId } from '../src/utils/individual-sections';
import { getEnvSectionId } from '../src/utils/section-env';
import { ClaimsOfferSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { resolveHostRegistrySector } from '../src/utils/services';

type StepResult = {
  name: string;
  request: { method: string; url: string; headers?: Record<string, string>; body?: any };
  submit: { status: number; headers: Record<string, string>; bodyText: string; bodyJson?: any };
  poll?: { url: string; tries: number; final: { status: number; headers: Record<string, string>; bodyText: string; bodyJson?: any } };
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function toBase64Json(obj: any): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}

function makeDemoJwt(payload: any): string {
  const header = { alg: 'none', typ: 'JWT' };
  return `${toBase64Json(header)}.${toBase64Json(payload)}.sig`;
}

function safeJsonParse(text: string): any | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function redacted(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/Bearer\s+[A-Za-z0-9+/_=-]+\.[A-Za-z0-9+/_=-]+\.[A-Za-z0-9+/_=-]+/g, 'Bearer <jwt>')
      .replace(/https?:\/\/[^\s"']+/g, '<url>');
  }
  if (Array.isArray(value)) return value.map(redacted);
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'access_token') out[k] = '<access_token>';
      else if (k === 'initial_access_token') out[k] = '<initial_access_token>';
      else if (k === 'jti') out[k] = '<jti>';
      else if (k === 'iat' || k === 'nbf' || k === 'exp') out[k] = '<time>';
      else out[k] = redacted(v);
    }
    return out;
  }
  return value;
}

function extractOfferId(bundleBody: any): string | undefined {
  const entries = bundleBody?.data || bundleBody?.entry || [];
  for (const e of entries) {
    const claims = e?.meta?.claims;
    if (!claims || typeof claims !== 'object') continue;
    const direct = claims[ClaimsOfferSchemaorg.identifier];
    if (typeof direct === 'string' && direct) return direct;
    for (const [k, v] of Object.entries(claims)) {
      if (typeof v === 'string' && k.endsWith('Offer.identifier')) return v;
    }
  }
  return undefined;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function submitAndMaybePoll(app: any, req: StepResult['request']): Promise<{ submit: StepResult['submit']; poll?: StepResult['poll'] }> {
  const submitResp = await invokeExpress(app, req);
  const submitJson = safeJsonParse(submitResp.text);
  const submit = { status: submitResp.status, headers: submitResp.headers, bodyText: submitResp.text, ...(submitJson ? { bodyJson: submitJson } : {}) };

  if (submitResp.status !== 202) return { submit };

  const thid = req.body?.thid || req.body?.content?.thid || req.body?.body?.thid;
  const location = submitResp.headers.location;
  const pollUrl = location ? new URL(location).pathname : undefined;
  if (!pollUrl || !thid) return { submit };

  let final = { status: 0, headers: {}, bodyText: '' } as any;
  let tries = 0;
  for (; tries < 50; tries++) {
    const pollResp = await invokeExpress(app, {
      method: 'POST',
      url: pollUrl,
      headers: { 'content-type': 'application/json' },
      body: { thid },
    });
    if (pollResp.status === 200 || pollResp.status >= 400) {
      const pollJson = safeJsonParse(pollResp.text);
      final = { status: pollResp.status, headers: pollResp.headers, bodyText: pollResp.text, ...(pollJson ? { bodyJson: pollJson } : {}) };
      break;
    }
    await sleep(25);
  }

  return {
    submit,
    poll: { url: pollUrl, tries, final },
  };
}

async function main() {
  process.env.NODE_ENV = 'test';
  process.env.DB_PROVIDER = 'mem';
  process.env.STORAGE_PROVIDER = 'mem';
  process.env.QUEUE_PROVIDER = 'mem';
  process.env.SECTORS_ALLOWED = 'health-care';

  // Minimal host bootstrap config required by startServer().
  process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
  process.env.ORG_HOST_JURISDICTION = 'ES';
  process.env.ORG_HOST_ID_TYPE = 'TAX';
  process.env.ORG_HOST_ID_VALUE = 'A0011223344';
  process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
  process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
  process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';

  const { startServer } = await import('../src/server');
  const { app, queueAdapter, tenantManager, vaultRepository, kmsService, cryptographyService } = await startServer({ listen: false });

  const report: { generatedAt: string; steps: StepResult[] } = { generatedAt: new Date().toISOString(), steps: [] };

  try {
    const hostRegistrySector = resolveHostRegistrySector(process.env.NODE_ENV);

    // --- Discovery (sync) ---
    for (const url of [
      '/host/ping',
      '/host/cds-eu/v1/test/.well-known/did.json',
      '/host/cds-eu/v1/test/.well-known/jwks.json',
      '/host/cds-eu/v1/test/.well-known/openid-configuration',
    ]) {
      const resp = await invokeExpress(app, { method: 'GET', url });
      report.steps.push({
        name: `Discovery: ${url}`,
        request: { method: 'GET', url },
        submit: { status: resp.status, headers: resp.headers, bodyText: resp.text, ...(safeJsonParse(resp.text) ? { bodyJson: safeJsonParse(resp.text) } : {}) },
      });
    }

    // --- 1.1 Organization Registration ---
    {
      const req = {
        method: 'POST',
        url: `/host/cds-ES/v1/${hostRegistrySector}/registry/org.schema/Organization/_batch`,
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(ORGANIZATION_REGISTRATION_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '1.1 Organization Registration', request: req, submit, ...(poll ? { poll } : {}) });
    }

    const orgReg = report.steps.find((s) => s.name === '1.1 Organization Registration')?.poll?.final?.bodyJson;
    const orgOfferId = extractOfferId(orgReg);

    // --- 1.2 Organization Order (fail + success) ---
    {
      const badOrder = deepClone(ORGANIZATION_ORDER_REQUEST);
      badOrder.body.data[0].resource.meta.claims['Order.acceptedOffer.identifier'] = 'urn:cds:invalid:Offer:<uuid>';

      const req = {
        method: 'POST',
        url: `/host/cds-ES/v1/${hostRegistrySector}/registry/org.schema/Order/_batch`,
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: badOrder,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '1.2 Organization Order (invalid offer)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    if (orgOfferId) {
      const goodOrder = deepClone(ORGANIZATION_ORDER_REQUEST);
      goodOrder.body.data[0].resource.meta.claims['Order.acceptedOffer.identifier'] = orgOfferId;
      const req = {
        method: 'POST',
        url: `/host/cds-ES/v1/${hostRegistrySector}/registry/org.schema/Order/_batch`,
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: goodOrder,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '1.2 Organization Order (valid)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // Warm tenant cache for `health-care_acme` after finalization.
    const tenantVaultId = getTenantVaultId('health-care', 'acme');
    await tenantManager.getTenant(tenantVaultId);

    // --- 1.3 ICA status message (legal representative) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/messaging/post-quantum/didcomm-plaintext/_messages',
        headers: { 'content-type': 'application/json', authorization: 'Bearer demo' },
        body: { thid: 'thid-ica-status-messages' },
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '1.3 ICA Status Messages (list)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    try {
      const messagingDocs = await vaultRepository.getContainersInSection<any>(
        tenantVaultId,
        getEnvSectionId('messaging'),
      );

      let icaMessageId: string | undefined;
      for (const secureDoc of messagingDocs) {
        try {
          const content = await kmsService.unprotectConfidentialData<any>(secureDoc, tenantVaultId);
          if (content?.type === 'IcaEnrollResponse-v1.0' && typeof secureDoc?.id === 'string') {
            icaMessageId = secureDoc.id;
            break;
          }
        } catch {
          // Ignore unrelated or malformed docs while searching for ICA status message.
        }
      }

      if (icaMessageId) {
        const req = {
          method: 'POST',
          url: '/acme/cds-ES/v1/health-care/messaging/post-quantum/didcomm-plaintext/_get',
          headers: { 'content-type': 'application/json', authorization: 'Bearer demo' },
          body: { id: icaMessageId },
        };
        const { submit, poll } = await submitAndMaybePoll(app, req);
        report.steps.push({ name: '1.3 ICA Status Message (get)', request: req, submit, ...(poll ? { poll } : {}) });
      } else {
        report.steps.push({
          name: '1.3 ICA Status Message (get)',
          request: { method: 'LOCAL', url: 'vault search: IcaEnrollResponse-v1.0' },
          submit: {
            status: 204,
            headers: {},
            bodyText: JSON.stringify({
              info: 'ICA status message not available. Set ICA_EXTERNAL_DOMAIN (and ICA endpoint) to validate automatic ICA message persistence.',
            }),
          },
        });
      }
    } catch (e: any) {
      report.steps.push({
        name: '1.3 ICA Status Message (get)',
        request: { method: 'LOCAL', url: 'vault search: IcaEnrollResponse-v1.0' },
        submit: { status: 500, headers: {}, bodyText: JSON.stringify({ error: String(e?.message || e) }) },
      });
    }

    // --- 2.1.1 Firebase custom token (optional; likely fails without real eIDAS) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/firebase/Token/_custom',
        headers: { 'content-type': 'application/didcomm-plain+json' },
        body: deepClone(FIREBASE_CUSTOM_TOKEN_REQUEST),
      };
      const resp = await invokeExpress(app, req);
      report.steps.push({
        name: '2.1.1 Firebase custom token (demo call)',
        request: req,
        submit: { status: resp.status, headers: resp.headers, bodyText: resp.text, ...(safeJsonParse(resp.text) ? { bodyJson: safeJsonParse(resp.text) } : {}) },
      });
    }

    // --- 2.1.2 Initial Access Token Exchange (fail + success) ---
    const idToken = makeDemoJwt({ sub: 'user1@example.com', tenant_id: 'acme' });
    const activationCode = 'activation-code-demo-1';
    {
      const invalidReqBody = deepClone(INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST);
      invalidReqBody.thid = 'token-exchange-thread-id-invalid';
      invalidReqBody.jti = 'token-exchange-request-id-invalid';
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/Token/_exchange',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: `Bearer ${idToken}` },
        body: { ...invalidReqBody, body: { subject_token: activationCode } },
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '2.1.2 Initial Access Token Exchange (invalid code)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // Seed one AVAILABLE license (the pool created after purchase), then issue an activation code via the API.
    // This simulates the tenant admin "invite" step.
    await vaultRepository.put(
      tenantVaultId,
      [
        {
          id: 'license-available-1',
          status: 'available',
          sequence: 0,
          content: {
            id: 'license-available-1',
            tenantId: 'acme',
            userClass: 'employee',
            type: 'mobile',
            status: 'available',
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        } as any,
      ],
      getEnvSectionId('device-licenses'),
    );

    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/License/_issue',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(LICENSE_ISSUE_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      const finalJson = poll?.final?.bodyJson || submit.bodyJson;
      const issuedCode =
        finalJson?.body?.data?.[0]?.id ||
        finalJson?.data?.[0]?.id;
      if (typeof issuedCode === 'string' && issuedCode.startsWith('lic-')) {
        // Use the issued code for the subsequent token exchange.
        (globalThis as any).__issuedActivationCode = issuedCode;
      }
      report.steps.push({ name: '2.1.1 License Issue (invite)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    let initialAccessToken: string | undefined;
    {
      const issuedCode = (globalThis as any).__issuedActivationCode;
      const validReqBody = deepClone(INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST);
      validReqBody.thid = 'token-exchange-thread-id-valid';
      validReqBody.jti = 'token-exchange-request-id-valid';
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/Token/_exchange',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: `Bearer ${idToken}` },
        body: { ...validReqBody, body: { subject_token: issuedCode || activationCode } },
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      const bodyJson = poll?.final?.bodyJson || submit.bodyJson;
      initialAccessToken = bodyJson?.initial_access_token || bodyJson?.body?.initial_access_token;
      report.steps.push({
        name: '2.1.2 Initial Access Token Exchange (valid)',
        request: req,
        submit,
        ...(poll ? { poll } : {}),
      });
    }

    // Sanity check: verify that the minted token actually validates against the host public key.
    if (initialAccessToken) {
      try {
        const [protectedHeader, payload, signature] = initialAccessToken.split('.');
        const hostKey = await kmsService.getPublicVerificationKey('host');
        const ok =
          !!hostKey &&
          !!protectedHeader &&
          !!payload &&
          !!signature &&
          (await cryptographyService.verifyJws({ protected: protectedHeader, payload, signature }, hostKey as any));

        let okViaManager = false;
        try {
          const manager = new AppAuthorizationManager(
            vaultRepository as any,
            { verify: async () => ({ valid: true, payload: {} }) } as any,
            kmsService,
            cryptographyService,
          );
          await manager.verifyInitialAccessToken(initialAccessToken);
          okViaManager = true;
        } catch {
          okViaManager = false;
        }

        report.steps.push({
          name: '2.1.2 Initial Access Token Exchange (signature check)',
          request: { method: 'LOCAL', url: 'verifyJws(host, initial_access_token)' },
          submit: { status: ok && okViaManager ? 200 : 500, headers: {}, bodyText: JSON.stringify({ ok, okViaManager }) },
        });
      } catch (e: any) {
        report.steps.push({
          name: '2.1.2 Initial Access Token Exchange (signature check)',
          request: { method: 'LOCAL', url: 'verifyJws(host, initial_access_token)' },
          submit: { status: 500, headers: {}, bodyText: JSON.stringify({ ok: false, error: String(e?.message || e) }) },
        });
      }
    }

    // --- 2.1.3 DCR (fail + success) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/Device/_dcr',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer invalid.initial.access' },
        body: deepClone(DEVICE_REGISTRATION_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '2.1.3 DCR (invalid initial_access_token)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    if (initialAccessToken) {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/Device/_dcr',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: `Bearer ${initialAccessToken}` },
        body: deepClone(DEVICE_REGISTRATION_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '2.1.3 DCR (valid)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 2.2 SMART Token (fail + success) ---
    const subject = 'did:web:api.acme.org:individual:123';
    {
      const reqBody = deepClone(SMART_TOKEN_REQUEST);
      reqBody.body.scope = reqBody.body.scope.replace('<unified-health-identifier>', '123');
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/smart/token',
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: reqBody,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '2.2 SMART Token (missing subject vault)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // Seed consent rule in the TENANT vault, under the per-individual rules section,
    // matching where ConsentManager persists rules in production.
    const acmeTenantVaultId = getTenantVaultId('health-care', 'acme');
    await vaultRepository.put(
      acmeTenantVaultId,
      [{ ...testConsentRulePermitOrgDid } as any],
      getIndividualSectionId(subject, 'rules'),
    );

    {
      const reqBody = deepClone(SMART_TOKEN_REQUEST);
      reqBody.body.scope = reqBody.body.scope.replace('<unified-health-identifier>', '123');
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/identity/openid/smart/token',
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: reqBody,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '2.2 SMART Token (valid)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 3.1 Employee Role ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/entity/org.schema/Employee/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(EMPLOYEE_REGISTRATION_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '3.1 Employee Role', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 4.1 Family Registration + 4.2 Order ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.schema/Organization/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(FAMILY_REGISTRATION_REQUEST),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '4.1 Family Registration', request: req, submit, ...(poll ? { poll } : {}) });
    }

    const familyReg = report.steps.find((s) => s.name === '4.1 Family Registration')?.poll?.final?.bodyJson;
    const familyOfferId = extractOfferId(familyReg);

    {
      const badOrder = deepClone(FAMILY_ORDER_REQUEST);
      badOrder.body.data[0].resource.meta.claims['Order.acceptedOffer.identifier'] = 'urn:cds:invalid:Offer:<uuid>';
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.schema/Order/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: badOrder,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '4.2 Family Order (invalid offer)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    if (familyOfferId) {
      const goodOrder = deepClone(FAMILY_ORDER_REQUEST);
      goodOrder.body.data[0].resource.meta.claims['Order.acceptedOffer.identifier'] = familyOfferId;
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.schema/Order/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: goodOrder,
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '4.2 Family Order (valid)', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 5. Consent (expected to fail until wired into Worker) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Consent/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(CONSENT_CREATION_MESSAGE),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '5. Consent', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 6. Communication (may fail depending on manager implementation) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(COMMUNICATION_CREATION_MESSAGE),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '6. Communication', request: req, submit, ...(poll ? { poll } : {}) });
    }

    // --- 7. Composition (currently not implemented; expected to fail) ---
    {
      const req = {
        method: 'POST',
        url: '/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Composition/_batch',
        headers: { 'content-type': 'application/didcomm-plain+json', authorization: 'Bearer mock' },
        body: deepClone(COMPOSITION_UPDATE_MESSAGE),
      };
      const { submit, poll } = await submitAndMaybePoll(app, req);
      report.steps.push({ name: '7. Composition', request: req, submit, ...(poll ? { poll } : {}) });
    }
  } finally {
    queueAdapter.stop();
  }

  const output = {
    ...report,
    steps: report.steps.map((s) => ({
      ...s,
      request: { ...s.request, ...(s.request.headers ? { headers: redacted(s.request.headers) } : {}), ...(s.request.body ? { body: redacted(s.request.body) } : {}) },
      submit: { ...s.submit, ...(s.submit.bodyJson ? { bodyJson: redacted(s.submit.bodyJson) } : {}) },
      ...(s.poll
        ? {
            poll: {
              ...s.poll,
              final: {
                ...s.poll.final,
                ...(s.poll.final.bodyJson ? { bodyJson: redacted(s.poll.final.bodyJson) } : {}),
              },
            },
          }
        : {}),
    })),
  };

  const artifactsDir = path.resolve(process.cwd(), 'artifacts');
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = path.join(artifactsDir, 'api-integrators-guide.flow-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote report: ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
