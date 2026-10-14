import { ClaimsServiceSchemaorg } from "gdc-common-utils-ts/constants/schemaorg";
import { testConfigDataHost, testConfigTenant1 } from "./organization.data";

// Terms of service accepted for running the software service
export const testServiceTermsClaimsForHost = {
    [ClaimsServiceSchemaorg.category]: testConfigDataHost.provider?.service.sectorCategory, // sector type
    [ClaimsServiceSchemaorg.identifier]: testConfigDataHost.provider?.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testConfigDataHost.provider?.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testConfigDataHost.provider?.service.serviceType,
}

// Terms of service accepted by the tenant's registrant (the `admin` or tenant's `controller`)
export const testServiceTermsClaimsForTenant1 = {
    [ClaimsServiceSchemaorg.category]: testConfigTenant1.provider?.service.category, // sector type
    [ClaimsServiceSchemaorg.identifier]: testConfigTenant1.provider?.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testConfigTenant1.provider?.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testConfigTenant1.provider?.service.serviceType,
}