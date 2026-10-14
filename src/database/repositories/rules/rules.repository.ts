// src/database/repositories/rules/rules.repository.ts

import { ConsentRule } from "gdc-common-utils-ts/models/consent-rule";

/**
 * Defines the scope or partition for a set of consent rules.
 * - 'global': For rules that apply across the entire data space (e.g., Fabric ledger).
 * - 'subject-specific': For rules partitioned by the individual subject's ID (e.g., Firestore collections).
 */
export type RuleScope = 'global' | 'subject-specific';

/**
 * Defines the contract for a repository that manages publicly queryable consent rules.
 * This is the abstraction for the shared data space's rules engine.
 */
export abstract class IRulesRepository {
  /**
   * Creates a new consent rule within a specific sector and scope.
   * @param sector The data space sector (e.g., 'health-care', 'research'), mapping to a channel or collection root.
   * @param scope The scope in which to create the rule.
   * @param subjectId The identifier of the subject. Required for 'subject-specific' scope.
   * @param rule The ConsentRule object to store.
   */
  abstract create(sector: string, scope: RuleScope, subjectId: string | null, rule: ConsentRule): Promise<boolean>;

  /**
   * Retrieves all rules for a specific subject within a specific sector.
   * @param sector The data space sector to query within.
   * @param subjectId The identifier of the subject whose rules are to be retrieved.
   */
  abstract getRulesForSubject(sector: string, subjectId: string): Promise<ConsentRule[]>;
}
