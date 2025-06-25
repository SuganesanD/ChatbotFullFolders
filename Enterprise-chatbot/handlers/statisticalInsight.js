// statisticalInsight.js
const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../services/logger');
require('dotenv').config({ path: './couchdb_credentials.env' });

async function statisticalInsight(classified) {
  logger.info(`🔀 Routing Function: tatisticalInsight`);

  const {
    where,
    whereDocument = [],
    pagination = { limit: 100, offset: 0 },
    originalQuery = "",
    statisticalFields = {},
    count = false
  } = classified;

  const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  // 👉 Embed originalQuery using Gemini (optional semantic boost)
  let queryEmbedding = undefined;
  if (originalQuery?.trim()) {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    const embed = await embeddingModel.embedContent({
      content: { parts: [{ text: originalQuery }] }
    });
    const vector = embed.embedding?.values || embed.embedding;
    queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];
  }

  console.log("📦 Final WHERE:", JSON.stringify(where, null, 2));

  const queryResult = await collection.query({
    queryEmbeddings: queryEmbedding,
    where: where,
    whereDocument: whereDocument.length > 0 ? { "$contains": whereDocument.join(" ") } : undefined,
    nResults: pagination.limit,
    offset: pagination.offset
  });

  const documents = queryResult.documents[0] || [];
  console.log(documents);
  
  const metadatas = queryResult.metadatas[0] || [];

  if (count === true) {
    return documents.length;
  }

  // ✅ Handle statistical operations
  if (Object.keys(statisticalFields).length > 0) {
    const statsResult = {};
    for (const [field, operation] of Object.entries(statisticalFields)) {
      const values = metadatas.map(m => parseFloat(m[field])).filter(v => !isNaN(v));
      if (values.length === 0) {
        statsResult[field] = null;
        continue;
      }

      switch (operation) {
        case 'sum':
          statsResult[field] = values.reduce((a, b) => a + b, 0);
          break;
        case 'average':
          statsResult[field] = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'max':
          statsResult[field] = Math.max(...values);
          break;
        case 'min':
          statsResult[field] = Math.min(...values);
          break;
        case 'count':
          statsResult[field] = values.length;
          break;
        default:
          statsResult[field] = 'Unsupported operation';
      }
    }
    return statsResult;
  }

  // ✅ Return metadata if no stats needed
  return metadatas;
}

module.exports = statisticalInsight;
