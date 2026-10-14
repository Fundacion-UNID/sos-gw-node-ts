// Flow contract: each GW environment owns one pull subscription, one dead-letter topic,
// one retained dead-letter subscription, one private expiring payload bucket,
// and one Firestore TTL collection group.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../provision-gcp-async-jobs.sh', import.meta.url), 'utf8');

test('provisions the complete durable async-job boundary', () => {
  for (const required of [
    '--enable-exactly-once-delivery',
    '--dead-letter-topic',
    'dead_letter_subscription="${GCP_PUBSUB_SUBSCRIPTION}-dead-letter"',
    '--topic "${dead_letter_topic}"',
    '--message-retention-duration 14d',
    '--max-delivery-attempts 10',
    'roles/pubsub.publisher',
    'roles/pubsub.subscriber',
    'roles/storage.objectAdmin',
    '--uniform-bucket-level-access',
    '--lifecycle-file',
    'firestore fields ttls update expiresAt',
  ]) {
    assert.ok(script.includes(required), `missing ${required}`);
  }
});
