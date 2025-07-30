const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { milvusClient, DataType } = require('../src/config/milvusClient');
const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');
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

// Helper function to create and verify vector index
async function createAndVerifyVectorIndex(client, collectionName) {
    console.log(`Creating vector index on 'embedding' with IVF_FLAT...`);
    const indexRes = await client.createIndex({
        collection_name: collectionName,
        field_name: "embedding",
        index_name: "embedding_index",
        index_type: "IVF_FLAT",
        metric_type: "COSINE",
        params: { nlist: 4 }
    });
    console.log(`Create index response:`, JSON.stringify(indexRes, null, 2));

    let attempts = 0;
    const maxAttempts = 60;
    const delayMs = 1000;
    while (attempts < maxAttempts) {
        try {
            const res = await client.describeIndex({
                collection_name: collectionName,
                index_name: "embedding_index"
            });
            console.log(`Index description:`, JSON.stringify(res, null, 2));
            if (res.status?.error_code === "Success" && res.index_descriptions?.[0]) {
                console.log(`Vector index on 'embedding' is built or recognized.`);
                return true;
            }
            console.log(`Index not ready (attempt ${attempts + 1}):`, res.status);
        } catch (error) {
            console.log(`Attempt ${attempts + 1}: describeIndex failed - ${error.message}`);
        }
        await sleep(delayMs);
        attempts++;
    }
    throw new Error(`Index on 'embedding' not found or not ready after ${maxAttempts} attempts.`);
}

async function ingestData() {
    const MAX_PROCESS_RETRIES = 3;
    let processAttempt = 0;
    const POLLING_INTERVAL_MS = 1000;

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
            const inferredFields = [];
            const scalarIndexCandidates = [];

            // Build schema using fieldDescriptions
            for (const fieldName in fieldDescriptions) {
                const description = fieldDescriptions[fieldName] || `Inferred field: ${fieldName}`;
                const value = firstRecord[fieldName];

                let milvusDataType;
                let fieldDefinition = {
                    name: fieldName,
                    description: description // Use description directly
                };

                // Special handling for known fields
                if (fieldName === "docId") {
                    milvusDataType = DataType.VarChar;
                    fieldDefinition.is_primary_key = true;
                    fieldDefinition.max_length = 128;
                    fieldDefinition.auto_id = false;
                } else if (fieldName === "embedding") {
                    milvusDataType = DataType.FloatVector;
                    fieldDefinition.dim = 768;
                } else if (fieldName === "documentText") {
                    milvusDataType = DataType.VarChar;
                    fieldDefinition.max_length = 8192;
                } else {
                    milvusDataType = inferMilvusDataType(value);
                    if (milvusDataType === DataType.VarChar) {
                        fieldDefinition.max_length = 8192;
                    }
                    if (value === null) {
                        fieldDefinition.is_nullable = true;
                    }
                }

                fieldDefinition.data_type = milvusDataType;

                if (!Object.values(DataType).includes(milvusDataType)) {
                    console.error(`[Schema Inference ERROR] Inferred Milvus DataType for field '${fieldName}' is invalid: ${milvusDataType}. Defaulting to DataType.VarChar.`);
                    fieldDefinition.data_type = DataType.VarChar;
                    fieldDefinition.max_length = 8192;
                }

                inferredFields.push(fieldDefinition);

                if (fieldName !== "docId" && fieldName !== "embedding" && fieldName !== "documentText") {
                    scalarIndexCandidates.push({ name: fieldName, data_type: milvusDataType });
                }
            }

            // Ensure required fields are present
            const ensureField = (name, type, dim, maxLength, isPrimaryKey, autoId, desc) => {
                if (!inferredFields.some(f => f.name === name)) {
                    const fieldDef = {
                        name: name,
                        data_type: type,
                        description: fieldDescriptions[name] || desc
                    };
                    if (dim) fieldDef.dim = dim;
                    if (maxLength) fieldDef.max_length = maxLength;
                    if (isPrimaryKey !== undefined) fieldDef.is_primary_key = isPrimaryKey;
                    if (autoId !== undefined) fieldDef.auto_id = autoId;
                    inferredFields.push(fieldDef);
                }
            };

            ensureField("docId", DataType.VarChar, null, 128, true, false, "Unique identifier for each document/record.");
            ensureField("embedding", DataType.FloatVector, 768, null, false, false, "The vector embedding of the document content, used for semantic search.");
            ensureField("documentText", DataType.VarChar, null, 8192, false, false, "A dynamically generated summary paragraph for each record, used for semantic search.");

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

            // Robust Collection Creation and Existence Polling
            let collectionSuccessfullyCreated = false;
            const MAX_COLLECTION_CREATION_ATTEMPTS = 5;
            const MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS = 30;

            for (let createAttempt = 0; createAttempt < MAX_COLLECTION_CREATION_ATTEMPTS; createAttempt++) {
                console.log(`\nAttempt ${createAttempt + 1} to create and verify collection '${COLLECTION_NAME}'...`);
                try {
                    console.log(`Checking if collection '${COLLECTION_NAME}' exists...`);
                    const hasCollection = await milvusClient.hasCollection({ collection_name: COLLECTION_NAME });

                    if (hasCollection.value) {
                        console.log(`Collection '${COLLECTION_NAME}' already exists. Dropping it to create a fresh one.`);
                        await milvusClient.dropCollection({ collection_name: COLLECTION_NAME });
                        await sleep(2000);
                        console.log(`Collection '${COLLECTION_NAME}' dropped.`);
                    }

                    console.log(`Creating collection '${COLLECTION_NAME}' with dynamic schema...`);
                    console.log("Final COLLECTION_SCHEMA being sent to Milvus:", JSON.stringify(COLLECTION_SCHEMA, null, 2));
                    await milvusClient.createCollection({
                        collection_name: COLLECTION_SCHEMA.collectionName,
                        fields: COLLECTION_SCHEMA.fields,
                        description: COLLECTION_SCHEMA.description,
                        enableDynamicField: COLLECTION_SCHEMA.enableDynamicField
                    });
                    console.log(`Collection '${COLLECTION_NAME}' creation command sent successfully.`);
                    await sleep(2000);

                    let collectionConfirmedToExist = false;
                    for (let i = 0; i < MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS; i++) {
                        try {
                            const checkExistence = await milvusClient.hasCollection({ collection_name: COLLECTION_NAME });
                            if (checkExistence.value) {
                                console.log(`Collection '${COLLECTION_NAME}' confirmed to exist.`);
                                collectionConfirmedToExist = true;
                                break;
                            } else {
                                console.log(`Collection '${COLLECTION_NAME}' not yet confirmed to exist. Retrying hasCollection... (${i + 1}/${MAX_COLLECTION_EXISTENCE_POLLING_ATTEMPTS})`);
                            }
                        } catch (checkError) {
                            console.warn(`Warning during collection existence check: ${checkError.message}. Retrying hasCollection...`);
                        }
                        await sleep(POLLING_INTERVAL_MS);
                    }

                    if (collectionConfirmedToExist) {
                        collectionSuccessfullyCreated = true;
                        console.log(`Collection '${COLLECTION_NAME}' successfully created and verified.`);
                        break;
                    } else {
                        throw new Error(`Collection '${COLLECTION_NAME}' could not be confirmed to exist after creation command.`);
                    }
                } catch (error) {
                    console.error(`Error in collection creation/verification attempt ${createAttempt + 1}: ${error.message}`);
                    if (createAttempt < MAX_COLLECTION_CREATION_ATTEMPTS - 1) {
                        console.log("Retrying collection creation after 5 seconds...");
                        await sleep(5000);
                    } else {
                        throw new Error(`Failed to create and verify collection '${COLLECTION_NAME}' after ${MAX_COLLECTION_CREATION_ATTEMPTS} attempts.`);
                    }
                }
            }

            if (!collectionSuccessfullyCreated) {
                throw new Error("Collection creation failed after multiple attempts.");
            }

            console.log(`Generating documentText, embeddings and inserting ${records.length} entities...`);
            const entities = [];
            let docIdCounter = 1;

            for (const record of records) {
                const currentDocId = record.docId || `AUTO_DOC_${docIdCounter++}`;
                record.docId = currentDocId;
                const generatedDocumentText = fillTemplate(summaryTemplate, record);
                record.documentText = generatedDocumentText;
                const embedding = await embeddings.embedQuery(record.documentText);
                const entity = {
                    docId: record.docId,
                    embedding: embedding,
                    documentText: record.documentText
                };
                for (const key in record) {
                    if (key !== "docId" && key !== "documentText" && key !== "embedding") {
                        entity[key] = record[key] === null ? "" : record[key];
                    }
                }
                entities.push(entity);
            }

            await milvusClient.insert({
                collection_name: COLLECTION_NAME,
                fields_data: entities
            });
            console.log(`Data ingestion complete. ${entities.length} entities inserted.`);

            console.log(`Flushing collection '${COLLECTION_NAME}'...`);
            await milvusClient.flushSync({ collection_names: [COLLECTION_NAME] });

            const stats = await milvusClient.getCollectionStatistics({ collection_name: COLLECTION_NAME });
            console.log(`Collection stats after flush:`, stats);
            const actualRowCount = stats.stats.find(s => s.key === 'row_count')?.value;

            if (actualRowCount !== String(records.length)) {
                throw new Error(`Flush incomplete: Expected ${records.length} rows, got ${actualRowCount || 'undefined'}`);
            }
            console.log(`Collection '${COLLECTION_NAME}' flushed with ${actualRowCount} rows.`);

            console.log("Waiting 5 seconds after flush before creating indexes...");
            await sleep(5000);

            await createAndVerifyVectorIndex(milvusClient, COLLECTION_NAME);

            for (const field of scalarIndexCandidates) {
                let indexType;
                if (field.data_type === DataType.VarChar) {
                    indexType = "INVERTED";
                } else if ([DataType.Int64, DataType.Float, DataType.Double, DataType.Bool].includes(field.data_type)) {
                    indexType = "BITMAP";
                } else {
                    console.warn(`Skipping scalar index for '${field.name}': Unsupported data type.`);
                    continue;
                }

                console.log(`Creating scalar index on '${field.name}' (Milvus Type: ${field.data_type}, Index: ${indexType})...`);
                try {
                    const fieldExists = COLLECTION_SCHEMA.fields.some(f => f.name === field.name);
                    if (!fieldExists) {
                        console.warn(`Skipping scalar index for '${field.name}': field not found in schema.`);
                        continue;
                    }
                    await milvusClient.createIndex({
                        collection_name: COLLECTION_NAME,
                        field_name: field.name,
                        index_type: indexType
                    });
                    console.log(`Scalar index on '${field.name}' created successfully.`);
                } catch (error) {
                    console.warn(`Warning: Could not create scalar index on '${field.name}': ${error.message}`);
                }
            }

            console.log(`Loading collection '${COLLECTION_NAME}' into memory for search...`);
            await milvusClient.loadCollection({ collection_name: COLLECTION_NAME });
            console.log(`Collection '${COLLECTION_NAME}' loaded.`);

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