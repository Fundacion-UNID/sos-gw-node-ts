// Flow contract: follow docs/LOCAL_FIRST_RELEASE_CONTRACT.md; start red, reuse canonical versioned-data/common-utils fixtures, and never duplicate governed literals.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('npm authorization continuity policy', () => {
  it('is mandatory in every repository skill', () => {
    const skillsRoot = resolve(process.cwd(), '.codex/skills');
    const skillFiles = readdirSync(skillsRoot, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('SKILL.md'));
    expect(skillFiles.length).toBeGreaterThan(0);
    for (const file of skillFiles) {
      const contract = readFileSync(resolve(skillsRoot, file), 'utf8');
      expect(contract).toMatch(/three.*attempts.*five\s+minutes/is);
      expect(contract).toMatch(/npm pack.*tarball.*local.*test/is);
      expect(contract).toMatch(/registry.*publish.*consumer.*merge.*deploy/is);
      expect(contract).toMatch(/do not attempt.*npm publish.*every affected local.*unit.*integration.*local services.*real UI.*Playwright/is);
      expect(contract).toMatch(/authorization failure.*never stop.*test.*stage/is);
      expect(contract).toMatch(/immutable.*tarball.*--no-save.*pushed but unmerged branches/is);
      expect(contract).toMatch(/resume only the smallest failed gate.*do not repeat a green\s+gate/is);
      expect(contract).toMatch(/exact registry version.*minimal\s+install\/export smoke.*do not repeat/is);
      expect(contract).toMatch(/blocks only.*consumer merge.*image build.*local-network.*test-network.*network/is);
      expect(contract).toMatch(/gateway.*exact registry version.*image.*local-network.*portal.*tarball.*local-network.*exact registry version.*staging/is);
      expect(contract).toMatch(/first line.*Flow contract.*versioned domain data package.*common-utils.*no duplicated literals/is);
      expect(contract).toMatch(/reuse.*types.*HL7.*LOINC.*SNOMED.*ICD-10.*WHO ATC.*Schema\.org.*before.*invent/is);
      expect(contract).toMatch(/types.*versioned domain data package.*common-utils.*shared package/is);
      expect(contract).toMatch(/docs\/LOCAL_FIRST_RELEASE_CONTRACT\.md/is);
      expect(contract).toMatch(/unit.*integration.*networkKind=test/is);
      expect(contract).toMatch(/UI.*BFF.*SDK.*GW\/DataConv.*Playwright/is);
      expect(contract).toMatch(/npm pack.*temporary.*no-save.*restore.*lockfile/is);
      expect(contract).toMatch(/resume.*failed gate.*predecessor.*state/is);
    }
  });
});
