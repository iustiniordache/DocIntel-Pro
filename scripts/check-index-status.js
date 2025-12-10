const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const aws4 = require('aws4');

const indexName = 'docintel-vectors';
const endpoint =
  'search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com';

async function checkIndexStatus() {
  try {
    const credentials = await defaultProvider()();

    const client = new Client({
      node: `https://${endpoint}`,
      Connection: class extends require('@opensearch-project/opensearch').Connection {
        buildRequestObject(params) {
          const request = super.buildRequestObject(params);
          request.service = 'es';
          request.region = 'us-east-1';
          request.headers = request.headers || {};
          request.headers['host'] = endpoint;

          return aws4.sign(request, credentials);
        }
      },
    });

    // Check if index exists
    const exists = await client.indices.exists({ index: indexName });

    if (!exists.body) {
      console.log(`❌ Index '${indexName}' does NOT exist`);
      console.log(
        'The index needs to be created by uploading a document or will be created on next query.',
      );
      return;
    }

    console.log(`✅ Index '${indexName}' exists`);

    // Get mapping
    const mapping = await client.indices.getMapping({ index: indexName });
    const embeddingType = mapping.body[indexName]?.mappings?.properties?.embedding?.type;

    console.log('\n📋 Index Mapping:');
    console.log(`  Embedding field type: ${embeddingType}`);

    if (embeddingType === 'knn_vector') {
      const embeddingConfig = mapping.body[indexName]?.mappings?.properties?.embedding;
      console.log(`  ✅ Correct type (knn_vector)`);
      console.log(`  Dimensions: ${embeddingConfig.dimension}`);
      console.log(`  Method: ${embeddingConfig.method?.name}`);
      console.log(`  Space type: ${embeddingConfig.method?.space_type}`);
      console.log(`  Engine: ${embeddingConfig.method?.engine}`);
    } else {
      console.log(`  ❌ Wrong type (should be knn_vector, got ${embeddingType})`);
    }

    // Count documents
    const count = await client.count({ index: indexName });
    console.log(`\n📊 Document count: ${count.body.count}`);

    if (count.body.count > 0) {
      // Get sample documents
      const docs = await client.search({
        index: indexName,
        body: {
          query: { match_all: {} },
          size: 5,
        },
      });

      console.log('\n📄 Sample documents:');
      docs.body.hits.hits.forEach((hit, idx) => {
        console.log(`\n  Document ${idx + 1}:`);
        console.log(`    ID: ${hit._id}`);
        console.log(`    Document ID: ${hit._source.documentId}`);
        console.log(`    File: ${hit._source.metadata?.fileName}`);
        console.log(`    Page: ${hit._source.metadata?.pageNumber}`);
        console.log(`    Content: ${hit._source.content.substring(0, 100)}...`);
        console.log(`    Has embedding: ${Array.isArray(hit._source.embedding)}`);
        if (Array.isArray(hit._source.embedding)) {
          console.log(`    Embedding dimensions: ${hit._source.embedding.length}`);
        }
      });
    }
  } catch (error) {
    console.error('❌ Error checking index status:', error.message);
    if (error.meta?.body) {
      console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
    }
    throw error;
  }
}

checkIndexStatus()
  .then(() => console.log('\n✅ Check complete'))
  .catch((error) => {
    console.error('\n❌ Check failed');
    process.exit(1);
  });
