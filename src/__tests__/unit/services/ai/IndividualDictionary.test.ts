// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { VaultMemRepository } from '../../../../database/repositories/vault/vault.mem.repository';
import { IndividualDictionaryManager } from '../../../../managers/IndividualDictionaryManager';
import {
  anonymizeTextWithDictionary,
  reidentifyTextWithDictionary,
  type IndividualDictionaryEntry,
} from '../../../../services/ai/individualDictionary';

describe('IndividualDictionary (anonymize/reidentify)', () => {
  it('anonymizes private entities and can re-identify in a private context', async () => {
    const vaultRepository = new VaultMemRepository();
    const manager = new IndividualDictionaryManager(vaultRepository);

    const tenantVaultId = 'health-care_acme' as const;
    const subjectDid = 'did:web:api.acme.org:individual:unified-health-identifier' as const;

    const entries: IndividualDictionaryEntry[] = [
      {
        id: 'dict-rp-neighbor-1',
        kind: 'RelatedPerson',
        alias: 'neighbor-1',
        displayName: 'Juan (neighbor)',
        matchTerms: ['Juan', 'my neighbor Juan'],
      },
      {
        id: 'dict-place-home-1',
        kind: 'Place',
        alias: 'home-1',
        displayName: 'home',
        matchTerms: ['Church Street', 'Villoslada del Rio', 'Imaginaria Province'],
      },
      {
        id: 'dict-org-primary-care-1',
        kind: 'Organization',
        alias: 'primary-care-clinic-1',
        displayName: 'North City Family Health Clinic',
        matchTerms: ['North City Family Health Clinic'],
      },
      {
        id: 'dict-prac-reference-1',
        kind: 'Practitioner',
        alias: 'reference-doctor-1',
        displayName: 'Dr. Some',
        matchTerms: ['Dr. Some', 'Doctor Some'],
      },
    ];

    for (const entry of entries) {
      await manager.upsert({ tenantVaultId, subjectDid, entry });
    }

    const storedEntries = await manager.list({ tenantVaultId, subjectDid });
    expect(storedEntries).toHaveLength(entries.length);

    const inputText =
      `My name is Jaime Lobos Del Rio. I live on Church Street in Villoslada del Rio, Imaginaria Province.\n` +
      `My primary care clinic is North City Family Health Clinic. My reference doctor is Dr. Some.\n` +
      `My neighbor Juan took me to the emergency room six months ago.\n`;

    const { anonymizedText, usedEntryIds } = anonymizeTextWithDictionary(inputText, storedEntries);

    expect(usedEntryIds.sort()).toEqual(entries.map((e) => e.id).sort());
    expect(anonymizedText).not.toContain('Juan');
    expect(anonymizedText).not.toContain('North City Family Health Clinic');
    expect(anonymizedText).not.toContain('Dr. Some');
    expect(anonymizedText).not.toContain('Church Street');

    // Private-context re-identification: placeholders are replaced back to a preferred private label.
    const reidentified = reidentifyTextWithDictionary(anonymizedText, storedEntries);
    expect(reidentified).toContain('Juan (neighbor)');
    expect(reidentified).toContain('North City Family Health Clinic');
    expect(reidentified).toContain('Dr. Some');
  });
});

