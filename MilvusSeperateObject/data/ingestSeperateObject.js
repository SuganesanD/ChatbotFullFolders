const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { milvusClient, DataType } = require('../../Milvus_langchain_chatbot/src/config/milvusClient');
const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const fs = require('fs');
const readline = require('readline');

// --- Environment Variable Check ---
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// --- Initialize LLM and Embedding Models ---
const chatModel = new ChatGoogleGenerativeAI({
    apiKey: GOOGLE_API_KEY,
    model: "gemini-2.0-flash", // Good for conversational and templating tasks
    temperature: 0.1, // Keep it low for consistent template generation
});

const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: GOOGLE_API_KEY,
    model: "embedding-001", // Or "text-embedding-004" for newer models if available and desired
});

// --- Configuration for Dynamic Processing ---
// List of JSON files to process.
// These simulate fetched data from CouchDB and will be processed into separate collections.
const jsonFilesToIngest = [
    'schoolObject.json',
    'studentObject.json',
    'leaveObject.json',
];

// Mapping to define primary key and embedding source field for each collection type.
// This is crucial for correctly building schema and generating embeddings.
const collectionTypeMappings = {
    "schoolObject": {
        primaryKeyField: "id", // This is the 'id' field from your JSON
        embeddingSourceField: "description",
        milvusCollectionAlias: "schools" // Milvus collection name
    },
    "studentObject": {
        primaryKeyField: "id", // This is the 'id' field from your JSON
        embeddingSourceField: "bio",
        milvusCollectionAlias: "students"
    },
    "leaveObject": {
        primaryKeyField: "id", // This is the 'id' field from your JSON
        embeddingSourceField: "reason",
        milvusCollectionAlias: "leaves"
    }
    // Add more mappings here if you add new JSON files/object types
};

const EMBEDDING_DIMENSION = 768; // Dimension for 'embedding-001' model

// --- Helper Functions ---

// Helper function to introduce a delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to infer Milvus DataType from JavaScript type
function inferMilvusDataType(value) {
    if (value === null) {
        return DataType.VarChar; // Treat nulls as VarChar, potentially nullable
    }
    switch (typeof value) {
        case 'string':
            return DataType.VarChar;
        case 'number':
            return Number.isInteger(value) ? DataType.Int64 : DataType.Float;
        case 'boolean':
            return DataType.Bool;
        case 'object':
            if (Array.isArray(value)) {
                return DataType.VarChar; // Stringify arrays for now
            }
            return DataType.VarChar; // For general objects, stringify them
        default:
            console.warn(`[WARN] Unexpected JavaScript type '${typeof value}' for value:`, value, `. Defaulting to DataType.VarChar.`);
            return DataType.VarChar;
    }
}

// Function to generate a summary template using LLM and get user approval
async function getApprovedSummaryTemplate(milvusSchemaFields, firstRecord, collectionName, embeddingSourceField) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    let approvedTemplate = null;

    while (approvedTemplate === null) {
        console.log(`\n--- Generating Summary Template for '${collectionName}' Collection with LLM ---`);
        // Filter out Milvus internal fields ('documentText', 'embedding', 'docId') when presenting schema to LLM
        const schemaForLLM = milvusSchemaFields.map(f => ({
            name: f.name,
            description: f.description || `Inferred field: ${f.name} (Milvus type: ${f.data_type}).`
        })).filter(f => !['documentText', 'embedding', 'docId'].includes(f.name));

        const llmPrompt = `You are an expert data summarizer. Your task is to create a concise, human-readable summary template for a data record.
I will provide you with the schema (field names and their descriptions) and an example data record from the "${collectionName}" collection.
Your output should be a single paragraph that uses placeholders for the actual data values.
Use double curly braces for placeholders, like \`{{fieldName}}\`.
**Critically, ensure you create a comprehensive summary template that attempts to include all available fields from the provided schema, as each field contains relevant information.**
**The field '${embeddingSourceField}' is the most important field containing the core semantic content of this record. You MUST ensure '{{${embeddingSourceField}}}' is prominently featured in the template.**
Consider how dates (Unix timestamps like 'created_at') and boolean values ('is_active', 'is_emergency') and arrays ('tags') should be naturally expressed in the summary.
Do not include any introductory or concluding remarks, just the summary paragraph.

Schema (Field Names and Descriptions for ${collectionName}):
${JSON.stringify(schemaForLLM, null, 2)}

Example Record (first record from JSON, use its values to understand context):
${JSON.stringify(firstRecord, null, 2)}

Generate the summary template (e.g., "Student {{name}} from school {{school_id}} requested {{type}} leave..."):`;

        try {
            const response = await chatModel.invoke(llmPrompt);
            const generatedTemplate = response.content;

            console.log("\nGenerated Summary Template:");
            console.log("------------------------------------------");
            console.log(generatedTemplate);
            console.log("------------------------------------------");

            const answer = await new Promise(resolve => {
                rl.question(`Do you approve this template for '${collectionName}'? (yes/no): `, input => {
                    resolve(input.toLowerCase());
                });
            });

            if (answer === 'yes') {
                if (!generatedTemplate.includes(`{{${embeddingSourceField}}}`)) {
                    console.warn(`[WARN] The generated template for '${collectionName}' does not contain '{{${embeddingSourceField}}}'. Please reject and regenerate if this is critical.`);
                    const proceedAnyway = await new Promise(resolve => {
                        rl.question(`Proceed anyway? (yes/no): `, input => {
                            resolve(input.toLowerCase());
                        });
                    });
                    if (proceedAnyway === 'yes') {
                        approvedTemplate = generatedTemplate;
                        console.log(`Template for '${collectionName}' approved despite missing embedding source field. Proceeding.`);
                    } else {
                        console.log("Template rejected. Regenerating a new template...");
                    }
                } else {
                    approvedTemplate = generatedTemplate;
                    console.log(`Template for '${collectionName}' approved. Proceeding with data ingestion.`);
                }
            } else if (answer === 'no') {
                console.log("Template rejected. Regenerating a new template...");
            } else {
                console.log("Invalid input. Please type 'yes' or 'no'. Regenerating...");
            }
        } catch (error) {
            console.error(`Error generating template for '${collectionName}' with LLM:`, error);
            console.log("Attempting to regenerate template due to error...");
            await sleep(5000); // Wait before retrying LLM call
        }
    }
    rl.close();
    return approvedTemplate;
}

// Function to fill the generated template with actual record data
function fillTemplate(template, record) {
    let filledText = template;
    for (const key in record) {
        let value = record[key];

        // Specific handling for common field names
        if (key === 'created_at' && typeof value === 'number' && value > 0) {
            try {
                value = new Date(value * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
            } catch (e) {
                value = record[key];
            }
        } else if ((key === 'is_active' || key === 'is_emergency') && typeof value === 'boolean') {
            value = value ? 'Yes' : 'No';
        } else if (Array.isArray(value)) {
            value = value.join(', '); // Join array elements for better readability in text
        } else if (value === null || value === undefined) {
            value = 'N/A'; // Handle null/undefined values gracefully
        } else if (typeof value === 'object') {
            value = JSON.stringify(value); // Stringify other objects (e.g., nested JSON)
        }

        filledText = filledText.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return filledText;
}

// Helper function to create and verify vector index
async function createAndVerifyVectorIndex(client, collectionName) {
    console.log(`Creating vector index on 'embedding' for collection '${collectionName}' with IVF_FLAT...`);
    const indexRes = await client.createIndex({
        collection_name: collectionName,
        field_name: "embedding",
        index_name: "embedding_index",
        index_type: "IVF_FLAT", // Or HNSW for larger datasets/better performance if memory allows
        metric_type: "COSINE", // COSINE for Google embeddings
        params: { nlist: 128 } // nlist should be tuned based on data scale
    });
    console.log(`Create index response for '${collectionName}':`, JSON.stringify(indexRes, null, 2));

    let attempts = 0;
    const maxAttempts = 60; // Wait up to 60 seconds
    const delayMs = 1000;
    while (attempts < maxAttempts) {
        try {
            const res = await client.describeIndex({
                collection_name: collectionName,
                index_name: "embedding_index"
            });
            if (res.status?.error_code === "Success" && res.index_descriptions?.[0]) {
                console.log(`Vector index on 'embedding' for '${collectionName}' is built or recognized.`);
                return true;
            }
            console.log(`Index for '${collectionName}' not ready (attempt ${attempts + 1}):`, res.status?.reason || 'Status not success');
        } catch (error) {
            console.warn(`Attempt ${attempts + 1}: describeIndex for '${collectionName}' failed - ${error.message}. Retrying...`);
        }
        await sleep(delayMs);
        attempts++;
    }
    throw new Error(`Index on 'embedding' for '${collectionName}' not found or not ready after ${maxAttempts} attempts.`);
}

// --- Main Ingestion Function ---
async function ingestAllData() {
    const MAX_PROCESS_RETRIES = 2; // Total attempts for each collection process
    const POLLING_INTERVAL_MS = 1000; // General polling interval

    for (const jsonFileName of jsonFilesToIngest) {
        const filePath = path.join(__dirname, jsonFileName);
        const collectionKey = jsonFileName.replace('.json', '');
        const collectionConfig = collectionTypeMappings[collectionKey];

        if (!collectionConfig) {
            console.error(`[ERROR] No collection configuration found for ${jsonFileName}. Skipping.`);
            continue;
        }

        const milvusCollectionName = collectionConfig.milvusCollectionAlias;
        const primaryKeyField = collectionConfig.primaryKeyField; // e.g., "id"
        const embeddingSourceField = collectionConfig.embeddingSourceField;

        let processAttempt = 0;
        let successfulIngestion = false;

        while (processAttempt < MAX_PROCESS_RETRIES && !successfulIngestion) {
            processAttempt++;
            console.log(`\n--- Starting Ingestion Attempt ${processAttempt} of ${MAX_PROCESS_RETRIES} for Collection: '${milvusCollectionName}' ---`);

            try {
                console.log(`Loading data from ${jsonFileName}...`);
                const rawData = fs.readFileSync(filePath);
                const fullJsonData = JSON.parse(rawData);
                const records = fullJsonData.records;
                const fieldDescriptions = fullJsonData._field_descriptions;

                if (!records || records.length === 0) {
                    console.warn(`No records found in ${jsonFileName} or 'records' key is missing. Skipping this file.`);
                    break;
                }
                if (!fieldDescriptions) {
                    console.warn(`'_field_descriptions' key not found in ${jsonFileName}. Schema will use generic descriptions.`);
                }

                const firstRecord = records[0];
                const inferredFields = [];
                const scalarIndexCandidates = [];

                // --- Dynamic Schema Generation ---
                const allFieldNames = new Set(Object.keys(fieldDescriptions || {}));
                for (const record of records) {
                    for (const key in record) {
                        allFieldNames.add(key);
                    }
                }

                for (const fieldName of allFieldNames) {
                    const description = fieldDescriptions[fieldName] || `Inferred field: ${fieldName}.`;
                    const sampleValue = firstRecord[fieldName];

                    let milvusDataType = inferMilvusDataType(sampleValue);
                    let fieldDefinition = {
                        name: fieldName,
                        description: description,
                        data_type: milvusDataType
                    };

                    // IMPORTANT FIX: Do NOT mark the original JSON's primaryKeyField as `is_primary_key` here.
                    // The 'docId' field (added below) will be the ONLY Milvus primary key.
                    // The original 'id' field from JSON will simply be a regular scalar field in Milvus.
                    if (milvusDataType === DataType.VarChar) {
                        fieldDefinition.max_length = 8192;
                    }

                    inferredFields.push(fieldDefinition);

                    // Add to scalar index candidates, excluding special fields and the source primary key
                    if (fieldName !== "embedding" && fieldName !== "documentText" && fieldName !== "docId") {
                        scalarIndexCandidates.push({ name: fieldName, data_type: milvusDataType });
                    }
                }

                // Ensure 'docId' (the Milvus primary key), 'embedding', and 'documentText' fields are present.
                // 'docId' must be the ONLY field with `is_primary_key: true`.
                const docIdFieldExists = inferredFields.some(f => f.name === "docId");
                if (!docIdFieldExists) {
                    inferredFields.push({
                        name: "docId",
                        data_type: DataType.VarChar,
                        is_primary_key: true, // This is the SOLE primary key
                        max_length: 256,
                        auto_id: false,
                        description: "Unique identifier for each document/record in Milvus, derived from the JSON's primary key."
                    });
                }
                // Also ensure any previous `is_primary_key` flags are reset if they somehow got set for `docId`
                // in an earlier pass (though with the above logic, it shouldn't happen)
                inferredFields.forEach(f => {
                    if (f.name !== "docId" && f.is_primary_key) {
                        f.is_primary_key = false; // Ensure no other field is accidentally marked PK
                    }
                });

                const embeddingFieldExists = inferredFields.some(f => f.name === "embedding");
                if (!embeddingFieldExists) {
                    inferredFields.push({
                        name: "embedding",
                        data_type: DataType.FloatVector,
                        dim: EMBEDDING_DIMENSION,
                        description: "The vector embedding of the document content, used for semantic search."
                    });
                }

                const documentTextFieldExists = inferredFields.some(f => f.name === "documentText");
                if (!documentTextFieldExists) {
                    inferredFields.push({
                        name: "documentText",
                        data_type: DataType.VarChar,
                        max_length: 16384,
                        description: "A dynamically generated summary paragraph for each record, used for semantic search."
                    });
                }

                const COLLECTION_SCHEMA = {
                    collectionName: milvusCollectionName,
                    description: `Collection for ${milvusCollectionName} records with detailed field descriptions.`,
                    fields: inferredFields,
                    enableDynamicField: true
                };

                const llmSchemaFields = inferredFields.filter(f => !['docId', 'embedding', 'documentText'].includes(f.name));
                const summaryTemplate = await getApprovedSummaryTemplate(llmSchemaFields, firstRecord, milvusCollectionName, embeddingSourceField);
                if (!summaryTemplate) {
                    throw new Error(`No approved summary template for '${milvusCollectionName}'. Aborting ingestion.`);
                }

                // --- Robust Collection Creation and Existence Polling ---
                let collectionSuccessfullyCreated = false;
                const MAX_COLLECTION_CREATION_ATTEMPTS = 3;
                const MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS = 30;

                for (let createAttempt = 0; createAttempt < MAX_COLLECTION_CREATION_ATTEMPTS; createAttempt++) {
                    console.log(`\nAttempt ${createAttempt + 1} to create and verify collection '${milvusCollectionName}'...`);
                    try {
                        const hasCollection = await milvusClient.hasCollection({ collection_name: milvusCollectionName });

                        if (hasCollection.value) {
                            console.log(`Collection '${milvusCollectionName}' already exists. Dropping it to create a fresh one.`);
                            await milvusClient.dropCollection({ collection_name: milvusCollectionName });
                            await sleep(2000);
                            console.log(`Collection '${milvusCollectionName}' dropped.`);
                        }

                        console.log(`Creating collection '${milvusCollectionName}' with dynamic schema...`);
                        console.log("Final COLLECTION_SCHEMA being sent to Milvus:", JSON.stringify(COLLECTION_SCHEMA, null, 2));
                        await milvusClient.createCollection({
                            collection_name: COLLECTION_SCHEMA.collectionName,
                            fields: COLLECTION_SCHEMA.fields,
                            description: COLLECTION_SCHEMA.description,
                            enableDynamicField: COLLECTION_SCHEMA.enableDynamicField
                        });
                        console.log(`Collection '${milvusCollectionName}' creation command sent successfully.`);
                        await sleep(2000);

                        let collectionConfirmedToExist = false;
                        for (let i = 0; i < MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS; i++) {
                            try {
                                const checkExistence = await milvusClient.hasCollection({ collection_name: milvusCollectionName });
                                if (checkExistence.value) {
                                    console.log(`Collection '${milvusCollectionName}' confirmed to exist.`);
                                    collectionConfirmedToExist = true;
                                    break;
                                } else {
                                    console.log(`Collection '${milvusCollectionName}' not yet confirmed to exist. Retrying hasCollection... (${i + 1}/${MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS})`);
                                }
                            } catch (checkError) {
                                console.warn(`Warning during collection existence check for '${milvusCollectionName}': ${checkError.message}. Retrying hasCollection...`);
                            }
                            await sleep(POLLING_INTERVAL_MS);
                        }

                        if (collectionConfirmedToExist) {
                            collectionSuccessfullyCreated = true;
                            console.log(`Collection '${milvusCollectionName}' successfully created and verified.`);
                            break;
                        } else {
                            throw new Error(`Collection '${milvusCollectionName}' could not be confirmed to exist after creation command.`);
                        }
                    } catch (error) {
                        console.error(`Error in collection creation/verification attempt ${createAttempt + 1} for '${milvusCollectionName}': ${error.message}`);
                        if (createAttempt < MAX_COLLECTION_CREATION_ATTEMPTS - 1) {
                            console.log("Retrying collection creation after 5 seconds...");
                            await sleep(5000);
                        } else {
                            throw new Error(`Failed to create and verify collection '${milvusCollectionName}' after ${MAX_COLLECTION_CREATION_ATTEMPTS} attempts.`);
                        }
                    }
                }

                if (!collectionSuccessfullyCreated) {
                    throw new Error(`Collection '${milvusCollectionName}' creation failed after multiple attempts. Cannot proceed.`);
                }

                // --- Generate documentText, Embeddings and Insert Data ---
                console.log(`Generating documentText, embeddings and inserting ${records.length} entities into '${milvusCollectionName}'...`);
                const entities = [];
                for (const record of records) {
                    const primaryId = record[primaryKeyField];
                    if (primaryId === undefined || primaryId === null) {
                        console.warn(`[WARN] Record missing primary key field '${primaryKeyField}'. Skipping record:`, JSON.stringify(record));
                        continue;
                    }

                    const generatedDocumentText = fillTemplate(summaryTemplate, record);
                    let embedding;
                    try {
                        embedding = await embeddings.embedQuery(generatedDocumentText);
                    } catch (embedError) {
                        console.error(`[ERROR] Failed to generate embedding for record ${primaryId} in '${milvusCollectionName}': ${embedError.message}. Skipping this record.`);
                        continue;
                    }

                    const entity = {
                        docId: String(primaryId), // Correctly maps JSON's ID to Milvus's docId
                        embedding: embedding,
                        documentText: generatedDocumentText
                    };

                    // Add all other fields dynamically from the record
                    for (const key in record) {
                        // Ensure we don't add docId twice if the original primaryKeyField was already 'docId'
                        // Or if the original primaryKeyField is explicitly called 'id' but we want 'docId' as Milvus PK
                        if (key !== "docId") {
                            entity[key] = (record[key] === null || record[key] === undefined) ? "" :
                                          (typeof record[key] === 'object' && !Array.isArray(record[key])) ? JSON.stringify(record[key]) :
                                          Array.isArray(record[key]) ? JSON.stringify(record[key]) :
                                          record[key];
                        }
                    }
                    entities.push(entity);
                }

                if (entities.length === 0) {
                    console.warn(`No valid entities to insert into '${milvusCollectionName}'. Moving to next file.`);
                    successfulIngestion = true;
                    continue;
                }

                // Insert data in batches for large datasets
                const BATCH_SIZE = 1000;
                for (let i = 0; i < entities.length; i += BATCH_SIZE) {
                    const batch = entities.slice(i, i + BATCH_SIZE);
                    console.log(`Inserting batch ${Math.floor(i / BATCH_SIZE) + 1} for '${milvusCollectionName}' (items ${i} to ${Math.min(i + BATCH_SIZE, entities.length)})...`);
                    await milvusClient.insert({
                        collection_name: milvusCollectionName,
                        fields_data: batch
                    });
                }
                console.log(`Data insertion complete for '${milvusCollectionName}'. ${entities.length} entities inserted.`);

                console.log(`Flushing collection '${milvusCollectionName}'...`);
                await milvusClient.flushSync({ collection_names: [milvusCollectionName] });
                console.log(`Collection '${milvusCollectionName}' flushed.`);

                const stats = await milvusClient.getCollectionStatistics({ collection_name: milvusCollectionName });
                console.log(`Collection '${milvusCollectionName}' stats after flush:`, stats);
                const actualRowCount = stats.stats.find(s => s.key === 'row_count')?.value;

                if (actualRowCount !== String(entities.length)) {
                    throw new Error(`Flush incomplete for '${milvusCollectionName}': Expected ${entities.length} rows, got ${actualRowCount || 'undefined'}`);
                }
                console.log(`Collection '${milvusCollectionName}' flushed with ${actualRowCount} rows.`);

                console.log("Waiting 5 seconds after flush before creating indexes...");
                await sleep(5000);

                // --- Create and Verify Indexes ---
                await createAndVerifyVectorIndex(milvusClient, milvusCollectionName);

                for (const field of scalarIndexCandidates) {
                    let indexType;
                    if (field.data_type === DataType.VarChar) {
                        indexType = "INVERTED";
                    } else if ([DataType.Int64, DataType.Float, DataType.Double, DataType.Bool, DataType.Int8, DataType.Int16, DataType.Int32].includes(field.data_type)) {
                        indexType = "BITMAP";
                    } else {
                        console.warn(`Skipping scalar index for '${field.name}' in '${milvusCollectionName}': Unsupported data type for scalar index '${field.data_type}'.`);
                        continue;
                    }

                    console.log(`Creating scalar index on '${field.name}' (Milvus Type: ${field.data_type}, Index: ${indexType}) for '${milvusCollectionName}'...`);
                    try {
                        const fieldExistsInSchema = COLLECTION_SCHEMA.fields.some(f => f.name === field.name);
                        if (!fieldExistsInSchema) {
                            console.warn(`Skipping scalar index for '${field.name}' in '${milvusCollectionName}': field not found in final schema.`);
                            continue;
                        }
                        await milvusClient.createIndex({
                            collection_name: milvusCollectionName,
                            field_name: field.name,
                            index_type: indexType
                        });
                        console.log(`Scalar index on '${field.name}' for '${milvusCollectionName}' created successfully.`);
                    } catch (error) {
                        console.warn(`Warning: Could not create scalar index on '${field.name}' for '${milvusCollectionName}': ${error.message}`);
                    }
                }

                console.log(`Loading collection '${milvusCollectionName}' into memory for search...`);
                await milvusClient.loadCollection({ collection_name: milvusCollectionName });
                console.log(`Collection '${milvusCollectionName}' loaded.`);

                successfulIngestion = true;

            } catch (error) {
                console.error(`\n--- Ingestion Attempt ${processAttempt} Failed for '${milvusCollectionName}' ---`);
                console.error(error.message);
                if (processAttempt < MAX_PROCESS_RETRIES) {
                    console.log(`Retrying full ingestion process for '${milvusCollectionName}' in 15 seconds...`);
                    await sleep(15000);
                } else {
                    console.error(`All ingestion attempts failed for '${milvusCollectionName}'. Moving to next collection (if any).`);
                }
            }
        }
        if (!successfulIngestion) {
            console.error(`Critical: Failed to ingest data for '${milvusCollectionName}' after all retries.`);
        }
    }

    console.log("\n--- All specified JSON files processed. ---");
    milvusClient.closeConnection();
    process.exit(0);
}

ingestAllData();