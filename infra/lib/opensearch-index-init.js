const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const aws4 = require('aws4');

/**
 * Custom Resource Lambda handler to create OpenSearch index with correct k-NN mapping
 * This runs during CDK deployment to ensure the index exists with proper configuration
 */
exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  const indexName = process.env.INDEX_NAME || 'docintel-vectors';
  const endpoint = process.env.OPENSEARCH_ENDPOINT;

  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is required');
  }

  const credentials = await defaultProvider()();

  const client = new Client({
    node: endpoint,
    Connection: class extends require('@opensearch-project/opensearch').Connection {
      buildRequestObject(params) {
        const request = super.buildRequestObject(params);
        request.service = 'es';
        request.region = process.env.AWS_REGION || 'us-east-1';
        request.headers = request.headers || {};
        request.headers['host'] = endpoint.replace('https://', '');

        return aws4.sign(request, credentials);
      }
    },
  });

  try {
    // Only create on Create and Update events
    if (event.RequestType === 'Delete') {
      console.log('Delete event - skipping index deletion (index will remain)');
      return sendResponse(event, context, 'SUCCESS', {
        Message: 'Index preserved on stack deletion',
      });
    }

    // Check if index already exists
    const exists = await client.indices.exists({ index: indexName });

    if (exists.body) {
      console.log(`Index '${indexName}' already exists`);

      // Check if mapping is correct
      const mapping = await client.indices.getMapping({ index: indexName });
      const embeddingType =
        mapping.body[indexName]?.mappings?.properties?.embedding?.type;

      if (embeddingType === 'knn_vector') {
        console.log('Index has correct knn_vector mapping');
        return sendResponse(event, context, 'SUCCESS', {
          Message: 'Index already exists with correct mapping',
          IndexName: indexName,
        });
      } else {
        console.log(`Index has wrong mapping type: ${embeddingType}, recreating...`);

        // Backup documents
        const allDocs = await client.search({
          index: indexName,
          body: { query: { match_all: {} }, size: 1000 },
        });

        const documents = allDocs.body.hits.hits.map((hit) => ({
          id: hit._id,
          source: hit._source,
        }));

        console.log(`Backing up ${documents.length} documents`);

        // Delete old index
        await client.indices.delete({ index: indexName });
        console.log('Old index deleted');

        // Create new index (will fall through to creation below)
        await createIndex(client, indexName);

        // Restore documents
        if (documents.length > 0) {
          const bulkBody = [];
          for (const doc of documents) {
            bulkBody.push({ index: { _index: indexName, _id: doc.id } });
            bulkBody.push(doc.source);
          }

          await client.bulk({ body: bulkBody, refresh: true });
          console.log(`Restored ${documents.length} documents`);
        }

        return sendResponse(event, context, 'SUCCESS', {
          Message: 'Index recreated with correct mapping',
          IndexName: indexName,
          DocumentsRestored: documents.length,
        });
      }
    }

    // Create new index
    await createIndex(client, indexName);

    return sendResponse(event, context, 'SUCCESS', {
      Message: 'Index created successfully',
      IndexName: indexName,
    });
  } catch (error) {
    console.error('Error managing OpenSearch index:', error);
    return sendResponse(event, context, 'FAILED', {
      Message: error.message,
    });
  }
};

async function createIndex(client, indexName) {
  console.log(`Creating index '${indexName}' with knn_vector mapping...`);

  await client.indices.create({
    index: indexName,
    body: {
      settings: {
        index: {
          number_of_shards: 1,
          number_of_replicas: 0,
          knn: true,
          'knn.algo_param.ef_search': 100,
        },
      },
      mappings: {
        properties: {
          documentId: { type: 'keyword' },
          chunkId: { type: 'keyword' },
          content: { type: 'text' },
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
            properties: {
              fileName: { type: 'keyword' },
              fileType: { type: 'keyword' },
              pageNumber: { type: 'integer' },
              uploadedAt: { type: 'date' },
              totalPages: { type: 'integer' },
            },
          },
          createdAt: { type: 'date' },
        },
      },
    },
  });

  console.log(`Index '${indexName}' created successfully`);
}

/**
 * Send CloudFormation custom resource response
 */
async function sendResponse(event, context, status, data) {
  const responseBody = JSON.stringify({
    Status: status,
    Reason: data.Message || 'See CloudWatch logs for details',
    PhysicalResourceId: context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  });

  console.log('Response:', responseBody);

  const https = require('https');
  const url = require('url');

  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(event.ResponseURL);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.path,
      method: 'PUT',
      headers: {
        'Content-Type': '',
        'Content-Length': responseBody.length,
      },
    };

    const request = https.request(options, (response) => {
      console.log('Status code:', response.statusCode);
      resolve();
    });

    request.on('error', (error) => {
      console.error('Error sending response:', error);
      reject(error);
    });

    request.write(responseBody);
    request.end();
  });
}
