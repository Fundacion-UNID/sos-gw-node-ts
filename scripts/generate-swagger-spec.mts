import swaggerJSDoc from 'swagger-jsdoc';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { options, swaggerDefinition } = require('../swagger.config.cjs');

// Dynamic examples from the same TS source of truth used in tests and docs.
const examples = await import('../src/__tests__/data/example-payloads.ts');
const apiExamples = await import('../src/api-examples/index.ts');

swaggerDefinition.components.schemas.OrganizationRegistrationLegacy.example =
  examples.ORGANIZATION_REGISTRATION_REQUEST;
swaggerDefinition.components.schemas.EmployeeCreationLegacy.example =
  examples.EMPLOYEE_REGISTRATION_REQUEST;
swaggerDefinition.components.schemas.CustomerCreationLegacy.example =
  examples.CUSTOMER_ONBOARDING_MESSAGE;
swaggerDefinition.components.schemas.ConsentCreation.example = examples.CONSENT_CREATION_MESSAGE;
swaggerDefinition.components.schemas.CommunicationCreation.example =
  apiExamples.COMMUNICATION_INGESTION_MESSAGE_EXAMPLE;
swaggerDefinition.components.schemas.RelatedPersonCreation.example =
  examples.FAMILY_MEMBER_RELATIONSHIP_MESSAGE;
swaggerDefinition.components.schemas.AsyncPollRequest.example = examples.ASYNC_POLL_REQUEST;
swaggerDefinition.components.schemas.AsyncPollPending.example = examples.ASYNC_POLL_PENDING_RESPONSE;
swaggerDefinition.components.schemas.AsyncPollSecureResponse.example = examples.ASYNC_POLL_SECURE_RESPONSE_FORM;

swaggerDefinition.components.examples.OrganizationRegistrationPlaintextMessage.value =
  examples.ORGANIZATION_REGISTRATION_REQUEST;
swaggerDefinition.components.examples.OrganizationActivationPlaintextMessage.value =
  examples.ORGANIZATION_ACTIVATION_REQUEST;
swaggerDefinition.components.examples.OrganizationActivationResponseBundle.value =
  examples.ORGANIZATION_ACTIVATION_RESPONSE;
swaggerDefinition.components.examples.OrganizationVerificationTransactionPlaintextMessage.value =
  examples.ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST;
swaggerDefinition.components.examples.OrganizationIssuePlaintextMessage.value =
  examples.ORGANIZATION_ISSUE_REQUEST;
swaggerDefinition.components.examples.OrganizationIssueResponseBundle.value =
  examples.ORGANIZATION_ISSUE_RESPONSE;
swaggerDefinition.components.examples.OrganizationOrderPlaintextMessage.value =
  examples.ORGANIZATION_ORDER_REQUEST;
swaggerDefinition.components.examples.OrganizationVerificationTransactionResponseBundle.value =
  examples.ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE;
swaggerDefinition.components.examples.OrganizationOrderResponseBundle.value =
  examples.ORGANIZATION_ORDER_RESPONSE;
swaggerDefinition.components.examples.InitialAccessTokenExchangePlaintextMessage.value =
  examples.INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST;
swaggerDefinition.components.examples.InitialAccessTokenExchangeResponse.value =
  examples.INITIAL_ACCESS_TOKEN_EXCHANGE_RESPONSE;
swaggerDefinition.components.examples.LicenseIssuePlaintextMessage.value =
  examples.LICENSE_ISSUE_REQUEST;
swaggerDefinition.components.examples.LicenseIssueExistingEmployeePlaintextMessage.value =
  examples.LICENSE_ISSUE_EXISTING_EMPLOYEE_REQUEST;
swaggerDefinition.components.examples.FirebaseCustomTokenPlaintextMessage.value =
  examples.FIREBASE_CUSTOM_TOKEN_REQUEST;
swaggerDefinition.components.examples.DeviceRegistrationPlaintextMessage.value =
  examples.DEVICE_REGISTRATION_REQUEST;
swaggerDefinition.components.examples.DeviceRegistrationResponse.value =
  examples.DEVICE_REGISTRATION_RESPONSE;
swaggerDefinition.components.examples.SmartTokenRequestPlaintextMessage.value =
  examples.SMART_TOKEN_REQUEST;
swaggerDefinition.components.examples.EmployeeRegistrationPlaintextMessage.value =
  examples.EMPLOYEE_REGISTRATION_REQUEST;
swaggerDefinition.components.examples.EmployeeDisablePlaintextMessage.value =
  examples.EMPLOYEE_DISABLE_REQUEST;
swaggerDefinition.components.examples.EmployeePurgePlaintextMessage.value =
  examples.EMPLOYEE_PURGE_REQUEST;
swaggerDefinition.components.examples.RelatedPersonDisablePlaintextMessage.value =
  examples.RELATED_PERSON_DISABLE_REQUEST;
swaggerDefinition.components.examples.RelatedPersonPurgePlaintextMessage.value =
  examples.RELATED_PERSON_PURGE_REQUEST;
swaggerDefinition.components.examples.TenantDisablePlaintextMessage.value = examples.TENANT_DISABLE_REQUEST;
swaggerDefinition.components.examples.TenantEnablePlaintextMessage.value = examples.TENANT_ENABLE_REQUEST;
swaggerDefinition.components.examples.TenantPurgePlaintextMessage.value = examples.TENANT_PURGE_REQUEST;
swaggerDefinition.components.examples.IndividualOrganizationDisablePlaintextMessage.value =
  examples.INDIVIDUAL_ORGANIZATION_DISABLE_REQUEST;
swaggerDefinition.components.examples.IndividualOrganizationPurgePlaintextMessage.value =
  examples.INDIVIDUAL_ORGANIZATION_PURGE_REQUEST;
swaggerDefinition.components.examples.FamilyRegistrationPlaintextMessage.value =
  examples.FAMILY_REGISTRATION_REQUEST;
swaggerDefinition.components.examples.FamilyOrderPlaintextMessage.value =
  examples.FAMILY_ORDER_REQUEST;
swaggerDefinition.components.examples.CustomerOnboardingPlaintextMessage.value =
  examples.CUSTOMER_ONBOARDING_MESSAGE;
swaggerDefinition.components.examples.ConsentCreationPlaintextMessage.value =
  examples.CONSENT_CREATION_MESSAGE;
swaggerDefinition.components.examples.CommunicationCreationPlaintextMessage.value =
  apiExamples.COMMUNICATION_INGESTION_MESSAGE_EXAMPLE;
swaggerDefinition.components.examples.CompositionUpdatePlaintextMessage.value =
  examples.COMPOSITION_UPDATE_MESSAGE;
swaggerDefinition.components.examples.ResearchCompositionIngestionPlaintextMessage.value =
  examples.RESEARCH_COMPOSITION_INGESTION_MESSAGE;
swaggerDefinition.components.examples.FamilyMemberRelationshipPlaintextMessage.value =
  examples.FAMILY_MEMBER_RELATIONSHIP_MESSAGE;

swaggerDefinition.components.examples.AsyncPollRequest.value = examples.ASYNC_POLL_REQUEST;
if (swaggerDefinition.components.examples.TokenExchangePollRequest) {
  swaggerDefinition.components.examples.TokenExchangePollRequest.value =
    examples.TOKEN_EXCHANGE_POLL_REQUEST;
}
swaggerDefinition.components.examples.AsyncPollPending.value = examples.ASYNC_POLL_PENDING_RESPONSE;
swaggerDefinition.components.examples.AsyncPollSecureResponse.value = examples.ASYNC_POLL_SECURE_RESPONSE_FORM;

const swaggerSpec = swaggerJSDoc({
  swaggerDefinition,
  apis: options.apis,
});

const outputPath = path.resolve(process.cwd(), 'swagger-spec.json');
const referencePath = path.resolve(process.cwd(), 'swagger-spec.reference.json');
fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2));
fs.writeFileSync(referencePath, JSON.stringify(swaggerSpec, null, 2));
console.log(`✅ Swagger specification generated at: ${outputPath}`);
console.log(`✅ Swagger reference snapshot generated at: ${referencePath}`);
