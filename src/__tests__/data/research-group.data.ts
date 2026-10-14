export const researchGroupRouteFixture = Object.freeze({
  tenantId: 'research-clinic',
  sector: 'animal-research',
  jurisdiction: 'CA-BC',
  collectionName: 'isolated-research-clinic-vault',
  controllerDid: 'did:web:example.test:controller',
  professionalDid: 'did:web:example.test:professional',
  gatewayDid: 'did:web:example.test:gw',
});

export const researchGroupFixture = Object.freeze({
  resourceType: 'Group' as const,
  id: 'research-reviewers',
  active: true,
  type: 'practitioner' as const,
  membership: 'enumerated' as const,
  name: 'Research reviewers',
  managingEntity: { reference: 'Organization/research-clinic' },
  member: [
    { entity: { reference: 'PractitionerRole/reviewer-one' } },
    { entity: { reference: 'PractitionerRole/reviewer-two' } },
  ],
});

export const researchGroupSearchProjectionFixture = Object.freeze({
  ...researchGroupFixture,
  identifier: [{ system: 'https://example.test/research-groups', value: 'reviewers-2026' }],
  characteristic: [
    {
      code: { coding: [{ system: 'https://example.test/group-characteristic', code: 'experience' }] },
      valueCodeableConcept: {
        coding: [{ system: 'https://example.test/experience', code: 'veterinary-research' }],
      },
      exclude: false,
    },
    {
      code: { coding: [{ system: 'https://example.test/group-characteristic', code: 'available' }] },
      valueBoolean: true,
      exclude: false,
    },
    {
      code: { coding: [{ system: 'https://example.test/group-characteristic', code: 'study' }] },
      valueReference: { reference: 'ResearchStudy/veterinary-study-2026' },
      exclude: false,
    },
  ],
});
