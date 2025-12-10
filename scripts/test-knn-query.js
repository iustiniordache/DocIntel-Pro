const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

async function testKNNQuery() {
  const client = new Client({
    ...AwsSigv4Signer({
      region: 'us-east-1',
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: 'https://search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com',
  });

  try {
    // Test 1: Check index mappings
    console.log('\n=== Test 1: Index Mappings ===');
    const mappings = await client.indices.getMapping({ index: 'docintel-vectors' });
    console.log(
      'Mappings:',
      JSON.stringify(
        mappings.body['docintel-vectors']?.mappings?.properties?.embedding,
        null,
        2,
      ),
    );

    // Test 2: Get one document
    console.log('\n=== Test 2: Sample Document ===');
    const sample = await client.search({
      index: 'docintel-vectors',
      body: { query: { match_all: {} }, size: 1 },
    });
    const doc = sample.body.hits.hits[0];
    console.log('Sample doc ID:', doc?._id);
    console.log('Has embedding:', !!doc?._source?.embedding);
    console.log('Embedding length:', doc?._source?.embedding?.length);
    console.log('Embedding first 5 values:', doc?._source?.embedding?.slice(0, 5));

    // Test 3: Try k-NN query with a sample embedding
    console.log('\n=== Test 3: k-NN Query with Sample Embedding ===');
    const testVector = doc?._source?.embedding || Array(1024).fill(0);

    const knnResult = await client.search({
      index: 'docintel-vectors',
      body: {
        size: 5,
        query: {
          knn: {
            embedding: {
              vector: testVector,
              k: 5,
            },
          },
        },
      },
    });

    console.log('k-NN results count:', knnResult.body.hits.hits.length);
    console.log(
      'Scores:',
      knnResult.body.hits.hits.map((h) => h._score),
    );

    // Test 4: Try alternative query format
    console.log('\n=== Test 4: Alternative k-NN Format ===');
    const altResult = await client.search({
      index: 'docintel-vectors',
      body: {
        size: 5,
        query: {
          bool: {
            must: {
              knn: {
                embedding: {
                  vector: testVector,
                  k: 5,
                },
              },
            },
          },
        },
      },
    });

    console.log('Alternative results count:', altResult.body.hits.hits.length);
    console.log(
      'Scores:',
      altResult.body.hits.hits.map((h) => h._score),
    );
  } catch (error) {
    console.error('Error:', error.message);
    if (error.meta?.body) {
      console.error('Error body:', JSON.stringify(error.meta.body, null, 2));
    }
  }
}

testKNNQuery();
