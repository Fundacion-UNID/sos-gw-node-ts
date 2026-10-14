import { invokeExpress } from './invokeExpress';

/**
 * Submits and reads back one explicit Consent through the real asynchronous
 * route. Integration journeys use this facade instead of duplicating queue
 * polling or mutating projection storage directly.
 */
export async function submitConsentRuleAndPoll(input: Readonly<{
  app: unknown;
  tenantId: string;
  jurisdiction: string;
  sector: string;
  format: string;
  thid: string;
  /** Signed actor authorization used by the application journey. */
  authorization?: string;
  /** Interoperable command claims; the GW derives the stored ConsentRule and its identifier. */
  claims: Readonly<Record<string, unknown>>;
}>): Promise<void> {
  const base = `/${input.tenantId}/cds-${input.jurisdiction}/v1/${input.sector}/individual/${input.format}/Consent`;
  const submit = await invokeExpress(input.app, {
    method: 'POST',
    url: `${base}/_batch`,
    headers: { 'content-type': 'application/json', authorization: input.authorization || 'Bearer demo-token' },
    body: {
      thid: input.thid,
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{
          request: { method: 'POST', url: `individual/${input.format}/Consent` },
          resource: { resourceType: 'Consent', meta: { claims: input.claims } },
        }],
      },
    },
  });
  if (submit.status !== 202) throw new Error(`Consent submit failed with ${submit.status}.`);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const poll = await invokeExpress(input.app, {
      method: 'POST',
      url: `${base}/_batch-response`,
      headers: { 'content-type': 'application/json' },
      body: { thid: input.thid },
    });
    if (poll.status === 200) {
      const body = JSON.parse(poll.text);
      if (String(body?.data?.[0]?.response?.status || '') !== '201') {
        throw new Error('Consent persistence did not reach its successful terminal state.');
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Consent polling did not complete.');
}
