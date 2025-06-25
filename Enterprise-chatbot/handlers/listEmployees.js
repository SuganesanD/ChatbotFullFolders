const chroma = require('../config/chromaClient');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../services/logger');
const { configDotenv } = require('dotenv');
configDotenv({path:'./couchdb_credentials.env'})


async function listEmployees(classified) {

logger.info(`🔀 Routing Funtion: listEmployees`);
 
  const {
    where,
    whereDocument = [],
    // fields = [],
    pagination = { limit: 100, offset: 0 },
    originalQuery = ""
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


 console.log("queryembedding:",queryEmbedding);
 console.log("📦 Final WHERE:", JSON.stringify(where, null, 2));
 console.log("whereDocument:" ,JSON.stringify(whereDocument,null,2));
 


  // 🔍 Perform vector query
  const queryResult = await collection.query({
    queryEmbeddings: queryEmbedding,
    where: where,
    whereDocument:{ "$contains": whereDocument.join(" ") },
    nResults: pagination.limit,
    offset: pagination.offset
  });


console.log(`documents:${queryResult.documents}`);

const finaldocument=queryResult.documents.toString().split(".,");
const metadata=queryResult.metadatas[0]
console.log("metadata:",metadata);

if(classified.category==="Statistical"){
  
}
  


if (classified.count===true){
 console.log(`length of the document is :${finaldocument.length}`);
 console.log("finaldocument:", finaldocument)
 return finaldocument.length
}
else{ return  queryResult.documents}
 
}


module.exports = listEmployees; 