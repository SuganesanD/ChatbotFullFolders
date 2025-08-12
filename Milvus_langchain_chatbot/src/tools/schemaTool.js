const { Tool } = require('@langchain/core/tools');
const { milvusClient } = require('../config/milvusClient');
const { z } = require('zod');

class SchemaTool extends Tool {
    constructor() {
        super();
        this.name = "schema_tool";
        this.description = "Useful for inspecting the schema of the Milvus collection. " +
                           "This tool returns the names, types, and descriptions of all fields in the 'dynamicRecords' collection. " +
                           "Always call this tool first to understand the available data.";
    }

    schema = z.object({});


    _extractDescription(field) {
        console.log(`[SchemaTool Debug] Field '${field.name}' description:`, field.description);
        return field.description && field.description.trim() !== ''
            ? field.description
            : 'No description provided.';
    }

    async _call() {
        try {
            const collectionName = 'dynamicRecords';
            console.log(`[SchemaTool] Retrieving collection schema for '${collectionName}'...`);

            const describeCollectionRes = await milvusClient.describeCollection({
                collection_name: collectionName,
            });

            console.log(`[SchemaTool Debug] Full describeCollection response:`, JSON.stringify(describeCollectionRes, null, 2));

            if (describeCollectionRes.status && describeCollectionRes.status.error_code !== 'Success') {
                throw new Error(`Failed to describe collection: ${describeCollectionRes.status.reason}`);
            }

            const schema = describeCollectionRes.schema;
            if (!schema || !schema.fields) {
                throw new Error("Schema or fields not found in the response.");
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
                collectionName,
                fields,
            };

            console.log(`[SchemaTool] Schema retrieved:`, JSON.stringify(formattedSchema, null, 2));
            return JSON.stringify(formattedSchema);

        } catch (error) {
            console.error("[SchemaTool] Error retrieving schema:", error.message);
            return `Error retrieving schema: ${error.message}`;
        }
    }
}

module.exports = SchemaTool;