// Flow contract: remove only the verified controller's bootstrap individual so the destructive E2E starts without active descendants.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IndividualOrganizationLifecycleEditor } from 'gdc-common-utils-ts';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertSuccessfulTerminal(result, label) {
  if (result?.poll?.status !== 200) {
    throw new Error(`${label} polling returned HTTP ${result?.poll?.status ?? 'unknown'}.`);
  }
  const root = result.poll.body?.body || result.poll.body || {};
  const entries = Array.isArray(root.data) ? root.data : [];
  const failed = entries.find((entry) => Number.parseInt(String(entry?.response?.status || '200'), 10) >= 400);
  if (failed) {
    const diagnostic = failed?.response?.outcome?.issue?.[0]?.diagnostics || 'unknown lifecycle failure';
    throw new Error(`${label} failed: ${diagnostic}`);
  }
}

const sdkRoot = required('GDC_SDK_NODE_ROOT');
const { HttpRuntimeClient } = await import(pathToFileURL(resolve(sdkRoot, 'dist/index.js')).href);
const baseUrl = required('BASE_URL');
const tenantId = required('TENANT_ID');
const tenantRouteId = required('TENANT_ROUTE_ID');
const jurisdiction = required('JURISDICTION');
const sector = required('SECTOR');
const controllerEmail = required('CONTROLLER_EMAIL');
const bearerToken = required('AUTH_BEARER');
const ctx = { tenantId: tenantRouteId, jurisdiction, sector };
const client = new HttpRuntimeClient({ baseUrl, bearerToken, ctx, requestTimeoutMs: 15_000 });

const owned = await client.listOwnedFamilyOrganizations(ctx, {
  verifiedContact: { email: controllerEmail },
  timeoutSeconds: 20,
  intervalSeconds: 0.2,
});

for (const entry of owned) {
  const claims = entry.claims || {};
  const identifier = String(claims[ClaimsOrganizationSchemaorg.sameAs] || entry.resourceId || '').trim();
  const alternateName = String(entry.alternateName || '').trim();
  const editor = new IndividualOrganizationLifecycleEditor()
    .setIdentifier(identifier)
    .setAlternateName(alternateName)
    .setOwnerEmail(controllerEmail);
  const disable = await client.disableIndividualOrganization(
    ctx,
    { individualEditor: editor, resourceId: entry.resourceId },
    { timeoutMs: 20_000, intervalMs: 200 },
  );
  assertSuccessfulTerminal(disable, `Disable bootstrap individual ${entry.resourceId}`);
  const purge = await client.purgeIndividualOrganization(
    ctx,
    { individualEditor: editor, resourceId: entry.resourceId },
    { timeoutMs: 20_000, intervalMs: 200 },
  );
  assertSuccessfulTerminal(purge, `Purge bootstrap individual ${entry.resourceId}`);
}

process.stdout.write(`Cleaned ${owned.length} bootstrap individual(s) for tenant ${tenantId}.\n`);
