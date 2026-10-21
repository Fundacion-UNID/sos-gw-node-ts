// Flow contract: SOS GW indexes the complete inherited portal API map and clearly separates implemented, adapter-owned and planned capabilities without inventing a numbered successor to the beginner guide.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('complete portal API reference', () => {
  it('keeps the beginner guide separate from the complete capability map', () => {
    const referencePath = resolve(process.cwd(), 'docs/PORTAL_API_TO_GW_CORE.md');
    const index = readFileSync(resolve(process.cwd(), 'docs/README.md'), 'utf8');

    expect(existsSync(referencePath)).toBe(true);
    const reference = readFileSync(referencePath, 'utf8');
    const combined = `${index}\n${reference}`;

    expect(index).toContain('[complete portal API reference](PORTAL_API_TO_GW_CORE.md)');
    expect(reference).toContain('The `101` document is the beginner guide');
    expect(reference).not.toContain('102-');

    for (const heading of [
      'Profile, session and technical identity',
      'Organizations, employees, licences, offers and orders',
      'Subjects, cards and personal controllers',
      'Clinical data, documents and IPS',
      'Consent, contacts, members and invitations',
      'Scheduling, Encounters and care journeys',
      'Communications, attachments and calls',
      'Public information and alerts',
      'Terminology and schema-driven forms',
      'Assistant and channel adapters',
    ]) expect(reference).toContain(`## ${heading}`);

    for (const routeFamily of [
      '/api/profile',
      '/api/subjects',
      '/api/cards',
      '/api/notifications',
      '/api/assistant',
      '/api/internal',
    ]) expect(reference).toContain(routeFamily);

    for (const state of ['Implemented shared rule', 'Portal adapter', 'Planned']) {
      expect(reference).toContain(state);
    }
  });
});
