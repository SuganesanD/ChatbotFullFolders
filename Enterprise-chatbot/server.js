// server.js

const express = require('express');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const chatbotRoutes = require('./routes/chatbot.routes')
const logger = require('./services/logger');
const Nano = require('nano');
const cors = require('cors');
const https = require('https');
const readline = require('readline');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CohereClient } = require('cohere-ai');

const chroma = new ChromaClient({ path: 'http://127.0.0.1:8000' });

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const cohere = new CohereClient();

// Load .env config
dotenv.config({ path: './couchdb_credentials.env' });

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: 'http://localhost:4200' }))

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

// === Middlewares ===
app.use(express.json());


let select_modal = 'gemini'

// === Routes ===
app.use('/api/chatbot', chatbotRoutes);

// === Health Check ===
app.get('/', (req, res) => {
  res.send('🤖 Enterprise Chatbot API is running...');
});

// === Error Handling Middleware ===
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong in the backend.' });
});

// // === Start Server ===
// app.listen(PORT, () => {
//   logger.info(`🚀 Server started at http://localhost:${PORT}`);
// });


var Template = ''

//pre process fetched data
const processAndEmbedEmployee = async (empInfo, additionalInfo, leaveInfo) => {
  try {
    const combinedData = {
      empInfo: empInfo.data,
      additionalInfo: additionalInfo,
      leaveInfo: leaveInfo
    };


    async function geminiDynamicTemplate(summaryData) {
      console.log("Modal-", select_modal);

      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const allFields = Object.keys(summaryData);
      const prompt = `
You are a Node.js assistant.

Your job is to generate a professional and meaningful paragraph summarizing an employee profile using the provided object named \`summaryData\`.

✅ Use the following format:
- The output must be a valid **JavaScript template literal**, wrapped in **a single pair of backticks** — that is: \` at the beginning and \` at the end.
- Do NOT use triple backticks (e.g., \`\`\`)
- Each dynamic field must use the full variable path like \${summaryData.fullName}, not just \${fullName}.
- Include **all** of the following fields. Do not skip or rename any:

${allFields.map(field => `- summaryData.${field}`).join('\n')}

🚫 Do NOT:
- Do NOT use example values
- Do NOT invent or omit fields
- Do NOT include any explanation, markdown, or code fencing (like \`\`\`js)
- Do NOT start the paragraph with phrases like "This profile summarizes" — start directly with the employee’s name or key information.

✅ DO:
- Return only a single-line or multi-line JavaScript template literal
- Wrap the whole thing with exactly one \` at the start and one \` at the end

Here is the object definition:
const summaryData = ${JSON.stringify(summaryData, null, 2)}

Now return ONLY the template literal wrapped in **one backtick pair**. No comments. No markdown. No code block fences.`;

      const result = await model.generateContent(prompt);
      const response = result.response;
      return response.text().trim();
    }


    async function cohereDynamicTemplate(summaryData) {
      console.log("Modal-", select_modal);
      const allFields = Object.keys(summaryData);

      const start = Date.now();
      console.log("Start getAnswerCohere at:", new Date(start).toISOString());

      const prompt = `
You are a JavaScript assistant.

Your job is to generate a **JavaScript template literal** that summarizes all data in the provided object \`summaryData\`.

⚠️ This is important:
- You MUST include **every single field** from the list below — do not skip, omit, or summarize.
- Use only JavaScript **template literal syntax** (with backticks and \${summaryData.field})
- The paragraph should read naturally but still **mention every field**.

📋 Fields to include:
${allFields.map(field => `- summaryData.${field}`).join('\n')}

📌 Format:
\`\${summaryData.fullName}, employee ID \${summaryData.employeeId}, is a \${summaryData.empType} employee...\`

🚫 Do NOT:
- Do NOT return example values
- Do NOT skip any fields, even if they look similar or optional
- Do NOT return plain sentences or real data

Return ONLY the paragraph as a JavaScript template literal (surrounded with one pair of backticks). No markdown, no explanation, no code fences.

Here is the object:
const summaryData = ${JSON.stringify(summaryData, null, 2)}
`;


      const response = await cohere.generate({
        model: 'command-r-plus',
        prompt: prompt,
        max_tokens: 1000,
        temperature: 0.7,
      });

      const answer = response.generations[0].text.trim();
      return answer;
    }


    function askUser(question) {
      const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      return new Promise(resolve => rl.question(question, ans => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      }));
    }

    async function loopUntilApproved(summaryData) {
      while (true) {
        let Template = '';

        if (select_modal === 'gemini') {
          Template = await geminiDynamicTemplate(summaryData);
        } else if (select_modal === 'cohere') {
          Template = await cohereDynamicTemplate(summaryData);
        } else {
          console.error('❌ Unknown modal:', select_modal);
          return; // Exit the loop if modal is unsupported
        }

        let cleanedTemplate = Template
          .replace(/^```[a-z]*\n?/i, '')
          .replace(/```$/, '')
          .trim();

        if (cleanedTemplate.startsWith('"') && cleanedTemplate.endsWith('"')) {
          cleanedTemplate = cleanedTemplate.slice(1, -1);
        }

        cleanedTemplate = cleanedTemplate.replace(/`/g, '\\`');

        try {
          const renderPreviewFn = new Function('summaryData', `return \`${cleanedTemplate}\`;`);
          const sampleOutput = renderPreviewFn(summaryData);

          console.log('\n📝 Generated Template:\n');
          console.log(Template);
          console.log('\nSample Output:\n');
          console.log(sampleOutput);
          console.log('\n');

          const userInput = await askUser("👉 Is this template okay? Type 'ok' to accept, or press enter to regenerate: ");
          if (userInput === 'ok') {
            global.renderFn = new Function('summaryData', `return \`${cleanedTemplate}\`;`);
            break;
          }
          console.log('\n🔁 Regenerating template...\n');
        } catch (err) {
          console.error('❌ Error evaluating the template:', err.message);
          console.log('\n🔁 Regenerating template...\n');
        }
      }
    }


    async function generateEmployeeSummary({ empInfo, additionalInfo, leaveInfo }) {
      const fullName = `${empInfo.FirstName} ${empInfo.LastName}`;
      const summaryData = {
        fullName: fullName.toLowerCase(),
        employeeId: empInfo.EmpID.toLowerCase(),
        firstname: empInfo.FirstName.toLowerCase(),
        lastname: empInfo.LastName.toLowerCase(),
        empType: empInfo.EmployeeType.toLowerCase(),
        department: empInfo.DepartmentType.toLowerCase(),
        division: empInfo.Division.toLowerCase(),
        startDate: formatDate(empInfo.StartDate),
        manager: empInfo.Manager.toLowerCase(),
        email: empInfo.Email.toLowerCase(),
        status: empInfo.EmployeeStatus.toLowerCase(),
        payZone: empInfo.PayZone.toLowerCase(),
        salary: empInfo.Salary,
        additionalID: empInfo.additionalinfo_id.toLowerCase(),
        dob: formatDate(additionalInfo.DOB),
        gender: additionalInfo.GenderCode.toLowerCase(),
        marital: additionalInfo.MaritalDesc.toLowerCase(),
        state: additionalInfo.State.toLowerCase(),
        locationCode: additionalInfo.LocationCode,
        performance: additionalInfo.PerformanceScore.toLowerCase(),
        rating: additionalInfo.CurrentEmployeeRating,
        leaveDates: (leaveInfo.length > 0 ? leaveInfo.map(leave => formatDate(leave.date)) : ["N/A"]).join(', '),
        leaveEmpID: leaveInfo.length > 0 ? leaveInfo[0].employee_id.toLowerCase() : "n/a"
      };

      if (!global.renderFn) {
        await loopUntilApproved(summaryData);
      }

      const finalTemplate = global.renderFn(summaryData);

      return {
        template: finalTemplate,
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

    const normalizedanswer = await generateEmployeeSummary(combinedData);
    const { template, metadata } = normalizedanswer;

    console.log("Template:", template);
    console.log("Metadata:", metadata);

    if (select_modal === 'gemini') {
      await embed_employee_profile_gemini(template, metadata);
    } else if (select_modal === 'cohere') {
      await embed_fetchedData_cohere(template, metadata);
    } else {
      console.log("Invalid select modal");
    }
  } catch (err) {
    console.error(`❌ Embedding error for employee ID ${empInfo._id}:`, err.message);
  }
};


// //embedded fetched data
// async function embed_fetchedData_gemini(textChunks,empInfo) {


//     const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });

//     const collection = await chroma.getCollection({ name: 'enterprise-collection' });

//     for (let i = 0; i < textChunks.length; i++) {
//         const chunkText = textChunks[i];
//         const chunkId = `${empInfo._id}_chunk_${i}`;

//         const embed = await embeddingModel.embedContent({ content: { parts: [{ text: chunkText }] } });
//         const vector = embed?.embedding?.values;
//         console.log('Query vector length:', vector.length);
//         if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
//             console.error('❌ Invalid embedding vector during upsert:', vector);
//             continue;
//         }

//         if (!chunkId || !chunkText || !empInfo._id) {
//             console.error('❌ Invalid metadata or chunk data');
//             continue;
//         }

//         console.log("chunkId", chunkId);


//         await collection.upsert({
//             ids: [chunkId],
//             embeddings: [vector],
//             metadatas: [{
//                 employeeId: empInfo._id,
//                 chunkIndex: i,          
//                 text: chunkText
//             }],
//             documents: [chunkText],
//         });

//         console.log(`✅ Upserted chunk ${i} for employee ID: ${empInfo._id}`);

//     };

//     const embeddingsCount = await collection.peek({ limit: 1000000 });

//     if (embeddingsCount?.ids) {
//         console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
//     } else {
//         console.log(`🔢 No embeddings found.`);
//     };
//     return;
// }

async function embed_employee_profile_gemini(template_to_embed, metadata) {
  console.log("Modal-", select_modal);

  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const collection = await chroma.getCollection({ name: 'enterprise-collection' });

    const embed = await embeddingModel.embedContent({ content: { parts: [{ text: template_to_embed }] } });
    const vector = embed?.embedding?.values;

    if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
      console.error('❌ Invalid embedding vector:', vector);
      return;
    }

    const documentId = `${metadata.employeeId}_profile`; // ✅ Use employeeId from passed metadata

    await collection.upsert({
      ids: [documentId],
      embeddings: [vector],
      metadatas: [metadata],
      documents: [template_to_embed],
    });

    console.log(`✅ Upserted employee profile for ID: ${metadata.employeeId}`);

    const embeddingsCount = await collection.peek({ limit: 1000000 });
    console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
  } catch (error) {
    console.error('❌ Error embedding employee profile:', error);
  }
}

async function embed_fetchedData_cohere(template_to_embed, metadata) {
  console.log("Modal-", select_modal);

  // const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  // for (let i = 0; i < textChunks.length; i++) {
  //     const chunkText = textChunks[i];
  //     const chunkId = `${empInfo._id}_chunk_${i}`;

  //     const embed = await cohere.embed({
  //         texts: [chunkText],
  //         model: "embed-english-v3.0", // Or "embed-multilingual-v3.0"
  //         input_type: "search_document"
  //     });
  //     const vector = embed.embeddings[0];

  //     console.log('Query vector length:', vector.length);
  //     if (
  //         !vector ||
  //         !Array.isArray(vector) ||
  //         (vector.length !== 768 && vector.length !== 1024) ||
  //         typeof vector[0] !== 'number'
  //       ) {
  //         console.error('❌ Invalid embedding vector during upsert:', vector);
  //         continue;
  //       }

  //     if (!chunkId || !chunkText || !empInfo._id) {
  //         console.error('❌ Invalid metadata or chunk data');
  //         continue;
  //     }

  //     console.log("chunkId", chunkId);


  //     await collection.upsert({
  //         ids: [chunkId],
  //         embeddings: [vector],
  //         metadatas: [{
  //             employeeId: empInfo._id,
  //             chunkIndex: i,
  //             text: chunkText
  //         }],
  //         documents: [chunkText],
  //     });

  //     console.log(`✅ Upserted chunk ${i} for employee ID: ${empInfo._id}`);
  // }

  // const embeddingsCount = await collection.peek({ limit: 1000000 });

  // if (embeddingsCount?.ids) {
  //     console.log(`🔢 Total embeddings count in Chroma: ${embeddingsCount.ids.length}`);
  // } else {
  //     console.log(`🔢 No embeddings found.`);
  // };
  // return;


  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const collection = await chroma.getCollection({ name: 'enterprise-collection' });

    const embed = await cohere.embed({
      texts: [template_to_embed],
      model: "embed-english-v3.0", // Or "embed-multilingual-v3.0"
      input_type: "search_document"
    });
    const vector = embed.embeddings[0];



    const documentId = `${metadata.employeeId}_profile`; // ✅ Use employeeId from passed metadata

    await collection.upsert({
      ids: [documentId],
      embeddings: [vector],
      metadatas: [metadata],
      documents: [template_to_embed],
    });

    console.log(`✅ Upserted employee profile for ID: ${metadata.employeeId}`);

    const embeddingsCount = await collection.peek({ limit: 1000000 });
    console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
  } catch (error) {
    console.error('❌ Error embedding employee profile:', error);
  }
}

//InitializeEmbeddings
const initializeEmbeddings = async ({ deleteExisting = false } = {}) => {
  const collectionName = 'enterprise-collection';

  try {
    if (deleteExisting) {
      console.log("📦 Checking if collection exists...");
      const collections = await chroma.listCollections();
      const collectionExists = collections.find(c => c.name === collectionName);

      if (collectionExists) {
        console.log("🧹 Deleting existing collection to reset dimension...");
        try {
          await chroma.deleteCollection({ name: collectionName });
          console.log("🧨 Collection deleted.");
        } catch (deleteErr) {
          console.warn("⚠️ Failed to delete collection, might be corrupted:", deleteErr.message);
        }
      } else {
        console.log("✅ Collection does not exist. Skipping deletion.");
      }

      console.log("🔄 Recreating collection...");
      await chroma.createCollection({ name: collectionName });
      console.log("✅ Collection created.");
    }

    console.log("✅ Collection ready.");

    console.log("📥 Fetching all documents from CouchDB...");
    const allDocs = await db.list({ include_docs: true });

    let employeeDocs = [];
    let additionalInfoDocs = [];
    let leaveInfo = {};

    for (const row of allDocs.rows) {
      const doc = row.doc;
      if (doc._id.startsWith('employee_2_')) {
        employeeDocs.push(doc);
      }
      if (doc._id.startsWith('additionalinfo_2_')) {
        additionalInfoDocs.push(doc.data);
      }
      if (doc._id.startsWith('leave_2_')) {
        const parentId = doc.data['employee_id'];
        if (!leaveInfo[parentId]) {
          leaveInfo[parentId] = [];
        }
        leaveInfo[parentId].push(doc.data);
      }
    }

    console.log(`👥 Found ${employeeDocs.length} employee entries.`);
    const start = Date.now();
    console.log("Start embedding fetched data starting at:", new Date(start).toISOString());

    for (let i = 0; i < employeeDocs.length; i++) {
      let parentDocId = employeeDocs[i]['_id'].split('_2_')[1];
      await processAndEmbedEmployee(employeeDocs[i], additionalInfoDocs[i], leaveInfo[parentDocId]);
    }

    const end = Date.now();
    console.log("End embedding fetched data starting at:", new Date(end).toISOString());
    console.log(`⏱ Execution time: ${end - start} ms`);

  } catch (err) {
    console.error('❌ Error initializing embeddings:', err);
  }
};



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
          rl.close()
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
