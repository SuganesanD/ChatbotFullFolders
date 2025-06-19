const { ChromaClient } = require('chromadb');
const chroma = new ChromaClient({ path: 'http://127.0.0.1:8000' });

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI('AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk');

async function handleAggregatequestion(classifiedInput) {
  const collection = await chroma.getOrCreateCollection({ name: 'employee-embeddings2' });

  const BATCH_SIZE = 500;
  const allMatchedDocs = [];
  const allDocsFetched = [];
  let offset = 0;
  let batchCount = 0;

  const filters = classifiedInput.metadataFilters || {};
  const isCountOnly = classifiedInput.count ;

  while (true) {
    try {
      const response = await collection.get({
        include: ['metadatas', 'documents'],
        limit: BATCH_SIZE,
        offset
      });

      const metadatas = response?.metadatas || [];
      const documents = response?.documents || [];
      const fetchedCount = metadatas.length;

      console.log(`✅ Fetched batch ${++batchCount} from offset ${offset}: ${fetchedCount} records`);

      if (fetchedCount === 0) break;

      allDocsFetched.push(...documents);

      // Apply metadata filtering
      for (let i = 0; i < metadatas.length; i++) {
        const metadata = metadatas[i];
        let match = true;

        for (const [key, value] of Object.entries(filters)) {
          const metadataValue = metadata[key];
          if (!metadataValue || metadataValue.toString().toLowerCase() !== value.toString().toLowerCase()) {
            match = false;
            break;
          }
        }

        if (match) {
          allMatchedDocs.push(documents[i]);
        }
      }

      offset += BATCH_SIZE;
    } catch (err) {
      console.error(`❌ Error in batch ${batchCount + 1}: ${err.message}`);
      break;
    }
  }

  console.log(`\n📊 Summary Report:`);
  console.log(`📦 Total Records Fetched: ${allDocsFetched.length}`);
  console.log(`✅ Total Matched Documents: ${allMatchedDocs.length}`);

  if (isCountOnly) {
    const countPrompt = `There are ${allMatchedDocs.length} matched records for filters: ${JSON.stringify(classifiedInput.metadataFilters)}.`;
    console.log(countPrompt);
    
    const countResponse = await getAnswerGemini(countPrompt,classifiedInput.originalQuery);
    return countResponse;
  } else {
    const finalAnswer = await processChunksAndGetAnswer(allMatchedDocs, classifiedInput.originalQuery);
    return finalAnswer;
  }
}


function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function processChunksAndGetAnswer(allMatchedDocs, userQuery) {
  const CHUNK_SIZE = 50;
  const chunks = chunkArray(allMatchedDocs, CHUNK_SIZE);
  const allResponses = [];

  console.log(`📦 Total Documents: ${allMatchedDocs.length}`);
  console.log(`🔄 Total Chunks: ${chunks.length} (each with max ${CHUNK_SIZE} items)`);

  for (let i = 0; i < chunks.length; i++) {
    const currentChunk = chunks[i];

    // ✅ Format each chunk: Paragraph 1:\n<content>
    const finalContext = currentChunk
      .map((doc, index) => `Paragraph ${index + 1}:\n${doc}`)
      .join('\n\n');

    console.log(`🚀 Sending chunk ${i + 1} to Gemini...`);

    try {
      const response = await getAnswerGemini(finalContext, userQuery);
      allResponses.push(response.trim());

    } catch (err) {
      console.error(`❌ Error with chunk ${i + 1}:`, err.message);
      allResponses.push(`## 🔹 Response ${i + 1}:\n[Error fetching response]`);
    }
  }

  // ✅ Combine all chunked Gemini responses
  const finalAnswer = allResponses.join('\n\n---\n\n');
  return finalAnswer;
}


async function getAnswerGemini(batchparagraph,userQuery){
  const start = Date.now();
console.log("Start getAnswerGemini at:", new Date(start).toISOString());
  const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { maxOutputTokens: 1000 }
  });

  const prompt = `
  You are a precise and intelligent assistant.
  
  Your task is to answer the user question using ONLY the data provided in the context below.
  
  ---
  
  Context:
  ${batchparagraph}
  
  ---
  
  User Question:
  ${userQuery}
  
  ---
  
  Instructions:
  - Use only the context provided to answer.
  - If the user asks to **list employees**, ALWAYS include these fields:
    - **Employee ID**
    - **Name**
  - If the user asks for **extra fields** like salary, employee type, or division, include those too in the table — but only if requested.
  - Present the result as a clean **markdown table** with only the required columns.
  - DO NOT include summaries like "All employees listed are..." or restate the filter used in the query.
  - DO NOT repeat the question or generate generic explanations.
  - If the user asks for a **count** (e.g., "number of employees"), respond with a **natural sentence** like:
    - "There are 27 employees in the Sales department."
  - If the context is unstructured, extract relevant information clearly, avoiding redundancy.
  - The response must be **direct**, **human-like**, and **precisely aligned** with the user's intent.
  `;
  
  const result = await model.generateContent({
      contents: [{
          role: "user",
          parts: [{ text: prompt }]
      }]
  });

  const response = result.response.text();
 
  const end = Date.now();
console.log("End getAnswerGemini at:", new Date(end).toISOString());
console.log(`⏱ Execution time: ${end - start} ms`);
  return response;

}

// Example input
// const classifiedInput = {
//   category: 'Aggregate',
//   whereDocument: [],
//   metadataFilters: { gender: 'Male' }, // ← change this dynamically
//   metadataConditionalFields: {},
//   originalQuery: 'list employees who are male'
// };

// (async () => {
//   const results = await handleAggregateQuery(classifiedInput);
//   console.log(`\n🎯 Preview (first 3 documents):`);
//   console.log(JSON.stringify(results.slice(0, 3), null, 2));
// })();

module.exports={handleAggregatequestion};