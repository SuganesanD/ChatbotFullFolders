const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../../src/config/milvusClient'); // Corrected path from '../config/milvusClient'
const { z } = require('zod');

class SchemaTool extends Tool {
    constructor() {
        super();
        this.name = "schema_tool";
        this.description = "Useful for inspecting the schema of a specific Milvus collection. " +
                           "Input should be a JSON object with a 'collection_name' string, e.g., {\"collection_name\": \"my_collection\"}. " +
                           "This tool returns the names, types, and descriptions of all fields in the specified collection. " +
                           "Always call this tool after selecting a collection to understand its available data fields.";
    }

    // Define the schema for the tool's input, requiring a 'collection_name'
    schema = z.object({
        collection_name: z.string().describe("The name of the Milvus collection whose schema is to be retrieved."),
    });

    _extractDescription(field) {
        console.log(`[SchemaTool Debug] Field '${field.name}' description:`, field.description);
        return field.description && field.description.trim() !== ''
            ? field.description
            : 'No description provided.';
    }

    async _call(input) {
        const { collection_name } = input; // Extract collection_name from input
        
        if (!collection_name) {
            const errorMessage = "Error: 'collection_name' is required for schema_tool.";
            console.error(`[SchemaTool] ${errorMessage}`);
            return JSON.stringify({ error: errorMessage });
        }

        try {
            console.log(`[SchemaTool] Retrieving collection schema for '${collection_name}'...`);

            const describeCollectionRes = await milvusClient.describeCollection({
                collection_name: collection_name,
            });

            // console.log(`[SchemaTool Debug] Full describeCollection response for '${collection_name}':`, JSON.stringify(describeCollectionRes, null, 2));

            if (describeCollectionRes.status && describeCollectionRes.status.error_code !== 'Success') {
                throw new Error(`Failed to describe collection '${collection_name}': ${describeCollectionRes.status.reason}`);
            }

            const schema = describeCollectionRes.schema;
            if (!schema || !schema.fields) {
                throw new Error(`Schema or fields not found in the response for collection '${collection_name}'.`);
            }

            const fields = schema.fields.map(field => {
                console.log(`[SchemaTool Debug] Processing field '${field.name}', description:`, field.description);
                return {
                    name: field.name,
                    type: field.data_type,
                    description: this._extractDescription(field),
                };
            });

            const formattedSchema = {
                collectionName: collection_name, // Use the dynamic collection name
                fields,
            };

            console.log(`[SchemaTool] Schema retrieved for '${collection_name}':`, JSON.stringify(formattedSchema, null, 2));
            return JSON.stringify(formattedSchema);

        } catch (error) {
            console.error(`[SchemaTool] Error retrieving schema for '${collection_name}':`, error.message);
            return JSON.stringify({ error: `Error retrieving schema for '${collection_name}': ${error.message}` });
        }
    }
}

module.exports = SchemaTool;
