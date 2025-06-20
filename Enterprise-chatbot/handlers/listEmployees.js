const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');


async function listEmployees(classified) {
  const {
    where,
    whereDocument = [],
    fields = [],
    pagination = { limit: 100, offset: 0 },
    originalQuery = ""
  } = classified;

  const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  // 👉 Embed originalQuery using Gemini (optional semantic boost)
  let queryEmbedding = undefined;
  if (originalQuery?.trim()) {
    const genAI = new GoogleGenerativeAI('AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk');
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    const embed = await embeddingModel.embedContent({
      content: { parts: [{ text: originalQuery }] }
    });
    const vector = embed.embedding?.values || embed.embedding;
    queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];
  }

 console.log("queryembedding:",queryEmbedding);
  console.log("📦 Final WHERE:", JSON.stringify(where, null, 2));
  

  // 🔍 Perform vector query
  const queryResult = await collection.query({
    queryEmbeddings: queryEmbedding,
    where:where,
    whereDocument: whereDocument.length > 0 ? { "$contains": whereDocument.join(" ") } : undefined,
    nResults: pagination.limit,
    offset: pagination.offset
  });

  const results = [];

  for (let i = 0; i < queryResult.documents.length; i++) {
    const doc = queryResult.documents[i];
    const meta = queryResult.metadatas[i];

    if (fields.length > 0) {
      const filtered = {};
      for (const field of fields) {
        filtered[field] = meta[field];
      }
      results.push(filtered);
    } else {
      results.push({ ...meta });
    }
  }

  return results;
}

module.exports = listEmployees;
