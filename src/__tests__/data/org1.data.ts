// src/__tests__/org1.data.ts

/**
 * Generates a FHIR-like Batch Bundle for onboarding employees for ORG1.
 * This function now constructs entries that adhere to our canonical BundleEntry structure,
 * with the definitive claims located in `entry.resource.meta.claims`.
 *
 * @param org1Urn The URN of the custodian tenant.
 * @returns A Bundle object.
 */
export const getOrg1EmployeeBatch = (org1Urn: string) => {
  const employees = [
    { id: 'employee-01', familyName: 'Smith', givenName: 'John' },
    { id: 'employee-02', familyName: 'Doe', givenName: 'Jane' },
    { id: 'employee-03', familyName: 'Jones', givenName: 'Peter' },
  ];

  return {
    resourceType: "Bundle",
    type: "batch",
    entry: employees.map(emp => {
      const resource = {
        resourceType: "Practitioner",
        id: emp.id,
        name: [{ family: emp.familyName, given: [emp.givenName] }],
        meta: {
          claims: {
            '@context': 'org.schema.Person',
            '@type': 'Practitioner',
            identifier: `emp-${emp.id}`,
            ...emp
          }
        },
        // Other FHIR properties...
      };

      return {
        fullUrl: `urn:uuid:${emp.id}`,
        resource: resource,
        request: {
          method: 'PUT',
          url: `Practitioner/${emp.id}`
        }
      };
    })
  };
};
