require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Milvus } = require('@langchain/community/vectorstores/milvus');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');  // ✅ Corrected
const { v4: uuidv4 } = require('uuid');

const run = async () => {
  // 1. Set up Google Gemini Embeddings
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: 'text-embedding-004',
  });

  // 2. Prepare sample documents
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
      pageContent: "Abi works in the frontend department and focuses on Angular.",
      metadata: {
        name: "Abi",
        dept: "Frontend",
        rating: 4,
        id: uuidv4(),
      },
    }
  ];

  // 3. Connect to Milvus
  const vectorStore = await Milvus.fromDocuments(docs, embeddings, {
    collectionName: "employee_profiles",
    clientConfig: {
      address: "localhost:19530",
    },
    textField: "content",
    primaryField: "id",
  });

  console.log("✅ Documents inserted into Milvus.");
};

run().catch(console.error);
