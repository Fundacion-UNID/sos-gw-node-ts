// Flow contract: research terminology is resolved from a canonical FHIR token through the governed exact-label HTTP boundary; caller-supplied labels are never authoritative.
import { createServer, type Server } from 'node:http';
import { resolveResearchTerminologyLabels } from '../../../services/research-terminology-resolver';

describe('research terminology resolver', () => {
  let server: Server;
  let baseUrl: string;

  afterEach(async () => {
    delete process.env.RESEARCH_TERMINOLOGY_BASE_URL;
    delete process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('resolves trusted local and English labels from an exact system|code lookup', async () => {
    let requests = 0;
    server = createServer((request, response) => {
      requests += 1;
      const url = new URL(request.url || '/', 'http://localhost');
      expect(url.pathname).toBe('/v1/terminology/labels');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        sector: 'animal-care',
        jurisdiction: 'ES',
        fhirVersion: 'R4',
        claim: 'Observation.code',
        system: 'http://loinc.org',
        code: '8310-5',
        language: 'es',
      });
      expect(request.headers.authorization).toBe('Bearer local-service-token');
      response.writeHead(200, { 'content-type': 'application/vnd.api+json' });
      response.end(JSON.stringify({
        data: {
          type: 'terminology-label',
          id: 'http://loinc.org|8310-5',
          attributes: {
            system: 'http://loinc.org',
            code: '8310-5',
            text: 'Temperatura corporal',
            display: 'Body temperature',
            textLanguage: 'es',
            displayLanguage: 'en',
          },
        },
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = baseUrl;
    process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN = 'local-service-token';

    const input = {
      sector: 'animal-care',
      jurisdiction: 'ES',
      resourceType: 'Observation',
      claims: {
        'Observation.code': 'http://loinc.org|8310-5',
        'Observation.language': 'es',
        'Observation.code-text': 'texto no confiable',
        'Observation.code-display': 'untrusted display',
      },
    };
    await expect(resolveResearchTerminologyLabels(input)).resolves.toEqual({
      codeClaim: 'Observation.code',
      textClaim: 'Observation.code-text',
      displayClaim: 'Observation.code-display',
      system: 'http://loinc.org',
      code: '8310-5',
      text: 'Temperatura corporal',
      display: 'Body temperature',
      textLanguage: 'es',
      displayLanguage: 'en',
    });
    await expect(resolveResearchTerminologyLabels(input)).resolves.toBeDefined();
    expect(requests).toBe(1);
  });

  it('does not call a service or invent labels when no canonical code is present', async () => {
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = 'http://127.0.0.1:1';
    await expect(resolveResearchTerminologyLabels({
      sector: 'animal-care',
      jurisdiction: 'ES',
      resourceType: 'Observation',
      claims: { 'Observation.code-text': 'Fiebre' },
    })).resolves.toBeUndefined();
  });

  it('rejects a failed governed lookup instead of accepting caller labels', async () => {
    server = createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'application/vnd.api+json' });
      response.end(JSON.stringify({ errors: [{ status: '503', code: 'unavailable' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    process.env.RESEARCH_TERMINOLOGY_BASE_URL = `http://127.0.0.1:${address.port}`;

    await expect(resolveResearchTerminologyLabels({
      sector: 'animal-care', jurisdiction: 'ES', resourceType: 'Observation',
      claims: {
        'Observation.code': 'http://loinc.org|8310-5',
        'Observation.code-text': 'texto no confiable',
      },
    })).rejects.toThrow('HTTP 503');
  });
});
