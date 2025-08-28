const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const { MilvusClient, DataType } = require("@zilliz/milvus2-sdk-node");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // For direct API call
require("dotenv").config();

async function run() {
  // 1. Connect to Milvus
  const client = new MilvusClient({ address: "127.0.0.1:19530" });

  const COLLECTION_NAME = "gemini_paragraphs";

  // 2. Drop collection if exists
  try {
    await client.dropCollection({ collection_name: COLLECTION_NAME });
    console.log(`Dropped old collection '${COLLECTION_NAME}'`);
  } catch (err) {
    console.log("No !No old collection found, continuing...");
  }

  // 3. Create collection schema
  await client.createCollection({
    collection_name: COLLECTION_NAME,
    description: "Collection storing text and Gemini embeddings",
    fields: [
      { name: "id", description: "Primary Key", data_type: DataType.Int64, is_primary_key: true, autoID: false },
      { name: "text", description: "Original paragraph", data_type: DataType.VarChar, max_length: 2000 },
      { name: "embedding", description: "Gemini vector embedding", data_type: DataType.FloatVector, dim: 768 },
    ],
  });
  console.log(`Created collection '${COLLECTION_NAME}'`);

  // 4. Create index on embedding field
  await client.createIndex({
    collection_name: COLLECTION_NAME,
    field_name: "embedding",
    index_type: "IVF_FLAT",
    metric_type: "IP",
    params: { nlist: 128 },
  });
  console.log("Created index on 'embedding'");

  // 5. Load collection
  await client.loadCollectionSync({ collection_name: COLLECTION_NAME });
  console.log("Collection loaded into memory");

  // 6. Get embedding using Gemini via LangChain
  const embeddings = new GoogleGenerativeAIEmbeddings({
    model: "gemini-embedding-001",
    apiKey: process.env.GOOGLE_API_KEY,
    outputDimensionality: 768,
    taskType: "RETRIEVAL_DOCUMENT"
  });

  const paragraph = `...`; // Your paragraph (omitted for brevity)

  // Get and inspect embedding
  let vector = await embeddings.embedQuery(paragraph);
  console.log("Embedding dimension:", vector.length);
  console.log("First 5 elements:", vector.slice(0, 5));

  // Fix: Handle 3072-dimensional output
  if (vector.length === 3072) {
    console.log("Warning: Received 3072-dimensional vector; truncating to 768 dimensions");
    vector = vector.slice(0, 768); // Take first 768 elements (MRL allows truncation)
  }

  // Verify vector dimension
  if (!Array.isArray(vector) || vector.length !== 768) {
    throw new Error(`Vector dimension mismatch: expected 768, got ${vector.length}`);
  }

  // 7. Insert data into Milvus
  const insertRes = await client.insert({
    collection_name: COLLECTION_NAME,
    fields_data: [
      {
        id: 1,
        text: paragraph,
        embedding: vector,
      },
    ],
  });

  console.log("Inserted data:", insertRes);

  // 8. Flush data
  await client.flushSync({ collection_names: [COLLECTION_NAME] });
  console.log("Flushed collection");

  // Optional: Test direct Gemini API call for debugging
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: "embedding-001" });
  const directResponse = await model.embedContent({
    content: { parts: [{ text: paragraph }] },
    outputDimensionality: 768,
    taskType: "RETRIEVAL_DOCUMENT"
  });
  console.log("Direct Gemini API embedding dimension:", directResponse.embedding.values.length);
}

run().catch(console.error);