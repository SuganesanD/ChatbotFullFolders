// milvus_direct_query.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Ensure .env is loaded from root

const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

// --- Configuration ---
const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS || 'localhost:19530'; // Default to localhost
const COLLECTION_NAME = 'dynamicRecords';

// --- Initialize Milvus Client ---
let milvusClient;
try {
    milvusClient = new MilvusClient({ address: MILVUS_ADDRESS });
    console.log("Milvus client initialized for direct query.");
} catch (error) {
    console.error("Failed to initialize Milvus client:", error);
    process.exit(1);
}

/**
 * Performs a direct query on the Milvus collection using a scalar filter.
 */
async function directMilvusQuery() {
    try {
        console.log(`Attempting to load collection '${COLLECTION_NAME}' into memory for query...`);
        // It's good practice to ensure the collection is loaded for queries too,
        // although for simple filters it might sometimes work without explicit load.
        await milvusClient.loadCollection({ collection_name: COLLECTION_NAME });
        console.log(`Collection '${COLLECTION_NAME}' loaded successfully for query.`);

        const filterExpression = `studentName == "Tina Garcia"`;
        const outputFields = ["docId", "studentName", "leaveReasonText", "leaveStatus"];

        console.log(`Executing direct Milvus query with filter: "${filterExpression}"`);
        console.log(`Requesting output fields: ${JSON.stringify(outputFields)}`);

        const queryResults = await milvusClient.query({
            collection_name: COLLECTION_NAME,
            expr: filterExpression,
            output_fields: outputFields,
            limit: 10 // Limit results, just in case
        });

        console.log("\n--- Direct Milvus Query Results ---");
        if (queryResults && queryResults.data && queryResults.data.length > 0) {
            console.log(`Found ${queryResults.data.length} record(s):`);
            queryResults.data.forEach((record, index) => {
                console.log(`Record ${index + 1}:`);
                console.log(JSON.stringify(record, null, 2));
            });
        } else {
            console.log("No records found matching the filter criteria.");
            console.log("Raw query response:", JSON.stringify(queryResults, null, 2));
        }

    } catch (error) {
        console.error("Error during direct Milvus query:", error);
    } finally {
        // You might want to release the collection if this is a one-off script
        // await milvusClient.releaseCollection({ collection_name: COLLECTION_NAME });
        // console.log(`Collection '${COLLECTION_NAME}' released.`);
    }
}

// Run the direct query
directMilvusQuery();
