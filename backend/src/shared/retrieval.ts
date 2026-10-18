import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import { OpenAIEmbeddings } from '@langchain/openai';
import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { createClient } from '@supabase/supabase-js';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseConfigurationAnnotation,
  ensureBaseConfiguration,
} from './configuration.js';

export async function makeSupabaseRetriever(
  configuration: typeof BaseConfigurationAnnotation.State,
): Promise<VectorStoreRetriever> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are not defined',
    );
  }
  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
  });
  const supabaseClient = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  );
  const vectorStore = new SupabaseVectorStore(embeddings, {
    client: supabaseClient,
    tableName: 'documents',
    queryName: 'match_documents',
  });
  return vectorStore.asRetriever({
    k: configuration.k,
    filter: configuration.filterKwargs,
  });
}

const LOCAL_STORE_PATH = path.resolve(
  process.env.LOCAL_VECTORSTORE_PATH ?? '.local_vectorstore.json',
);

let localStore: MemoryVectorStore | undefined;

/**
 * Persist the in-memory vectors to disk after every write so ingested
 * documents survive server restarts.
 */
class PersistentMemoryVectorStore extends MemoryVectorStore {
  async addVectors(vectors: number[][], documents: Document[]): Promise<void> {
    await super.addVectors(vectors, documents);
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(this.memoryVectors));
  }
}

/**
 * A file-backed vector store that needs no external database, used when
 * Supabase is not configured.
 */
export async function makeLocalRetriever(
  configuration: typeof BaseConfigurationAnnotation.State,
): Promise<VectorStoreRetriever> {
  if (!localStore) {
    localStore = new PersistentMemoryVectorStore(
      new OpenAIEmbeddings({ model: 'text-embedding-3-small' }),
    );
    if (fs.existsSync(LOCAL_STORE_PATH)) {
      localStore.memoryVectors = JSON.parse(
        fs.readFileSync(LOCAL_STORE_PATH, 'utf8'),
      );
    }
  }
  const filterEntries = Object.entries(configuration.filterKwargs ?? {});
  return localStore.asRetriever({
    k: configuration.k,
    filter: filterEntries.length
      ? (doc: Document) =>
          filterEntries.every(([key, value]) => doc.metadata[key] === value)
      : undefined,
  });
}

export async function makeRetriever(
  config: RunnableConfig,
): Promise<VectorStoreRetriever> {
  const configuration = ensureBaseConfiguration(config);
  switch (configuration.retrieverProvider) {
    case 'supabase':
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        return makeLocalRetriever(configuration);
      }
      return makeSupabaseRetriever(configuration);
    case 'local':
      return makeLocalRetriever(configuration);
    default:
      throw new Error(
        `Unsupported retriever provider: ${configuration.retrieverProvider}`,
      );
  }
}
