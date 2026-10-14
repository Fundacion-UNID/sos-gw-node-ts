// Flow contract: the production server injects the initialized Subscription manager into the Worker registry used by asynchronous FHIR R5 registration jobs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('server Subscription manager wiring', () => {
  it('passes the manager built at bootstrap into the Worker registry', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
    const destructuring = source.slice(source.indexOf('} = buildManagers(') - 2400, source.indexOf('} = buildManagers('));
    const registry = source.slice(source.indexOf('const managerRegistry:'), source.indexOf('const worker = new Worker'));

    expect(destructuring).toContain('subscriptionManager,');
    expect(registry).toContain('subscriptionManager,');
  });
});
