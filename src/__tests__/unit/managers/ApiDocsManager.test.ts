import { createApiDocsSetupOptions } from '../../../managers/ApiDocsManager';

/**
 * API-docs teaching-flow contract under test:
 * the rendered page must explain identity bootstrap, the public actor/transport
 * boundary, internal subject-index dispatch, compatibility routes and the
 * submit/202/poll/readback lifecycle before developers reach the flat endpoint
 * catalogue. CSS assertions retain responsive visual and dark-theme support.
 */
describe('ApiDocsManager Global Flow Context', () => {
  it('renders the GW CORE contract map before the endpoint catalogue', () => {
    const options = createApiDocsSetupOptions();
    const script = String(options.customJsStr || '');
    const css = String(options.customCss || '');

    expect(script).toContain('gw-core-contract-map');
    expect(script).toContain('BFF / actor facade');
    expect(script).toContain('Communication/_batch');
    expect(script).toContain('Subject/$summary');
    expect(script).toContain('Internal operation');
    expect(script).toContain('Compatibility only');
    expect(script).toContain('Organization / License');
    expect(script).toContain('Identity bootstrap');
    expect(script).toContain('DCR registers the actor device');
    expect(script).toContain('Submit + thid');
    expect(script).toContain('202 Accepted');
    expect(script).toContain('Poll response');
    expect(script).toContain('Exact readback');
    expect(css).toContain('.gw-core-contract-map');
    expect(css).toContain('.gw-core-contract-arrow');
    expect(css).toContain('.gw-core-contract-lifecycle');
    expect(css).toContain('.gw-core-contract-map { padding-top: 58px; }');
  });

  it('includes canonical tenant, individual, and physician helper fields', () => {
    const options = createApiDocsSetupOptions();
    const script = String(options.customJsStr || '');

    expect(script).toContain("key: 'taxTenantId'");
    expect(script).toContain("placeholder: 'acme-id'");
    expect(script).toContain('getCanonicalTenantId');
    expect(script).toContain("key: 'portalNamespace'");
    expect(script).toContain("placeholder: 'globaldatacare.es'");
    expect(script).toContain("key: 'individualUuid'");
    expect(script).toContain("key: 'individualDid'");
    expect(script).toContain("key: 'individualControllerEmail'");
    expect(script).toContain("key: 'individualControllerRole'");
    expect(script).toContain("key: 'individualControllerDid'");
    expect(script).toContain("key: 'physicianEmail'");
    expect(script).toContain("key: 'physicianRole'");
    expect(script).toContain("key: 'sectionsAllowed'");
    expect(script).toContain("key: 'physicianOrg'");
    expect(script).toContain("key: 'physicianDid'");
    expect(script).not.toContain("label: 'tenantId'");
    expect(script).not.toContain("label: 'tax id'");
    expect(script).toContain('buildPhysicianOrgDid');
    expect(script).toContain('buildMemberDid');
    expect(script).toContain('buildIndividualControllerDid');
    expect(script).toContain('sha256Multibase58btc');
    expect(script).toContain('buildIndividualDid');
    expect(script).toContain('getCurrentIndividualId');
    expect(script).toContain('migrateLegacyContextValues');
    expect(script).toContain('normalizeLegacyCanonicalTenantId');
    expect(script).toContain('PANEL_VERSION');
    expect(script).toContain('getPanelOpen');
    expect(script).toContain('setPanelOpen');
    expect(script).toContain('syncGlobalContextPanelState');
    expect(script).toContain('gw-api-global-context-toggle');
    expect(script).toContain('gw-api-global-context-launcher');
    expect(script).toContain('uuidToMultibase58btc');
    expect(script).toContain('globaldatacare.es');
    expect(script).toContain('acme-id');
    expect(script).toContain('doctor1@acme.org');
    expect(script).toContain('ISCO-08|2211');
    expect(script).toContain('LOINC|48765-2');
    expect(script).toContain('{{individualDid}}');
    expect(script).toContain('{{individualControllerDid}}');
    expect(script).toContain('{{physicianOrg}}');
    expect(script).toContain('{{physicianDid}}');
  });
});
