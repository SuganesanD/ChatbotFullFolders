// src/tools/scalarQueryTool.js
const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../config/milvusClient'); // Import our Milvus client
const { z } = require('zod'); // For defining the tool's input schema

// Define the name of the Milvus collection we are interacting with
const COLLECTION_NAME = 'dynamicRecords';
const BATCH_SIZE = 10000; // Define a reasonable batch size for pagination


class ScalarQueryTool extends Tool {
    name = "scalar_query_tool";

    description = `
    Performs a precise scalar query (metadata filtering) on the Milvus 'dynamicRecords' collection.
    This tool is designed to retrieve ALL records that strictly match the provided 'filter' expression.
    It is ideal for getting a complete dataset based on exact conditions on structured fields,
    such as specific names, IDs, statuses, or date ranges. This tool *always* fetches all matching records
    by internally paginating results, making it suitable for very large datasets without a fixed large limit.

    Input should be a JSON string with the following properties:
    {
        "filter": string,    // A Milvus boolean expression string to filter results. This is REQUIRED.
                             // Use field names from 'schema_tool' output.
        "outputFields": string[] // (Optional) An array of field names to return for each matching record.
                                 // Use field names from 'schema_tool' output.
                                 // If not provided, a default set of relevant fields will be returned.
    }

    The 'filter' string MUST adhere to Milvus boolean expression syntax.
    Dates for filtering should be converted to Unix timestamps (seconds since epoch).
    Boolean values in filters should be 'true' or 'false' (lowercase).
    `;

    schema = z.object({
        filter: z.string().describe("A Milvus boolean expression string to filter results (e.g., 'studentName == \"Tina Garcia\"'). This is REQUIRED."),
        outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record."),
    });

    async _call(input) {
        const { filter, outputFields } = input;

        if (!filter) {
            return "Error: 'filter' parameter is required for scalar_query_tool.";
        }

        try {
            console.log(`[ScalarQueryTool] Input: ${JSON.stringify(input)}`);

            const allResults = [];
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const queryParams = {
                    collection_name: COLLECTION_NAME,
                    filter: filter,
                    output_fields: outputFields,
                    limit: BATCH_SIZE,
                    offset: offset,
                };

                console.log(`[ScalarQueryTool] Fetching batch with offset: ${offset}, limit: ${BATCH_SIZE}`);
                console.log("[ScalarQueryTool] Full query parameters sent to Milvus:", JSON.stringify(queryParams, null, 2));

                const results = await milvusClient.query(queryParams);

                console.log("[ScalarQueryTool] Raw Milvus results received for batch:", JSON.stringify(results, null, 2));

                if (results && results.data && results.data.length > 0) {
                    allResults.push(...results.data);
                    offset += results.data.length; // Increment offset by the number of records fetched
                    hasMore = results.data.length === BATCH_SIZE; // If fetched less than BATCH_SIZE, no more records
                    console.log(`[ScalarQueryTool] Fetched ${results.data.length} records in this batch. Total records so far: ${allResults.length}`);
                } else {
                    hasMore = false; // No more data
                    console.log("[ScalarQueryTool] No more records found in this batch.");
                }
            }

            console.log(`[ScalarQueryTool] Finished fetching all records. Total: ${allResults.length}`);

            if (allResults.length > 0) {
                return JSON.stringify(allResults, null, 2); // Return the collected 'data' array
            } else {
                return "No results found.";
            }

        } catch (error) {
            console.error("[ScalarQueryTool] Error during Milvus scalar query (pagination):", error);
            return `Error performing Milvus scalar query: ${error.message}. Please check the filter syntax or Milvus connection.`;
        }
    }
}

module.exports = ScalarQueryTool;
