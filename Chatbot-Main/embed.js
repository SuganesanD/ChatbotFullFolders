const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { DataType } = require('@zilliz/milvus2-sdk-node');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { CohereEmbeddings } = require("@langchain/cohere");

const { v4: uuid } = require('uuid');

// const fs = require('fs');   
// const readline = require('readline');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// Initialize embedding model
const geminiEmbeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: GOOGLE_API_KEY,
    model: "gemini-embedding-001",
    outputDimensionality: 768,
});

const cohereEmbeddings = new CohereEmbeddings({
    apiKey: process.env.COHERE_API_KEY, // your Cohere API key
    model: "embed-english-v3.0",        // or "embed-multilingual-v3.0"
});

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



async function embed(jsonData, milvusClient) {

    const MAX_PROCESS_RETRIES = 3;
    let processAttempt = 0;
    console.log("before******************************************");
    console.log("jsonData:", jsonData);

    let inputJson = JSON.parse(jsonData);
    console.log(JSON.stringify(inputJson));


    console.log("after*******************************************");

    // let database=inputJson.database;
    let collection = inputJson.collection;
    let Records = inputJson.records;
    // let sessionId=inputJson.sessionId;
    let modal = inputJson.modal;
    let template = inputJson.template;
    let FieldDescription = inputJson.fieldDescriptions;

    const embeddings = modal === 'gemini' ? geminiEmbeddings : cohereEmbeddings





    while (processAttempt < MAX_PROCESS_RETRIES) {
        processAttempt++;
        console.log(`\n--- Overall Ingestion Attempt ${processAttempt} of ${MAX_PROCESS_RETRIES} ---`);
        try {

            if (!Records || Records.length === 0) {
                console.warn("No records found in sampleRecords.json or 'records' key is missing. Exiting ingestion.");
                return;
            }
            if (!FieldDescription) {
                console.warn("'_field_descriptions' key not found in sampleRecords.json. Schema will use generic descriptions.");
            }

            const firstRecord = Records[0];

            // --- REVISED: Build Schema and Index Parameters upfront, starting with special fields ---
            const inferredFields = [
                // Always include the special RAG fields
                { name: "docId", data_type: DataType.VarChar, max_length: 128, is_primary_key: true, auto_id: false, description: "Unique identifier for each document/record." },
                { name: "embedding", data_type: DataType.FloatVector, dim: 768, description: "The vector embedding of the document content, used for semantic search." },
                { name: "documentText", data_type: DataType.VarChar, max_length: 8192, description: "A dynamically generated summary paragraph for each record, used for semantic search." }
            ];

            const indexParams = [
                // Always include the special RAG field indexes
                { field_name: "docId", index_name: "docId_index", index_type: "INVERTED", "mmap.enabled": true },
                { field_name: "documentText", index_name: "documentText_index", index_type: "INVERTED", "mmap.enabled": true },
                { field_name: "embedding", index_name: "embedding_index", index_type: "DISKANN", metric_type: "COSINE" },
            ];

            // Now, infer additional fields from the data
            for (const fieldName in FieldDescription) {
                // Skip the special RAG fields as they are already defined
                if (["docId", "embedding", "documentText"].includes(fieldName)) {
                    continue;
                }

                const description = FieldDescription[fieldName] || `Inferred field: ${fieldName}`;
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
                collectionName: collection,
                // description: "Collection for student leave records and school information with detailed field descriptions.",
                fields: inferredFields,
                enableDynamicField: true
            };

            const summaryTemplate = template
            if (!summaryTemplate) {
                console.error("No approved summary template. Exiting ingestion.");
                process.exit(1);
            }

            // --- Phase 2: Create collection and indexes, then upsert data ---
            const hasCollection = await milvusClient.hasCollection({ collection_name: collection });
            if (hasCollection.value) {
                console.log(`Collection '${collection}' already exists. Dropping it.`);
                await milvusClient.dropCollection({ collection_name: collection });
                await sleep(2000);
            }

            console.log(`\nCreating collection '${collection}' with schema...`);
            await milvusClient.createCollection({
                collection_name: COLLECTION_SCHEMA.collectionName,
                fields: COLLECTION_SCHEMA.fields,
                enableDynamicField: COLLECTION_SCHEMA.enableDynamicField,
            });
            // description: COLLECTION_SCHEMA.description,

            console.log(`Collection '${collection}' created.`);
            await sleep(2000);

            // Create all indexes *before* upserting data
            console.log(`Creating all indexes for '${collection}'...`);
            for (const param of uniqueIndexParams) {
                console.log(`Creating index on '${param.field_name}' (type: ${param.index_type})...`);
                try {
                    await milvusClient.createIndex({
                        collection_name: collection,
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

            console.log(`Generating documentText, embeddings and upserting ${Records.length} entities...`);
            const entities = [];
            let i = 1;
            for (const record of Records) {
                const currentDocId = record.docId || uuid.v4();
                record.docId = currentDocId;
                const generatedDocumentText = fillTemplate(summaryTemplate, record);
                record.documentText = generatedDocumentText;
                let embedding = await embeddings.embedQuery(record.documentText);
                console.log(`embeddings of ${i} record- ${embedding}`);

                // Truncate embedding to 768 dimensions and normalize
                if (embedding.length === 3072) {
                    console.log(`Truncating 3072-dimensional embedding to 768 dimensions for record ${i}`);
                    embedding = embedding.slice(0, 768);
                    // Normalize vector for IP metric
                    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
                    if (magnitude === 0) throw new Error(`Cannot normalize zero vector for record ${i}`);
                    embedding = embedding.map(val => val / magnitude);
                }
                if (embedding.length !== 768) {
                    throw new Error(`Vector dimension mismatch for record ${i}: expected 768, got ${embedding.length}`);
                }

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
                collection_name: collection,
                fields_data: entities
            });

            if (upsertResponse.status.error_code === "Success") {
                console.log(`✅ Upsert operation successful.`);
            } else {
                throw new Error(`Upsert operation failed: ${upsertResponse.status.reason}`);
            }

            console.log(`Flushing collection '${collection}' to persist data...`);
            const flushResponse = await milvusClient.flushSync({ collection_names: [collection] });
            if (flushResponse.status.error_code === "Success") {
                console.log(`Collection '${collection}' flushed successfully.`);
            } else {
                throw new Error(`Flush operation failed: ${flushResponse.status.reason}`);
            }

            // This is still a necessary step to ensure the index building is complete
            await verifyIndexes(milvusClient, collection, uniqueIndexParams);

            console.log("Ingestion process complete. Data upserted and indexes are built and ready for use.");
            return "Ingestion process complete. Data upserted and indexes are built";

        } catch (error) {
            console.error(`\n--- Ingestion Attempt ${processAttempt} Failed ---`);
            console.error(error.message);
            if (processAttempt < MAX_PROCESS_RETRIES) {
                console.log(`Retrying full ingestion process in 15 seconds...`);
                await sleep(15000);
            } else {
                console.error("All ingestion attempts failed. Please check Milvus logs and configuration.");
                return "All ingestion attempts failed. Please check Milvus logs and configuration.";
            }
        }
    }
}

module.exports = { embed };
