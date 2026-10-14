import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const inputPath = path.resolve(ROOT, 'swagger-spec.json');
const outDir = path.resolve(ROOT, 'docs', 'openapi-profiles');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function classifyPath(p) {
  if (p.includes('/identity/openid/smart/token')) return 'core';
  if (p.includes('/identity/openid/Token/_exchange')) return 'core';
  if (p.includes('/identity/openid/Device/_dcr')) return 'core';

  // Compatibility aliases and legacy-only routes.
  if (
    p.includes('/individual/org.hl7.fhir.api/Subject/$summary') ||
    p.includes('/individual/org.hl7.fhir.api/Patient/$summary') ||
    p.includes('/identity/openid/') ||
    p.includes('/auth/token')
  ) return 'compat';

  // Extension-oriented or non-core verticals.
  if (
    p.includes('/Observation/') ||
    p.includes('/Subject/_batch') ||
    p.includes('/ResearchStudy/') ||
    p.includes('/Group/') ||
    p.includes('/Appointment') ||
    p.includes('/AppointmentResponse')
  ) return 'extension';

  // Core GW UC profile.
  return 'core';
}

const CORE_FLOW_PATHS = [
  '/host/ping',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search',
];

const CORE_FLOW_STEP_BY_PATH = {
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate': '1.1',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response': '1.2',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch': '2.1',
  '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response': '2.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange': '3.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response': '3.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr': '3.3',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response': '3.4',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch': '4.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response': '4.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch': '4.3',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response': '4.4',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch': '5.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch-response': '5.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token': '6.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response': '6.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch': '7.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch-response': '7.2',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch': '7.3',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response': '7.4',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch': '8.1',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch-response': '8.2',
};

const CORE_FLOW_DESCRIPTION_OVERRIDES = {
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange':
    'After host/tenant Order, use activation code `org.schema.IndividualProduct.serialNumber` plus email-proof `id_token` to obtain the `initial_access_token` required by Dynamic Client Registration (DCR).',
  '/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr':
    'Use the `initial_access_token` from Token/_exchange to register device/wallet public key(s) and bind them to the license serial number and controller/professional email before additional employee operations.',
};

function deriveSpec(spec, targetProfile) {
  const clone = structuredClone(spec);
  const kept = {};
  const collected = new Map();

  for (const [p, item] of Object.entries(clone.paths || {})) {
    const profile = classifyPath(p);
    // Include core in all profiles as baseline; compat/extension add extra capabilities.
    const include =
      targetProfile === 'core'
        ? profile === 'core'
        : targetProfile === 'compat'
          ? profile === 'core' || profile === 'compat'
          : profile === 'core' || profile === 'compat' || profile === 'extension';
    if (!include) continue;
    if (targetProfile === 'core' && !CORE_FLOW_PATHS.includes(p)) continue;

    for (const op of Object.values(item)) {
      if (op && typeof op === 'object') {
        op['x-profile'] = profile;
        if (targetProfile === 'core') {
          const step = CORE_FLOW_STEP_BY_PATH[p];
          if (step) {
            op['x-flow-step'] = step;
            op.tags = ['Core Flow (SDK E2E Use Cases)'];
            const baseSummary = String(op.summary || '').trim();
            if (baseSummary && !baseSummary.startsWith(`[Step ${step}]`)) {
              op.summary = `[Step ${step}] ${baseSummary}`;
            }
            const stepLead = `[Step ${step}]`;
            const baseDescription = String(op.description || '').trim();
            if (!baseDescription) {
              op.description = stepLead;
            } else if (
              !baseDescription.startsWith(stepLead)
            ) {
              op.description = `${stepLead}\n\n${baseDescription}`;
            }
          }
          const override = CORE_FLOW_DESCRIPTION_OVERRIDES[p];
          if (override) {
            const existing = String(op.description || '').trim();
            op.description = existing ? `${override}\n\n${existing}` : override;
          }
        }
      }
    }
    collected.set(p, item);
  }

  if (targetProfile === 'core') {
    for (const p of CORE_FLOW_PATHS) {
      if (collected.has(p)) kept[p] = collected.get(p);
    }
  } else {
    for (const [p, item] of collected.entries()) {
      kept[p] = item;
    }
  }

  clone.paths = kept;
  clone.info = clone.info || {};
  if (targetProfile === 'core') {
    clone.info.title = 'Gateway API - CORE';
    clone.info.description = 'CORE API documentation for the secure gateway canonical flow.';
  } else if (targetProfile === 'compat') {
    clone.info.title = 'Gateway API - COMPAT';
    clone.info.description = 'Compatibility profile including legacy and alias routes on top of the core flow.';
  } else if (targetProfile === 'extension') {
    clone.info.title = 'Gateway API - EXTENSIONS';
    clone.info.description = 'Extension profile including non-core and vertical-specific capabilities on top of core and compat.';
  }
  clone.info['x-profile-generated-at'] = new Date().toISOString();
  clone.info['x-profile-name'] = targetProfile;
  if (targetProfile === 'core') {
    clone.tags = [
      {
        name: 'Core Flow (SDK E2E Use Cases)',
        description: 'Canonical CORE flow aligned with dataspace-client-sdk-node/tests/live-gw-uc5.e2e.test.mjs',
      },
    ];
  }
  return clone;
}

if (!fs.existsSync(inputPath)) {
  console.error(`ERROR: ${inputPath} not found. Run npm run build:swagger first.`);
  process.exit(1);
}

const spec = readJson(inputPath);
const profiles = ['core', 'compat', 'extension'];

for (const profile of profiles) {
  const outPath = path.join(outDir, `openapi-${profile}.json`);
  writeJson(outPath, deriveSpec(spec, profile));
  console.log(`✅ Generated ${outPath}`);
}
