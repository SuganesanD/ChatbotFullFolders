// server.js

const express = require('express');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');

const Nano = require('nano');
const cors = require('cors');
const https = require('https');
const readline = require('readline');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const milvusClient = require('./milvusClient');
dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
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
// app.use('/api/chatbot', chatbotRoutes);
// === Health Check ===
app.get('/', (req, res) => {
  res.send('🤖 Enterprise Chatbot API is running...');
});

// === Error Handling Middleware ===
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Something went wrong in the backend.' });
});

    


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

async function createMilvusCollectionIfNotExists(collectionName, selectedKeys, flatData, dim = 768) {
  const { has_collection } = await milvusClient.hasCollection({ collection_name: collectionName });
  if (has_collection) {
    console.log(`✅ Collection '${collectionName}' already exists.`);
    return;
  }

  const fields = [
    {
      name: 'id',
      description: 'Primary key',
      data_type: DataType.VarChar,
      is_primary_key: true,
      autoID: false,
      max_length: 128,
    },
    {
      name: 'embedding',
      description: 'Vector embedding',
      data_type: DataType.FloatVector,
      type_params: { dim: dim.toString() },
    },
  ];

  // Create fields based on selected keys and their value types in flatData
  for (const key of selectedKeys) {
    const val = flatData[key];
    const isNumeric = typeof val === 'number';

    fields.push({
      name: key,
      description: `Field for ${key}`,
      data_type: isNumeric ? DataType.Int64 : DataType.VarChar,
      ...(isNumeric ? {} : { max_length: 256 })
    });
  }

  await milvusClient.createCollection({
    collection_name: collectionName,
    fields
  });

  console.log(`🎉 Milvus collection '${collectionName}' created with fields:`, selectedKeys);
}


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
  console.log("Model:", select_modal);

  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const embed = await embeddingModel.embedContent({
      content: { parts: [{ text: template_to_embed }] }
    });

    const vector = embed?.embedding?.values;
    if (!vector || vector.length !== 768 || typeof vector[0] !== 'number') {
      console.error('❌ Invalid embedding vector:', vector);
      return;
    }

    const collectionName = 'employee_collection';

    // 1. Create collection if it doesn't exist
    const hasCol = await milvusClient.hasCollection({ collection_name: collectionName });
    if (!hasCol.value) {
      console.log(`Creating collection: ${collectionName}`);
      await milvusClient.createCollection({
        collection_name: collectionName,
        fields: [
          { name: 'id', data_type: 'VarChar', max_length: 64, is_primary_key: true },
          { name: 'vector', data_type: 'FloatVector', type_params: { dim: '768' } },
          { name: 'metadata_json', data_type: 'VarChar', max_length: 65535 },
        ],
      });
    }

    // 2. Insert data FIRST
    const documentId = metadata.Id;
    await milvusClient.insert({
      collection_name: collectionName,
      fields_data: [{
        id: documentId,
        vector,
        metadata_json: JSON.stringify(metadata),
      }],
    });

    // 3. Flush
    await milvusClient.flush({ collection_names: [collectionName] });

    // 4. Check if index exists
    const indexDesc = await milvusClient.describeIndex({
      collection_name: collectionName,
      field_name: 'vector',
    });

    const hasIndex = indexDesc.index_descriptions && indexDesc.index_descriptions.length > 0;

    // 5. Create index only if not exists
    if (!hasIndex) {
      console.log('Creating index on vector field...');
      await milvusClient.createIndex({
        collection_name: collectionName,
        field_name: 'vector',
        index_name: 'vector_index',
        index_type: 'IVF_FLAT',
        metric_type: 'COSINE',
        params: { nlist: 128 },
      });

      // 6. Wait for index build
      console.log('Waiting for index to be built...');
      let indexState;
      do {
        await new Promise(res => setTimeout(res, 1000));
        const state = await milvusClient.getIndexState({
          collection_name: collectionName,
          field_name: 'vector',
        });
        indexState = state.state;
        console.log('Index build state:', indexState);
      } while (indexState !== 'Finished');

      console.log('✅ Index build complete!');
    }

    // 7. Load collection
    await milvusClient.loadCollection({ collection_name: collectionName });

    console.log(`✅ Inserted into Milvus with ID: ${documentId}`);
  } catch (error) {
    console.error('❌ Error embedding or inserting into Milvus:', error.message || error);
  }
}



const COLLECTION_NAME = 'Milvus_collection';
const DIMENSION = 768; // adjust to match your embedding model
const INDEX_TYPE = 'IVF_FLAT';
const METRIC_TYPE = 'L2';

//InitializeEmbeddings
const initializeEmbeddings = async ({ deleteExisting = false } = {}) => {
  try {
    if (deleteExisting) {   
      const collections = await milvusClient.showCollections();
      const exists = collections.data.find(c => c.name === COLLECTION_NAME);

      if (exists) {
        console.log(`🧹 Dropping existing collection '${COLLECTION_NAME}'...`);
        await milvusClient.dropCollection({ collection_name: COLLECTION_NAME });
        console.log("🧨 Dropped successfully.");
      } else {
        console.log("✅ No existing collection found.");
      }
    }

    console.log(`📦 Creating collection '${COLLECTION_NAME}'...`);
    await milvusClient.createCollection({
      collection_name: COLLECTION_NAME,
      fields: [
        { name: 'employee_id', data_type: 5, is_primary_key: true, autoID: false }, // VarChar
        { name: 'embedding', data_type: 101, type_params: { dim: `${DIMENSION}` } }, // Float Vector
        { name: 'metadata', data_type: 5 }, // VarChar for JSON string
      ],
    });
    console.log("✅ Collection created.");

    console.log("📥 Fetching all documents from CouchDB...");
    const allDocs = await db.list({ include_docs: true });

    let employeeDocs = [];
    let additionalInfoMap = {};
    let leaveMap = {};

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
        if (!leaveMap[empId]) leaveMap[empId] = [];
        leaveMap[empId].push(doc.data);
      }
    }

    const mergedArray = [];
    for (const employee of employeeDocs) {
      const empData = employee.data;
      const additionalinfo = additionalInfoMap[empData.additionalinfo_id] || {};
      const employeeDocId = employee._id.split('_2_')[1];
      const leaves = leaveMap[employeeDocId] || [];

      const merged = {
        employee: empData,
        additionalinfo,
        leaves,
      };

      mergedArray.push(merged);
      console.log("🔗 Merged Record:");
      console.log(JSON.stringify(merged, null, 2));
    }

    console.log(`✅ Total merged records: ${mergedArray.length}`);

    for (let i = 0; i < mergedArray.length; i++) {
      const merged = mergedArray[i];
      const isFirstRecord = i === 0;
      console.log(`🔄 Sending employee ${merged.employee.EmpID} (${i + 1}/${mergedArray.length})`);
      await processAndEmbedEmployee(merged, isFirstRecord);
    }

  } catch (err) {
    console.error("❌ Error initializing Milvus embeddings:", err);
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