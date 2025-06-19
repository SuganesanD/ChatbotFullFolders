const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ChromaClient } = require('chromadb');


dotenv.config({ path: './couchdb_credentials.env' });

const chroma = new ChromaClient({ path: 'http://127.0.0.1:8000' });
const genAI = new GoogleGenerativeAI('AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk');

var finalParagraph=''
async function handleSpecific_Comparativequestion(Classified_json) {

    // if(Classified_json.filters.length==0){
    //     return
    // }
//  for(let i=0;i<Classified_json.filters.length;i++){
//     console.log("vector:",Classified_json.filters[i]);
//     vector =await embedQueryGemini(Classified_json.filters[i])
//     finalParagraph+=await fetchEmbeddingsGemini(vector);
//  }

vector =await embedQueryGemini(Classified_json.originalQuery)
    finalParagraph =await fetchEmbeddingsGemini(vector,Classified_json);


  try {
    userQuery=Classified_json.originalQuery
    console.log("userQuery:",userQuery);
    
    return await getAnswerGemini(finalParagraph,userQuery);
    
    
    
  } catch (err) {
    console.error('❌ Failed to send to genAnswerGemini:', err.message);
  }
}

async function embedQueryGemini(query) {
    const start = Date.now();
console.log("Start embedQueryGemini at:", new Date(start).toISOString());
    console.log("query:",query);
    
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    const embed = await embeddingModel.embedContent({
        content: { parts: [{ text: query }] }
    });
    const vector = embed.embedding?.values || embed.embedding;
    const end = Date.now();
console.log("End embedQueryGemini at:", new Date(end).toISOString());
console.log(`⏱ Execution time: ${end - start} ms`);
    return vector;
}

async function fetchEmbeddingsGemini(vector,classified_json){
const collection = await chroma.getCollection({ name: 'employee-embeddings1' });
const queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];

 // Destructure values from classified_json
 const { metadatafilters = {}, whereDocument = [] } = classified_json;

 // Construct dynamic query object
 const queryOptions = {
   queryEmbeddings: queryEmbedding,
   nResults: 10,
   include: ['documents', 'metadatas', 'distances'],
 };

 // Only add where if metadatafilters exist and are not empty
//  if (metadatafilters && Object.keys(metadatafilters).length > 0) {
//    queryOptions.where = metadatafilters;
//  }

 // Only add where_document if terms exist
 if (whereDocument && whereDocument.length > 0) {
   if (whereDocument.length === 1) {
     queryOptions.where_document = { $contains: whereDocument[0] };
   } else {
     queryOptions.where_document = {
       $or: whereDocument.map(term => ({ $contains: term }))
     };
   }
 }

 console.log("whereDocument:", whereDocument);
// console.log("queryOptions:", JSON.stringify(queryOptions, null, 2));
 

 // Run the query with dynamic filters
 const results = await collection.query(queryOptions);


if (!results.documents?.[0]?.length) {
    return res.status(404).json({ error: 'No matching documents found' });
}

// Optional: log top matches
console.log('Top matching documents:');
for (let i = 0; i < results.documents[0].length; i++) {
    console.log(`Rank #${i + 1}`);
    console.log(`ID: ${results.ids[0][i]}`);
    console.log(`Distance: ${results.distances[0][i]}`);
    console.log(`Metadata:`, results.metadatas[0][i]);
    console.log(`Text:`, results.documents[0][i]);
    console.log('--------------------------------');
}

// Step 2: Extract unique employeeIds from top 5
const topMetadatas = results.metadatas[0];
const uniqueEmployeeIds = [...new Set(topMetadatas.map(meta => meta.employeeId))];

console.log("Top 5 unique employeeIds:", uniqueEmployeeIds);

// Step 3: For each employeeId, get all chunks, sort, and combine
const paragraphs = [];
const allSortedChunks = [];

for (const empId of uniqueEmployeeIds) {
    const fullChunks = await collection.get({
        where: { employeeId: empId },
        include: ['documents', 'metadatas']
    });

    if (!fullChunks || !fullChunks.documents.length) continue;

    // Sort chunks by chunkIndex
    const sortedChunks = fullChunks.documents.map((doc, i) => ({
        id: fullChunks.ids[i],
        doc,
        metadata: fullChunks.metadatas[i]
    })).sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex);

    allSortedChunks.push(...sortedChunks);

    // Combine all chunks into one paragraph
    const paragraph = sortedChunks.map(item => item.doc).join(' ');
    paragraphs.push(paragraph);
}

console.log("paragraphs:",paragraphs);

// Step 4: Format all into a final context
const finalContext = paragraphs.map((p, i) => `Paragraph ${i + 1}:\n${p}`).join('\n\n');

console.log("Final Combined Context:\n", finalContext);
return finalContext;
}

async function getAnswerGemini(finalParagraph,userQuery){
    const start = Date.now();
console.log("Start getAnswerGemini at:", new Date(start).toISOString());
    const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        generationConfig: { maxOutputTokens: 1000 }
    });

    const prompt = `
You are a helpful and friendly assistant. Your job is to answer questions using the provided context  only. Do not alter the context.

Context:
${finalParagraph}

Question:
${userQuery}

Instructions:
-Only answer within the given context do not create response on your own.
- Speak in a natural, conversational tone, like a human would.
- Be warm and engaging, but don't restate the question or mention the context.
- If the answer involves categories or counts, use a clean, markdown-formatted table.
- Avoid extra explanations or generic phrases like "Based on the context" or "Here's the answer".
- Keep it to the point, but not robotic.
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


// Classified_json={
//     category: 'Specific',
//     metadataFilters: [],
//     whereDocument: ['oleta'],
//     originalQuery: 'what is the salary of oleta?'
//   }



module.exports = { handleSpecific_Comparativequestion };
