// const { Tool } = require('@langchain/core/tools');
// const { z } = require('zod');

// const BATCH_SIZE = 10000; // Define a reasonable batch size for pagination

// class ScalarQueryTool extends Tool {
//     constructor({ milvusClient }) {
//         super();
//         this.milvusClient = milvusClient;
//         this.name = "scalar_query_tool";
//         this.description = `
//     Performs a precise scalar query (metadata filtering) on a specified Milvus collection.
//     This tool retrieves ALL records that strictly match the provided 'filter' expression.
//     It is ideal for getting a complete dataset based on exact conditions on structured fields,
//     such as specific names, IDs, statuses, or date ranges. It fetches all matching records
//     by internally paginating results, making it suitable for very large datasets without a fixed large limit.

//     Input must be a JSON string with the following properties:
//     {
//         "collection_name": string, // REQUIRED: The name of the Milvus collection to query (e.g., "students").
//         "filter": string,          // REQUIRED: A Milvus boolean expression to filter results (e.g., '(name LIKE "%John%")').
//         "outputFields": string[]   // Optional: An array of field names to return for each matching record.
//     }

//     The 'filter' string MUST adhere to Milvus boolean expression syntax:
//     - Use 'LIKE' with wildcards ('%') for VARCHAR fields (e.g., '(field LIKE "%value%")').
//     - Use lowercase 'and', 'or', 'not' for logical operators, with each condition in parentheses.
//     - Use double quotes for string values (e.g., 'field == "value"').
//     - Dates should be Unix timestamps (seconds since epoch).
//     - Boolean values should be 'true' or 'false' (lowercase).
//     Use field names from 'schema_tool' output.
//     `;
//         this.schema = z.object({
//             collection_name: z.string().describe("The name of the Milvus collection to query"),
//             filter: z.string().describe("A Milvus boolean expression to filter results (e.g., '(studentName == \"Tina Garcia\")')"),
//             outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record")
//         });
//     }

//     async _call(input) {
//         try {
//             // Parse and validate input
//             const parsedInput = this.schema.parse(input);
//             const { collection_name, filter, outputFields = [] } = parsedInput;

//             if (!filter) {
//                 return "Error: 'filter' parameter is required for scalar_query_tool.";
//             }

//             console.log(`[ScalarQueryTool] Input: ${JSON.stringify(parsedInput)}`);

//             // Handle query with pagination
//             const allResults = [];
//             let offset = 0;
//             let hasMore = true;

//             while (hasMore) {
//                 const queryParams = {
//                     collection_name,
//                     filter,
//                     output_fields: outputFields,
//                     limit: BATCH_SIZE,
//                     offset
//                 };

//                 console.log(`[ScalarQueryTool] Fetching batch with offset: ${offset}, limit: ${BATCH_SIZE}`);
//                 console.log("[ScalarQueryTool] Full query parameters sent to Milvus:", JSON.stringify(queryParams, null, 2));

//                 const results = await this.milvusClient.query(queryParams);

//                 console.log("[ScalarQueryTool] Raw Milvus results received for batch:", JSON.stringify(results, null, 2));

//                 if (results && results.data && results.data.length > 0) {
//                     allResults.push(...results.data);
//                     offset += results.data.length; // Increment offset by the number of records fetched
//                     hasMore = results.data.length === BATCH_SIZE; // If fetched less than BATCH_SIZE, no more records
//                     console.log(`[ScalarQueryTool] Fetched ${results.data.length} records in this batch. Total records so far: ${allResults.length}`);
//                 } else {
//                     hasMore = false; // No more data
//                     console.log("[ScalarQueryTool] No more records found in this batch.");
//                 }
//             }

//             console.log(`[ScalarQueryTool] Finished fetching all records. Total: ${allResults.length}`);

//             if (allResults.length > 0) {
//                 return JSON.stringify(allResults, null, 2); // Return the collected 'data' array
//             } else {
//                 return "No results found.";
//             }
//         } catch (error) {
//             console.error("[ScalarQueryTool] Error during Milvus scalar query:", error);
//             return `Error performing Milvus scalar query: ${error.message}. Please check the filter syntax or Milvus connection.`;
//         }
//     }
// }

// module.exports = ScalarQueryTool;

const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');

const BATCH_SIZE = 10000;

class ScalarQueryTool extends Tool {
  constructor({ milvusClient }) {
    super();
    this.milvusClient = milvusClient;
    this.name = 'scalar_query_tool';
    this.description =
      'Performs a precise scalar query (metadata filtering) on a Milvus collection. ' +
      'The collection name must be provided in the input as "collection_name". ' +
      'Provide a Milvus boolean expression as "filter" and optionally "outputFields".';
    this.schema = z.object({
      collection_name: z.string().describe('The name of the Milvus collection to query.'),
      filter: z.string().describe('A Milvus boolean expression to filter results (e.g., "(field LIKE \"%value%\")").'),
      outputFields: z.array(z.string()).optional().describe('Optional: list of fields to return.'),
    }).strict();
  }

  async _call(input) {
    try {
      // Normalize and validate input
      let parsedInput = {};
      if (typeof input === 'string') {
        if (input.trim() !== '') {
          try {
            parsedInput = JSON.parse(input);
          } catch {
            throw new Error('Invalid JSON input. Input must be a valid JSON string or object.');
          }
        }
      } else if (typeof input === 'object' && input !== null) {
        parsedInput = input;
      } else {
        throw new Error('Input must be a valid JSON string or object.');
      }

      // Validate input schema
      const { collection_name, filter, outputFields = [] } = this.schema.parse(parsedInput);

      if (!collection_name || collection_name.trim() === '') {
        throw new Error("Missing or empty required field: 'collection_name'.");
      }
      if (!filter || filter.trim() === '') {
        throw new Error("Missing or empty required field: 'filter'.");
      }

      // Log input details
      console.log(`[ScalarQueryTool] Using collection: '${collection_name}'`);
      console.log(`[ScalarQueryTool] Filter: "${filter}"`);
      console.log(`[ScalarQueryTool] Output Fields: ${outputFields.length > 0 ? outputFields.join(', ') : 'None (all fields)'}`);

      // Verify collection exists
      const hasCollection = await this.milvusClient.hasCollection({ collection_name });
      if (!hasCollection.value) {
        console.error(`[ScalarQueryTool] Collection '${collection_name}' does not exist`);
        return `Error: Collection '${collection_name}' does not exist in Milvus.`;
      }

      // Validate filter syntax
      if (filter.includes("'")) {
        console.warn(`[ScalarQueryTool] Single quotes detected in filter: "${filter}". Replacing with double quotes.`);
        parsedInput.filter = filter.replace(/'/g, '"');
      }

      const allResults = [];
      let offset = 0;
      let hasMore = true;
      const maxRetries = 3;

      while (hasMore) {
        const queryParams = {
          collection_name,
          filter: parsedInput.filter || filter,
          output_fields: outputFields.length > 0 ? outputFields : undefined,
          limit: BATCH_SIZE,
          offset,
        };

        // Perform query with retry
        let results;
        let attempts = 0;
        while (attempts < maxRetries) {
          try {
            results = await this.milvusClient.query(queryParams);
            break;
          } catch (error) {
            attempts++;
            if (attempts >= maxRetries) {
              throw new Error(`Failed to query collection '${collection_name}' after ${maxRetries} attempts: ${error.message}`);
            }
            console.warn(`[ScalarQueryTool] Retry ${attempts}/${maxRetries} for query on '${collection_name}': ${error.message}`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        if (results?.data?.length > 0) {
          allResults.push(...results.data);
          offset += results.data.length;
          hasMore = results.data.length === BATCH_SIZE;
        } else {
          hasMore = false;
        }
      }

      if (allResults.length === 0) {
        console.log(`[ScalarQueryTool] No results found in '${collection_name}' for filter: "${filter}"`);
        return `No results found in collection '${collection_name}' for filter: "${filter}"`;
      }

      console.log(`[ScalarQueryTool] Retrieved ${allResults.length} records from '${collection_name}'.`);
      return JSON.stringify(allResults, null, 2);

    } catch (error) {
      console.error(`[ScalarQueryTool] Error for collection '${parsedInput.collection_name || 'unknown'}': ${error.message}`);
      return `Error performing scalar query: ${error.message}`;
    }
  }
}

module.exports = ScalarQueryTool;
