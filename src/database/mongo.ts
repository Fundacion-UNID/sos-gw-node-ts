// src/database/mongo.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { MongoClient, Db } from 'mongodb';

export async function initializeMongoDb(uri: string, dbName: string): Promise<Db> {
  if (!uri) throw new Error('Missing MONGO_URI for initialization');

  const client = new MongoClient(uri);
  await client.connect();
  return client.db(dbName);
}