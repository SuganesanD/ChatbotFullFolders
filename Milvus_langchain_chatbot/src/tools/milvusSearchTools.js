    // src/tools/milvusSearchTool.js
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
     * MilvusSearchTool extends LangChain's Tool class to provide an interface
     * for searching and filtering data in a Milvus collection.
     *
     * The tool takes a natural language query, an optional Milvus filter expression,
     * and a list of desired output fields. It converts the query to an embedding
     * and performs a vector search with scalar filtering.
     */
    class MilvusSearchTool extends Tool {
        // The name of the tool, used by the LLM to refer to it
        name = "milvus_search_tool";

        // A detailed description of the tool's capabilities and its inputs.
        // This description is crucial for the LLM to understand when and how to use this tool.
        // It explains what the tool does, its parameters, and the expected format.
        description = `
        A tool for searching and filtering records in the Milvus 'dynamicRecords' collection.
        This tool performs a hybrid search, combining semantic vector search with structured scalar filtering.

        It is useful for retrieving specific data based on natural language queries combined with precise conditions on record fields.

        Input should be a JSON string with the following properties:
        {
            "queryText": string, // The natural language query string to semantically search for.
            "filter": string,    // (Optional) A Milvus boolean expression string to filter results.
                                 // Example filters:
                                 // "studentName == 'Derick Jones'"
                                 // "leaveType == 'Sick Leave' and studentGradeLevel >= 10"
                                 // "schoolCity == 'Springfield' and leaveIsEmergency == true"
                                 // "leaveStartDateUnix > 1672531200 and leaveEndDateUnix < 1704067200" (Unix timestamps)
                                 // Use correct field names as provided in the schema.
            "outputFields": string[], // (Optional) An array of field names to return for each matching record.
                                      // If not provided, a default set of relevant fields will be returned.
                                      // Example: ["studentName", "leaveType", "leaveReasonText", "schoolName"]
            "topK": number       // (Optional) The maximum number of results to return. Defaults to 10.
        }

        The 'filter' string must adhere to Milvus boolean expression syntax.
        Dates for filtering should be converted to Unix timestamps (seconds since epoch).
        Boolean values in filters should be 'true' or 'false' (lowercase).
        `;

        // Define the input schema for the tool using Zod.
        // This helps LangChain validate the inputs provided by the LLM.
        schema = z.object({
            queryText: z.string().describe("The natural language query string for semantic search."),
            filter: z.string().optional().describe("A Milvus boolean expression string to filter results."),
            outputFields: z.array(z.string()).optional().describe("An array of field names to return for each matching record."),
            topK: z.number().int().optional().default(10).describe("The maximum number of results to return."),
        });

        // The core logic of the tool: how it interacts with Milvus
        async _call(input) {
            const { queryText, filter, outputFields, topK } = input;

            try {
                // Generate embedding for the query text
                const queryEmbedding = await embeddings.embedQuery(queryText);

                // Define search parameters for Milvus
                const searchParams = {
                    collection_name: COLLECTION_NAME,
                    vectors: [queryEmbedding], // The vector to search with
                    limit: topK,                // Number of nearest neighbors to return
                    output_fields: outputFields || [ // Default output fields if not specified
                        "docId", "documentText", "leaveId", "leaveType", "leaveStatus",
                        "studentName", "studentGradeLevel", "schoolName", "leaveReasonText",
                        "leaveStartDateUnix", "leaveEndDateUnix", "leaveIsEmergency"
                    ],
                    // Search parameters for the HNSW index
                    search_params: {
                        anns_field: "embedding", // The vector field to search on
                        metric_type: "COSINE",   // Must match the index metric type
                        params: JSON.stringify({ ef: 10 }) // HNSW specific search parameter
                    },
                    // Apply scalar filter if provided
                    expr: filter || "" // Milvus filter expression
                };

                console.log(`Milvus Search Tool: Executing search with queryText: "${queryText}", filter: "${filter || 'none'}", outputFields: ${JSON.stringify(searchParams.output_fields)}`);

                // Perform the search in Milvus
                const results = await milvusClient.search(searchParams);

                // Milvus search results structure: results.results[0].hits
                if (results && results.results && results.results[0] && results.results[0].hits) {
                    const hits = results.results[0].hits;
                    console.log(`Milvus Search Tool: Found ${hits.length} results.`);
                    // Return the hits as a JSON string for the LLM to parse
                    return JSON.stringify(hits, null, 2);
                } else {
                    console.log("Milvus Search Tool: No results found or unexpected response structure.");
                    return "No results found.";
                }

            } catch (error) {
                console.error("Error in MilvusSearchTool:", error);
                // Return an error message for the LLM to handle
                return `Error performing Milvus search: ${error.message}. Please check the filter syntax or Milvus connection.`;
            }
        }
    }

    module.exports = MilvusSearchTool;
    