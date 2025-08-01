const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../../src/config/milvusClient');
const { z } = require('zod');

class ScalarQueryTool extends Tool {
    constructor() {
        super();
        this.name = "scalar_query_tool";
        this.description = "Useful for filtering, retrieving, and counting records in a specific Milvus collection. " +
                           "Input should be a JSON object with 'collection_name' (string, mandatory), " +
                           "'filter' (string, optional, Milvus DSL format, e.g., 'field == \"value\"' or 'field LIKE \"%value%\"'), " +
                           "'output_fields' (array of strings, optional, fields to return), " +
                           "'operation' (string, optional, 'count' to get total count matching filter). " +
                           "If 'operation' is 'count', 'output_fields' is ignored. " +
                           "Always specify the 'collection_name' that was identified as most relevant by the collection_selector_tool. " +
                           "For VARCHAR fields in text-based queries, always use LIKE with wildcards ('%'). " +
                           "For multiple conditions, each individual condition must be enclosed in its own set of parentheses when using and/or/not (use in lowercase). " +
                           "Example: {\"collection_name\": \"my_collection\", \"filter\": \"(name LIKE \\\"%john%\\\") and (age > 30)\", \"output_fields\": [\"name\", \"age\"]}. " +
                           "For counting: {\"collection_name\": \"my_collection\", \"filter\": \"(status == \\\"active\\\")\", \"operation\": \"count\"}. " +
                           "Note: The collection must be loaded into Milvus memory externally before calling this tool, and released externally after use.";
    }

    // Define the schema for the tool's input
    schema = z.object({
        collection_name: z.string().describe("The name of the Milvus collection to query."),
        filter: z.string().optional().describe("Milvus DSL filter expression (e.g., 'field == \"value\"' or 'field LIKE \"%value%\"')."),
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
            // Loading is handled externally by the agent or server.js
            console.log(`[ScalarQueryTool] Querying collection '${collection_name}'... (assuming it is already loaded)`);

            let result;
            if (operation === "count") {
                console.log(`[ScalarQueryTool] Counting records in '${collection_name}' with filter: '${filter}'`);
                // For a filtered count, Milvus's query operation with a limit and then checking length is one way.
                // A more direct filtered count might require a specific Milvus API or iterating results.
                // For simplicity here, if operation is 'count', we'll get the collection statistics.
                const stats = await milvusClient.getCollectionStatistics({ collection_name: collection_name });
                const actualRowCount = stats.data.row_count; // Correct access as per Milvus advice
                result = { count: actualRowCount }; // Return the total count of the collection
                console.warn("[ScalarQueryTool] Note: 'count' operation currently returns total collection row count. For filtered counts, a more complex query or iteration might be needed.");
            } else {
                console.log(`[ScalarQueryTool] Querying collection '${collection_name}' with filter: '${filter}', output_fields: ${JSON.stringify(output_fields)}`);
                const queryRes = await milvusClient.query({
                    collection_name: collection_name,
                    filter: filter,
                    output_fields: output_fields,
                });
                result = queryRes.data;
            }

            console.log(`[ScalarQueryTool] Query result for '${collection_name}':`, JSON.stringify(result, null, 2));
            return JSON.stringify(result);

        } catch (error) {
            console.error(`[ScalarQueryTool] Error querying collection '${collection_name}':`, error.message);
            return JSON.stringify({ error: `Error querying collection '${collection_name}': ${error.message}` });
        } finally {
            // Releasing is handled externally by the agent or server.js
            console.log(`[ScalarQueryTool] Finished operation on '${collection_name}'. (Collection release handled externally)`);
        }
    }
}

module.exports = ScalarQueryTool;
