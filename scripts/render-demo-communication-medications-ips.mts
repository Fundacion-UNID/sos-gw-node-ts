import {
  buildDemoCommunicationBatchSubmitRequest,
  buildDemoIpsSearchRequest,
  buildDemoMedicationSearchRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../src/__tests__/data/demo-communication-medications-ips.data.ts';

type PayloadName =
  | 'COMMUNICATION_BATCH'
  | 'MEDICATION_SEARCH'
  | 'IPS_SEARCH';

const payloadName = process.argv[2] as PayloadName | undefined;

if (!payloadName) {
  throw new Error(
    'Usage: render-demo-communication-medications-ips.mts <COMMUNICATION_BATCH|MEDICATION_SEARCH|IPS_SEARCH>'
  );
}

const runtime = {
  thidComm: process.env.THID_COMM || 'comm-medications-demo',
  thidMedSearch: process.env.THID_MED_SEARCH || 'medications-search-demo',
  thidIpsSearch: process.env.THID_IPS_SEARCH || 'ips-search-demo',
  medicationCaseIndex: Number(process.env.MEDICATION_CASE_INDEX || '0'),
};

const config = {
  ...demoCommunicationMedicationIpsDefaults,
  subjectId: process.env.SUBJECT_ID || demoCommunicationMedicationIpsDefaults.subjectId,
  ...runtime,
};

const rendered = (() => {
  switch (payloadName) {
    case 'COMMUNICATION_BATCH':
      return buildDemoCommunicationBatchSubmitRequest(config);
    case 'MEDICATION_SEARCH':
      return buildDemoMedicationSearchRequest(config);
    case 'IPS_SEARCH':
      return buildDemoIpsSearchRequest(config);
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
