import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ChromaClient } from 'chromadb';
import https from 'https';
import readline from 'readline';
import Nano from 'nano';
import dotenv from 'dotenv';

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
      username: 'd_couchdb',
      password: 'Welcome#2',
    }
  }
});
const db = nano.db.use(process.env.COUCHDB_DB);

// Express middleware
app.use(cors({ origin: 'http://localhost:4200' }));
app.use(bodyParser.json());

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
      const empID = empInfo.EmpID;
      const startDate = formatDate(empInfo.StartDate);
      const empType = empInfo.EmployeeType;
      const department = empInfo.DepartmentType;
      const division = empInfo.Division;
      const manager = empInfo.Manager;
      const email = empInfo.Email;
      const status = empInfo.EmployeeStatus;
      const payZone = empInfo.PayZone;
      const additionalID = empInfo.additionalinfo_id;

      const dob = formatDate(additionalInfo.DOB);
      const state = additionalInfo.State;
      const gender = additionalInfo.GenderCode;
      const locationCode = additionalInfo.LocationCode;
      const marital = additionalInfo.MaritalDesc;
      const performance = additionalInfo["Performance Score"];
      const rating = additionalInfo["Current Employee Rating"];
      const salary = additionalInfo["Salary"]; 
      const additionalInfoID = additionalInfo._id;

      const leaveDate = leaveInfo && leaveInfo.length > 0 ? formatDate(leaveInfo[0].date) : "N/A";
      const leaveEmpID = leaveInfo && leaveInfo.length > 0 ? leaveInfo[0].employee_id : "N/A";

      return `${fullName}, with ID ${empID}, began employment on ${startDate}, as a ${empType} employee in the ${department} department of the ${division} division, under the management of ${manager}. @ ` +
        `Their employee status is currently ${status}. Their email address is ${email} and their pay zone is ${payZone}.@ ` +
        `Additional information with ID ${additionalID} includes a date of birth of ${dob}, a ${state} residency, a ${gender} gender, and a Location Code of ${locationCode}.@ ` +
        `Their marital status is ${marital}, performance score is ${performance}, rating is ${rating}, and salary is $${salary}.@ ` +
        `Leave date is ${leaveDate}, associated with employee ID ${leaveEmpID}.@`;
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
      return `${monthName} ${parseInt(day)}, ${year}`;
    }

    const normalizedanswer = generateEmployeeSummary(combinedData);
    console.log("normalizedanswer:", normalizedanswer);

    // ✂️ Chunking Function
    const chunkText = (text) => {
      // Split by period and remove any empty or whitespace-only entries
      const chunks = text.split('@').map(s => s.trim()).filter(s => s.length > 0);
    
      return chunks;
    };

    const textChunks = chunkText(normalizedanswer);
    console.log("textchunks",textChunks);
    
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });

    const collection = await chroma.getCollection({ name: 'employee-embeddings' });

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

      console.log("chunkId",chunkId);
      
      
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
    }

  } catch (err) {
    console.error(`❌ Embedding error for employee ID ${empInfo._id}:`, err.message);
  }
};



const initializeEmbeddings = async ({ deleteExisting = false } = {}) => {
  try {
    console.log("🔄 Creating 'employee-embeddings' collection if not exists...");
    await chroma.createCollection({ name: 'employee-embeddings' }).catch(() => { });
    const collection = await chroma.getCollection({ name: 'employee-embeddings' });
    console.log("✅ Collection retrieved.");

    if (deleteExisting) {
      console.log("🧹 Deleting all existing embeddings...");
      const existingIds = await collection.peek({ limit: 1000 });
      if (existingIds && existingIds.ids?.length > 0) {
        console.log('existingIds.ids', existingIds.ids);
        let deleteCollection = await collection.delete({ ids: existingIds.ids });
        console.log("🗑️ Embeddings deleted.", deleteCollection);
      } else {
        console.log("ℹ️ No embeddings found to delete.");
      }
    }

    console.log("📥 Fetching all documents from CouchDB...");
    const allDocs = await db.list({ include_docs: true });
    let employeeDocs = [];
    let additionalInfoDocs = [];
    let leaveInfo = {}

    for (const row of allDocs.rows) {
      const doc = row.doc;
      if (doc._id.startsWith('employee_1_')) {
        employeeDocs.push(doc)
      }
      if (doc._id.startsWith('additionalinfo_1_')) {
        additionalInfoDocs.push(doc.data)
      }
      if (doc._id.startsWith('leave_')) {
        const parentId = doc.data['employee_id'];
        if (!leaveInfo.parentId) {
          leaveInfo[parentId] = []
        }
        leaveInfo[parentId].push(doc.data);
      }
    }
    console.log(`👥 Found ${Object.keys(employeeDocs).length} employee entries.`, employeeDocs);
    for (let i = 0; i < employeeDocs.length; i++) {
      let parentDocId = employeeDocs[i]['_id'].split('_1_')[1]
      await processAndEmbedEmployee(employeeDocs[i], additionalInfoDocs[i], leaveInfo[parentDocId]);
    }

    // console.log('\n🎉 All embeddings initialized successfully.');
  } catch (err) {
    console.error('❌ Error initializing embeddings:', err);
  }
};

// Handle query
app.post('/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });

const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
const classificationPrompt = `Is the following query asking for a broad list (yes or no)?\nQuery: "${query}"`;
const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: classificationPrompt }] }] });
const isBroadQuery = (result.response).text().toLowerCase().includes('yes');
console.log("isBroadQuery",isBroadQuery);

const nResults = isBroadQuery ? 1000 : 5;
console.log("nResults:",nResults);


  try {
    // 1. Generate query embedding using Gemini
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    const embed = await embeddingModel.embedContent({
      content: { parts: [{ text: query }] }
    });

    const vector = embed.embedding?.values || embed.embedding;

    console.log("vector:",vector);
    
    if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
      return res.status(500).json({ error: 'Invalid query embedding', vector });
    }

    
    console.log("✅ Final vector shape:", Array.isArray(vector), vector?.length);
    console.log(`✅ First ${nResults} values:`, vector?.slice(0, 5));

    // 2. Query ChromaDB for most relevant chunks
    const collection = await chroma.getCollection({ name: 'employee-embeddings' });
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
    
    // Step 4: Format all into a final context
    const finalContext = paragraphs.map((p, i) => `Paragraph ${i + 1}:\n${p}`).join('\n\n');
    
    console.log("Final Combined Context:\n", finalContext);
    
    // ➡️ Now pass `finalContext` to Gemini

    // 4. Generate answer from Gemini using the sorted chunk context
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { maxOutputTokens: 1000 }
    });

    const prompt = `Context:\n${finalContext}\n\nQuestion: ${query}Answer based upon the context NOTE: If the query is general then answer in general leaving the cont:`
;
    const result = await model.generateContent({
      contents: [{  
        role: "user",
        parts: [{ text: prompt }]
      }]
    });

    const response =result.response;
    const answer = response.text();
    console.log(answer);
    
    // 6. Send response
    res.status(200).json({
      query,
      answer,
      conversation: [
        { role: 'user', content: query },
        { role: 'assistant', content: answer }
      ]
    });

  } catch (err) {
    console.error('Query processing error:', err);
    res.status(500).json({
      error: 'Query processing failed',
      details: err.message
    });
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
    console.log('Error while mapping employee data for embedding',err);
  }
}

const fetchEmployeeDependentData = async (doc) => {
  try {
    let info = {
      "empInfo": doc,
      "additionalInfo" : {},
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
    console.log('Error occurs while fetching dependent data of employee',error);
  }
  
}

const fetchLeaveDependentData = async (doc) => {
  try {
    let info = {
      "empInfo": {},
      "additionalInfo" : {},
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
        console.log('additionalData',additionalData);
        
        if (additionalData?.rows.length > 0) {
          employeeResult['rows'].push(additionalData['rows'][0])
          employeeProfile = mapEmployeeData(employeeResult['rows'], info);
        }
      }).catch((err)=> {
        console.log('Error while fetching employee / lookup data');
      })
    }
    return employeeProfile;
  } catch (error) {
    console.log('Error occurs while fetching dependent data of leave of an employee',error);
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
      "additionalInfo" : {},
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
    console.log('Error occurs while fetching additional data of employee',error);
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
      console.log('Detected changes on:',doc);
      
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
    console.log('Listener error occurs while listening on couch',error);
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
      await initializeEmbeddings({ deleteExisting: true });
    } else if (input === 'no') {
      console.log('⏭️ Skipping embedding process as per user input.');
    } else {
      console.log('⚠️ Invalid input. Skipping embedding process by default.');
    }
    rl.close();
    await listenToChanges();
  });
});