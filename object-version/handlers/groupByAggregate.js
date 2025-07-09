const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../services/logger');
const { configDotenv } = require('dotenv');
configDotenv({ path: './couchdb_credentials.env' });

async function groupByAggregate(classified) {
  logger.info(`🚀 [GroupedAggregate] Starting grouped aggregation process`);

  const {
    where = {},
    whereDocument = [],
    pagination = {},
    groupBy,
    chartConfig = {},
    originalQuery = ''
  } = classified;

  logger.info(`📌 groupBy field: ${groupBy}`);
  logger.info(`📊 Chart Type: ${chartConfig.chartType}`);
  logger.info(`📦 Where Filter: ${JSON.stringify(where)}`);
  logger.info(`📘 WhereDocument Filter: ${JSON.stringify(whereDocument)}`);

  const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  // Optional embedding of query
  let queryEmbedding;
  if (originalQuery.trim()) {
    try {
      logger.info(`🧠 Generating embedding for originalQuery: "${originalQuery}"`);
      const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
      const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
      const embed = await embeddingModel.embedContent({
        content: { parts: [{ text: originalQuery }] }
      });
      const vector = embed.embedding?.values || embed.embedding;
      queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];
      logger.info(`✅ Embedding generated successfully`);
    } catch (error) {
      logger.error('❌ Error generating embedding:', error);
    }
  }

  // Pagination loop
  const limit = 100;
let offset = 0;
let hasMore = true;
const allMetadatas = [];

while (hasMore) {
  const result = await collection.get({
    limit,
    offset
  });

  const chunk = result?.metadatas || [];

  console.log(`📦 Retrieved ${chunk.length} items from offset ${offset}`);
  allMetadatas.push(...chunk);

  if (chunk.length < limit) {
    hasMore = false;
    console.log(`✅ All embeddings fetched. Total: ${allMetadatas.length}`);
  } else {
    offset += limit;
  }
}

  logger.info(`📊 Total embeddings fetched: ${allMetadatas.length}`);
  logger.info(`🔍 Grouping data by field: ${groupBy}`);

  // Group and count
  const groupCounts = {};
  for (const meta of allMetadatas) {
    const key = meta[groupBy] || 'Unknown';
    groupCounts[key] = (groupCounts[key] || 0) + 1;
  }

  const labels = Object.keys(groupCounts);
  const data = Object.values(groupCounts);

  logger.info(`📈 Grouping result:`);
  labels.forEach((label, i) => {
    logger.info(`   - ${label}: ${data[i]}`);
  });

  return {
    context: [
      {
        labels,
        data,
        chartType: chartConfig.chartType || 'bar',
        xField: chartConfig.xField || groupBy,
        yField: chartConfig.yField || 'count',
        totalCount: allMetadatas.length
      }
    ]
  };
}

module.exports = groupByAggregate;

