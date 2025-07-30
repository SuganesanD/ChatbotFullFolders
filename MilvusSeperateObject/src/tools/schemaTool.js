// src/tools/schemaTool.js
const { Tool } = require('@langchain/core/tools');
// Remove direct import of milvusClient, as it will be passed via constructor
// const { milvusClient } = require('../config/milvusClient');
const { z } = require('zod');

class SchemaTool extends Tool {
    // --- MODIFICATION START ---
    // Make constructor dynamic to receive milvusClientInstance and availableCollections
    constructor(availableCollections = [], milvusClientInstance) {
        super();
        this.milvusClient = milvusClientInstance; // Store the Milvus client instance
        this.name = "schema_tool";
        this.availableCollections = availableCollections; // Store the list of available collection names

        // Update the description to be dynamic and guide the LLM
        this.description = `
        Useful for inspecting the schema of specified Milvus collections.
        This tool returns the names, types, and descriptions of all fields in the requested collection.
        Always call this tool first with a specific 'collection_name' to understand the available data structure
        before attempting a search or asking questions about specific fields within that collection.

        Input should be a JSON string with the following property:
        {
            "collection_name": string // REQUIRED: The exact name of the Milvus collection whose schema you want to inspect.
                                     // Available collections are: ${this.availableCollections.length > 0 ? this.availableCollections.join(', ') : 'No collections configured.'}
        }
        Example usage: schema_tool({"collection_name": "students"})
        `;
    }

    // Define the schema for the input arguments the tool expects, now requiring collection_name
    schema = z.object({
        collection_name: z.string().describe("The exact name of the Milvus collection whose schema you want to inspect (e.g., 'schools', 'students', 'leaves'). This is a mandatory argument."),
    });

    /**
     * Extracts the description from the field schema.
     * @param {object} field - The field object from Milvus schema.
     * @returns {string} The description or a default message.
     */
    _extractDescription(field) {
        // console.log(`[SchemaTool Debug] Field '${field.name}' description:`, field.description); // Keep for debugging if needed
        return field.description && field.description.trim() !== ''
            ? field.description
            : 'No description provided.';
    }

    /**
     * The core logic of the tool. Fetches and formats the schema for the specified collection.
     * @param {object} toolInput - The input arguments from the agent, expected to contain `collection_name`.
     * @param {string} toolInput.collection_name - The name of the collection to get the schema for.
     * @returns {Promise<string>} A JSON string of the collection's schema or an error message.
     */
    async _call(toolInput) { // Accept the input object
        const { collection_name } = toolInput; // Destructure collection_name from the input

        if (!collection_name) {
            return "Error: 'collection_name' parameter is required for schema_tool.";
        }

        // Add a check to ensure the requested collection is one of the available ones
        if (!this.availableCollections.includes(collection_name)) {
            return `Error: Collection '${collection_name}' is not a recognized or available collection. Available collections are: ${this.availableCollections.join(', ')}.`;
        }

        try {
            console.log(`[SchemaTool] Retrieving collection schema for '${collection_name}'...`);

            // Use the milvusClient instance passed in the constructor
            const describeCollectionRes = await this.milvusClient.describeCollection({
                collection_name: collection_name, // Use the dynamic collection_name
            });

            // console.log(`[SchemaTool Debug] Full describeCollection response for ${collection_name}:`, JSON.stringify(describeCollectionRes, null, 2)); // Keep for debugging if needed

            if (describeCollectionRes.status && describeCollectionRes.status.error_code !== 'Success') {
                throw new Error(`Failed to describe collection: ${describeCollectionRes.status.reason}`);
            }

            const schema = describeCollectionRes.schema;
            if (!schema || !schema.fields) {
                throw new Error("Schema or fields not found in the response.");
            }

            const fields = schema.fields.map(field => {
                // console.log(`[SchemaTool Debug] Processing field '${field.name}', description:`, field.description); // Keep for debugging if needed
                return {
                    name: field.name,
                    type: field.data_type,
                    description: this._extractDescription(field),
                };
            });

            const formattedSchema = {
                collectionName: collection_name, // Use the dynamic collection_name
                fields,
            };

            console.log(`[SchemaTool] Schema retrieved for ${collection_name}.`);
            return JSON.stringify(formattedSchema);

        } catch (error) {
            console.error(`[SchemaTool] Error retrieving schema for '${collection_name}':`, error.message);
            return `Error retrieving schema for '${collection_name}': ${error.message}. Please ensure the collection exists and Milvus is accessible.`;
        }
    }
}
// --- MODIFICATION END ---

module.exports = SchemaTool;