const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// Connect to local Milvus (docker host)
const milvusClient = new MilvusClient({
  address: 'localhost:19530',
});

module.exports = milvusClient;