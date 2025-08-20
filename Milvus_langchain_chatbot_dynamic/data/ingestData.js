const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { milvusClient, DataType } = require('../src/config/milvusClient');
const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { v4: uuid } = require('uuid');

const fs = require('fs');   
const readline = require('readline');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// Initialize LLM for template generation
const chatModel = new ChatGoogleGenerativeAI({
    apiKey: GOOGLE_API_KEY,
    model: "gemini-2.0-flash",
    temperature: 0.1,
});

// Initialize embedding model
const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: GOOGLE_API_KEY,
    model: "embedding-001",
});

const COLLECTION_NAME = 'dynamicRecords';

// Helper function to introduce a delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to infer Milvus DataType from JavaScript type
function inferMilvusDataType(value) {
    if (value === null) {
        return DataType.VarChar;
    }
    switch (typeof value) {
        case 'string':
            return DataType.VarChar;
        case 'number':
            return Number.isInteger(value) ? DataType.Int64 : DataType.Float;
        case 'boolean':
            return DataType.Bool;
        case 'object':
            return DataType.VarChar;
        default:
            console.warn(`Unexpected JavaScript type '${typeof value}' for value:`, value, `. Defaulting to DataType.VarChar.`);
            return DataType.VarChar;
    }
}

// Function to generate a summary template using LLM and get user approval
async function getApprovedSummaryTemplate(inferredSchemaFields, firstRecord) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    let approvedTemplate = null;

    while (approvedTemplate === null) {
        console.log("\n--- Generating Summary Template with LLM ---");
        const schemaForLLM = inferredSchemaFields.map(f => ({
            name: f.name,
            description: f.description || `Inferred field: ${f.name} (Milvus type: ${f.data_type}).`
        }));

        const llmPrompt = `You are an expert data summarizer. Your task is to create a concise, human-readable summary template for a data record.
I will provide you with the schema (field names and their descriptions) and an example data record.
Your output should be a single paragraph that uses placeholders for the actual data values.
Use double curly braces for placeholders, like \`{{fieldName}}\`.
Ensure the summary covers the most important aspects of a record, focusing on what a user would typically ask about.
Consider how dates (Unix timestamps) and boolean values should be naturally expressed in the summary.
Do not include any introductory or concluding remarks, just the summary paragraph.

Schema (Field Names and Descriptions):
${JSON.stringify(schemaForLLM, null, 2)}

Example Record (first record from JSON, use its values to understand context):
${JSON.stringify(firstRecord, null, 2)}

Generate the summary template (e.g., "Student {{studentName}} from {{schoolName}} requested {{leaveType}} leave..."):`;

        try {
            const response = await chatModel.invoke(llmPrompt);
            const generatedTemplate = response.content;

            console.log("\nGenerated Summary Template:");
            console.log("------------------------------------------");
            console.log(generatedTemplate);
            console.log("------------------------------------------");

            const answer = await new Promise(resolve => {
                rl.question("Do you approve this template? (yes/no): ", input => {
                    resolve(input.toLowerCase());
                });
            });

            if (answer === 'yes') {
                approvedTemplate = generatedTemplate;
                console.log("Template approved. Proceeding with data ingestion.");
            } else if (answer === 'no') {
                console.log("Template rejected. Regenerating a new template...");
            } else {
                console.log("Invalid input. Please type 'yes' or 'no'. Regenerating...");
            }
        } catch (error) {
            console.error("Error generating template with LLM:", error);
            console.log("Attempting to regenerate template due to error...");
        }
    }
    rl.close();
    return approvedTemplate;
}

function fillTemplate(template, record) {
    let filledText = template;
    for (const key in record) {
        let value = record[key];
        if (key.endsWith('Unix') && typeof value === 'number' && value > 0) {
            try {
                value = new Date(value * 1000).toISOString().split('T')[0];
            } catch (e) {
                value = record[key];
            }
        } else if (typeof value === 'boolean') {
            value = value ? 'Yes' : 'No';
        } else if (value === null) {
            value = 'N/A';
        } else if (typeof value === 'object') {
            value = JSON.stringify(value);
        }
        filledText = filledText.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return filledText;
}

// Helper function to verify all indexes
async function verifyIndexes(client, collectionName, indexParams) {
    console.log(`Verifying all indexes for collection '${collectionName}'...`);
    let attempts = 0;
    const maxAttempts = 60;
    const delayMs = 1000;

    while (attempts < maxAttempts) {
        try {
            const statePromises = indexParams.map(param =>
                client.getIndexState({
                    collection_name: collectionName,
                    index_name: param.index_name
                }).then(res => ({
                    index_name: param.index_name,
                    state: res.state
                }))
            );

            const results = await Promise.all(statePromises);
            const allFinished = results.every(result => result.state === 'Finished');

            if (allFinished) {
                console.log(`All indexes for '${collectionName}' are finished and ready.`);
                return true;
            }

            const notFinished = results.filter(result => result.state !== 'Finished');
            console.log(`Indexes not finished (attempt ${attempts + 1}):`, notFinished.map(r => `${r.index_name} (state: ${r.state})`));

        } catch (error) {
            console.warn(`Warning during index state check (attempt ${attempts + 1}): ${error.message}`);
        }
        await sleep(delayMs);
        attempts++;
    }
    const notFinished = results.filter(result => result.state !== 'Finished');
    throw new Error(`Some indexes not finished after ${maxAttempts} attempts: ${notFinished.map(r => `${r.index_name} (state: ${r.state})`).join(', ')}`);
}

async function ingestData() {
    const MAX_PROCESS_RETRIES = 3;
    let processAttempt = 0;

    while (processAttempt < MAX_PROCESS_RETRIES) {
        processAttempt++;
        console.log(`\n--- Overall Ingestion Attempt ${processAttempt} of ${MAX_PROCESS_RETRIES} ---`);
        try {
            console.log('Loading sample data from sampleRecords.json...');
            const rawData = fs.readFileSync(path.join(__dirname, 'sampleRecords.json'));
            const fullJsonData = JSON.parse(rawData);
            const records = fullJsonData.records;
            const fieldDescriptions = fullJsonData._field_descriptions;

            if (!records || records.length === 0) {
                console.warn("No records found in sampleRecords.json or 'records' key is missing. Exiting ingestion.");
                return;
            }
            if (!fieldDescriptions) {
                console.warn("'_field_descriptions' key not found in sampleRecords.json. Schema will use generic descriptions.");
            }

            const firstRecord = records[0];
            
            // --- REVISED: Build Schema and Index Parameters upfront, starting with special fields ---
            const inferredFields = [
                // Always include the special RAG fields
                { name: "docId", data_type: DataType.VarChar, max_length: 128, is_primary_key: true, auto_id: false, description: "Unique identifier for each document/record." },
                { name: "embedding", data_type: DataType.FloatVector, dim: 768, description: "The vector embedding of the document content, used for semantic search." },
                { name: "documentText", data_type: DataType.VarChar, max_length: 8192, description: "A dynamically generated summary paragraph for each record, used for semantic search." }
            ];
            
            const indexParams = [
                // Always include the special RAG field indexes
                { field_name: "docId", index_name: "docId_index", index_type: "INVERTED","mmap.enabled": true },
                { field_name: "documentText", index_name: "documentText_index", index_type: "INVERTED" ,"mmap.enabled": true},
                { field_name: "embedding", index_name: "embedding_index", index_type: "DISKANN", metric_type: "COSINE" },
            ];

            // Now, infer additional fields from the data
            for (const fieldName in fieldDescriptions) {
                // Skip the special RAG fields as they are already defined
                if (["docId", "embedding", "documentText"].includes(fieldName)) {
                    continue;
                }

                const description = fieldDescriptions[fieldName] || `Inferred field: ${fieldName}`;
                const value = firstRecord[fieldName];

                let milvusDataType = inferMilvusDataType(value);
                let fieldDefinition = {
                    name: fieldName,
                    description: description,
                    data_type: milvusDataType,
                    "mmap.enabled": true
                };

                if (milvusDataType === DataType.VarChar) {
                    fieldDefinition.max_length = 8192;
                }
                if (value === null) {
                    fieldDefinition.is_nullable = true;
                }
                
                inferredFields.push(fieldDefinition);

                // Add scalar index for non-special fields
                let indexType;
                if (milvusDataType === DataType.VarChar) {
                    indexType = "INVERTED";
                } else if ([DataType.Int64, DataType.Float, DataType.Double, DataType.Bool].includes(milvusDataType)) {
                    indexType = "BITMAP";
                } else {
                    console.warn(`Skipping scalar index for '${fieldName}': Unsupported data type.`);
                    continue;
                }
                indexParams.push({
                    field_name: fieldName,
                    index_name: `${fieldName}_index`,
                    index_type: indexType
                });
            }

            // Filter out duplicate index params if any
            const uniqueIndexParams = indexParams.filter((v, i, a) => a.findIndex(t => t.index_name === v.index_name) === i);

            const COLLECTION_SCHEMA = {
                collectionName: COLLECTION_NAME,
                description: "Collection for student leave records and school information with detailed field descriptions.",
                fields: inferredFields,
                enableDynamicField: true
            };

            const summaryTemplate = await getApprovedSummaryTemplate(COLLECTION_SCHEMA.fields, firstRecord);
            if (!summaryTemplate) {
                console.error("No approved summary template. Exiting ingestion.");
                process.exit(1);
            }

            // --- Phase 2: Create collection and indexes, then upsert data ---
            const hasCollection = await milvusClient.hasCollection({ collection_name: COLLECTION_NAME });
            if (hasCollection.value) {
                console.log(`Collection '${COLLECTION_NAME}' already exists. Dropping it.`);
                await milvusClient.dropCollection({ collection_name: COLLECTION_NAME });
                await sleep(2000);
            }

            console.log(`\nCreating collection '${COLLECTION_NAME}' with schema...`);
            await milvusClient.createCollection({
                collection_name: COLLECTION_SCHEMA.collectionName,
                fields: COLLECTION_SCHEMA.fields,
                description: COLLECTION_SCHEMA.description,
                enableDynamicField: COLLECTION_SCHEMA.enableDynamicField,    
            });

            console.log(`Collection '${COLLECTION_NAME}' created.`);
            await sleep(2000);

            // Create all indexes *before* upserting data
            console.log(`Creating all indexes for '${COLLECTION_NAME}'...`);
            for (const param of uniqueIndexParams) {
                console.log(`Creating index on '${param.field_name}' (type: ${param.index_type})...`);
                try {
                    await milvusClient.createIndex({
                        collection_name: COLLECTION_NAME,
                        field_name: param.field_name,
                        index_name: param.index_name,
                        index_type: param.index_type,
                        metric_type: param.metric_type,
                        params: param.params
                    });
                    console.log(`Index '${param.index_name}' created successfully.`);
                } catch (error) {
                    if (error.message.includes('index already exist')) {
                        console.warn(`Warning: Index '${param.index_name}' already exists.`);
                    } else {
                        console.warn(`Warning: Could not create index '${param.index_name}': ${error.message}`);
                    }
                }
            }

            console.log(`Generating documentText, embeddings and upserting ${records.length} entities...`);
            const entities = [];
            let i=0;
            for (const record of records) {
                const currentDocId = record.docId || uuid.v4();
                record.docId = currentDocId;
                const generatedDocumentText = fillTemplate(summaryTemplate, record);
                record.documentText = generatedDocumentText;
                const embedding = await embeddings.embedQuery(record.documentText);
                const entity = {
                    docId: record.docId,
                    embedding: embedding,
                    documentText: record.documentText,
                    ...Object.keys(record).reduce((obj, key) => {
                        if (key !== "docId" && key !== "documentText" && key !== "embedding") {
                            obj[key] = record[key] === null ? "" : record[key];
                        }
                        return obj;
                    }, {})
                };
                entities.push(entity);
                console.log(`Record ${i} is embedded ✅`);
                i++;
            }
            const upsertResponse = await milvusClient.upsert({
                collection_name: COLLECTION_NAME,
                fields_data: entities
            });

            if (upsertResponse.status.error_code === "Success") {
                console.log(`✅ Upsert operation successful.`);
            } else {
                throw new Error(`Upsert operation failed: ${upsertResponse.status.reason}`);
            }

            console.log(`Flushing collection '${COLLECTION_NAME}' to persist data...`);
            const flushResponse = await milvusClient.flushSync({ collection_names: [COLLECTION_NAME] });
            if (flushResponse.status.error_code === "Success") {
                console.log(`Collection '${COLLECTION_NAME}' flushed successfully.`);
            } else {
                throw new Error(`Flush operation failed: ${flushResponse.status.reason}`);
            }
            
            // This is still a necessary step to ensure the index building is complete
            await verifyIndexes(milvusClient, COLLECTION_NAME, uniqueIndexParams);
            
            console.log("Ingestion process complete. Data upserted and indexes are built and ready for use.");
            return;

        } catch (error) {
            console.error(`\n--- Ingestion Attempt ${processAttempt} Failed ---`);
            console.error(error.message);
            if (processAttempt < MAX_PROCESS_RETRIES) {
                console.log(`Retrying full ingestion process in 15 seconds...`);
                await sleep(15000);
            } else {
                console.error("All ingestion attempts failed. Please check Milvus logs and configuration.");
                process.exit(1);
            }
        }
    }
}

ingestData();
