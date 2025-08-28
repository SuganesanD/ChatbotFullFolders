// const { Tool } = require('@langchain/core/tools');
// const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
// const { z } = require('zod');

// // Load environment variables for the embedding model
// require('dotenv').config();
// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// if (!GOOGLE_API_KEY) {
//     console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
//     process.exit(1);
// }

// // Initialize the embedding model for converting query text to vectors
// const embeddings = new GoogleGenerativeAIEmbeddings({
//     apiKey: GOOGLE_API_KEY,
//     model: "embedding-001", // Must match the model used for ingestion (dim: 768)
// });

// class VectorSearchTool extends Tool {
//     constructor({ milvusClient }) {
//         super();
//         this.milvusClient = milvusClient;
//         this.name = "vector_search_tool";
//         this.description = `
//     Performs vector similarity search (semantic search) in a specified Milvus collection.
//     Use this tool when the user's query is about semantic similarity or finding conceptually related records.
//     This tool uses 'milvusClient.search()' to find up to 10 most relevant records based on the query text.

//     Input must be a JSON string with the following properties:
//     {
//         "collection_name": string, // REQUIRED: The name of the Milvus collection to query (e.g., "students").
//         "queryText": string,       // REQUIRED: The natural language query string for semantic search.
//         "outputFields": string[]   // Optional: An array of field names to return for each matching record.
//                                    // Use field names from 'schema_tool' output.
//                                    // If not provided, fields from 'schema_tool' should be used.
//     }
//     `;
//         this.schema = z.object({
//             collection_name: z.string().describe("The name of the Milvus collection to query"),
//             queryText: z.string().describe("The natural language query string for semantic search"),
//             outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record")
//         });
//     }

//     async _call(input) {
//         try {
//             // Parse and validate input
//             const parsedInput = this.schema.parse(input);
//             const { collection_name, queryText, outputFields } = parsedInput;

//             console.log(`[VectorSearchTool] Input: ${JSON.stringify(parsedInput)}`);

//             const queryEmbedding = await embeddings.embedQuery(queryText);

//             const searchParams = {
//                 collection_name,
//                 vectors: [queryEmbedding],
//                 limit: 10, // Default limit since topK is removed
//                 output_fields: outputFields || [], // Rely on schema_tool for defaults
//                 search_params: {
//                     anns_field: "embedding",
//                     metric_type: "COSINE",
//                     topk: 10,
//                 }
//             };

//             console.log("[VectorSearchTool] Full search parameters sent to Milvus:", JSON.stringify(searchParams, null, 2));
//             const results = await this.milvusClient.search(searchParams);
//             console.log("[VectorSearchTool] Raw Milvus results received:", JSON.stringify(results, null, 2));

//             if (results && results.status && results.status.error_code === "Success" && results.results && results.results.length > 0) {
//                 const hits = results.results;
//                 console.log(`[VectorSearchTool] Found ${hits.length} results.`);
//                 return JSON.stringify(hits, null, 2);
//             } else {
//                 console.log("[VectorSearchTool] No results found or unexpected response structure.");
//                 return "No results found.";
//             }
//         } catch (error) {
//             console.error("[VectorSearchTool] Error during Milvus vector search:", error);
//             return `Error performing Milvus vector search: ${error.message}. Please check the query or Milvus connection.`;
//         }
//     }
// }

// module.exports = VectorSearchTool;     


const { Tool } = require('@langchain/core/tools');
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { z } = require('zod');

// Load environment variables for the embedding model
require('dotenv').config();
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error('GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.');
  process.exit(1);
}

// Initialize the embedding model (global, reused for all requests)
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: GOOGLE_API_KEY,
  model: 'embedding-001', // Must match ingestion model
});

class VectorSearchTool extends Tool {
  constructor({ milvusClient }) {
    super();
    this.milvusClient = milvusClient;
    this.name = 'vector_search_tool';
    this.description =
      'Performs a semantic similarity (vector) search on a Milvus collection. ' +
      'The collection name must be provided in the input as "collection_name". ' +
      'Provide a natural language "queryText" and optionally "outputFields", "filter", and "topK". ' +
      'Returns the most similar records from the specified collection.';
    this.schema = z.object({
      collection_name: z.string().describe('The name of the Milvus collection to search.'),
      queryText: z.string().describe('The natural language query string for semantic search.'),
      outputFields: z.array(z.string()).optional().describe('Optional: list of fields to return for each result.'),
      filter: z.string().optional().describe('Optional: Milvus filter expression (e.g., "field LIKE \\"%value%\\"").'),
      topK: z.number().optional().default(10).describe('Optional: number of results to return (default: 10).'),
    }).strict(); // Reject unexpected fields
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
        } else {
          throw new Error('Input cannot be an empty string. Provide a JSON object with "collection_name", "queryText", and optional fields.');
        }
      } else if (typeof input === 'object' && input !== null) {
        parsedInput = input;
      } else {
        throw new Error('Input must be a valid JSON string or object.');
      }

      // Validate input schema
      const { collection_name, queryText, outputFields = [], filter = '', topK = 10 } = this.schema.parse(parsedInput);

      if (!collection_name || collection_name.trim() === '') {
        throw new Error("Missing or empty required field: 'collection_name'.");
      }
      if (!queryText || queryText.trim() === '') {
        throw new Error("Missing or empty required field: 'queryText'.");
      }

      // Log input details
      console.log(`[VectorSearchTool] Using collection: '${collection_name}'`);
      console.log(`[VectorSearchTool] Query Text: "${queryText}"`);
      console.log(`[VectorSearchTool] Filter: "${filter || 'None'}"`);
      console.log(`[VectorSearchTool] TopK: ${topK}`);
      console.log(`[VectorSearchTool] Output Fields: ${outputFields.length > 0 ? outputFields.join(', ') : 'None (all fields)'}`);

      // Verify collection exists
      const hasCollection = await this.milvusClient.hasCollection({ collection_name });
      if (!hasCollection.value) {
        console.error(`[VectorSearchTool] Collection '${collection_name}' does not exist`);
        return `Error: Collection '${collection_name}' does not exist in Milvus.`;
      }

      // Embed query
      let queryEmbedding;
      const maxRetries = 3;
      let attempts = 0;
      while (attempts < maxRetries) {
        try {
          queryEmbedding = await embeddings.embedQuery(queryText);
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxRetries) {
            throw new Error(`Failed to embed query after ${maxRetries} attempts: ${error.message}`);
          }
          console.warn(`[VectorSearchTool] Retry ${attempts}/${maxRetries} for embedding query: ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      // Validate filter syntax
      if (filter.includes("'")) {
        console.warn(`[VectorSearchTool] Single quotes detected in filter: "${filter}". Replacing with double quotes for Milvus compatibility.`);
        parsedInput.filter = filter.replace(/'/g, '"');
      }

      // Build search parameters
      const searchParams = {
        collection_name,
        vectors: [queryEmbedding],
        limit: topK,
        output_fields: outputFields.length > 0 ? outputFields : undefined,
        filter: parsedInput.filter || undefined,
        search_params: {
          anns_field: 'embedding', // Must match schema
          metric_type: 'COSINE',
          params: JSON.stringify({ nprobe: 10 }),
        },
      };

      console.log(`[VectorSearchTool] Search parameters:`, JSON.stringify(searchParams, null, 2));

      // Perform search with retry
      let results;
      attempts = 0;
      while (attempts < maxRetries) {
        try {
          results = await this.milvusClient.search(searchParams);
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxRetries) {
            throw new Error(`Failed to perform vector search on '${collection_name}' after ${maxRetries} attempts: ${error.message}`);
          }
          console.warn(`[VectorSearchTool] Retry ${attempts}/${maxRetries} for search on '${collection_name}': ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (results?.results?.length > 0) {
        console.log(`[VectorSearchTool] Found ${results.results.length} results in '${collection_name}'.`);
        return JSON.stringify(results.results, null, 2);
      } else {
        console.log(`[VectorSearchTool] No results found in '${collection_name}'.`);
        return `No results found in collection '${collection_name}' for query: "${queryText}"`;
      }

    } catch (error) {
      console.error(`[VectorSearchTool] Error for collection '${parsedInput.collection_name || 'unknown'}': ${error.message}`);
      return `Error performing vector search on collection '${parsedInput.collection_name || 'unknown'}': ${error.message}`;
    }
  }
}

module.exports = VectorSearchTool;