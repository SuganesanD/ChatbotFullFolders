const Mustache = require("mustache");
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");

/**
 * Upsert documents into Milvus:
 * - Render template with record fields (documentText)
 * - Embed text with Gemini (embedding)
 * - Batch upsert
 */
async function upsertMilvus(client, input) {
  try {
    const { collection, records, template, modal } = input;

    if (!collection) {
      return { success: false, message: "Collection name is required in input.collection" };
    }
    if (!records || !Array.isArray(records) || records.length === 0) {
      return { success: false, message: "At least one record must be provided in input.records" };
    }
    if (!template) {
      return { success: false, message: "Template is required in input.template" };
    }

    // ✅ Check if collection exists
    const { value: exists } = await client.hasCollection({ collection_name: collection });
    if (!exists) {
      return { success: false, message: `Collection '${collection}' does not exist.` };
    }

    // ✅ Gemini embedding client
    if (modal !== "gemini") {
      return { success: false, message: `Unsupported modal: ${modal}` };
    }
    const embeddings = new GoogleGenerativeAIEmbeddings({
      modelName: "embedding-001",
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // ✅ Render + embed each record
    const processedRecords = [];
    let idx = 1;
    for (const record of records) {
      // 1. Render template into documentText
      const documentText = Mustache.render(template, record);

      // 2. Generate embedding
      let vector = await embeddings.embedQuery(documentText);

      // 3. Truncate to 768 dims
      if (vector.length > 768) vector = vector.slice(0, 768);

      // 4. Normalize null values for Milvus
      const normalizedRecord = {};
      for (const key of Object.keys(record)) {
        const val = record[key];
        normalizedRecord[key] =
          val === null
            ? typeof val === "number"
              ? 0
              : typeof val === "boolean"
              ? false
              : ""
            : val;
      }

      // 5. Attach documentText and embedding
      normalizedRecord.documentText = documentText;
      normalizedRecord.embedding = vector;

      processedRecords.push(normalizedRecord);
      console.log(`✅ Prepared record ${idx}`);
      idx++;
    }

    // ✅ Batch upsert
    const batchSize = 1000;
    let total = 0;
    const batchResults = [];

    for (let i = 0; i < processedRecords.length; i += batchSize) {
      const batch = processedRecords.slice(i, i + batchSize);

      const res = await client.upsert({
        collection_name: collection,
        data: batch,
      });

      console.log("Response from upsert:", res);

      total += batch.length;
      batchResults.push({
        batchNumber: Math.floor(i / batchSize) + 1,
        count: batch.length,
        res,
      });

      console.log(`✅ Upserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records`);
    }

    return {
      success: true,
      message: `Upserted ${total} record(s) into '${collection}' in batches of ${batchSize}.`,
      batches: batchResults,
    };
  } catch (err) {
    return { success: false, message: `Error during upsert: ${err.message}` };
  }
}

module.exports = { upsertMilvus };
