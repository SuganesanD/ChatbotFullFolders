import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChromaClient } from 'chromadb';
import https from 'https';
import readline from 'readline';
import Nano from 'nano';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from "@google/genai";
import { CohereClient } from 'cohere-ai';

const cohere = new CohereClient();

// Load environment variables
dotenv.config({ path: './couchdb_credentials.env' });

// Validate env variables
['COUCHDB_HOST', 'COUCHDB_USERNAME', 'COUCHDB_PASSWORD', 'COUCHDB_DB', 'GOOGLE_API_KEY'].forEach(key => {
    if (!process.env[key]) {
        console.error(`❌ Missing environment variable: ${key}`);
        process.exit(1);
    }
});

// Setup
const app = express();
const PORT = 3000;
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const chroma = new ChromaClient({ path: 'http://127.0.0.1:8000' });

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Ignore self-signed certs


const nano = Nano({
    url: `https://${process.env.COUCHDB_HOST}`,
    requestDefaults: {
        agent: new https.Agent({ rejectUnauthorized: false }),
        auth: {
            username: 'datauser',
            password: 'Welcome#1',
        }
    }
});
const db = nano.db.use(process.env.COUCHDB_DB);

// Express middleware
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(bodyParser.json());

let select_modal='gemini'
// Helper function to embed given employeeId
const processAndEmbedEmployee = async (empInfo, additionalInfo, leaveInfo) => {

    try {
        const combinedData = {
            empInfo: empInfo.data,
            additionalInfo: additionalInfo,
            leaveInfo: leaveInfo
        };

        function generateEmployeeSummary({ empInfo, additionalInfo, leaveInfo }) {
            const fullName = `Employee ${empInfo.FirstName} ${empInfo.LastName}`;
            const empID = empInfo.EmpID;  //
            const startDate = formatDate(empInfo.StartDate);
            const empType = empInfo.EmployeeType;
            const department = empInfo.DepartmentType;
            const division = empInfo.Division;
            const manager = empInfo.Manager; //
            const email = empInfo.Email;
            const status = empInfo.EmployeeStatus;
            const payZone = empInfo.PayZone;
            const salary = empInfo.Salary; //
            const additionalID = empInfo.additionalinfo_id;

            const dob = formatDate(additionalInfo.DOB);
            const state = additionalInfo.State;
            const gender = additionalInfo.GenderCode;
            const locationCode = additionalInfo.LocationCode;
            const marital = additionalInfo.MaritalDesc;
            const performance = additionalInfo.PerformanceScore; //
            const rating = additionalInfo.CurrentEmployeeRating; // 
            const additionalInfoID = additionalInfo._id;
            let leaveDate = [];
            let leaveEmpID = "";
            if (leaveInfo.length > 0) {
                for (let leave of leaveInfo) {
                    leaveDate.push(formatDate(leave.date));
                }
                leaveEmpID = leaveInfo[0].employee_id;
            } else {
                leaveDate = "N/A";
                leaveEmpID = "N/A";
            }
            console.log('leeavemp',leaveEmpID);
            
            
            // const leaveDate = leaveInfo && leaveInfo.length > 0 ? formatDate(leaveInfo.date) : "N/A"; //
                // const leaveEmpID = leaveInfo && leaveInfo.length > 0 ? leaveInfo.employee_id : "N/A"; //

            return `${fullName}, with employee ID ${empID}, began employment on ${startDate}, as a ${empType} employee in the ${department} department of the ${division} division, under the management of ${manager}. $ ` +
                `Their employee status is currently ${status}. Their email address is ${email} and their pay zone is ${payZone}.$ ` +
                `Additional information with ID ${additionalID} includes a date of birth of ${dob}, a ${state} residency, a ${gender} gender, and a Location Code of ${locationCode}.$ ` +
                `Their marital status is ${marital}, performance score is ${performance}, rating is ${rating}, and salary is ${salary} in rupees.$ ` +
                `Leave dates are ${leaveDate.join('')}$`;
        }

        function formatDate(dateString) {
            if (!dateString) return 'N/A';

            const monthMap = {
                '01': 'January', '02': 'February', '03': 'March', '04': 'April',
                '05': 'May', '06': 'June', '07': 'July', '08': 'August',
                '09': 'September', '10': 'October', '11': 'November', '12': 'December'
            };

            let day, month, year;
            if (dateString.includes('-')) {
                [day, month, year] = dateString.split('-');
            } else if (dateString.includes('/')) {
                [month, day, year] = dateString.split('/');
            }

            const monthName = monthMap[month.padStart(2, '0')] || month;
            return `${monthName},${parseInt(day)},${year} `;
        }

        const normalizedanswer = generateEmployeeSummary(combinedData);
        console.log("normalizedanswer:", normalizedanswer);

        // ✂️ Chunking Function
        const chunkText = (text) => {
            // Split by period and remove any empty or whitespace-only entries
            const chunks = text.split('$').map(s => s.trim()).filter(s => s.length > 0);

            return chunks;
        };

        const textChunks = chunkText(normalizedanswer);
        console.log("textchunks", textChunks);

        if (select_modal === 'gemini') {
            await embed_fetchedData_gemini(textChunks,empInfo)
        }
        else if (select_modal === 'cohere') {
            await embed_fetchedData_cohere(textChunks,empInfo)
        }
        else {
            console.log("Invalid select modal");
        };
        
    } catch (err) {
        console.error(`❌ Embedding error for employee ID ${empInfo._id}:`, err.message);
    }
};

async function embed_fetchedData_gemini(textChunks,empInfo) {

    
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });

    const collection = await chroma.getCollection({ name: 'employee-embeddings1' });

    for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        const chunkId = `${empInfo._id}_chunk_${i}`;

        const embed = await embeddingModel.embedContent({ content: { parts: [{ text: chunkText }] } });
        const vector = embed?.embedding?.values;
        console.log('Query vector length:', vector.length);
        if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
            console.error('❌ Invalid embedding vector during upsert:', vector);
            continue;
        }

        if (!chunkId || !chunkText || !empInfo._id) {
            console.error('❌ Invalid metadata or chunk data');
            continue;
        }

        console.log("chunkId", chunkId);


        await collection.upsert({
            ids: [chunkId],
            embeddings: [vector],
            metadatas: [{
                employeeId: empInfo._id,
                chunkIndex: i,          
                text: chunkText
            }],
            documents: [chunkText],
        });

        console.log(`✅ Upserted chunk ${i} for employee ID: ${empInfo._id}`);
        
    };

    const embeddingsCount = await collection.peek({ limit: 10000 });

    if (embeddingsCount?.ids) {
        console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
    } else {
        console.log(`🔢 No embeddings found.`);
    };
    return;
}

async function embed_fetchedData_cohere(textChunks,empInfo) {
    const collection = await chroma.getCollection({ name: 'employee-embeddings1' });

    for (let i = 0; i < textChunks.length; i++) {
        const chunkText = textChunks[i];
        const chunkId = `${empInfo._id}_chunk_${i}`;

        const embed = await cohere.embed({
            texts: [chunkText],
            model: "embed-english-v3.0", // Or "embed-multilingual-v3.0"
            input_type: "search_document"
        });
        const vector = embed.embeddings[0];

        console.log('Query vector length:', vector.length);
        if (
            !vector ||
            !Array.isArray(vector) ||
            (vector.length !== 768 && vector.length !== 1024) ||
            typeof vector[0] !== 'number'
          ) {
            console.error('❌ Invalid embedding vector during upsert:', vector);
            continue;
          }

        if (!chunkId || !chunkText || !empInfo._id) {
            console.error('❌ Invalid metadata or chunk data');
            continue;
        }

        console.log("chunkId", chunkId);


        await collection.upsert({
            ids: [chunkId],
            embeddings: [vector],
            metadatas: [{
                employeeId: empInfo._id,
                chunkIndex: i,
                text: chunkText
            }],
            documents: [chunkText],
        });

        console.log(`✅ Upserted chunk ${i} for employee ID: ${empInfo._id}`);
    }

    const embeddingsCount = await collection.peek({ limit: 1000 });

    if (embeddingsCount?.ids) {
        console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
    } else {
        console.log(`🔢 No embeddings found.`);
    };
    return;
}



const initializeEmbeddings = async ({ deleteExisting = false } = {}) => {
    try {
        if (deleteExisting) {
            console.log("📦 Checking if collection exists...");
        
            const collections = await chroma.listCollections();
            const collectionExists = collections.includes('employee-embeddings1');
        
            if (collectionExists) {
                console.log("🧹 Deleting existing collection to reset dimension...");
                await chroma.deleteCollection({ name: 'employee-embeddings1' });
                console.log("🧨 Collection deleted.");
            } else {
                console.log("✅ Collection does not exist. Skipping deletion.");
            }
        
            console.log("🔄 Recreating collection...");
            await chroma.createCollection({ name: 'employee-embeddings1' }); 
            console.log("✅ Collection created.");
        }
        
console.log("✅ Collection ready.");

        console.log("📥 Fetching all documents from CouchDB...");
        const allDocs = await db.list({ include_docs: true });
        let employeeDocs = [];
        let additionalInfoDocs = [];
        let leaveInfo = {}

        for (const row of allDocs.rows) {
            const doc = row.doc;
            if (doc._id.startsWith('employee_2_')) {
                employeeDocs.push(doc)
            }
            if (doc._id.startsWith('additionalinfo_2_')) {
                additionalInfoDocs.push(doc.data)
            }
            if (doc._id.startsWith('leave_2_')) {
                const parentId = doc.data['employee_id'];
            
                if (!leaveInfo[parentId]) {
                    leaveInfo[parentId] = [];
                }
            
                leaveInfo[parentId].push(doc.data);
            }
            
        }
        
        console.log(`👥 Found ${Object.keys(employeeDocs).length} employee entries.`);
        const start = Date.now();
        console.log("Start embedding fetched data starting at:", new Date(start).toISOString());
        for (let i = 0; i < employeeDocs.length; i++) {
            let parentDocId = employeeDocs[i]['_id'].split('_2_')[1]
            await processAndEmbedEmployee(employeeDocs[i], additionalInfoDocs[i], leaveInfo[parentDocId]);  
        }
        const end = Date.now();
            console.log("End embedding fetched data starting at:", new Date(end).toISOString());
            console.log(`⏱ Execution time: ${end - start} ms`);

        // console.log('\n🎉 All embeddings initialized successfully.');
    } catch (err) {
        console.error('❌ Error initializing embeddings:', err);
    }
};

async function classifyPromptCohere(query) {
    const start = Date.now();
console.log("Start classifyPromptCohere at:", new Date(start).toISOString());
    const classificationPrompt = `Is the following query asking for a broad list (yes or no)? Query: "${query}"`;

  
    const response = await cohere.generate({
      model: 'command-r-plus',
      prompt: classificationPrompt,
      max_tokens: 10,
      temperature: 0.3,
    });
  
    console.log("Full Cohere Response:", JSON.stringify(response, null, 2)); // log raw
  
    const generations = response?.generations || response?.body?.generations;
//   if (!generations || !Array.isArray(generations) || !generations[0]?.text) {
//     console.error("❌ No valid text found in generations. Falling back.");
//     return 5;
//   }
  
    const outputText = generations[0].text.trim().toLowerCase();
    console.log("outputText",outputText);
    
    const isBroadQuery = outputText.includes('yes');
    const nResults = isBroadQuery ? 5 : 5;
  
    console.log("nResults:", nResults);
    const end = Date.now();
    console.log("End classifyPromptCohere at:", new Date(end).toISOString());
    console.log(`⏱ Execution time: ${end - start} ms`);
    return nResults;
}

async function classifyPromptGemini(query) {
    const start = Date.now();
    console.log("Start classifyPromptGemini at:", new Date(start).toISOString());
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const classificationPrompt = `Is the following query asking for a broad list (yes or no)? Query: "${query}"`;
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: classificationPrompt }] }] });
    const isBroadQuery = (result.response).text().toLowerCase().includes('yes');
    console.log("isBroadQuery", isBroadQuery);

    const nResults = isBroadQuery ? 5 : 5;
    console.log("nResults:", nResults);
    const end = Date.now();
    console.log("End classifyPromptGemini at:", new Date(end).toISOString());
    console.log(`⏱ Execution time: ${end - start} ms`);
    return nResults;
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

async function embedQueryCohere(query) {
    const start = Date.now();
console.log("Start embedQueryCohere at:", new Date(start).toISOString());
    const embed = await cohere.embed({
        texts: [query],
        model: "embed-english-v3.0",
        input_type: "search_query"
      });
      const vector = embed.embeddings[0];
      

    console.log("vector:",vector);
    const end = Date.now();
console.log("End embedQueryCohere at:", new Date(end).toISOString());
console.log(`⏱ Execution time: ${end - start} ms`);
    return vector;
}


// Handle query
app.post('/query', async (req, res) => {
    const { query } = req.body;
    let nResults = 0;
    let vector;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    if (select_modal === 'gemini') {
        nResults = await classifyPromptGemini(query)
    }
    else if (select_modal === 'cohere') {
       nResults = await classifyPromptCohere(query);
    }
    else {
        console.log("Invalid modal select");
    }

    try {
        // 1. Generate query embedding using Gemini
        if (select_modal === 'gemini') {
            vector = await embedQueryGemini(query);
        }
        else if (select_modal === 'cohere') {
            vector =await embedQueryCohere(query);
        }

        console.log("vector:", vector);

        


        console.log("✅ Final vector shape:", Array.isArray(vector), vector?.length);
        console.log(`✅ First ${nResults} values:`, vector?.slice(0, 5));

        // 2. Query ChromaDB for most relevant chunks
        const collection = await chroma.getCollection({ name: 'employee-embeddings1' });
        const queryEmbedding = Array.isArray(vector[0]) ? vector : [vector];

        // Step 1: Get top 5 matches
        const results = await collection.query({
            queryEmbeddings: queryEmbedding,
            nResults: nResults,
            include: ['documents', 'metadatas', 'distances']
        });

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

        // ➡️ Now pass `finalContext` to Modal

        async function getAnswerCohere(finalContext) {
            const start = Date.now();
console.log("Start getAnswerCohere at:", new Date(start).toISOString());

            const prompt = `
You are a helpful and friendly assistant. Your job is to answer questions using the provided context only. Do not alter the context.

Context:
${finalContext}

Question:
${query}

Instructions:
- Speak in a natural, conversational tone, like a human would.
- Be warm and engaging, but don't restate the question or mention the context.
- If the answer involves categories or counts, use a clean, markdown-formatted table.
- Avoid extra explanations or generic phrases like "Based on the context" or "Here's the answer".
- Keep it to the point, but not robotic.
- If there is no correct answer available respond to the question in general.
`;

            const response = await cohere.generate({
                model: 'command-r-plus', // Use 'command-r' if 'plus' is not available to you
                prompt: prompt,
                max_tokens: 1000,
                temperature: 0.5,
                stop_sequences: [],
            });

            const answer = response.generations[0].text.trim();
            console.log(answer);

            res.status(200).json({
                query,
                answer,
                conversation: [
                    { role: 'user', content: query },
                    { role: 'assistant', content: answer }
                ]
            });
            const end = Date.now();
console.log("End getAnswerCohere at:", new Date(end).toISOString());
console.log(`⏱ Execution time: ${end - start} ms`);
            return;
        }

        async function getAnswerGemini(finalContext){
            const start = Date.now();
console.log("Start getAnswerGemini at:", new Date(start).toISOString());
            const model = genAI.getGenerativeModel({
                model: 'gemini-1.5-flash',
                generationConfig: { maxOutputTokens: 1000 }
            });
    
            const prompt = `
        You are a helpful and friendly assistant. Your job is to answer questions using the provided context  only. Do not alter the context.
        
        Context:
        ${finalContext}
        
        Question:
        ${query}
        
        Instructions:
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
    
            const responsemodal1 = result.response;
            const answer = responsemodal1.text();
            console.log(answer);
    
            // 6. Send response
            res.status(200).json({
                query,
                answer,
                //   image: base64Image,
                conversation: [
                    { role: 'user', content: query },
                    { role: 'assistant', content: answer }
                ]
            });
            const end = Date.now();
console.log("End getAnswerGemini at:", new Date(end).toISOString());
console.log(`⏱ Execution time: ${end - start} ms`);
            return;
    
        }

        if (select_modal === "gemini") {
            getAnswerGemini(finalContext)
            console.log("selectedModal:",select_modal);
            
        }
        else if (select_modal == 'cohere') {
            getAnswerCohere(finalContext)
            console.log("selectedModal:",select_modal);
        }
        else {
            console.log("Invalid select modal");
        }

        // 4. Generate answer from Gemini using the sorted chunk context
       
    } catch (err) {
        console.error('Query processing error:', err);
        res.status(500).json({
            error: 'Query processing failed',
            details: err.message
        });
    }
});

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

app.post('/generate-image', async (req, res) => {
    try {
        const { imagePrompt } = req.body;
        console.log("imagePrompt", imagePrompt);

        if (!imagePrompt) {
            return res.status(400).json({ error: 'Prompt for image is required to generate an image.' });
        }

        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            generationConfig: { maxOutputTokens: 1000 }
        });

        const imagePromptBuilder = `
      You are a precise and structured prompt generator for a data visualization model.
      
      Your task:
      Based on the input summary, generate a single natural language prompt (100–200 characters) to create an accurate and labeled chart image.
      
      Strict instructions:
      - Clearly specify the chart type (e.g., pie chart, bar chart, line chart, donut chart).
      - Include a descriptive chart title.
      - For axis-based charts, explicitly define:
        - X-axis label and unit
        - Y-axis label and unit
      - List all categories with their exact values and units .
      - Use only plain, structured, descriptive natural language.
      - Do NOT use special characters, code, formatting, or line breaks.
      - Make sure no value, label, unit, or title is missing.
      
      Input:
      ${imagePrompt}
      
      Output:
      `;



        const imagePromptResult = await model.generateContent({
            contents: [{
                role: "user",
                parts: [{ text: imagePromptBuilder }]
            }]
        });

        const modal1Response = imagePromptResult.response;
        const modal1Answer = modal1Response.text();
        console.log("modal1 output:", modal1Answer);

        const result = await ai.models.generateContent({
            model: "gemini-2.0-flash-preview-image-generation",
            contents: modal1Answer,
            config: {
                responseModalities: [Modality.TEXT, Modality.IMAGE],
            },
        });

        let base64Image = '';
        let description = '';

        const parts = result.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
            if (part.text) {
                description += part.text;
                console.log(description);

            } else if (part.inlineData) {
                const buffer = Buffer.from(part.inlineData.data, "base64");
                base64Image = `data:image/png;base64,${buffer.toString('base64')}`;
            }
        }

        if (!base64Image) {
            return res.status(500).json({ error: 'Image generation failed or no image returned.' });
        }

        res.status(200).json({
            image: base64Image,
            description
        });

    } catch (error) {
        console.error("Image generation error:", error?.message || error);
        res.status(500).json({ error: 'Image generation failed', details: error?.message });
    }
});


const mapEmployeeData = (empInfo, info) => {
    try {
        for (let empDocs of empInfo) {
            if (empDocs.doc.data) {
                if (empDocs.id.startsWith('additionalinfo_1_')) {
                    info['additionalInfo'] = empDocs.doc.data
                } else if (empDocs.id.startsWith('leave_1_')) {
                    info['leaveInfo'].push(empDocs.doc.data)
                } else if (empDocs.id.startsWith('employee_1_')) {
                    info['empInfo'] = empDocs.doc
                }
            }
        }
        return info;
    } catch (error) {
        console.log('Error while mapping employee data for embedding', err);
    }
}

const fetchEmployeeDependentData = async (doc) => {
    try {
        let info = {
            "empInfo": doc,
            "additionalInfo": {},
            "leaveInfo": []
        }
        let employeeProfile = '';
        if (doc.data) {
            let empId = doc._id.split('_1_')[1]
            let query = {
                'q': `(type: leave AND employee_id : ${empId}) OR (_id: additionalinfo_1_${doc.data.additionalinfo_id})`,
                include_docs: true
            }
            await db.search('chatbot', 'chatbot', query).then((employeeResult) => {
                if (employeeResult?.rows.length > 0) {
                    employeeProfile = mapEmployeeData(employeeResult.rows, info);
                }
            })
        }
        return employeeProfile
    } catch (error) {
        console.log('Error occurs while fetching dependent data of employee', error);
    }

}

const fetchLeaveDependentData = async (doc) => {
    try {
        let info = {
            "empInfo": {},
            "additionalInfo": {},
            "leaveInfo": []
        }
        let employeeProfile = '';
        if (doc.data) {
            let query = {
                'q': `(_id: employee_1_${doc.data.employee_id}) OR (type: leave AND employee_id: ${doc.data.employee_id})`,
                include_docs: true
            }
            await db.search('chatbot', 'chatbot', query).then(async (employeeResult) => {

                let employeeDoc = employeeResult['rows'].filter((data) => data.id.startsWith('employee_1_'));
                let additionalInfoId = employeeDoc[0]['doc']['data']['additionalinfo_id'];
                let infoQuery = {
                    'q': `_id: (additionalinfo_1_${additionalInfoId})`,
                    include_docs: true
                }
                let additionalData = await db.search('chatbot', 'chatbot', infoQuery);
                console.log('additionalData', additionalData);

                if (additionalData?.rows.length > 0) {
                    employeeResult['rows'].push(additionalData['rows'][0])
                    employeeProfile = mapEmployeeData(employeeResult['rows'], info);
                }
            }).catch((err) => {
                console.log('Error while fetching employee / lookup data');
            })
        }
        return employeeProfile;
    } catch (error) {
        console.log('Error occurs while fetching dependent data of leave of an employee', error);
    }
}

const fetchAdditionalDependentData = async (doc) => {
    try {
        let infoId = doc._id.split('_1_')[1];

        let employeeQuery = {
            'q': `type: employee AND additionalinfo_id: ${infoId}`,
            include_docs: true
        }
        let employeeProfile = '';
        let info = {
            "empInfo": {},
            "additionalInfo": {},
            "leaveInfo": []
        }
        await db.search('chatbot', 'chatbot', employeeQuery).then(async (employeeResult) => {
            let empId = employeeResult['rows'][0]['doc']['_id'].split('_1_')[1]
            let leaveQuery = {
                'q': `type: leave AND employee_id: ${empId}`,
                include_docs: true
            }
            let leaveResult = await db.search('chatbot', 'chatbot', leaveQuery);

            if (leaveResult?.rows.length > 0) {
                leaveResult['rows'].push(employeeResult['rows'][0])
                employeeProfile = mapEmployeeData(leaveResult['rows'], info);
            }
        })
        return employeeProfile;
    } catch (error) {
        console.log('Error occurs while fetching additional data of employee', error);
    }
}

// Listen to CouchDB changes
const listenToChanges = async () => {
    try {
        console.log('👂 Listening to CouchDB changes...');

        const feed = db.changesReader.start({
            since: 'now',
            live: true,
            continuous: true,
            includeDocs: true,
        });

        feed.on('change', async (change) => {
            const doc = change.doc;
            if (!doc || !doc._id) return;

            let userInfo = '';
            console.log('Detected changes on:', doc);

            if (doc._id.startsWith('employee_1_')) {
                userInfo = await fetchEmployeeDependentData(doc)
            } else if (doc._id.startsWith('leave_1_')) {
                userInfo = await fetchLeaveDependentData(doc)
            } else if (doc._id.startsWith('additionalinfo_1_')) {
                userInfo = await fetchAdditionalDependentData(doc);
            }

            console.log(`🔁 Change detected. Re-embedding for employee ID: ${JSON.stringify((userInfo))}`);
            await processAndEmbedEmployee(userInfo.empInfo, userInfo.additionalInfo, userInfo.leaveInfo);
        });

        feed.on('error', (err) => {
            console.error('❌ Change feed error:', err);
        });
    } catch (error) {
        console.log('Listener error occurs while listening on couch', error);
    }
};

// App init
app.listen(PORT, async () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('❓ Do you want to delete existing embeddings? (yes/no): ', async (answer) => {
    const input = answer.trim().toLowerCase();

    if (input === 'yes') {
      rl.question('❓ Select modal for your application? (gemini/cohere): ', async (select) => {
        const model = select.trim().toLowerCase();

        if (model === 'gemini' || model === 'cohere') {
          select_modal = model;
          await initializeEmbeddings({ deleteExisting: true });
        } else {
          console.log("⚠️ Invalid Modal Selection");
        }

        rl.close();
        await listenToChanges();
      });

    } else if (input === 'no') {
      console.log('⏭️ Skipping embedding process as per user input.');
      rl.close();
      await listenToChanges();
    } else {
      console.log('⚠️ Invalid input. Skipping embedding process by default.');
      rl.close();
      await listenToChanges();
    }
  });
});