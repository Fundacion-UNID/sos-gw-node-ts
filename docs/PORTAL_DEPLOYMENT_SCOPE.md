# Portal and demo deployment scope

## One service, several channels

The European staging environment runs one shared SOS gateway service. Personal
and professional portals are channels into that service; they do not own or
deploy separate gateway implementations. Human and animal data remain
separated by their configured tenant route, jurisdiction and sector, not by
copying the gateway.

The shared service does not merge provider authority, data custody, KMS
material, ICA identities or ledger profiles. Every portal BFF sends its stable
application identity and calls only the tenant route assigned by deployment
configuration.

## One tenant-controller portal

UNID Professional is the sole portal for tenant-controller administration in
this staging topology. SOSChain Professional is an emergency and professional
service channel; it must not grow a second tenant-controller console. Personal
portals never grant controller authority.

## Month-end demonstration boundary

Active feature work for the month-end demonstration is limited to SOSChain
Personal and SOSChain Professional. UHC portals remain compatible consumers of
the shared service, but demo behavior must not be implemented twice there.

The existing North American VetChain and PetChain deployment stays outside this
demo migration until its separately governed regional move is approved and
tested. Cross-provider discovery does not change which gateway owns the source
tenant.

## Developer rule

When adding a demo flow:

1. implement shared data and SDK behavior in the owning shared packages;
2. expose it through the single SOS gateway;
3. integrate it in the SOSChain personal or professional BFF as appropriate;
4. keep tenant-controller operations in UNID Professional; and
5. do not fork the same behavior into another portal merely to change branding.
