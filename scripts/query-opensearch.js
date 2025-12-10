const { Client } = require('@opensearch-project/opensearch');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');

async function queryAllDocuments() {
  const client = new Client({
    ...AwsSigv4Signer({
      region: 'us-east-1',
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: 'https://search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com',
  });

  try {
    const response = await client.search({
      index: 'docintel-vectors',
      body: {
        query: {
          match_all: {},
        },
        size: 100,
        _source: ['documentId', 'chunkId', 'metadata', 'content'],
      },
    });

    console.log('Total documents found:', response.body.hits.total.value);
    console.log('\n=== Documents ===\n');

    const documents = {};
    response.body.hits.hits.forEach((hit, index) => {
      const source = hit._source;
      const docId = source.documentId;

      if (!documents[docId]) {
        documents[docId] = {
          documentId: docId,
          chunks: [],
          metadata: source.metadata || {},
        };
      }

      documents[docId].chunks.push({
        chunkId: source.chunkId,
        content: source.content ? source.content.substring(0, 100) + '...' : 'N/A',
        page: source.metadata?.page || 'N/A',
      });
    });

    // Print summary
    Object.values(documents).forEach((doc) => {
      console.log(`Document ID: ${doc.documentId}`);
      console.log(`Source: ${doc.metadata.source || 'N/A'}`);
      console.log(`Chunks: ${doc.chunks.length}`);
      console.log(`Pages: ${[...new Set(doc.chunks.map((c) => c.page))].join(', ')}`);
      console.log('---');
    });

    // Print detailed chunks
    console.log('\n=== Detailed Chunks ===\n');
    response.body.hits.hits.forEach((hit, index) => {
      const source = hit._source;
      console.log(`${index + 1}. Chunk: ${source.chunkId}`);
      console.log(`   Document: ${source.documentId}`);
      console.log(`   Page: ${source.metadata?.page || 'N/A'}`);
      console.log(
        `   Content: ${source.content ? source.content.substring(0, 150) : 'N/A'}...`,
      );
      console.log('');
    });
  } catch (error) {
    console.error('Error querying OpenSearch:', error.message);
    if (error.meta?.body) {
      console.error('Error details:', JSON.stringify(error.meta.body, null, 2));
    }
  }
}

queryAllDocuments();
