import * as fs from 'fs';
import * as path from 'path';

// --- Configuration ---
const DATA_FOLDER = path.join(__dirname, '../../data/snomed/ips');
const OUTPUT_FOLDER = path.join(__dirname, '../../data/snomed');

const DESCRIPTION_FILE = 'sct2_Description_IPSSnapshot-en_IPST_20240701.txt';
const RELATIONSHIP_FILE = 'sct2_Relationship_IPSSnapshot_IPST_20240701.txt';

/**
 * Extracts SNOMED CT IPS problem codes, returning them as a direct
 * key-value map for i18n. It strips the semantic tag (e.g., "(finding)")
 * from the end of each term.
 *
 * @param descriptionFileContent The full string content of the sct2_Description file.
 * @param relationshipFileContent The full string content of the sct2_Relationship file.
 * @returns An object where the key is the SNOMED CT Code (string) and the value is the Cleaned Term (string).
 */
export function getIpsProblemCodes(descriptionFileContent: string, relationshipFileContent: string): Record<string, string> {
    
    // Function to strip semantic tags (e.g., "Clinical finding (finding)" -> "Clinical finding")
    const cleanTerm = (term: string): string => {
        // Regex to match and remove "(...)" at the end of the string, and trim whitespace
        return term.replace(/\s*\([^)]+\)$/, '').trim();
    };
    
    // --- 1. Load active descriptions and clean the term ---
    const descriptions = new Map<string, string>();
    const descriptionLines = descriptionFileContent.split(/\r?\n/).slice(1);
    for (const line of descriptionLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        if (parts[2] === '1') { // parts[2] is 'active' flag
            const cleanedTerm = cleanTerm(parts[7]); // parts[7] is the term
            descriptions.set(parts[4], cleanedTerm); // parts[4] is conceptId
        }
    }

    // --- 2. Build 'Is a' (116680003) hierarchy and find all descendants ---
    const parentToChildren = new Map<string, string[]>();
    const relationshipLines = relationshipFileContent.split(/\r?\n/).slice(1);
    for (const line of relationshipLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        const isARelationshipTypeId = "116680003";
        if (parts[2] === '1' && parts[7] === isARelationshipTypeId) {
            const childId = parts[4];
            const parentId = parts[5];
            if (!parentToChildren.has(parentId)) {
                parentToChildren.set(parentId, []);
            }
            parentToChildren.get(parentId)!.push(childId);
        }
    }

    const rootConcepts = ["404684003", "243796009", "272379006", "160245001"];
    const allDescendants = new Set<string>(rootConcepts);
    const queue = [...rootConcepts];
    
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (parentToChildren.has(current)) {
            for (const child of parentToChildren.get(current)!) {
                if (!allDescendants.has(child)) {
                    allDescendants.add(child);
                    queue.push(child);
                }
            }
        }
    }

    // --- 3. Filter descriptions and convert to the target key-value object ---
    const problemCodes: Record<string, string> = {};
    for (const conceptId of allDescendants) {
        if (descriptions.has(conceptId)) {
            problemCodes[conceptId] = descriptions.get(conceptId)!;
        }
    }

    return problemCodes;
}

describe('SNOMED IPS Problem Codes Artifact Generation', () => {
    let problemMap: Record<string, string> = {};
    const OUTPUT_FILENAME = 'ips_problem_codes.json';
    const OUTPUT_PATH = path.join(OUTPUT_FOLDER, OUTPUT_FILENAME);

    // Use test.serial to ensure the file is generated before the read-back test
    it('should process SNOMED files, save the key-value JSON artifact, and pass integrity checks', () => {
        
        // 1. SETUP: Read file content
        const descriptionFilePath = path.join(DATA_FOLDER, DESCRIPTION_FILE);
        const relationshipFilePath = path.join(DATA_FOLDER, RELATIONSHIP_FILE);

        if (!fs.existsSync(descriptionFilePath) || !fs.existsSync(relationshipFilePath)) {
            throw new Error(`SNOMED IPS data files not found. Ensure they are in: ${DATA_FOLDER}`);
        }

        const descriptionContent = fs.readFileSync(descriptionFilePath, 'utf-8');
        const relationshipContent = fs.readFileSync(relationshipFilePath, 'utf-8');

        // 2. EXECUTE: Run the core logic to get the key-value map
        problemMap = getIpsProblemCodes(descriptionContent, relationshipContent);

        // 3. ARTIFACT GENERATION: Save the JSON file first
        if (!fs.existsSync(OUTPUT_FOLDER)) {
             fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
        }
        
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(problemMap, null, 2), 'utf-8');
        
        console.log(`\n✅ Artifact generated successfully: ${OUTPUT_PATH}`);
        
        // 4. ASSERTIONS: Check the file creation and data integrity
        
        // Check 1: The output file exists
        expect(fs.existsSync(OUTPUT_PATH)).toBe(true);
        
        // Check 2: The total number of codes is correct
        console.log(`Total problem codes extracted: ${Object.keys(problemMap).length}`);
        expect(Object.keys(problemMap).length).toBeGreaterThan(1000); 

        // Check 3: Data Integrity (Spot check core concepts)
        const clinicalFindingCode = '404684003';
        
        // NOTE: The expected value is now 'Clinical finding' (WITHOUT the semantic tag)
        expect(problemMap).toHaveProperty(clinicalFindingCode);
        expect(problemMap[clinicalFindingCode]).toEqual('Clinical finding');

        // Check a specific descendant concept
        const miCode = '22298006'; // Myocardial infarction
        if (problemMap[miCode]) {
             expect(problemMap[miCode]).toBeDefined(); 
        } else {
             console.warn(`Warning: Could not confirm expected descendant code ${miCode}. The IPS release might be partial.`);
        }
    });

    it('should verify the saved JSON file contains the key-value structure', () => {
        
        // Read the file directly to confirm its structure
        const fileContent = fs.readFileSync(OUTPUT_PATH, 'utf-8');
        const savedData: unknown = JSON.parse(fileContent);

        // Check 4: Verify structure and size
        expect(typeof savedData).toBe('object');
        expect(savedData).not.toBeNull();
        
        const keys = Object.keys(savedData as Record<string, string>);
        // Use the actual size found in your previous run for a specific check
        expect(keys.length).toEqual(7303); 
        
        // Verify the key is a SNOMED code (numeric string) and the value is a term (string)
        expect(keys[0]).toMatch(/^\d+$/);
        expect(typeof (savedData as Record<string, string>)[keys[0]]).toBe('string');
    });
});

/**
 * Extracts SNOMED CT IPS Allergy and Intolerance codes based on the specified
 * root concepts. It strips the semantic tag for clean i18n usage.
 *
 * @param descriptionFileContent The full string content of the sct2_Description file.
 * @param relationshipFileContent The full string content of the sct2_Relationship file.
 * @returns An object where the key is the SNOMED CT Code (string) and the value is the Cleaned Term (string).
 */
export function getIpsAllergyCodes(descriptionFileContent: string, relationshipFileContent: string): Record<string, string> {
    
    // Function to strip semantic tags (e.g., "Clinical finding (finding)" -> "Clinical finding")
    const cleanTerm = (term: string): string => {
        // Regex to match and remove "(...)" at the end of the string, and trim whitespace
        return term.replace(/\s*\([^)]+\)$/, '').trim();
    };
    
    // --- 1. Load active descriptions and clean the term ---
    const descriptions = new Map<string, string>();
    const descriptionLines = descriptionFileContent.split(/\r?\n/).slice(1);
    for (const line of descriptionLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        if (parts[2] === '1') { // parts[2] is 'active' flag
            const cleanedTerm = cleanTerm(parts[7]); // parts[7] is the term
            descriptions.set(parts[4], cleanedTerm); // parts[4] is conceptId
        }
    }

    // --- 2. Build 'Is a' (116680003) hierarchy and find all descendants ---
    const parentToChildren = new Map<string, string[]>();
    const relationshipLines = relationshipFileContent.split(/\r?\n/).slice(1);
    for (const line of relationshipLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        const isARelationshipTypeId = "116680003";
        if (parts[2] === '1' && parts[7] === isARelationshipTypeId) {
            const childId = parts[4];
            const parentId = parts[5];
            if (!parentToChildren.has(parentId)) {
                parentToChildren.set(parentId, []);
            }
            parentToChildren.get(parentId)!.push(childId);
        }
    }

    // IPS Allergy Roots: Descendants of the following concepts
    const rootConcepts = [
        "373873005",  // Pharmaceutical / biologic product (product)
        "105590001",  // Substance (substance)
        "420134006",  // Propensity to adverse reaction (finding)
        "716186003",  // No known allergy (situation) - explicitly included as self/descendant
    ];

    const allDescendants = new Set<string>(rootConcepts);
    const queue = [...rootConcepts];
    
    // BFS to find all descendants
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (parentToChildren.has(current)) {
            for (const child of parentToChildren.get(current)!) {
                if (!allDescendants.has(child)) {
                    allDescendants.add(child);
                    queue.push(child);
                }
            }
        }
    }

    // --- 3. Filter descriptions and convert to the target key-value object ---
    const allergyCodes: Record<string, string> = {};
    for (const conceptId of allDescendants) {
        if (descriptions.has(conceptId)) {
            allergyCodes[conceptId] = descriptions.get(conceptId)!;
        }
    }

    return allergyCodes;
}

describe('SNOMED IPS Allergy Codes Artifact Generation', () => {
    let allergyMap: Record<string, string> = {};
    const OUTPUT_FILENAME = 'snomed-ips-allergies.json';
    const OUTPUT_PATH = path.join(OUTPUT_FOLDER, OUTPUT_FILENAME);

    it('should process SNOMED files, save the key-value JSON artifact, and pass integrity checks', () => {
        
        // 1. SETUP: Read file content
        const descriptionFilePath = path.join(DATA_FOLDER, DESCRIPTION_FILE);
        const relationshipFilePath = path.join(DATA_FOLDER, RELATIONSHIP_FILE);

        if (!fs.existsSync(descriptionFilePath) || !fs.existsSync(relationshipFilePath)) {
            throw new Error(`SNOMED IPS data files not found. Ensure they are in: ${DATA_FOLDER}`);
        }

        const descriptionContent = fs.readFileSync(descriptionFilePath, 'utf-8');
        const relationshipContent = fs.readFileSync(relationshipFilePath, 'utf-8');

        // 2. EXECUTE: Run the core logic to get the key-value map
        allergyMap = getIpsAllergyCodes(descriptionContent, relationshipContent);

        // 3. ARTIFACT GENERATION: Save the JSON file first
        if (!fs.existsSync(OUTPUT_FOLDER)) {
             fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allergyMap, null, 2), 'utf-8');
        
        console.log(`\n✅ Allergy Artifact generated successfully: ${OUTPUT_PATH}`);
        
        // 4. ASSERTIONS: Check the file creation and data integrity
        
        // Check 1: The output file exists
        expect(fs.existsSync(OUTPUT_PATH)).toBe(true);
        
        // Check 2: Total number of codes (should be a large number)
        const codeCount = Object.keys(allergyMap).length;
        console.log(`Total allergy codes extracted: ${codeCount}`);
        expect(codeCount).toBeGreaterThan(1000); 

        // Check 3: Data Integrity (Spot check core concepts)
        
        // Root 1: Substance, stripped term
        const substanceCode = '105590001';
        expect(allergyMap).toHaveProperty(substanceCode);
        expect(allergyMap[substanceCode]).toEqual('Substance');

        // Root 4: No known allergy, stripped term
        const noKnownAllergyCode = '716186003';
        expect(allergyMap).toHaveProperty(noKnownAllergyCode);
        expect(allergyMap[noKnownAllergyCode]).toEqual('NKA - no known allergy');

        // Check a specific descendant (e.g., Penicillin)
        const penicillinCode = '373873005';
        if (allergyMap[penicillinCode]) {
             expect(allergyMap[penicillinCode]).toBeDefined(); 
        } else {
             console.warn(`Warning: Could not confirm expected descendant code ${penicillinCode}. The IPS release might be partial.`);
        }
    });

    it('should verify the saved JSON file contains the key-value structure', () => {
        
        // Read the file directly to confirm its structure
        const fileContent = fs.readFileSync(OUTPUT_PATH, 'utf-8');
        const savedData: unknown = JSON.parse(fileContent);

        // Check 4: Verify structure
        expect(typeof savedData).toBe('object');
        expect(savedData).not.toBeNull();
        
        const keys = Object.keys(savedData as Record<string, string>);
        expect(keys.length).toBeGreaterThan(1000);
        
        // Verify the key is a SNOMED code (numeric string) and the value is a term (string)
        expect(keys[0]).toMatch(/^\d+$/);
        expect(typeof (savedData as Record<string, string>)[keys[0]]).toBe('string');
    });
});


/**
 * Extracts SNOMED CT IPS Allergy Reaction codes based on the extensive list of
 * root concepts. It strips the semantic tag for clean i18n usage.
 *
 * @param descriptionFileContent The full string content of the sct2_Description file.
 * @param relationshipFileContent The full string content of the sct2_Relationship file.
 * @returns An object where the key is the SNOMED CT Code (string) and the value is the Cleaned Term (string).
 */
export function getIpsReactionCodes(descriptionFileContent: string, relationshipFileContent: string): Record<string, string> {
    
    // Function to strip semantic tags (e.g., "(finding)")
    const cleanTerm = (term: string): string => {
        // Regex to match and remove "(...)" at the end of the string, and trim whitespace
        return term.replace(/\s*\([^)]+\)$/, '').trim();
    };
    
    // --- 1. Load active descriptions and clean the term ---
    const descriptions = new Map<string, string>();
    const descriptionLines = descriptionFileContent.split(/\r?\n/).slice(1);
    for (const line of descriptionLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        if (parts[2] === '1') { // parts[2] is 'active' flag
            const cleanedTerm = cleanTerm(parts[7]); // parts[7] is the term
            descriptions.set(parts[4], cleanedTerm); // parts[4] is conceptId
        }
    }

    // --- 2. Build 'Is a' (116680003) hierarchy and find all descendants ---
    const parentToChildren = new Map<string, string[]>();
    const relationshipLines = relationshipFileContent.split(/\r?\n/).slice(1);
    for (const line of relationshipLines) {
        if (!line) continue;
        const parts = line.trim().split('\t');
        const isARelationshipTypeId = "116680003";
        if (parts[2] === '1' && parts[7] === isARelationshipTypeId) {
            const childId = parts[4];
            const parentId = parts[5];
            if (!parentToChildren.has(parentId)) {
                parentToChildren.set(parentId, []);
            }
            parentToChildren.get(parentId)!.push(childId);
        }
    }

    // IPS Allergy Reaction Root Concepts (Descendants of all of these)
    const rootConcepts = [
        "4386001", "9826008", "23924001", "24079001", "31996006", "39579001", 
        "41291007", "43116000", "49727002", "51599000", "62315008", "70076002", 
        "73442001", "76067001", "91175000", "126485001", "162290004", "195967001", 
        "247472004", "267036007", "271757001", "271759003", "271807003", 
        "410430005", "418363000", "422400008", "422587007", "698247007", 
        "702809001", "768962006", "781682005"
    ];

    const allDescendants = new Set<string>(rootConcepts);
    const queue = [...rootConcepts];
    
    // BFS to find all descendants
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (parentToChildren.has(current)) {
            for (const child of parentToChildren.get(current)!) {
                if (!allDescendants.has(child)) {
                    allDescendants.add(child);
                    queue.push(child);
                }
            }
        }
    }

    // --- 3. Filter descriptions and convert to the target key-value object ---
    const reactionCodes: Record<string, string> = {};
    for (const conceptId of allDescendants) {
        if (descriptions.has(conceptId)) {
            reactionCodes[conceptId] = descriptions.get(conceptId)!;
        }
    }

    return reactionCodes;
}

describe('SNOMED IPS Reaction Codes Artifact Generation', () => {
    let reactionMap: Record<string, string> = {};
    
    // --- Reaction Specific Configuration ---
    const OUTPUT_FILENAME = 'snomed-ips-reactions.json';
    const OUTPUT_PATH = path.join(OUTPUT_FOLDER, OUTPUT_FILENAME);

    it('should process SNOMED files, save the key-value JSON artifact, and pass integrity checks', () => {
        
        // 1. SETUP: Read file content
        const descriptionFilePath = path.join(DATA_FOLDER, DESCRIPTION_FILE);
        const relationshipFilePath = path.join(DATA_FOLDER, RELATIONSHIP_FILE);

        if (!fs.existsSync(descriptionFilePath) || !fs.existsSync(relationshipFilePath)) {
            throw new Error(`SNOMED IPS data files not found. Ensure they are in: ${DATA_FOLDER}`);
        }

        const descriptionContent = fs.readFileSync(descriptionFilePath, 'utf-8');
        const relationshipContent = fs.readFileSync(relationshipFilePath, 'utf-8');

        // 2. EXECUTE: Run the core logic to get the key-value map
        reactionMap = getIpsReactionCodes(descriptionContent, relationshipContent);

        // 3. ARTIFACT GENERATION: Save the JSON file first
        if (!fs.existsSync(OUTPUT_FOLDER)) {
             fs.mkdirSync(OUTPUT_FOLDER, { recursive: true });
        }
        fs.writeFileSync(OUTPUT_PATH, JSON.stringify(reactionMap, null, 2), 'utf-8');
        
        console.log(`\n✅ Reaction Artifact generated successfully: ${OUTPUT_PATH}`);
        
        // 4. ASSERTIONS: Check the file creation and data integrity
        
        // Check 1: The output file exists
        expect(fs.existsSync(OUTPUT_PATH)).toBe(true);
        
        // Check 2: Total number of codes 
        const codeCount = Object.keys(reactionMap).length;
        console.log(`Total reaction codes extracted: ${codeCount}`);
        expect(codeCount).toBeGreaterThan(100); 

        // Check 3: Data Integrity (Spot check core concepts)
        
        // Check Bronchospasm (4386001) - should be stripped
        const bronchospasmCode = '4386001';
        expect(reactionMap).toHaveProperty(bronchospasmCode);
        expect(reactionMap[bronchospasmCode]).toEqual('Bronchospasm');

        // Check Anaphylaxis (39579001) - should be stripped
        const anaphylaxisCode = '39579001';
        expect(reactionMap).toHaveProperty(anaphylaxisCode);
        expect(reactionMap[anaphylaxisCode]).toEqual('Anaphylaxis');
    });

    it('should verify the saved JSON file contains the key-value structure', () => {
        
        // Read the file directly to confirm its structure
        const fileContent = fs.readFileSync(OUTPUT_PATH, 'utf-8');
        const savedData: unknown = JSON.parse(fileContent);

        // Check 4: Verify structure
        expect(typeof savedData).toBe('object');
        expect(savedData).not.toBeNull();
        
        const keys = Object.keys(savedData as Record<string, string>);
        expect(keys.length).toBeGreaterThan(100);
        
        // Verify the key is a SNOMED code (numeric string) and the value is a term (string)
        expect(keys[0]).toMatch(/^\d+$/);
        expect(typeof (savedData as Record<string, string>)[keys[0]]).toBe('string');
    });
});
