// Flow contract: identify the declared calling application for card/index writes without logging personal data or credentials.
/**
 * 1. A portal sends canonical AppId/AppVersion headers and one DIDComm thid.
 * 2. The gateway parses the trusted route dimensions and emits one structured ingress event.
 * 3. The event labels application identity as caller-declared and excludes the body, token and personal claims.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { parseCdsRequest } from '../../../gdc-backend-utils-node/middleware/parseCdsRequest';

describe('CDS application-origin observability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('correlates an individual Organization write with its declared portal without logging PII', () => {
    const write = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const next = jest.fn();
    const request = {
      protocol: 'https',
      get: (name: string) => name.toLowerCase() === 'host' ? 'gw.example' : undefined,
      originalUrl: '/provider-1/cds-ES/v1/onehealth-research/individual/org.schema/Organization/_batch',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        appid: 'online.unid.st.uhc-personal',
        appversion: 'build-2026-10-20-001',
        authorization: 'Bearer must-not-be-logged',
      },
      body: {
        thid: 'card-create-thid-1',
        body: {
          data: [{
            resource: {
              meta: {
                claims: {
                  'org.schema.Organization.owner.email': 'private@example.org',
                  'org.schema.Organization.member.birthDate': '1970-01-01',
                },
              },
            },
          }],
        },
      },
    };

    parseCdsRequest(request as any, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    const event = JSON.parse(String(write.mock.calls.at(-1)?.[0]));
    expect(event).toMatchObject({
      severity: 'INFO',
      message: 'CDS request accepted',
      event: 'gateway.request.accepted',
      component: 'parseCdsRequest',
      declaredAppId: 'online.unid.st.uhc-personal',
      declaredAppVersion: 'build-2026-10-20-001',
      applicationIdentityAssurance: 'caller-declared',
      thid: 'card-create-thid-1',
      tenantId: 'provider-1',
      jurisdiction: 'ES',
      sector: 'onehealth-research',
      section: 'individual',
      resourceType: 'Organization',
      action: 'batch',
      method: 'POST',
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('private@example.org');
    expect(serialized).not.toContain('1970-01-01');
    expect(serialized).not.toContain('must-not-be-logged');
  });
});
