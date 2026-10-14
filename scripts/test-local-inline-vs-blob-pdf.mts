import fs from 'node:fs/promises';
import path from 'node:path';

import { COMMUNICATION_CREATION_MESSAGE } from '../src/__tests__/data/example-payloads.ts';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TENANT_ID = 'acme-id';
const DEFAULT_JURISDICTION = 'ES';
const DEFAULT_SECTOR = 'health-care';
const DEFAULT_SMALL_PDF = '/Users/fernando/GITS/gdc-workspace/examples/TEST-A4-Antifraud.pdf';
const DEFAULT_BIG_PDF = '/Users/fernando/GITS/gdc-workspace/examples/big.pdf';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_CONTENT_TYPE = 'application/didcomm-plain+json';
const DEFAULT_AUTHORIZATION = 'Bearer mock';
const PDF_MEDIA_TYPE = 'application/pdf';
const SMALL_ATTACHMENT_TITLE = 'small-inline-test.pdf';
const LARGE_ATTACHMENT_TITLE = 'big-inline-test.pdf';
const SMALL_THREAD_ID = 'thread-inline-small-pdf';
const LARGE_THREAD_ID = 'thread-inline-big-pdf';
const SMALL_MESSAGE_ID = 'message-inline-small-pdf';
const LARGE_MESSAGE_ID = 'message-inline-big-pdf';
const ISSUER_DID = 'did:web:ehr-system.example.com';
const AUDIENCE_DID = 'did:web:gateway.acme.org';
const INDIVIDUAL_DID = 'did:web:patient.example.com';
const PHYSICIAN_DID = 'did:web:physician.example.com';

type TestCase = {
  label: string;
  pdfPath: string;
  threadId: string;
  messageId: string;
  attachmentTitle: string;
};

type PollResult = {
  tries: number;
  status: number;
  bodyText: string;
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function resolveConfig() {
  return {
    baseUrl: String(process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ''),
    tenantId: String(process.env.TENANT_ID || DEFAULT_TENANT_ID).trim(),
    jurisdiction: String(process.env.JURISDICTION || DEFAULT_JURISDICTION).trim(),
    sector: String(process.env.SECTOR || DEFAULT_SECTOR).trim(),
    smallPdf: String(process.env.SMALL_PDF || DEFAULT_SMALL_PDF).trim(),
    bigPdf: String(process.env.BIG_PDF || DEFAULT_BIG_PDF).trim(),
    timeoutMs: Number.parseInt(String(process.env.POLL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS,
    pollIntervalMs: Number.parseInt(String(process.env.POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS), 10) || DEFAULT_POLL_INTERVAL_MS,
  };
}

function buildBatchUrl(config: ReturnType<typeof resolveConfig>): string {
  return `${config.baseUrl}/${config.tenantId}/cds-${config.jurisdiction}/v1/${config.sector}/individual/org.hl7.fhir.r4/Communication/_batch`;
}

function buildPollUrl(config: ReturnType<typeof resolveConfig>): string {
  return `${config.baseUrl}/${config.tenantId}/cds-${config.jurisdiction}/v1/${config.sector}/individual/org.hl7.fhir.r4/Communication/_batch-response`;
}

async function readPdfBase64(pdfPath: string): Promise<{ sizeBytes: number; dataBase64: string }> {
  const dataBytes = await fs.readFile(pdfPath);
  return {
    sizeBytes: dataBytes.byteLength,
    dataBase64: dataBytes.toString('base64'),
  };
}

function buildCommunicationPayload(testCase: TestCase, dataBase64: string) {
  const payload = deepClone(COMMUNICATION_CREATION_MESSAGE);
  payload.jti = testCase.messageId;
  payload.thid = testCase.threadId;
  payload.iss = ISSUER_DID;
  payload.aud = AUDIENCE_DID;

  const entry = payload.body.entry[0];
  entry.resource.meta.claims['Communication.content-attachment-data'] = dataBase64;
  entry.resource.meta.claims['Communication.content-attachment-title'] = testCase.attachmentTitle;
  entry.resource.meta.claims['Communication.content-attachment-type'] = PDF_MEDIA_TYPE;
  entry.resource.meta.claims['Communication.recipient'] = INDIVIDUAL_DID;
  entry.resource.meta.claims['Communication.sender'] = PHYSICIAN_DID;
  entry.resource.meta.claims['Communication.subject'] = INDIVIDUAL_DID;

  entry.resource.recipient[0].reference = INDIVIDUAL_DID;
  entry.resource.sender.reference = PHYSICIAN_DID;
  entry.resource.payload[1].contentAttachment.contentType = PDF_MEDIA_TYPE;
  entry.resource.payload[1].contentAttachment.title = testCase.attachmentTitle;
  entry.resource.payload[1].contentAttachment.data = dataBase64;

  return payload;
}

async function submitBatch(batchUrl: string, payload: unknown): Promise<Response> {
  return fetch(batchUrl, {
    method: 'POST',
    headers: {
      'content-type': DEFAULT_CONTENT_TYPE,
      authorization: DEFAULT_AUTHORIZATION,
    },
    body: JSON.stringify(payload),
  });
}

async function pollUntilDone(
  pollUrl: string,
  threadId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<PollResult> {
  const startedAt = Date.now();
  let tries = 0;

  while (Date.now() - startedAt < timeoutMs) {
    tries += 1;
    const response = await fetch(pollUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thid: threadId }),
    });
    const bodyText = await response.text();
    if (response.status === 200 || response.status >= 400) {
      return { tries, status: response.status, bodyText };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Polling timed out for thread '${threadId}' after ${timeoutMs} ms.`);
}

function printCaseHeader(label: string): void {
  console.log(`\n=== ${label} ===`);
}

function printResponse(label: string, response: Response, bodyText: string): void {
  console.log(`${label} status: ${response.status}`);
  console.log(`${label} body: ${bodyText.slice(0, 8000)}`);
}

async function runCase(config: ReturnType<typeof resolveConfig>, testCase: TestCase): Promise<void> {
  printCaseHeader(testCase.label);
  const { sizeBytes, dataBase64 } = await readPdfBase64(testCase.pdfPath);
  console.log(`pdf: ${testCase.pdfPath}`);
  console.log(`pdf size bytes: ${sizeBytes}`);
  console.log(`attachment base64 length: ${dataBase64.length}`);

  const payload = buildCommunicationPayload(testCase, dataBase64);
  const submitResponse = await submitBatch(buildBatchUrl(config), payload);
  const submitBodyText = await submitResponse.text();
  printResponse('submit', submitResponse, submitBodyText);

  if (submitResponse.status !== 202) {
    throw new Error(`Expected 202 Accepted for '${testCase.label}', got ${submitResponse.status}.`);
  }

  const pollResult = await pollUntilDone(
    buildPollUrl(config),
    testCase.threadId,
    config.timeoutMs,
    config.pollIntervalMs,
  );
  console.log(`poll tries: ${pollResult.tries}`);
  console.log(`poll status: ${pollResult.status}`);
  console.log(`poll body: ${pollResult.bodyText.slice(0, 8000)}`);
}

async function main() {
  const config = resolveConfig();
  console.log('Local GW PDF inline/blob probe');
  console.log(JSON.stringify({
    baseUrl: config.baseUrl,
    tenantId: config.tenantId,
    jurisdiction: config.jurisdiction,
    sector: config.sector,
    smallPdf: path.basename(config.smallPdf),
    bigPdf: path.basename(config.bigPdf),
  }, null, 2));

  const cases: TestCase[] = [
    {
      label: 'small-pdf-inline-probe',
      pdfPath: config.smallPdf,
      threadId: SMALL_THREAD_ID,
      messageId: SMALL_MESSAGE_ID,
      attachmentTitle: SMALL_ATTACHMENT_TITLE,
    },
    {
      label: 'big-pdf-blob-probe',
      pdfPath: config.bigPdf,
      threadId: LARGE_THREAD_ID,
      messageId: LARGE_MESSAGE_ID,
      attachmentTitle: LARGE_ATTACHMENT_TITLE,
    },
  ];

  for (const testCase of cases) {
    await runCase(config, testCase);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
