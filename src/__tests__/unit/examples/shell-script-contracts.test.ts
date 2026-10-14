import { readFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();

function readScript(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('shell script payload contracts', () => {
  it('keeps portal smoke checks anchored to canonical payload fixtures', () => {
    const portalScript = readScript('scripts/portal-web-go-no-go.sh');

    expect(portalScript).toContain('render_example_payload ORGANIZATION_ACTIVATION_REQUEST');
    expect(portalScript).toContain('render_example_payload ORGANIZATION_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload ORGANIZATION_ORDER_REQUEST');
    expect(portalScript).toContain('render_example_payload EMPLOYEE_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST');
    expect(portalScript).toContain('render_example_payload DEVICE_REGISTRATION_REQUEST');
    expect(portalScript).toContain('render_example_payload SMART_TOKEN_REQUEST');
    expect(portalScript).toContain('render_example_payload FAMILY_REGISTRATION_REQUEST');
    expect(portalScript).not.toMatch(/dummy-/);
    expect(portalScript).not.toContain('/body/jwks/keys');
  });

  it('keeps the communication demo payloads out of bash heredocs', () => {
    const demoScript = readScript('scripts/demo-communication-medications-ips.sh');
    const renderer = readScript('scripts/render-demo-communication-medications-ips.mts');

    expect(demoScript).toContain('render_demo_payload_with_runtime COMMUNICATION_BATCH');
    expect(demoScript).toContain('render_demo_payload_with_runtime MEDICATION_SEARCH');
    expect(demoScript).toContain('render_demo_payload_with_runtime IPS_SEARCH');
    expect(demoScript).not.toContain('cat <<JSON');
    expect(demoScript).not.toContain('legacy-fhir');
    expect(renderer).toContain('buildDemoCommunicationBatchSubmitRequest');
    expect(renderer).not.toContain('buildDemoCommunicationDidcommRequest');
    expect(renderer).not.toContain('buildDemoCommunicationLegacyFhirRequest');
  });

  it('shares the shell payload helper instead of duplicating ts-node loader boilerplate', () => {
    const bootstrapScript = readScript('scripts/bootstrap-single-tenant.sh');
    const portalScript = readScript('scripts/portal-web-go-no-go.sh');
    const demoScript = readScript('scripts/demo-communication-medications-ips.sh');

    expect(bootstrapScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
    expect(portalScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
    expect(demoScript).toContain('source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"');
  });
});
