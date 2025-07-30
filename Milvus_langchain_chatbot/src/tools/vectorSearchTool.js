// src/tools/vectorSearchTool.js
const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../config/milvusClient'); // Import our Milvus client
const { GoogleGenerativeAIEmbeddings } = require('@langchain/google-genai');
const { z } = require('zod'); // For defining the tool's input schema

// Load environment variables for the embedding model
require('dotenv').config();
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
    console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// Initialize the embedding model for converting query text to vectors
const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: GOOGLE_API_KEY,
    model: "embedding-001", // Must match the model used for ingestion (dim: 768)
});

// Define the name of the Milvus collection we are interacting with
const COLLECTION_NAME = 'dynamicRecords';

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
    name = "vector_search_tool"; // Renamed tool name

    description = `
    Performs vector similarity search (semantic search) or hybrid search in the Milvus 'dynamicRecords' collection.
    Use this tool when the user's query is about semantic similarity, finding conceptually related records,
    or when combining semantic search with structured filters. This tool uses 'milvusClient.search()'.

    Input should be a JSON string with the following properties:
    {
        "queryText": string, // The natural language query string to semantically search for.
        "filter": string,    // (Optional) A Milvus boolean expression string to apply scalar filtering.
                             // Use field names from 'schema_tool' output.
                             // Example: "studentName == 'Derick Jones' AND leaveType == 'Sick Leave'"
        "outputFields": string[], // (Optional) An array of field names to return for each matching record.
                                 // Use field names from 'schema_tool' output.
                                 // If not provided, a default set of relevant fields will be returned.
        "topK": number       // (Optional) The maximum number of results to return. Defaults to 10.
                             // Set to 1 for single most relevant result.
    }

    The 'filter' string must adhere to Milvus boolean expression syntax.
    Boolean values in filters should be 'true' or 'false' (lowercase).
    `;

    schema = z.object({
        queryText: z.string().describe("The natural language query string for semantic search."),
        filter: z.string().optional().describe("A Milvus boolean expression string to filter results (e.g., 'studentName == \"John Doe\"')."),
        outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record."),
        topK: z.number().optional().default(10).describe("The maximum number of results to return (default 10)."),
    });

    async _call(input) {
        const { queryText, filter, topK, outputFields } = input;

        try {
            console.log(`[VectorSearchTool] Input: ${JSON.stringify(input)}`);

            const queryEmbedding = await embeddings.embedQuery(queryText);

            const searchParams = {
                collection_name: COLLECTION_NAME,
                vectors: [queryEmbedding],
                limit: topK,
                output_fields: outputFields || [
                    "docId", "documentText", "leaveId", "leaveType", "leaveStatus",
                    "studentName", "studentGradeLevel", "schoolName", "leaveReasonText",
                    "leaveStartDateUnix", "leaveEndDateUnix", "leaveIsEmergency",
                    "schoolEstablishedYear", "salary"
                ],
                search_params: {
                    anns_field: "embedding",
                    metric_type: "COSINE",
                    topk: topK,
                    params: JSON.stringify({ nprobe: 4 })
                },
                expr: filter || ""
            };

            console.log("[VectorSearchTool] Full search parameters sent to Milvus:", JSON.stringify(searchParams, null, 2));
            const results = await milvusClient.search(searchParams);
            console.log("[VectorSearchTool] Raw Milvus results received:", JSON.stringify(results, null, 2));

            if (results && results.status && results.status.error_code === "Success" && results.results && results.results.length > 0) {
                const hits = results.results;
                console.log(`[VectorSearchTool] Found ${hits.length} results.`);
                return JSON.stringify(hits, null, 2);
            } else {
                console.log("[VectorSearchTool] No results found or unexpected response structure.");
                return "No results found.";
            }

        } catch (error) {
            console.error("[VectorSearchTool] Error during Milvus vector search:", error);
            return `Error performing Milvus vector search: ${error.message}. Please check the filter syntax or Milvus connection.`;
        }
    }
}

module.exports = VectorSearchTool;
