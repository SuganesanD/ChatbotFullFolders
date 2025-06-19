//Imports
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { ChromaClient } = require('chromadb');
const https = require('https');
const readline = require('readline');
const Nano = require('nano');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CohereClient } = require('cohere-ai');
const { classifyQuery } = require('./Classifier/queryclassifier');
const { handleGeneralquestion } = require('./AIAgent/HandleGeneralquestion');
const { handleAggregatequestion } = require('./AIAgent/HandleAggregatequestion');
const { handleConditionalquestion } = require('./AIAgent/HandleConditionalquestion');
const { handleSpecific_Comparativequestion } = require('./AIAgent/handleSpecific_Comparativequestion');

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
const   genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
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

//pre process fetched data
const processAndEmbedEmployee = async (empInfo, additionalInfo, leaveInfo) => {

    try {
        const combinedData = {
            empInfo: empInfo.data,
            additionalInfo: additionalInfo,
            leaveInfo: leaveInfo
        };

        function generateEmployeeSummary({ empInfo, additionalInfo, leaveInfo }) {
            const  fullName =`${empInfo.FirstName} ${empInfo.LastName}`; 
            const summaryData = {
              fullName :fullName,   
              employeeId: empInfo.EmpID,
              firstname: empInfo.FirstName,
              lastname: empInfo.LastName,
              empType: empInfo.EmployeeType,
              department: empInfo.DepartmentType,
              division: empInfo.Division,
              startDate: formatDate(empInfo.StartDate),
              manager: empInfo.Manager,
              email: empInfo.Email,
              status: empInfo.EmployeeStatus,
              payZone: empInfo.PayZone,
              salary: empInfo.Salary,
              additionalID: empInfo.additionalinfo_id,
          
              dob: formatDate(additionalInfo.DOB),
              gender: additionalInfo.GenderCode,
              marital: additionalInfo.MaritalDesc,
              state: additionalInfo.State,
              locationCode: additionalInfo.LocationCode,
              performance: additionalInfo.PerformanceScore,
              rating: additionalInfo.CurrentEmployeeRating,
          
              leaveDates: (leaveInfo.length > 0 ? leaveInfo.map(leave => formatDate(leave.date)) : ["N/A"]).join(', '),
              leaveEmpID: leaveInfo.length > 0 ? leaveInfo[0].employee_id : "N/A"
            };
          
            const profileText = `
          ${summaryData.fullName} (Employee ID: ${summaryData.employeeId}) is a ${summaryData.empType} employee who joined the organization on ${summaryData.startDate}. 
          They work in the ${summaryData.department} department under the ${summaryData.division} division, reporting to ${summaryData.manager}. 
          Their registered email is ${summaryData.email}. Currently, their employment status is marked as "${summaryData.status}", and they are in pay zone ${summaryData.payZone} with a monthly salary of ₹${summaryData.salary}. 
          Their additional identifier is ${summaryData.additionalID}. They were born on ${summaryData.dob}, identify as ${summaryData.gender}, are currently ${summaryData.marital}, and are located in ${summaryData.state} with a location code of ${summaryData.locationCode}. 
          Performance-wise, they are rated as "${summaryData.performance}" with a score of ${summaryData.rating}. 
          Recent leave dates include: ${summaryData.leaveDates}. The leave records are associated with employee ID ${summaryData.leaveEmpID}.
          `.trim();
            
          
            return {
              profileText,
              metadata: summaryData
            };
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
        // console.log("normalizedanswer:", normalizedanswer);

        // ✂️ Chunking Function
        const chunkText = (text) => {
            // Split by period and remove any empty or whitespace-only entries
            const chunks = text.split('$').map(s => s.trim()).filter(s => s.length > 0);

            return chunks;
        };

        // const textChunks = chunkText(normalizedanswer);
        // const textChunks=normalizedanswer;
        const { profileText, metadata } = normalizedanswer;
        console.log("profileText:", profileText);
        console.log("metadata:",metadata);
        
        if (select_modal === 'gemini') {
            // await embed_fetchedData_gemini(textChunks,empInfo)
            await embed_employee_profile_gemini(profileText,metadata)
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

//embedded fetched data
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

    const embeddingsCount = await collection.peek({ limit: 1000000 });

    if (embeddingsCount?.ids) {
        console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
    } else {
        console.log(`🔢 No embeddings found.`);
    };
    return;
}

async function embed_employee_profile_gemini(profileText, metadata) {
    try {
        const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
        const collection = await chroma.getCollection({ name: 'employee-embeddings1' });

        const embed = await embeddingModel.embedContent({ content: { parts: [{ text: profileText }] } });
        const vector = embed?.embedding?.values;

        if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
            console.error('❌ Invalid embedding vector:', vector);
            return;
        }

        const documentId = `${metadata.employeeId}_profile`; // ✅ Use employeeId from passed metadata

        await collection.upsert({
            ids: [documentId],
            embeddings: [vector],
            metadatas: metadata,   
            documents: [profileText],
        });

        console.log(`✅ Upserted employee profile for ID: ${metadata.employeeId}`);

        const embeddingsCount = await collection.peek({ limit: 1000000 });
        console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
    } catch (error) {
        console.error('❌ Error embedding employee profile:', error);
    }
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

    const embeddingsCount = await collection.peek({ limit: 1000000 });

    if (embeddingsCount?.ids) {
        console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
    } else {
        console.log(`🔢 No embeddings found.`);
    };
    return;
}

//InitializeEmbeddings
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
                await chroma.createCollection({ name: 'employee-embeddings1'}); 
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


//query endpoint
app.post('/query', async (req, res) => {
    const { query } = req.body;
    Classified_json=await classifyQuery(query); //query classifier
    console.log("classified_json:",Classified_json);
    answer=await aiAgent(Classified_json);
    console.log("answer:",answer);


try {

        res.status(200).json({
            query,
            answer,
            //   image: base64Image,
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

//AI Agent

async function aiAgent(classifiedJson) {
    const { category } = classifiedJson;
  
    switch (category) { 
      case "General":
        return await handleGeneralquestion(classifiedJson);
      case "Specific":
      case "Comparative" :
        return await handleSpecific_Comparativequestion(classifiedJson);
      case "Aggregate":
        return await handleAggregatequestion(classifiedJson);
      case "Analytical":
        return await handleConditionalquestion(classifiedJson);
    //   case "Descriptive":
    //     return await handleDescriptive(classifiedJson);
    //   case "Temporal":
    //     return await handleTemporal(classifiedJson);
    //   case "Behavioral":
    //     return await handleBehavioral(classifiedJson);
    //   case "Locational":
    //     return await handleLocational(classifiedJson);
    //   case "Organizational":
    //     return await handleOrganizational(classifiedJson);
    //   case "Leave-based":
    //     return await handleLeaveBased(classifiedJson);
    //   case "Status-based":
    //     return await handleStatusBased(classifiedJson);
    //   case "Identity":
    //     return await handleIdentity(classifiedJson);
    //   case "Multi-topic":
    //     return await handleMultiTopic(classifiedJson);
    //   case "Intent-based (Open-ended)":
    //     return await handleIntentBased(classifiedJson);
      default:
        throw new Error(`Unsupported category: ${category}`);
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

            if (doc._id.startsWith('employee_2_')) {
                userInfo = await fetchEmployeeDependentData(doc)
            } else if (doc._id.startsWith('leave_2_')) {
                userInfo = await fetchLeaveDependentData(doc)
            } else if (doc._id.startsWith('additionalinfo_2_')) {
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
