// src/tools/scalarQueryTool.js
const { Tool } = require('@langchain/core/tools');
// Remove direct import of milvusClient, as it will be passed via constructor
// const { milvusClient } = require('../config/milvusClient');
const { z } = require('zod'); // For defining the tool's input schema

const BATCH_SIZE = 10000; // Define a reasonable batch size for pagination

class ScalarQueryToolObject extends Tool {
    // --- MODIFICATION START ---
    // Make constructor dynamic to receive milvusClient and loadedCollectionsSet
    constructor(milvusClientInstance, loadedCollectionsSet) {
        super();
        this.milvusClient = milvusClientInstance; // Store the Milvus client instance
        this.loadedCollections = loadedCollectionsSet; // Store the Set of loaded collections
        this.name = "scalar_query_tool";
        this.description = `
        Performs a precise scalar query (metadata filtering) on a specified Milvus collection.
        This tool is designed to retrieve ALL records that strictly match the provided 'filter' expression.
        It is ideal for getting a complete dataset based on exact conditions on structured fields,
        such as specific names, IDs, statuses, or date ranges. This tool *always* fetches all matching records
        by internally paginating results, making it suitable for very large datasets without a fixed large limit.

        Input should be a JSON string with the following properties:
        {
            "collection_name": string,  // REQUIRED: The exact name of the Milvus collection to query (e.g., 'schools', 'students', 'leaves').
            "filter": string,           // REQUIRED: A Milvus boolean expression string to filter results.
                                        // Use field names from 'schema_tool' output for the specified collection.
            "outputFields": string[]    // (Optional) An array of field names to return for each matching record.
                                        // Use field names from 'schema_tool' output for the specified collection.
        }

        The 'filter' string MUST adhere to Milvus boolean expression syntax.
        Dates for filtering should be converted to Unix timestamps (seconds since epoch).
        Boolean values in filters should be 'true' or 'false' (lowercase).
        `;
    }

    // Update the schema to include collection_name as a required input
    schema = z.object({
        collection_name: z.string().describe("The exact name of the Milvus collection to query (e.g., 'schools', 'students', 'leaves'). This is REQUIRED."),
        filter: z.string().describe("A Milvus boolean expression string to filter results (e.g., 'studentName == \"Tina Garcia\"'). This is REQUIRED."),
        outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record."),
    });

    async _call(input) {
        const { collection_name, filter, outputFields } = input; // Destructure collection_name

        if (!collection_name) {
            return "Error: 'collection_name' parameter is required for scalar_query_tool.";
        }
        if (!filter) {
            return "Error: 'filter' parameter is required for scalar_query_tool.";
        }

        // Check if the requested collection is loaded before attempting the query
        if (!this.loadedCollections.has(collection_name)) {
            return `Error: Collection '${collection_name}' is not loaded into Milvus memory. Please ensure it's loaded before querying.`;
        }

        try {
            console.log(`[ScalarQueryTool] Input: ${JSON.stringify(input)}`);

            const allResults = [];
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const queryParams = {
                    collection_name: collection_name, // Use the dynamic collection_name
                    filter: filter,
                    output_fields: outputFields,
                    limit: BATCH_SIZE,
                    offset: offset,
                };

                console.log(`[ScalarQueryTool] Fetching batch for '${collection_name}' with offset: ${offset}, limit: ${BATCH_SIZE}`);
                console.log("[ScalarQueryTool] Full query parameters sent to Milvus:", JSON.stringify(queryParams, null, 2));

                // Use the passed milvusClient instance
                const results = await this.milvusClient.query(queryParams);

                console.log("[ScalarQueryTool] Raw Milvus results received for batch:", JSON.stringify(results, null, 2));

                if (results && results.data && results.data.length > 0) {
                    allResults.push(...results.data);
                    offset += results.data.length; // Increment offset by the number of records fetched
                    hasMore = results.data.length === BATCH_SIZE; // If fetched less than BATCH_SIZE, no more records
                    console.log(`[ScalarQueryTool] Fetched ${results.data.length} records in this batch for '${collection_name}'. Total records so far: ${allResults.length}`);
                } else {
                    hasMore = false; // No more data
                    console.log(`[ScalarQueryTool] No more records found for '${collection_name}' in this batch.`);
                }
            }

            console.log(`[ScalarQueryTool] Finished fetching all records for '${collection_name}'. Total: ${allResults.length}`);

            if (allResults.length > 0) {
                return JSON.stringify(allResults, null, 2); // Return the collected 'data' array
            } else {
                return `No results found for filter: '${filter}' in collection: '${collection_name}'.`; // More informative message
            }

        } catch (error) {
            console.error(`[ScalarQueryTool] Error during Milvus scalar query for '${collection_name}' (pagination):`, error);
            return `Error performing Milvus scalar query for '${collection_name}': ${error.message}. Please check the filter syntax or Milvus connection.`;
        }
    }
}
// --- MODIFICATION END ---

module.exports = ScalarQueryToolObject;