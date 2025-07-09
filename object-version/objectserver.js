const express = require('express');
const dotenv =require('dotenv');
const bodyParser = require('body-parser');
const cors =require('cors');
const https= require('https');
const Nano =require('nano');
const readline = require('readline');
const { ChromaClient } = require('chromadb');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { CohereClient } = require('cohere-ai');
const chroma= new ChromaClient({path:'http://127.0.0.1:8000'});
const chatbotRoutes = require('./routes/chatbot.routes')
const { fieldStore } = require('./fieldStore');

const cohere = new CohereClient();



dotenv.config({ path: './couchdb_credentials.env' });
const app= express();
app.use(cors({origin:'http://localhost:4200'}));
app.use(express.json())
const nano = Nano({
  url: `https://${process.env.COUCHDB_HOST}`, // example: 192.168.57.254:5984
  requestDefaults: {
    agent: new https.Agent({ rejectUnauthorized: false }),
    auth: {
      username: 'datauser',
      password: 'Welcome#1'
    }
  }
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const db= nano.db.use(process.env.COUCHDB_DB2);
const PORT = process.env.PORT || 3000;

let previousObjectname=''



app.use('/api/chatbot', chatbotRoutes);



const processAndEmbed = async (object) => {
  try {
    let hasChanged = false;

    if (previousObjectname === '') {
      hasChanged = true;
    } else if (previousObjectname !== object.objectname) {
      hasChanged = true;
    }

    previousObjectname = object.objectname;

    async function geminiDynamicTemplate(object) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      const allFields = Object.keys(object);

      const prompt = `
You are a Node.js assistant.

Your job is to generate a professional and meaningful paragraph summarizing an employee profile using the provided object named \`metadataobject\`.

✅ Use the following format:
- The output must be a valid **JavaScript template literal**, wrapped in **a single pair of backticks** — that is: \` at the beginning and \` at the end.
- Do NOT use triple backticks
- Each dynamic field must use the full variable path like \${metadataobject.fullName}, not just \${fullName}.
- Include **all** of the following fields:

${allFields.map(field => `- metadataobject.${field}`).join('\n')}

🚫 Do NOT:
- Do NOT use example values
- Do NOT invent or omit fields
- Do NOT include explanations or markdown

✅ DO:
- Return only the JavaScript template literal (wrapped in backticks)

Here is the object:
const metadataobject = ${JSON.stringify(object, null, 2)}
`;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }

    async function cohereDynamicTemplate(object) {
      const allFields = Object.keys(object);

      const prompt = `
You are a JavaScript assistant.

Your job is to generate a **JavaScript template literal** that summarizes all data in the provided object \`metadataobject\`.

⚠️ Rules:
- MUST include **every single field** listed below
- Use JavaScript template literal syntax like \${metadataobject.name}

Fields to include:
${allFields.map(f => `- metadataobject.${f}`).join('\n')}

Here is the object:
const metadataobject = ${JSON.stringify(object, null, 2)}
`;

      const response = await cohere.generate({
        model: 'command-r-plus',
        prompt: prompt,
        max_tokens: 1000,
        temperature: 0.7,
      });

      return response.generations[0].text.trim();
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

    async function loopUntilApproved(metadataobject) {
      while (true) {
        let Template = '';

        if (select_modal === 'gemini') {
          Template = await geminiDynamicTemplate(metadataobject);
        } else if (select_modal === 'cohere') {
          Template = await cohereDynamicTemplate(metadataobject);
        } else {
          console.error('❌ Unknown modal:', select_modal);
          return;
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
          const renderPreviewFn = new Function('metadataobject', `return \`${cleanedTemplate}\`;`);
          const sampleOutput = renderPreviewFn(metadataobject);

          console.log('\n📝 Generated Template:\n');
          console.log(Template);
          console.log('\nSample Output:\n');
          console.log(sampleOutput);
          console.log('\n');

          const userInput = await askUser("👉 Is this template okay? Type 'ok' to accept, or press enter to regenerate: ");
          if (userInput === 'ok') {
            global.renderFn = new Function('metadataobject', `return \`${cleanedTemplate}\`;`);
            return;
          }

          console.log('\n🔁 Regenerating template...\n');
        } catch (err) {
          console.error('❌ Error evaluating the template:', err.message);
          console.log('\n🔁 Regenerating template...\n');
        }
      }
    }

    async function generateEmployeeSummary(object) {
      const metadataobject = {};
      for (const [key, value] of Object.entries(object)) {
        if (typeof value === 'string') {
          metadataobject[key] = value.toLowerCase();
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          metadataobject[key] = value;
        } else if (Array.isArray(value)) {
          metadataobject[key] = value;
        }
      }

      // If object changed, ask user and store fields
      if (hasChanged) {
        await loopUntilApproved(metadataobject);

        const availableFields = Object.keys(metadataobject).filter(f => f !== 'objectname');
        console.log('\n📋 Available fields to filter:');
        availableFields.forEach((field, idx) => console.log(`${idx + 1}. ${field}`));

        const userFilterInput = await askUser("\n🔎 Enter comma-separated fields to include in metadata: ");
        const selectedFields = userFilterInput.split(',').map(f => f.trim().toLowerCase()).filter(Boolean);

        // Ensure store is initialized
        if (!fieldStore.filterFieldsByObject[object.objectname]) {
          fieldStore.filterFieldsByObject[object.objectname] = [];
        }

        fieldStore.filterFieldsByObject[object.objectname] = selectedFields;
      }

      const selected = fieldStore.filterFieldsByObject?.[object.objectname] || [];
      const finalMetadata = { objectname: object.objectname };

      for (const field of selected) {
        if (field in metadataobject) {
          finalMetadata[field] = metadataobject[field];
        }
      }

      const finalTemplate = global.renderFn(metadataobject);
      return { template: finalTemplate, metadata: finalMetadata };
    }

    const normalized = await generateEmployeeSummary(object);
    const { template, metadata } = normalized;

    console.log("Template:", template);
    console.log("Metadata:", metadata);

    if (select_modal === 'gemini') {
      await embed_employee_profile_gemini(template, metadata);
    } else if (select_modal === 'cohere') {
      await embed_fetchedData_cohere(template, metadata);
    } else {
      console.log("Invalid modal selected.");
    }

  } catch (err) {
    console.error(`❌ Embedding error for employee:`, err.message);
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

     const documentId = `${metadata.objectname}_${Date.now()}`; 
    console.log("documentId:",documentId);// ✅ Use employeeId from passed metadata

    await collection.upsert({
      ids: [documentId],
      embeddings: [vector],
      metadatas: [metadata],
      documents: [template_to_embed],
    });

    console.log(`✅ Upserted employee profile for ID: ${metadata.objectname}`);

    const embeddingsCount = await collection.peek({ limit: 1000000 });
    console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
  } catch (error) {
    console.error('❌ Error embedding employee profile:', error);
  }
}

async function embed_fetchedData_cohere(template_to_embed, metadata) {
  console.log("Modal-", select_modal);

 

  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const collection = await chroma.getCollection({ name: 'two-object-collection' });

    const embed = await cohere.embed({
      texts: [template_to_embed],
      model: "embed-english-v3.0", // Or "embed-multilingual-v3.0"
      input_type: "search_document"
    });
    const vector = embed.embeddings[0];



    const documentId = `${metadata.objectname}_${Date.now()}`; 
    console.log("documentId:",documentId);
    // ✅ Use employeeId from passed metadata

    await collection.upsert({
      ids: [documentId],
      embeddings: [vector],
      metadatas: [metadata],
      documents: [template_to_embed],
    });

    console.log(`✅ Upserted employee profile for ID: ${metadata.objectname}`);

    const embeddingsCount = await collection.peek({ limit: 1000000 });
    console.log(`🔢 Total embeddings in Chroma: ${embeddingsCount.ids?.length || 0}`);
  } catch (error) {
    console.error('❌ Error embedding employee profile:', error);
  }
}



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

    
  
    let totalDocs=[]
    for (const row of allDocs.rows) {
      const doc = row.doc;
      totalDocs.push(doc.data)
      // if (doc._id.startsWith('student_2_')) {
      //   studentDocs.push(doc.data);
      // }
      // if (doc._id.startsWith('staff_2_')) {
      //   staffDocs.push(doc.data);
      // }
    }
      
   
   
    

  
    console.log(`👥 Found ${totalDocs.length} employee entries.`);
    const start = Date.now();
    console.log("Start embedding fetched data starting at:", new Date(start).toISOString());

 
    const typeGroups = {};
const typeOrder = [];

// Group the documents by data.objectname
for (const doc of totalDocs) {
  const type = doc.data?.objectname?.toLowerCase() || 'unknown';

  // If seeing this type for the first time, remember the order
  if (!typeGroups[type]) {
    typeGroups[type] = [];
    typeOrder.push(type);
  }

  typeGroups[type].push(doc);
}

// Flatten the grouped types in the order they first appeared
const sortedDocs = [];

for (const type of typeOrder) {
  sortedDocs.push(...typeGroups[type]);
}

console.log("sorted docs:",sortedDocs);

const allKeysSet = new Set();

for (const doc of sortedDocs) {
  for (const key of Object.keys(doc)) {
    allKeysSet.add(key);
  }
}

const allUniqueKeys = Array.from(allKeysSet);
console.log(allUniqueKeys);

app.locals.allUniqueKeys = allUniqueKeys;

   for(let i=0;i<sortedDocs.length;i++){
    await processAndEmbed(sortedDocs[i])
   }


    const end = Date.now();
    console.log("End embedding fetched data starting at:", new Date(end).toISOString());
    console.log(`⏱ Execution time: ${end - start} ms`);

  } catch (err) {
    console.error('❌ Error initializing embeddings:', err);
  }
};


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
        // await listenToChanges();
      });

    } else if (input === 'no') {
      console.log('⏭️ Skipping embedding process as per user input.');
      rl.close();
      // await listenToChanges();
    } else {
      console.log('⚠️ Invalid input. Skipping embedding process by default.');
      rl.close();
      // await listenToChanges();
    }
  });
});
