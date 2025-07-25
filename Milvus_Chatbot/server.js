require('dotenv').config();
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai'); 
const { Milvus } = require('@langchain/community/vectorstores/milvus');

const run = async () => {
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: 'models/embedding-001',
  });

  const docs = [
    {
      pageContent: "Sugu is a senior developer in the AI team.",
      metadata: {
        name: "Sugu",
        dept: "AI",
        rating: 5,
        id: uuidv4(),
      },
    },
    {
      pageContent: "Abi works in the frontend dept and focuses on Angular.",
      metadata: {
        name: "Abi",
        dept: "Frontend",
        rating: 4,
        id: uuidv4(),
      },
    }
  ];

  // Connect and insert documents
  const collectionName = "employee_collection";

  const vectorStore = await Milvus.fromDocuments(docs, embeddings, {
    collectionName,
    clientConfig: {
      address: "localhost:19530",
    },
    textField: "content",
    primaryField: "id",
  });

  console.log("✅ Documents inserted into Milvus.");

  // Create an index on the embedding field
  const milvusClient = new MilvusClient({ address: "localhost:19530" });

  await milvusClient.createIndex({
    collection_name: collectionName,
    field_name: "content_vector", // LangChain sets this internally
    index_type: "IVF_FLAT",       // Choose a supported type
    metric_type: "COSINE",        // Cosine similarity
    params: { nlist: 128 },       // Required for IVF_FLAT
  });

  console.log("✅ Index created.");
};

run().catch(console.error);
