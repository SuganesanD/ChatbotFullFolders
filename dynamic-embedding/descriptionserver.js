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


let select_modal = 'cohere'

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

 async function geminiDynamicTemplate(merged) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const allFields = Object.keys(merged);
      const prompt = `
You are a Node.js assistant.

Your job is to generate a professional and meaningful paragraph summarizing an employee profile using the provided object named \`summaryData\`.

✅ Use the following format:
- The output must be a valid **JavaScript template literal**, wrapped in **a single pair of backticks**
- Do NOT use triple backticks (e.g., \`\`\`)
- Each dynamic field must use the full variable path like \${summaryData.fullName}
- Include **all** of the following fields:

${allFields.map(field => `- merged.${field}`).join('\n')}

🚫 Do NOT:
- Do NOT use example values
- Do NOT invent or omit fields
- Do NOT include any explanation or markdown

Here is the object:
const merged = ${JSON.stringify(merged, null, 2)}

Now return ONLY the template literal wrapped in a single pair of backticks. No comments, no markdown.`;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
    
//pre process fetched data
// const porocessAndEmbedEmployee = async (merged) => {
//   try {
//     global.renderFn = global.renderFn || null;
//     global.selectedMetadataKeys = global.selectedMetadataKeys || null;

   

//     async function cohereDynamicTemplate(summaryData) {
//       const allFields = Object.keys(summaryData);
//       const prompt = `
// You are a JavaScript assistant.

// Your job is to generate a **JavaScript template literal** that summarizes all data in the provided object \`summaryData\`.

// ⚠️ This is important:
// - You MUST include **every single field** from the list below
// - Use JavaScript **template literal syntax** only

// 📋 Fields to include:
// ${allFields.map(field => `- summaryData.${field}`).join('\n')}

// 📌 Format:
// \`\${summaryData.fullName}, employee ID \${summaryData.employeeId}, is a \${summaryData.empType} employee...\`

// 🚫 Do NOT:
// - Do NOT return example values
// - Do NOT skip fields

// Here is the object:
// const summaryData = ${JSON.stringify(summaryData, null, 2)}`;

//       const response = await cohere.generate({
//         model: 'command-r-plus',
//         prompt: prompt,
//         max_tokens: 1000,
//         temperature: 0.7,
//       });

//       return response.generations[0].text.trim();
//     }

//     function askUser(question) {
//       const rl = require('readline').createInterface({
//         input: process.stdin,
//         output: process.stdout
//       });
//       return new Promise(resolve => rl.question(question, ans => {
//         rl.close();
//         resolve(ans.trim().toLowerCase());
//       }));
//     }

//     async function loopUntilApproved(firstMergedObject) {
//       while (true) {
//         let Template = '';

//         const objects = Object.keys(firstMergedObject);
//         const splittedObjects = [];
//         for (const key of objects) {
//           splittedObjects.push(firstMergedObject[key]);
//         }

//         for (let i = 0; i < splittedObjects.length; i++) {
//           const item = splittedObjects[i];
//           if (Array.isArray(item)) {
//             Template = (select_modal === 'gemini')
//               ? await geminiDynamicTemplate(item[0])
//               : await cohereDynamicTemplate(item[0]);
//           } else {
//             Template = (select_modal === 'gemini')
//               ? await geminiDynamicTemplate(item)
//               : await cohereDynamicTemplate(item);
//           }

//           // Step 7: Clean and render template
//           let cleanedTemplate = Template
//             .replace(/^```[a-z]*\n?/i, '')
//             .replace(/```$/, '')
//             .trim();

//           if (cleanedTemplate.startsWith('"') && cleanedTemplate.endsWith('"')) {
//             cleanedTemplate = cleanedTemplate.slice(1, -1);
//           }

//           cleanedTemplate = cleanedTemplate.replace(/`/g, '\\`');

//           try {
//             const renderPreviewFn = new Function('merged', `return \`${cleanedTemplate}\`;`);
//             const sampleOutput = renderPreviewFn(firstMergedObject);

//             console.log('\n📝 Generated Template:\n');
//             console.log(Template);
//             console.log('\n🔍 Sample Output:\n');
//             console.log(sampleOutput);
//             console.log('\n');

//             const userInput = await askUser("👉 Is this template okay? Type 'ok' to accept, or press enter to regenerate: ");
//             if (userInput.toLowerCase() === 'ok') {
//               global.renderFn = new Function('merged', `return \`${cleanedTemplate}\`;`);

//               // Step 9: Ask for selected metadata keys
//               const selectedFields = await askUser(
//                 `👇 Enter comma-separated field names from the following:\n${Object.keys(firstMergedObject).join(', ')}\nYour selection: `
//               );
//               global.selectedMetadataKeys = selectedFields.split(',').map(k => k.trim()).filter(Boolean);
//               return;
//             }

//             console.log('\n🔁 Regenerating template...\n');
//           } catch (err) {
//             console.error('❌ Error evaluating template:', err.message);
//             console.log('\n🔁 Regenerating...\n');
//           }
//         }
//       }
//     }

//     async function generateEmployeeSummary(currentMerged) {
//       if (!global.renderFn || !global.selectedMetadataKeys) {
//         await loopUntilApproved(currentMerged);
//       }

//       const finalTemplate = global.renderFn(currentMerged);
//       const metadata = {};
//       for (const key of global.selectedMetadataKeys) {
//         metadata[key] = currentMerged[key];
//       }

//       return { template: finalTemplate, metadata };
//     }

//     // ⬇️ Generate summary and embed
//     const normalizedanswer = await generateEmployeeSummary(merged);
//     const { template, metadata } = normalizedanswer;

//     console.log("✅ Final Template:", template);
//     console.log("📦 Selected Metadata:", metadata);

//     if (select_modal === 'gemini') {
//       await embed_employee_profile_gemini(template, metadata);
//     } else if (select_modal === 'cohere') {
//       await embed_fetchedData_cohere(template, metadata);
//     } else {
//       console.log("⚠️ Invalid select_modal");
//     }

//   } catch (err) {
//     console.error(`❌ Embedding error for employee ID ${merged._id || 'unknown'}:`, err.message);
//   }
// };

///starting point for chunk

const askUser = (question) => {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => readline.question(question, ans => {
    readline.close();
    resolve(ans.trim());
  }));
};

const generateGeminiPrompt = (obj) => {

    console.log(obj);
    
  return `
You are a Node.js assistant.

Your task is to generate a **natural-language JavaScript template literal** summarizing a \${label} record using only the keys present in the \`data\` object.

✅ Output Requirements:
- Output a **single template literal**, wrapped in one pair of backticks
- Format it as a **single flowing paragraph**
- Use only the keys present in \`data\`
- Use exact key names: \${data.key} — no assumptions
- Use **every key** from the \`data\` object — do **not skip or ignore any**
- Combine values into a grammatically correct sentence
- Keep the paragraph **meaningful and compact**
- **Avoid unnecessary filler words** like “The following is”, “This shows”, “With”, etc.
- Do **not** add labels like "(salary)", no parentheses, and no headings
- Do **not** include markdown or explanations — just the JavaScript template literal

✅ Example:
If data = {
  "employee_firstname": "Jared",
  "employee_lastname": "Feeney",
  "employee_salary": 89956,
  "employee_status": "Terminated",
  "additionalinfo_gendercode": "female",
  "leaves_date": "2025-05-08"
}

Then output:
\`\${data.employee_firstname} \${data.employee_lastname} is a \${data.additionalinfo_gendercode} employee who was \${data.employee_status}. Their salary was \$\${data.employee_salary}. Last recorded leave was on \${data.leaves_date}.\`

Here is the object:
const data = ${JSON.stringify(obj, null, 2)}

Now return ONLY the template literal — no explanation, no markdown.
`;
};




const generateEmployeeSummary = async (merged, isFirstRecord) => {
  const sharedContext = require('./sharedContext');

  global.templates = global.templates || {};
  global.keys = global.keys || {};
  global.selectedFieldDescriptions = global.selectedFieldDescriptions || {};

  // 🔄 Flatten function with parent prefix
  const flattenWithPrefix = (obj, prefix = '') => {
    let result = {};
    for (let key in obj) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}_${key.toLowerCase()}` : key.toLowerCase();
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.assign(result, flattenWithPrefix(value, newKey));
      } else if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'object') {
          Object.assign(result, flattenWithPrefix(value[0], newKey));
        }
      } else {
        result[newKey] = typeof value === 'string' ? value.toLowerCase() : value;
      }
    }
    return result;
  };

  const flatData = flattenWithPrefix(merged);
  const empId = merged.employee?.EmpID || 'unknown';
  const baseId = `${empId}_${Date.now()}`;

  let template = '';
  let selectedKeys = [];
  let fieldDescriptions = {};

  if (isFirstRecord) {
    // 🔮 Generate Gemini prompt
    const prompt = generateGeminiPrompt(flatData);

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let result = await model.generateContent(prompt);
    let rawTemplate = result.response.text().trim();

    rawTemplate = rawTemplate.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
    if (rawTemplate.startsWith('"') && rawTemplate.endsWith('"')) {
      rawTemplate = rawTemplate.slice(1, -1);
    }
    rawTemplate = rawTemplate.replace(/`/g, '\\`');

    const renderFn = new Function('data', `return \`${rawTemplate}\`;`);
    const preview = renderFn(flatData);

    console.log(`\n📝 TEMPLATE:\n${rawTemplate}`);
    console.log(`\n🔍 SAMPLE OUTPUT:\n${preview}`);

    const approved = await askUser("👉 Type 'ok' to accept template or press enter to regenerate: ");
    if (approved !== 'ok') return await generateEmployeeSummary(merged, isFirstRecord); // Regenerate

    // 🧠 Ask for selected keys and descriptions
    const selectedKeysInput = await askUser(`👇 Enter comma-separated fields from:\n${Object.keys(flatData).join(', ')}\nYour selection: `);
    const validKeys = Object.keys(flatData);

    selectedKeys = [];
    fieldDescriptions = {};

    for (const entry of selectedKeysInput.split(',')) {
      const key = entry.trim().toLowerCase();
      if (validKeys.includes(key)) {
        const description = await askUser(`📝 Description for '${key}': `);
        selectedKeys.push(key);
        fieldDescriptions[key] = description.trim();
      } else {
        console.log(`⚠️ '${key}' is not a valid key.`);
      }
    }
    const relationshipDescription = await askUser("🔗 Describe how the objects are related (relationship description): ");
sharedContext.relationshipDescription = relationshipDescription.trim();

    // 💾 Save to sharedContext
    sharedContext.selectedFieldsPerObject["SelectedFields"] = selectedKeys;
    sharedContext.selectedFieldDescriptions["Field Description"] = fieldDescriptions;
    sharedContext.availableFieldsPerObject["employee_profile"] = validKeys;
    sharedContext.select_modal = select_modal;
    sharedContext.objectList = ["employee_profile"];
    sharedContext.save();

    // 🌍 Save to global
    global.keys["employee_profile"] = selectedKeys;
    global.selectedFieldDescriptions["employee_profile"] = fieldDescriptions;
    global.templates["employee_profile"] = rawTemplate;
  }

  // 🛠 Use existing if not first record
  template = global.templates["employee_profile"];
  selectedKeys = global.keys["employee_profile"];
  fieldDescriptions = global.selectedFieldDescriptions["employee_profile"];
  const renderFn = new Function('data', `return \`${template}\`;`);
  const finalTemplate = renderFn(flatData);

  const metadata = {
    empid: empId,
    Id: `employee_profile_${baseId}`
  };
  selectedKeys.forEach(k => {
    if (flatData[k] !== undefined) metadata[k] = flatData[k];
  });

  return { templates: [finalTemplate], metadatas: [metadata] };
};




const processAndEmbedEmployee = async (merged, isFirstRecord) => {
  const { templates, metadatas } = await generateEmployeeSummary(merged, isFirstRecord);

  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    const metadata = metadatas[i];

    console.log("✅ Final Template:", template);
    console.log("📦 Selected Metadata:", metadata);

    if (select_modal === 'gemini') {
      await embed_employee_profile_gemini(template, metadata);
    } else if (select_modal === 'cohere') {
      await embed_fetchedData_cohere(template, metadata);
    } else {
      console.log("⚠️ Invalid select_modal");
    }
  }
};



async function embed_employee_profile_gemini(template_to_embed, metadata) {
  console.log("Modal-", select_modal);

  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const collection = await chroma.getCollection({ name: 'two-object-collection' });

    const embed = await embeddingModel.embedContent({ content: { parts: [{ text: template_to_embed }] } });
    const vector = embed?.embedding?.values;

    if (!vector || !Array.isArray(vector) || vector.length !== 768 || typeof vector[0] !== 'number') {
      console.error('❌ Invalid embedding vector:', vector);
      return;
    }

    const documentId = `${metadata.Id}`; // ✅ Use employeeId from passed metadata
    console.log("documentId:",documentId)

    await collection.upsert({
      ids: [documentId],
      embeddings: [vector],
      metadatas: [metadata],
      documents: [template_to_embed],
    });

    console.log(`✅ Upserted employee profile for ID: ${metadata.Id}`);

    const embeddingsCount = await collection.peek({ limit: 1000000 });
    console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
  } catch (error) {
    console.error('❌ Error embedding employee profile:', error);
  }
}

async function embed_fetchedData_cohere(template_to_embed, metadata) {
  console.log("Modal-", select_modal);

  try {
    const collection = await chroma.getCollection({ name: 'two-object-collection' });

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
  const collectionName = 'two-object-collection';

  try {
    if (deleteExisting) {
      console.log("📦 Checking if collection exists...");
      const collections = await chroma.listCollections();
      const collectionExists = collections.find(c => c.name === collectionName);

      if (collectionExists) {
        console.log("🧹 Deleting existing collection to reset dimension...");
        try {
          await chroma.deleteCollection({ name: collectionName });
          console.log(collectionName,"🧨 Collection deleted.");
        } catch (deleteErr) {
          console.warn("⚠️ Failed to delete collection, might be corrupted:", deleteErr.message);
        }
      } else {
        console.log("✅ Collection does not exist. Skipping deletion.");
      }

      console.log("🔄 Recreating collection...");
      await chroma.createCollection({ name: collectionName });
      console.log(collectionName,"✅ Collection created.");
    }

    console.log("✅ Collection ready.");

console.log("📥 Fetching all documents from CouchDB...");
const allDocs = await db.list({ include_docs: true });

let employeeDocs = [];
let additionalInfoMap = {};  // Map: additionalinfo_id => additionalinfo.data
let leaveMap = {};           // Map: employee_id (from _id) => array of leave.data

for (const row of allDocs.rows) {
  const doc = row.doc;

  if (doc._id.startsWith('employee_2_')) {
    employeeDocs.push(doc);
  }

  if (doc._id.startsWith('additionalinfo_2_')) {
    const infoId = doc._id.split('_2_')[1];
    additionalInfoMap[infoId] = doc.data;
  }

  if (doc._id.startsWith('leave_2_')) {
    const empId = doc.data.employee_id;
    if (!leaveMap[empId]) {
      leaveMap[empId] = [];
    }
    leaveMap[empId].push(doc.data);
  }
}

console.log(`👥 Found ${employeeDocs.length} employee entries.`);

// Build the final merged array
const mergedArray = [];

for (const employee of employeeDocs) {
  const empData = employee.data;

  // Lookup additional info
  const additionalinfo = additionalInfoMap[empData.additionalinfo_id] || {};

  // Lookup leaves using internal employee ID
  const employeeDocId = employee._id.split('_2_')[1];
  const leaves = leaveMap[employeeDocId] || [];

  // Create merged object
  const merged = {
    employee: empData,
    additionalinfo: additionalinfo,
    leaves: leaves
  };

  mergedArray.push(merged);

  // 🖨️ Log each record
  console.log("🔗 Merged Record:");
  console.log(JSON.stringify(merged, null, 2));
}

console.log(`✅ Total merged records: ${mergedArray.length}`);

for (let i = 0; i < mergedArray.length; i++) {
  const merged = mergedArray[i];

  console.log(`🔄 Sending employee ${merged.employee.EmpID} (${i + 1}/${mergedArray.length})`);
  const isFirstRecord = i === 0;
  await processAndEmbedEmployee(merged, isFirstRecord);
}



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
