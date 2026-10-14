#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, generateKeyPairSync, randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoDir = path.resolve(__dirname, '..');

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3310';
const TENANT_ID = process.env.TENANT_ID || 'ica';
const JURISDICTION = String(process.env.JURISDICTION || '').trim().toUpperCase();
const SECTOR = process.env.SECTOR || 'animal-care';
const RESOURCE_TYPE = process.env.RESOURCE_TYPE || 'contract';
const PDF_PATH = process.env.PDF_PATH || path.resolve(repoDir, '../examples/prueba-TEST-A4-multisign-fnmt.pdf');
const POLL_SLEEP_MS = Number.parseInt(process.env.POLL_SLEEP_MS || '1000', 10);
const POLL_MAX_ATTEMPTS = Number.parseInt(process.env.POLL_MAX_ATTEMPTS || '20', 10);
const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT || path.resolve(repoDir, 'artifacts/ica-a4-fullcycle');
const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.join(ARTIFACTS_ROOT, RUN_ID);

if (!JURISDICTION) {
  throw new Error('JURISDICTION must be set for the signed-PDF fixture.');
}

if (!existsSync(PDF_PATH)) {
  console.error(`PDF not found: ${PDF_PATH}`);
  process.exit(1);
}

mkdirSync(ARTIFACTS_DIR, { recursive: true });

const VERIFY_URL = `${API_BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/terms/pdf/${RESOURCE_TYPE}/_verify`;
const CREATE_URL = `${API_BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/entity/did/document/_create`;
const REMOVE_URL = `${API_BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/terms/pdf/${RESOURCE_TYPE}/_remove`;

function log(message) {
  console.log(`\n[${new Date().toISOString()}] ${message}`);
}

function logKv(key, value) {
  console.log(`  - ${key}: ${value}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  writeFileSync(filePath, String(value));
}

function generateControllerKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  const publicKeyJwk = publicKey.export({ format: 'jwk' });
  publicKeyJwk.alg = 'ES384';
  publicKeyJwk.use = 'sig';
  publicKeyJwk.kid = 'controller-msg-es384-local';

  const privateKeyJwk = privateKey.export({ format: 'jwk' });
  privateKeyJwk.alg = 'ES384';
  privateKeyJwk.use = 'sig';
  privateKeyJwk.kid = publicKeyJwk.kid;

  return { publicKeyJwk, privateKeyJwk };
}

function normalizeLocation(location) {
  if (!location) throw new Error('Missing Location header.');
  if (/^https?:\/\//i.test(location)) return location;
  return `${API_BASE_URL}${location}`;
}

async function postDidcomm(url, payload, outputPrefix) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/didcomm-plain+json' },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  const bodyFile = `${outputPrefix}.json`;
  const headersFile = `${outputPrefix}.headers.json`;
  writeText(bodyFile, bodyText);
  writeJson(headersFile, Object.fromEntries(response.headers.entries()));
  return { response, bodyText, bodyFile, headersFile };
}

async function pollLocation(location, outputFile) {
  for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(location, {
      method: 'POST',
      headers: { 'content-type': 'application/didcomm-plain+json' },
      body: '{}',
    });
    const bodyText = await response.text();
    const bodyJsonFile = path.join(ARTIFACTS_DIR, `poll-${attempt}.json`);
    writeText(bodyJsonFile, bodyText);
    if (response.status === 202) {
      await sleep(POLL_SLEEP_MS);
      continue;
    }
    if (response.status !== 200) {
      throw new Error(`Polling failed for ${location} with HTTP ${response.status}: ${bodyText}`);
    }
    writeText(outputFile, bodyText);
    return JSON.parse(bodyText);
  }
  throw new Error(`Polling timed out for ${location}`);
}

function buildVerifyPayload(controllerPublicJwk) {
  return {
    jti: randomUUID(),
    thid: `verify-${randomUUID()}`,
    type: 'https://globaldatacare.es/didcomm/ica/terms/verify-request/v1',
    meta: {
      jws: {
        protected: {
          alg: 'ES384',
          kid: controllerPublicJwk.kid,
          jwk: controllerPublicJwk,
        },
      },
    },
    body: {},
    attachments: [
      {
        id: 'signed-terms',
        media_type: 'application/pdf',
        data: {
          base64: readFileSync(PDF_PATH).toString('base64'),
        },
      },
    ],
  };
}

function buildCreatePayload(organizationIdentifier, organizationTaxId, organizationPublicJwk, controllerPublicJwk, controllerSameAs) {
  return {
    thid: `create-${randomUUID()}`,
    type: 'https://globaldatacare.es/didcomm/ica/entity/did/document/create-request/v1',
    body: {
      data: [
        {
          resource: {
            organization: {
              identifier: organizationIdentifier,
              taxID: organizationTaxId,
              publicKeyJwk: organizationPublicJwk,
            },
            controller: {
              publicKeyJwk: controllerPublicJwk,
              ...(controllerSameAs ? { sameAs: controllerSameAs } : {}),
            },
          },
        },
      ],
    },
  };
}

function buildRemovePayload(organizationIdentifier, organizationTaxId, controllerPublicJwk, controllerSameAs) {
  return {
    thid: `remove-${randomUUID()}`,
    type: 'https://globaldatacare.es/didcomm/ica/terms/remove-request/v1',
    meta: {
      jws: {
        protected: {
          alg: 'ES384',
          kid: controllerPublicJwk.kid,
          jwk: controllerPublicJwk,
        },
      },
    },
    body: {
      data: [
        {
          resource: {
            organization: {
              taxID: organizationTaxId,
              identifier: organizationIdentifier,
            },
            controller: {
              ...(controllerSameAs ? { sameAs: controllerSameAs } : {}),
            },
            reason: 'organization-requested-removal',
          },
        },
      ],
    },
  };
}

function getBodyDataEntries(result) {
  return Array.isArray(result?.body?.data) ? result.body.data : [];
}

function extractVerifyOutputs(result) {
  const entries = getBodyDataEntries(result);
  const organization = entries.find((entry) => entry?.type === 'Organization-verification-v1.0');
  const person = entries.find((entry) => entry?.type === 'LegalRepresentative-verification-v1.0');
  if (!organization) throw new Error('Verify response does not contain Organization-verification-v1.0.');
  if (!person) throw new Error('Verify response does not contain LegalRepresentative-verification-v1.0.');
  const credentialSubject = organization.resource?.credentialSubject || {};
  return {
    organizationPublicJwk: organization.publicKeyJwk,
    organizationPrivateJwk: organization.privateKeyJwk,
    organizationIdentifier: credentialSubject.id,
    organizationTaxId: credentialSubject.taxID,
    controllerSameAs: person.resource?.credentialSubject?.sameAs || '',
  };
}

async function runCycle(cycleName, controllerPublicJwk) {
  log(`${cycleName}: _verify`);
  const verifyPayload = buildVerifyPayload(controllerPublicJwk);
  writeJson(path.join(ARTIFACTS_DIR, `${cycleName}-verify-request.json`), verifyPayload);
  const verifySubmit = await postDidcomm(VERIFY_URL, verifyPayload, path.join(ARTIFACTS_DIR, `${cycleName}-verify-submit`));
  if (verifySubmit.response.status !== 202) {
    throw new Error(`_verify returned ${verifySubmit.response.status}: ${verifySubmit.bodyText}`);
  }
  const verifyLocation = normalizeLocation(verifySubmit.response.headers.get('location'));
  logKv('verify poll', verifyLocation);
  const verifyResult = await pollLocation(verifyLocation, path.join(ARTIFACTS_DIR, `${cycleName}-verify-response.json`));
  const verifyOutputs = extractVerifyOutputs(verifyResult);
  writeJson(path.join(ARTIFACTS_DIR, `${cycleName}-org-public.json`), verifyOutputs.organizationPublicJwk);
  writeJson(path.join(ARTIFACTS_DIR, `${cycleName}-org-private.json`), verifyOutputs.organizationPrivateJwk);
  writeText(path.join(ARTIFACTS_DIR, `${cycleName}-org-id.txt`), verifyOutputs.organizationIdentifier);
  writeText(path.join(ARTIFACTS_DIR, `${cycleName}-org-taxid.txt`), verifyOutputs.organizationTaxId);
  writeText(path.join(ARTIFACTS_DIR, `${cycleName}-controller-sameas.txt`), verifyOutputs.controllerSameAs);
  log(`${cycleName}: verified org taxID=${verifyOutputs.organizationTaxId} did=${verifyOutputs.organizationIdentifier}`);

  log(`${cycleName}: _create`);
  const createPayload = buildCreatePayload(
    verifyOutputs.organizationIdentifier,
    verifyOutputs.organizationTaxId,
    verifyOutputs.organizationPublicJwk,
    controllerPublicJwk,
    verifyOutputs.controllerSameAs,
  );
  writeJson(path.join(ARTIFACTS_DIR, `${cycleName}-create-request.json`), createPayload);
  const createSubmit = await postDidcomm(CREATE_URL, createPayload, path.join(ARTIFACTS_DIR, `${cycleName}-create-submit`));
  if (createSubmit.response.status !== 202) {
    throw new Error(`_create returned ${createSubmit.response.status}: ${createSubmit.bodyText}`);
  }
  const createLocation = normalizeLocation(createSubmit.response.headers.get('location'));
  logKv('create poll', createLocation);
  const createResult = await pollLocation(createLocation, path.join(ARTIFACTS_DIR, `${cycleName}-create-response.json`));
  const did = createResult?.body?.data?.[0]?.resource?.didDocument?.id || '';
  if (!did) throw new Error('Missing didDocument.id in _create response.');
  log(`${cycleName}: created DID document ${did}`);

  log(`${cycleName}: _remove`);
  const removePayload = buildRemovePayload(
    verifyOutputs.organizationIdentifier,
    verifyOutputs.organizationTaxId,
    controllerPublicJwk,
    verifyOutputs.controllerSameAs,
  );
  writeJson(path.join(ARTIFACTS_DIR, `${cycleName}-remove-request.json`), removePayload);
  const removeSubmit = await postDidcomm(REMOVE_URL, removePayload, path.join(ARTIFACTS_DIR, `${cycleName}-remove-submit`));
  if (removeSubmit.response.status !== 202) {
    throw new Error(`_remove returned ${removeSubmit.response.status}: ${removeSubmit.bodyText}`);
  }
  const removeLocation = normalizeLocation(removeSubmit.response.headers.get('location'));
  logKv('remove poll', removeLocation);
  const removeResult = await pollLocation(removeLocation, path.join(ARTIFACTS_DIR, `${cycleName}-remove-response.json`));
  const removedDid = removeResult?.body?.data?.[0]?.resource?.did || '';
  if (!removedDid) throw new Error('Missing removed did in _remove response.');
  log(`${cycleName}: removed terms for ${removedDid}`);

  return {
    did,
    taxID: verifyOutputs.organizationTaxId,
    controllerSameAs: verifyOutputs.controllerSameAs,
    organizationIdentifier: verifyOutputs.organizationIdentifier,
  };
}

async function main() {
  log('Generating controller ES384 keypair');
  logKv('api base', API_BASE_URL);
  logKv('tenant', TENANT_ID);
  logKv('jurisdiction', JURISDICTION);
  logKv('sector', SECTOR);
  logKv('resourceType', RESOURCE_TYPE);
  logKv('pdf', PDF_PATH);
  logKv('artifacts', ARTIFACTS_DIR);

  const controller = generateControllerKeypair();
  writeJson(path.join(ARTIFACTS_DIR, 'controller-keypair.json'), controller);
  writeJson(path.join(ARTIFACTS_DIR, 'controller-public.json'), controller.publicKeyJwk);

  const cycle1 = await runCycle('cycle1', controller.publicKeyJwk);
  const cycle2 = await runCycle('cycle2', controller.publicKeyJwk);

  const summary = {
    apiBaseUrl: API_BASE_URL,
    tenantId: TENANT_ID,
    jurisdiction: JURISDICTION,
    sector: SECTOR,
    resourceType: RESOURCE_TYPE,
    pdfPath: PDF_PATH,
    artifactsDir: ARTIFACTS_DIR,
    result: 'completed-removed',
    cycle1,
    cycle2,
  };
  writeJson(path.join(ARTIFACTS_DIR, 'summary.json'), summary);
  log('Completed two organization lifecycle cycles and finished in removed state.');
  logKv('summary', path.join(ARTIFACTS_DIR, 'summary.json'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
