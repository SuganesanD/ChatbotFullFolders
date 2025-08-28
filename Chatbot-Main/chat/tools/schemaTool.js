// const { Tool } = require('@langchain/core/tools');
// const { z } = require('zod');

// class SchemaTool extends Tool {
//     constructor({ milvusClient }) {
//         super();
//         this.milvusClient = milvusClient;
//         this.name = "schema_tool";
//         this.description = "Useful for inspecting the schema of a specified Milvus collection. " +
//                            "This tool returns the names, types, and descriptions of all fields in the collection provided in the input. " +
//                            "Input must include 'collection_name' (e.g., {\"collection_name\": \"students\"}). " +
//                            "Always call this tool first to understand the available data structure.";
//         this.schema = z.object({
//             collection_name: z.string().describe("The name of the Milvus collection to inspect")
//         });
//     }

//     _extractDescription(field) {
//         console.log(`[SchemaTool Debug] Field '${field.name}' description:`, field.description);
//         return field.description && field.description.trim() !== ''
//             ? field.description
//             : 'No description provided.';
//     }

//     async _call(input) {
//         try {
//             // Parse and validate input
//             const parsedInput = this.schema.parse(input);
//             const collectionName = parsedInput.collection_name;
//             console.log(`[SchemaTool] Retrieving collection schema for '${collectionName}'...`);

//             const describeCollectionRes = await this.milvusClient.describeCollection({
//                 collection_name: collectionName,
//             });

//             console.log(`[SchemaTool Debug] Full describeCollection response:`, JSON.stringify(describeCollectionRes, null, 2));

//             if (describeCollectionRes.status && describeCollectionRes.status.error_code !== 'Success') {
//                 throw new Error(`Failed to describe collection: ${describeCollectionRes.status.reason}`);
//             }

//             const schema = describeCollectionRes.schema;
//             if (!schema || !schema.fields) {
//                 throw new Error("Schema or fields not found in the response.");
//             }

//             const fields = schema.fields.map(field => {
//                 console.log(`[SchemaTool Debug] Processing field '${field.name}', description:`, field.description);
//                 return {
//                     name: field.name,
//                     type: field.data_type,
//                     description: this._extractDescription(field),
//                 };
//             });

//             const formattedSchema = {
//                 collectionName,
//                 fields,
//             };

//             console.log(`[SchemaTool] Schema retrieved:`, JSON.stringify(formattedSchema, null, 2));
//             return JSON.stringify(formattedSchema);

//         } catch (error) {
//             console.error("[SchemaTool] Error retrieving schema:", error.message);
//             return `Error retrieving schema: ${error.message}`;
//         }
//     }
// }

// module.exports = SchemaTool;

const { Tool } = require('@langchain/core/tools');
const { z } = require('zod');

class SchemaTool extends Tool {
  constructor({ milvusClient }) {
    super();
    this.milvusClient = milvusClient;
    this.name = 'schema_tool';
    this.description =
      'Inspects the schema of a Milvus collection. ' +
      'The collection name must be provided in the input as "collection_name". ' +
      'Returns field names, types, and descriptions for the collection. ' +
      'Input should be a JSON object with only "collection_name" (e.g., {"collection_name": "students"}).';
    this.schema = z.object({
      collection_name: z.string().describe('The name of the Milvus collection to inspect.'),
    }).strict(); // Strict mode to reject unexpected fields
  }

  _extractDescription(field) {
    const description = field.description && field.description.trim() !== ''
      ? field.description
      : 'No description provided.';
    console.log(`[SchemaTool] Field '${field.name}' description: ${description}`);
    return description;
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
            throw new Error('Invalid JSON input. Input must be a valid JSON string or object with only "collection_name".');
          }
        } else {
          throw new Error('Input cannot be an empty string. Provide {"collection_name": "<name>"}.');
        }
      } else if (typeof input === 'object' && input !== null) {
        parsedInput = input;
      } else {
        throw new Error('Input must be a valid JSON string or object with only "collection_name".');
      }

      // Validate input schema
      const { collection_name } = this.schema.parse(parsedInput);

      if (!collection_name || collection_name.trim() === '') {
        throw new Error("Missing or empty required field: 'collection_name'.");
      }

      console.log(`[SchemaTool] Retrieving schema for collection: '${collection_name}'`);

      // Verify collection exists
      const hasCollection = await this.milvusClient.hasCollection({ collection_name });
      if (!hasCollection.value) {
        console.error(`[SchemaTool] Collection '${collection_name}' does not exist`);
        return `Error: Collection '${collection_name}' does not exist in Milvus.`;
      }

      // Describe collection with retry
      let describeCollectionRes;
      const maxRetries = 3;
      let attempts = 0;
      while (attempts < maxRetries) {
        try {
          describeCollectionRes = await this.milvusClient.describeCollection({
            collection_name,
          });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxRetries) {
            throw new Error(`Failed to describe collection '${collection_name}' after ${maxRetries} attempts: ${error.message}`);
          }
          console.warn(`[SchemaTool] Retry ${attempts}/${maxRetries} for collection '${collection_name}': ${error.message}`);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s before retry
        }
      }

      if (describeCollectionRes.status?.error_code !== 'Success') {
        throw new Error(`Failed to describe collection '${collection_name}': ${describeCollectionRes.status.reason}`);
      }

      const schema = describeCollectionRes.schema;
      if (!schema?.fields) {
        throw new Error(`No schema fields found for collection '${collection_name}'.`);
      }

      const fields = schema.fields.map((field) => ({
        name: field.name,
        type: field.data_type,
        description: this._extractDescription(field),
      }));

      const formattedSchema = {
        collectionName: collection_name,
        fields,
      };

      console.log(`[SchemaTool] Successfully retrieved schema for '${collection_name}':`, JSON.stringify(formattedSchema, null, 2));
      return JSON.stringify(formattedSchema);

    } catch (error) {
      console.error(`[SchemaTool] Error for collection '${parsedInput.collection_name || 'unknown'}': ${error.message}`);
      return `Error retrieving schema for collection '${parsedInput.collection_name || 'unknown'}': ${error.message}`;
    }
  }
}

module.exports = SchemaTool;