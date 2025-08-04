const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../../src/config/milvusClient');
const { z } = require('zod');

const BATCH_SIZE = 10000; // Define a reasonable batch size for pagination

class ScalarQueryTool extends Tool {
    constructor() {
        super();
        this.name = "scalar_query_tool";
        this.description = "Useful for filtering, retrieving, and counting records in a specific Milvus collection. " +
                           "This tool is designed to retrieve ALL records that strictly match the provided 'filter' expression, " +
                           "or all records if the filter is for a general retrieval. " +
                           "It internally paginates results to fetch complete datasets. " +
                           "Input should be a JSON object with 'collection_name' (string, mandatory), " +
                           "'filter' (string, optional, Milvus DSL format, e.g., 'field == \"value\"' or 'field LIKE \"%value%\"'). " +
                           "For queries without specific conditions (e.g., 'list all records'), use a filter like '(docId != \"\")'. " +
                           "'output_fields' (array of strings, optional, fields to return), " +
                           "'operation' (string, optional, 'count' to get total count matching filter). " +
                           "If 'operation' is 'count', 'output_fields' is ignored, and only the count of matching records is returned. " +
                           "Always specify the 'collection_name' that was identified as most relevant by the collection_selector_tool. " +
                           "For VARCHAR fields in text-based queries, always use LIKE with wildcards ('%'). " +
                           "For multiple conditions, each individual condition must be enclosed in its own set of parentheses when using and/or/not (use in lowercase). " +
                           "Example: {\"collection_name\": \"my_collection\", \"filter\": \"(name LIKE \\\"%john%\\\") and (age > 30)\", \"output_fields\": [\"name\", \"age\"]}. " +
                           "For counting: {\"collection_name\": \"my_collection\", \"filter\": \"(status == \\\"active\\\")\", \"operation\": \"count\"}. " ;
    }

    // Define the schema for the tool's input
    schema = z.object({
        collection_name: z.string().describe("The name of the Milvus collection to query."),
        filter: z.string().optional().describe("Milvus DSL filter expression (e.g., 'field == \"value\"' or 'field LIKE \"%value%\"'). For all records, use '(docId != \"\")'."),
        output_fields: z.array(z.string()).optional().describe("Array of field names to return in the results."),
        operation: z.enum(["count"]).optional().describe("Set to 'count' to return only the count of matching records."),
    });

    /**
     * The core logic of the tool. It queries the specified Milvus collection.
     * @param {object} input - An object containing collection_name, filter, output_fields, and operation.
     * @returns {Promise<string>} A JSON string representing the query results or count.
     */
    async _call(input) {
        const { collection_name, filter = "", output_fields = [], operation } = input;

        if (!collection_name) {
            const errorMessage = "Error: 'collection_name' is required for scalar_query_tool.";
            console.error(`[ScalarQueryTool] ${errorMessage}`);
            return JSON.stringify({ error: errorMessage });
        }

        try {
            console.log(`[ScalarQueryTool] Querying collection '${collection_name}'... (assuming it is already loaded)`);

            const allResults = [];
            let offset = 0;
            let hasMore = true;

            // Determine output fields for the query based on operation type
            const fieldsToFetch = operation === "count" ? ["docId"] : (output_fields.length > 0 ? output_fields : ["docId"]); // Default to docId if no output_fields for non-count

            while (hasMore) {
                const queryParams = {
                    collection_name: collection_name,
                    filter: filter,
                    output_fields: fieldsToFetch,
                    limit: BATCH_SIZE,
                    offset: offset,
                };

                console.log(`[ScalarQueryTool] Fetching batch with offset: ${offset}, limit: ${BATCH_SIZE} for collection '${collection_name}'`);
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

            if (operation === "count") {
                return JSON.stringify({ count: allResults.length });
            } else {
                if (allResults.length > 0) {
                    return JSON.stringify(allResults, null, 2);
                } else {
                    return "No results found.";
                }
            }

        } catch (error) {
            console.error(`[ScalarQueryTool] Error during Milvus scalar query (pagination) for collection '${collection_name}':`, error);
            return JSON.stringify({ error: `Error performing Milvus scalar query for collection '${collection_name}': ${error.message}. Please check the filter syntax or Milvus connection.` });
        } finally {
            console.log(`[ScalarQueryTool] Finished operation on '${collection_name}'. (Collection release handled externally)`);
        }
    }
}

module.exports = ScalarQueryTool;
