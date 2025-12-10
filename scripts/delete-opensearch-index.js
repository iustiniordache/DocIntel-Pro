const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const aws4 = require('aws4');

const indexName = 'docintel-vectors';
const endpoint =
  'search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com';

async function deleteIndex() {
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
      console.log(`Index '${indexName}' does not exist. Nothing to delete.`);
      return;
    }

    console.log(`Deleting index: ${indexName}`);
    const response = await client.indices.delete({ index: indexName });

    console.log('✅ Index deleted successfully');
    console.log('Response:', JSON.stringify(response.body, null, 2));
  } catch (error) {
    console.error('❌ Error deleting index:', error.message);
    if (error.meta?.body) {
      console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
    }
    throw error;
  }
}

deleteIndex()
  .then(() => {
    console.log('\nIndex deletion complete.');
    console.log(
      'The index will be recreated automatically with correct mapping on next document upload or query.',
    );
  })
  .catch((error) => {
    console.error('\nFailed to delete index');
    process.exit(1);
  });
