// getSpecificEmployeeInfo.js
const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../services/logger');
const { configDotenv } = require('dotenv');
configDotenv({ path: './couchdb_credentials.env' });

async function getSpecificEmployeeInfo(classified) {
  logger.info(`🔍 Routing Function: getSpecificEmployeeInfo`);

  const {
    where = {},
    whereDocument = [],
    pagination = { limit: 10, offset: 0 },
    originalQuery = ''
  } = classified;

  const contentToEmbed = whereDocument.join(' ').trim();
  if (!contentToEmbed) {
    logger.warn(`⚠️ No keywords in whereDocument. Cannot proceed.`);
    return [];
  }

  // ▶️ Embed whereDocument with Gemini
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });

  const embedResponse = await embeddingModel.embedContent({
    content: { parts: [{ text: contentToEmbed }] }
  });

  const vector = embedResponse.embedding?.values || embedResponse.embedding;
  const queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];

  // 🔍 Query Chroma
  const collection = await chroma.getCollection({ name: 'enterprise-collection' });
  const queryResult = await collection.query({
    queryEmbeddings: queryEmbedding,
    // where: where,
    whereDocument: { "$contains": contentToEmbed },
    nResults: pagination.limit,
    offset: pagination.offset
  });

  const topDocs = queryResult.documents || [];
  const topMetas = queryResult.metadatas || [];

  logger.info(`✅ Specific match found: ${topDocs.length} result(s)`);
  console.log("📄 Documents:", topDocs);
  console.log("🧾 Metadata:", topMetas);

  return topDocs;
}

module.exports = getSpecificEmployeeInfo;
