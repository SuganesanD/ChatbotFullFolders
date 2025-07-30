// src/tools/vectorSearchTool.js
const { Tool } = require('@langchain/core/tools');
const { z } = require('zod'); // For defining the tool's input schema

// --- MODIFICATION START ---
// Remove direct imports and global initializations for milvusClient and embeddings
// as they are now passed via the constructor from server.js -> langchainAgent.js
// const { milvusClient } = require('../config/milvusClient');
// const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
// require('dotenv').config();
// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// const embeddings = new GoogleGenerativeAIEmbeddings({...});
// const COLLECTION_NAME = 'dynamicRecords'; // No longer hardcoded
// --- MODIFICATION END ---

/**
 * VectorSearchTool extends LangChain's Tool class to provide an interface
 * for performing vector similarity searches (semantic search) and hybrid searches
 * in a Milvus collection using `milvusClient.search()`.
 *
 * It converts a natural language query to an embedding and performs a vector search.
 * It can also optionally apply scalar filtering for hybrid search.
 * This tool is best for finding semantically similar records or for broad queries.
 */
class VectorSearchTool extends Tool {
    // --- MODIFICATION START ---
    constructor(milvusClientInstance, embeddingsInstance, loadedCollectionsSet) {
        super();
        this.milvusClient = milvusClientInstance; // Store the Milvus client instance
        this.embeddings = embeddingsInstance;     // Store the embeddings instance
        this.loadedCollections = loadedCollectionsSet; // Store the Set of loaded collections
        this.name = "vector_search_tool";

        // Update the description to be dynamic and guide the LLM
        this.description = `
        Performs vector similarity search (semantic search) or hybrid search in a specified Milvus collection.
        Use this tool when the user's query is about semantic similarity, finding conceptually related records,
        or when combining semantic search with structured filters. This tool uses 'milvusClient.search()'.

        Input should be a JSON string with the following properties:
        {
            "collection_name": string,  // REQUIRED: The exact name of the Milvus collection to search (e.g., 'schools', 'students', 'leaves').
            "queryText": string,        // REQUIRED: The natural language query string to semantically search for.
            "filter": string,           // (Optional) A Milvus boolean expression string to apply scalar filtering.
                                        // Use field names from 'schema_tool' output for the specified collection.
                                        // Example: "studentName == 'Derick Jones' AND leaveType == 'Sick Leave'"
            "outputFields": string[],   // (Optional) An array of field names to return for each matching record.
                                        // Use field names from 'schema_tool' output for the specified collection.
                                        // If not provided, a default set of relevant fields (such as 'id', 'text', 'embedding') will be returned.
            "topK": number              // (Optional) The maximum number of results to return. Defaults to 10.
                                        // Set to 1 for single most relevant result.
        }

        The 'filter' string must adhere to Milvus boolean expression syntax.
        Boolean values in filters should be 'true' or 'false' (lowercase).
        `;
    }

    // Update the schema to include collection_name as a required input
    schema = z.object({
        collection_name: z.string().describe("The exact name of the Milvus collection to search (e.g., 'schools', 'students', 'leaves'). This is REQUIRED."),
        queryText: z.string().describe("The natural language query string for semantic search."),
        filter: z.string().optional().describe("A Milvus boolean expression string to filter results (e.g., 'studentName == \"John Doe\"')."),
        outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record."),
        topK: z.number().optional().default(10).describe("The maximum number of results to return (default 10)."),
    });

    async _call(input) {
        const { collection_name, queryText, filter, topK, outputFields } = input;

        if (!collection_name) {
            return "Error: 'collection_name' parameter is required for vector_search_tool.";
        }
        if (!queryText) {
            return "Error: 'queryText' parameter is required for vector_search_tool.";
        }

        // Check if the requested collection is loaded before attempting the search
        if (!this.loadedCollections.has(collection_name)) {
            return `Error: Collection '${collection_name}' is not loaded into Milvus memory. Please ensure it's loaded before searching.`;
        }

        try {
            console.log(`[VectorSearchTool] Input: ${JSON.stringify(input)}`);

            // Use the embeddings instance passed in the constructor
            const queryEmbedding = await this.embeddings.embedQuery(queryText);

            const searchParams = {
                collection_name: collection_name, // Use the dynamic collection_name
                vectors: [queryEmbedding],
                limit: topK,
                // If outputFields are not provided by the agent, a minimal default set
                // or a collection-specific default might be necessary.
                // For now, if outputFields is undefined, Milvus's default (usually primary key + vector) will apply.
                // The agent's prompt now explicitly mentions it should provide outputFields.
                output_fields: outputFields || [], // Let Milvus return defaults if not specified
                search_params: {
                    anns_field: "embedding", // Assumes your vector field is named 'embedding'
                    metric_type: "COSINE",   // Assumes COSINE similarity
                    topk: topK,
                    params: JSON.stringify({ nprobe: 4 }) // Adjust nprobe based on index and performance needs
                },
                expr: filter || ""
            };

            console.log("[VectorSearchTool] Full search parameters sent to Milvus:", JSON.stringify(searchParams, null, 2));
            // Use the milvusClient instance passed in the constructor
            const results = await this.milvusClient.search(searchParams);
            console.log("[VectorSearchTool] Raw Milvus results received:", JSON.stringify(results, null, 2));

            if (results && results.status && results.status.error_code === "Success" && results.results && results.results.length > 0) {
                const hits = results.results;
                console.log(`[VectorSearchTool] Found ${hits.length} results for '${collection_name}'.`);
                return JSON.stringify(hits, null, 2);
            } else {
                console.log(`[VectorSearchTool] No results found or unexpected response structure for '${collection_name}'.`);
                return `No results found for query: '${queryText}' in collection: '${collection_name}'.`; // More informative message
            }

        } catch (error) {
            console.error(`[VectorSearchTool] Error during Milvus vector search for '${collection_name}':`, error);
            return `Error performing Milvus vector search for '${collection_name}': ${error.message}. Please check the query, filter syntax, or Milvus connection.`;
        }
    }
}
// --- MODIFICATION END ---

module.exports = VectorSearchTool;