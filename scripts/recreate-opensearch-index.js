const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

async function recreateIndex() {
  const client = new Client({
    ...AwsSigv4Signer({
      region: 'us-east-1',
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: 'https://search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com',
  });

  const indexName = 'docintel-vectors';

  try {
    // Step 1: Get all existing documents
    console.log('Step 1: Fetching all documents...');
    const allDocs = await client.search({
      index: indexName,
      body: {
        query: { match_all: {} },
        size: 100,
      },
      scroll: '1m',
    });

    const documents = allDocs.body.hits.hits.map((hit) => ({
      id: hit._id,
      source: hit._source,
    }));

    console.log(`Found ${documents.length} documents to preserve`);

    // Step 2: Delete the index
    console.log('\nStep 2: Deleting old index...');
    await client.indices.delete({ index: indexName });
    console.log('Index deleted');

    // Step 3: Create new index with correct knn_vector mapping
    console.log('\nStep 3: Creating new index with knn_vector mapping...');
    await client.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 3,
          number_of_replicas: 1,
          'index.knn': true,
        },
        mappings: {
          properties: {
            chunkId: { type: 'keyword' },
            documentId: { type: 'keyword' },
            content: {
              type: 'text',
              analyzer: 'standard',
            },
            embedding: {
              type: 'knn_vector',
              dimension: 1024,
              method: {
                name: 'hnsw',
                space_type: 'cosinesimil',
                engine: 'lucene',
                parameters: {
                  ef_construction: 128,
                  m: 24,
                },
              },
            },
            metadata: {
              type: 'object',
              enabled: true,
            },
            timestamp: { type: 'date' },
          },
        },
      },
    });
    console.log('New index created with knn_vector type');

    // Step 4: Re-index all documents
    console.log('\nStep 4: Re-indexing documents...');
    const bulkBody = [];
    for (const doc of documents) {
      bulkBody.push({ index: { _index: indexName, _id: doc.id } });
      bulkBody.push(doc.source);
    }

    if (bulkBody.length > 0) {
      const bulkResponse = await client.bulk({
        body: bulkBody,
        refresh: true,
      });

      console.log(`Re-indexed ${documents.length} documents`);
      if (bulkResponse.body.errors) {
        console.log('Some errors occurred during bulk indexing');
        const errors = bulkResponse.body.items.filter((item) => item.index?.error);
        console.log('Errors:', JSON.stringify(errors, null, 2));
      }
    }

    // Step 5: Verify
    console.log('\nStep 5: Verifying...');
    const mappings = await client.indices.getMapping({ index: indexName });
    console.log(
      'Embedding field type:',
      mappings.body[indexName].mappings.properties.embedding.type,
    );

    const count = await client.count({ index: indexName });
    console.log('Document count:', count.body.count);

    console.log('\n✅ Index recreated successfully!');
    console.log('You can now try your k-NN queries.');
  } catch (error) {
    console.error('Error:', error.message);
    if (error.meta?.body) {
      console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
    }
  }
}

recreateIndex();
