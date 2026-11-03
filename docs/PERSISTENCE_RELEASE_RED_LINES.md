# Persistence release red lines

These rules apply to every staging and production deployment profile of this
gateway. They specialize the bootstrap, claims-first and release requirements
in [`AGENTS.md`](../AGENTS.md).

## Non-negotiable evidence

Configured is not operational. Startup, health checks, provider names and
mocked tests do not prove durable custody.

Before promotion, the exact immutable image and workload must prove:

1. persistent database, confidential storage and production KMS adapters are
   active; no in-memory or local-secret substitute is accepted;
2. each process unwraps its encrypted runtime KEK exactly once during
   bootstrap and tenant operations do not call KMS;
3. a real write, read, byte comparison and delete succeeds with the deployment
   service identity;
4. the rolled-out pod repeats that roundtrip, is replaced, and its replacement
   repeats it again;
5. the running digest and configuration source match the reviewed release;
6. storage location, access policy, public-access prevention, versioning and
   KMS-key state are verified without printing secrets or ciphertext; and
7. affected authenticated public-boundary readback succeeds after rollout.

Failure blocks promotion. Never switch to memory storage, local KMS, mutable
tags or developer credentials to make a deployment appear healthy. Preserve
the previous digest for rollback and report each environment's evidence
separately.
