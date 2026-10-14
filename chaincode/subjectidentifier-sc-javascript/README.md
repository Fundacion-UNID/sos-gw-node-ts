# subjectidentifier-sc

Global equality lookup from one already-derived `urn:multibase` asset id to one
index provider DID.

The contract accepts and returns `indexProviderDid` as its only business field.
It never receives the raw identifier, public card, contact data, subject kind,
clinical data or an authorization decision. The asset id is a lookup key only;
the caller must resolve the DID and perform the authenticated provider-local
`Patient/$match` operation separately.
