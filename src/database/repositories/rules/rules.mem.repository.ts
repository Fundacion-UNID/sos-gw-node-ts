// src/database/repositories/rules/rules.mem.repository.ts

import { ConsentRule } from "gdc-common-utils-ts/models/consent-rule";
import { IRulesRepository, RuleScope } from "./rules.repository";

// In-memory store structure: Map<sector, Map<subjectId, Map<ruleId, ConsentRule>>>
type MemoryStore = Map<string, Map<string, Map<string, ConsentRule>>>;

/**
 * An in-memory implementation of the Rules Repository for testing purposes.
 * It simulates the 'subject-specific' scope by partitioning rules by sector and then subjectId.
 */
export class MemRulesRepository implements IRulesRepository {
    private store: MemoryStore = new Map();

    /**
     * Clears all state to ensure clean test runs.
     */
    public clear(): void {
        this.store.clear();
    }

    public async create(sector: string, scope: RuleScope, subjectId: string | null, rule: ConsentRule): Promise<boolean> {
        if (scope === 'subject-specific' && !subjectId) {
            throw new Error("subjectId is required for 'subject-specific' scope");
        }

        const subjectKey = subjectId || 'global';
        const ruleId = rule["Consent.identifier"];

        if (!this.store.has(sector)) {
            this.store.set(sector, new Map());
        }

        const sectorStore = this.store.get(sector)!;

        if (!sectorStore.has(subjectKey)) {
            sectorStore.set(subjectKey, new Map());
        }

        const subjectStore = sectorStore.get(subjectKey)!;
        subjectStore.set(ruleId, rule);

        return true;
    }

    public async getRulesForSubject(sector: string, subjectId: string): Promise<ConsentRule[]> {
        const subjectStore = this.store.get(sector)?.get(subjectId);
        if (!subjectStore) {
            return [];
        }
        return Array.from(subjectStore.values());
    }
}
