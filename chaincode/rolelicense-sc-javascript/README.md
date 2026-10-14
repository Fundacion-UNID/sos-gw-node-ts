# Organization role licence chaincode

`rolelicense-sc` stores organization-owned licence assignments on the regional
organization identity channel (`identity-eu`, `identity-na`, and so on). It is
not deployed on `identity-global`, which is reserved for natural-person identity.

The deterministic asset identity binds the official organization identifier,
one stable hashed email/telephone identifier and the licensed role. A different
role is a different licence. Tenant-local employee UUIDs and clear contact or
payment data are prohibited.

`data[]` holds contractual sector policy. `sector: ""` is a catch-all, while an
exact sector entry overrides it. `active: false` revokes matching DCR devices
only in that sector. `maxDevices: null` delegates the limit to GW/portal policy.
Global revocation revokes every registered device.

Test Network and production use the same Offer/Order/payment-evidence and
licence-registration path; only the configured payment provider/environment
differs.

