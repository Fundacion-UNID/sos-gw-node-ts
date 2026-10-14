// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export type ObservationFormAnswerType =
  | 'boolean'
  | 'string'
  | 'quantity'
  | 'code';

export type ObservationFormItem = {
  id: string;
  label: string;
  code: string; // token string: "<SYSTEM>|<CODE>"
  answerType: ObservationFormAnswerType;
  notes?: string;
};

export type ObservationFormSection = {
  id: string;
  label: string;
  items: ObservationFormItem[];
};

/**
 * "Personal Observations" starter forms.
 *
 * Notes:
 * - SNOMED codes MUST be concept IDs (in the IPS release file, that's the "conceptId" column).
 * - LOINC codes here are "question/statement" style items (MDSv3). Represent answers as boolean Observations.
 * - Time-of-day / recurrence should be represented with `Observation.date-when` (FHIR EventTiming: MORN|AFT|EVE|NIGHT).
 */
export const PERSONAL_OBSERVATIONS_FORMS: ObservationFormSection[] = [
  {
    id: 'emergency-context',
    label: 'Emergency & Care Continuity Context',
    items: [
      {
        id: 'anxiety-night',
        label: 'Feels anxious at night',
        code: 'SNOMED|48694002',
        answerType: 'string',
        notes:
          'Use `Observation.date-when = NIGHT` to express the time window; keep `Observation.issued` as the capture timestamp.',
      },
      {
        id: 'body-weight',
        label: 'Body weight (approx.)',
        code: 'LOINC|29463-7',
        answerType: 'quantity',
        notes: 'Use UCUM units (e.g., `kg`).',
      },
      {
        id: 'body-height',
        label: 'Body height',
        code: 'LOINC|8302-2',
        answerType: 'quantity',
        notes: 'Use UCUM units (e.g., `cm`).',
      },
      {
        id: 'fall-risk',
        label: 'At risk for falls',
        code: 'SNOMED|129839007',
        answerType: 'boolean',
      },
      {
        id: 'osteoporosis',
        label: 'Osteoporosis (if known)',
        code: 'SNOMED|64859006',
        answerType: 'boolean',
      },
      {
        id: 'dyspnea-on-exertion',
        label: 'Shortness of breath on exertion',
        code: 'SNOMED|60845006',
        answerType: 'boolean',
      },
      {
        id: 'low-back-pain',
        label: 'Low back pain',
        code: 'SNOMED|279039007',
        answerType: 'boolean',
      },
    ],
  },
  {
    id: 'preferences-mds',
    label: 'Preferences (LOINC MDSv3)',
    items: [
      { id: 'pref-independence-adl', label: 'Believes capable of increased independence in some ADLs', code: 'LOINC|45612-9', answerType: 'boolean' },
      { id: 'pref-around-animals', label: 'Prefers being around animals such as pets', code: 'LOINC|54729-9', answerType: 'boolean' },
      { id: 'pref-personal-belongings', label: 'Prefers caring for personal belongings', code: 'LOINC|54717-4', answerType: 'boolean' },
      { id: 'pref-choosing-clothes', label: 'Prefers choosing clothes to wear', code: 'LOINC|54716-6', answerType: 'boolean' },
      { id: 'pref-group-activities', label: 'Prefers doing things with groups of people', code: 'LOINC|54731-5', answerType: 'boolean' },
      { id: 'pref-family-involvement', label: 'Prefers family/significant-other involvement in care discussions', code: 'LOINC|54724-0', answerType: 'boolean' },
      { id: 'pref-news', label: 'Prefers keeping up with the news', code: 'LOINC|54730-7', answerType: 'boolean' },
      { id: 'pref-listening-music', label: 'Prefers listening to music', code: 'LOINC|54728-1', answerType: 'boolean' },
      { id: 'pref-favorite-activities', label: 'Prefers participating in favorite activities', code: 'LOINC|54732-3', answerType: 'boolean' },
      { id: 'pref-religious-activities', label: 'Prefers participating in religious activities/practices', code: 'LOINC|54735-6', answerType: 'boolean' },
      { id: 'pref-lock-belongings', label: 'Prefers a place to lock personal belongings', code: 'LOINC|54726-5', answerType: 'boolean' },
      { id: 'pref-reading', label: 'Prefers reading books/newspapers/magazines', code: 'LOINC|54727-3', answerType: 'boolean' },
      { id: 'pref-bed-bath', label: 'Prefers receiving bed bath', code: 'LOINC|54720-8', answerType: 'boolean' },
      { id: 'pref-shower', label: 'Prefers receiving shower', code: 'LOINC|54719-0', answerType: 'boolean' },
      { id: 'pref-sponge-bath', label: 'Prefers receiving sponge bath', code: 'LOINC|54721-6', answerType: 'boolean' },
      { id: 'pref-tub-bath', label: 'Prefers receiving tub bath', code: 'LOINC|54718-2', answerType: 'boolean' },
      { id: 'pref-snacks', label: 'Prefers snacks between meals', code: 'LOINC|54722-4', answerType: 'boolean' },
      { id: 'pref-away-from-nursing-home', label: 'Prefers spending time away from the nursing home', code: 'LOINC|54733-1', answerType: 'boolean' },
      { id: 'pref-outdoors', label: 'Prefers spending time outdoors', code: 'LOINC|54734-9', answerType: 'boolean' },
      { id: 'pref-stay-up-past-8pm', label: 'Prefers staying up past 8:00 p.m.', code: 'LOINC|54723-2', answerType: 'boolean' },
      { id: 'pref-phone-private', label: 'Prefers use of phone in private', code: 'LOINC|54725-7', answerType: 'boolean' },
      { id: 'pref-none', label: 'Prefers none of the above', code: 'LOINC|54736-4', answerType: 'boolean' },
    ],
  },
];
