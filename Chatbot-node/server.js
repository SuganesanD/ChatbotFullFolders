const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ChromaClient } = require('chromadb');
const https = require('https');
const readline = require('readline');
const Nano = require('nano');
const axios = require('axios');
require('dotenv').config({ path: './couchdb_credentials.env' });

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

    console.log('combinedText', combinedData);
    const combinedText   = JSON.stringify(combinedData);


    //normalize the combine text

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { maxOutputTokens: 1000 }
    });

    normalizequery="Context is in the json format .Give me a meaningful paragraph of this json without leaving any of the key and value and give the general word for the all the key and do not miss any of the fields and the values "

    const prompt = `Context:\n${combinedText}\n\nQuestion: ${normalizequery}\nAnswer:`;
    console.log('prompt', prompt);

    const result = await model.generateContent({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });
    // console.log('result',result);

    const response = await result.response;
    const normalizedanswer = response.text();
    console.log("normalizedanswer:",normalizedanswer);

    

    const { data } = await axios.post('http://127.0.0.1:5005/embed', {
      input: [normalizedanswer]  // send it as an array
    });
    const vector = data.data[0];  // get the first embedding
    
    if (!vector) return;

    const collection = await chroma.getCollection({ name: 'employee-embeddings-similar' });
    await collection.upsert({
      ids: [empInfo._id],
      embeddings: [vector],
      metadatas: [{ employeeId: empInfo._id, text: combinedText }],
      documents: [normalizedanswer],
    });

    // Fetch embeddings count only after the upsert operation
    const embeddingsCount = await collection.peek({ limit: 1000 });

    if (embeddingsCount && embeddingsCount.ids) {
      console.log(`✅ Embedded and upserted employee ID: ${empInfo._id}`);
      console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
    } else {
      console.log(`✅ Embedded and upserted employee ID: ${empInfo._id}`);
      console.log(`🔢 No embeddings in Chroma yet.`);
    }

  } catch (err) {
    console.error(`❌ Embedding error for:`, err.message);
  }
};


const initializeEmbeddings = async ({ deleteExisting = false } = {}) => {
  try {
    console.log("🔄 Creating 'employee-embeddings' collection if not exists...");
    await chroma.createCollection({ name: 'employee-embeddings-similar',metadata: { dimension: 384 } }).catch(() => { });
    const collection = await chroma.getCollection({ name: 'employee-embeddings-similar'  });
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
  console.log(query);
  
  if (!query) return res.status(400).json({ error: 'Query is required' });

  try {
    // 1. Generate embedding with proper format
    const queryresponse = await axios.post('http://127.0.0.1:5005/embed', {
      input: [query]
    });
    
    const vector = queryresponse.data.data[0]; 
    if (!vector || !Array.isArray(vector)) {
      return res.status(500).json({ error: 'Failed to generate embedding' });
    }

    // 2. Query ChromaDB with proper parameters
    const collection = await chroma.getCollection({ name: 'employee-embeddings-similar' });
    // console.log('getcollection',collection);
    // console.log('vectorvector',vector);

    const results = await collection.query({
      queryEmbeddings: [vector],
      nResults: 100,
      include: ['documents', 'metadatas']
    });

    // 3. Process ChromaDB results
    if (!results.documents?.[0]?.length) {
      return res.status(404).json({ error: 'No matching documents found' });
    }

    // Parse the most relevant document
    const primaryDoc = results.documents[0];
    const metadata = results.metadatas[0][0];
    console.log('metadata', results.documents);

    
    // console.log('primaryDoc',primaryDoc);

    // 4. Construct context from best match
//     const context = `Employee Record:
// - ID: ${primaryDoc.empInfo.EmpID}
// - Name: ${primaryDoc.empInfo.FirstName} ${primaryDoc.empInfo.LastName}
// - Department: ${primaryDoc.empInfo.DepartmentType}
// - Status: ${primaryDoc.empInfo.EmployeeStatus}
// - Email: ${primaryDoc.empInfo.Email}
// - Leave Info: ${primaryDoc.leaveInfo?.map(l => `${l.type} on ${l.date}`).join(', ')}`;

    // 5. Generate answer with Gemini
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: { maxOutputTokens: 1000 }
    });

    const prompt = `Context:\n${primaryDoc}\n\nQuestion: ${query}\nAnswer:`;
    console.log('prompt', prompt);

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }]
    });
    // console.log('result',result);

    const response = await result.response;
    const answer = response.text();
    console.log("answer:",answer);
    

    // 6. Format response with proper document references
    res.status(200).json({
      query,
      answer,
      sources: [{
        doc_id: results.ids[0][0], // Chroma document ID
        employee_id: primaryDoc.EmpID,
        document_type: metadata.type
      }],
      conversation: [
        { role: 'user', content: query },
        { role: 'assistant', content: answer }
      ]
    });

  } catch (err) {
    console.error('Processing Error:', err);
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
      console.log('ddddd',doc);
      
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