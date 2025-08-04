const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../../src/config/milvusClient');
const { z } = require('zod'); // Import z for schema definition

/**
 * A Langchain Tool to list all available Milvus collections along with their descriptions.
 * This helps the LLM decide which collection is most relevant to a user's query.
 */
class CollectionSelectorTool extends Tool {
    // The name the LLM will use to refer to this tool
    name = "collection_selector_tool";
    // A clear description of what the tool does and its expected input/output
    description = "Useful for listing all available Milvus collections and their descriptions. Input is always an empty JSON object: {}. Returns a JSON array of objects, each with 'collection_name' and 'description'.";

    constructor() {
        super();
    }

    // Explicitly define the schema for the tool's input
    // This tells Langchain that the tool expects an empty object as input.
    schema = z.object({}); 

    /**
     * The core logic of the tool. It lists collections and fetches their descriptions.
     * @param {object} input - Expected to be an empty object `{}`.
     * @returns {Promise<string>} A JSON string representing an array of collections with names and descriptions.
     */
    async _call(input) { // 'input' here will correctly be an empty object {}
        try {
            // List all collections in the current database context
            const listCollectionsResponse = await milvusClient.showCollections({});
            
            if (listCollectionsResponse.status.error_code !== 'Success') {
                throw new Error(`Failed to list collections: ${listCollectionsResponse.status.reason}`);
            }

            const collections = listCollectionsResponse.data;
            const collectionsWithDescriptions = [];

            // Iterate through each collection to get its detailed description
            for (const collection of collections) {
                // Correctly access the collection name using 'collection.name'
                const currentCollectionName = collection?.name; // Changed from collection?.collection_name

                if (typeof currentCollectionName !== 'string' || currentCollectionName.trim() === '') {
                    console.warn(`[CollectionSelectorTool] Skipping invalid collection entry (missing or empty name):`, collection);
                    continue; // Skip this entry if the name is not a valid string
                }

                let description = `Collection for storing ${currentCollectionName} related data.`; // Default description

                try {
                    // Attempt to fetch the actual collection description from Milvus schema
                    const descResponse = await milvusClient.describeCollection({ collection_name: currentCollectionName });
            
                    
                    if (descResponse.status?.error_code === 'Success' && descResponse.schema?.description) {
                        description = descResponse.schema.description;
                    }
                } catch (descError) {
                    // Log a warning if description fetching fails, but don't stop the process
                    console.warn(`[CollectionSelectorTool] Could not fetch detailed description for collection '${currentCollectionName}': ${descError.message}`);
                }

                collectionsWithDescriptions.push({
                    collection_name: currentCollectionName,
                    description: description
                });
            }

            console.log("collectionwith description:" ,collectionsWithDescriptions);
            

            // Return the result as a JSON string
            return JSON.stringify(collectionsWithDescriptions);
        } catch (error) {
            console.error("[CollectionSelectorTool] Error in _call method:", error);
            // Return an error message as a JSON string
            return JSON.stringify({ error: error.message, message: "Failed to retrieve collection information." });
        }
    }
}

module.exports = CollectionSelectorTool;
