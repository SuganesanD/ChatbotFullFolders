const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../services/logger');
require('dotenv').config({ path: './couchdb_credentials.env' });

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function getEmbedding(text) {
  const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  const embed = await embeddingModel.embedContent({
    content: { parts: [{ text }] }
  });

  const vector = embed.embedding?.values || embed.embedding;
  return Array.isArray(vector[0]) ? vector[0] : vector;
}

async function fetchEmbeddingsAndQuery(classified) {
  return new Promise(async (resolve, reject)=> {
    try {
      logger.info(`🔀 Routing Function: fetchEmbeddingsAndQuery`);

  const {
    where = {},
    layer = true,
    pagination = { limit: 100, offset: 0 },
    originalQuery = ""
  } = classified;

  const collection = await chroma.getCollection({ name: 'two-object-collection' });

  // 🧠 Step 1: Get embedding for original query
  let queryEmbedding;
  if (originalQuery?.trim()) {
    queryEmbedding = await getEmbedding(originalQuery);
  }

  logger.info("📌 Final WHERE: " + JSON.stringify(where, null, 2));
  logger.info("📌 layer: " + layer);

  // 👉 If layer is false → run normal hybrid search

    const queryObject = {
      queryEmbeddings: [queryEmbedding],
      nResults: pagination.limit,
      offset: pagination.offset
    };

    if (Object.keys(where).length > 0) {
      queryObject.where = where;
    }

   

    const queryResult = await collection.query(queryObject);

    const documents = queryResult.documents?.flat() || [];
    const metadatas = queryResult.metadatas?.flat() || [];

    logger.info(`📄 Fetched ${documents.length} document(s)`);
    

    resolve(
      {
      data: metadatas,
      context: documents
    }
    ); 
  

  // // 👉 If layer is true → 2-phase strategy
  // // 🔍 STEP 1: Find main matching record (e.g., employee with name/email)
  // const step1Query = {
  //   queryEmbeddings: [queryEmbedding],
  //   nResults: 5,
  //   offset: 0
  // };

  // if (Object.keys(where).length > 0) {
  //   step1Query.where = where;
  // }

  // console.log("where in layer==true",JSON.stringify(where,null,2));
  



  // const step1 = await collection.query(step1Query);

  // const matchedDocs = step1.documents?.flat() || [];
  // const matchedMetas = step1.metadatas?.flat() || [];

  // console.log("fetched documents when layer==true:",matchedDocs);
  

  // logger.info(`🔁 Layer = true → Matched ${matchedDocs.length} base embeddings`);

  // // 🔗 STEP 2: Collect all related embeddings using employeeId
  // const empIds = matchedMetas.map(m => m.empid).filter(Boolean);
  // const uniqueEmpIds = [...new Set(empIds)];

  // if (uniqueEmpIds.length === 0) {
  //   logger.warn("⚠️ No empids found to expand results");
  //   return { data: [], context: [] };
  // }

  // const expandedResult = await collection.get({
  //   where: {
  //     empid: { "$in": uniqueEmpIds }
  //   }
  // });

  // const documents = expandedResult.documents?.flat() || [];
  // const metadatas = expandedResult.metadatas?.flat() || [];

  // logger.info(`📦 Fetched ${documents.length} expanded documents for empid(s): ${uniqueEmpIds.join(', ')}`);

  // resolve({
  //   data: metadatas,
  //   context: documents
  // }); 
    } catch (error) {
      console.log('Error while embedding queries on the chatbot',error);
      reject(error)
    }
  })
}

module.exports = { fetchEmbeddingsAndQuery };
