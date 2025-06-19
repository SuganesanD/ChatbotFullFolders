const chroma = require('../config/chromaClient');

/**
 * List employees using full classified query format.
 * Supports metadata filters, conditional fields, semantic document filters (whereDocument), and field selection.
 * Fetches all matching data in batches.
 *
 * @param {Object} classified - Structured query from classifier
 * @returns {Promise<Object[]>} - Filtered and matched employee documents
 */
async function listEmployees(classified) {
  const BATCH_SIZE = 500;
  const allMatched = [];
  let offset = 0;
  let batchCount = 0;

  const {
    metadataFilters = {},
    metadataConditionalFields = {},
    whereDocument = [],
    fields = []
  } = classified;

  const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  while (true) {
    const response = await collection.get({
      include: ['metadatas', 'documents'],
      limit: BATCH_SIZE,
      offset
    });

    const metadatas = response?.metadatas || [];
    const documents = response?.documents || [];
    const fetchedCount = metadatas.length;

    if (fetchedCount === 0) break;

    for (let i = 0; i < metadatas.length; i++) {
      const metadata = metadatas[i];
      const documentText = documents[i]?.toLowerCase() || '';
      let match = true;

      // Apply exact metadata filters
      for (const [key, value] of Object.entries(metadataFilters)) {
        const metaValue = metadata[key];
        if (!metaValue || metaValue.toString().toLowerCase() !== value.toString().toLowerCase()) {
          match = false;
          break;
        }
      }

      // Apply conditional field filters (e.g., salary > 50000)
      for (const [key, condition] of Object.entries(metadataConditionalFields)) {
        const actual = parseFloat(metadata[key]);
        const operator = Object.keys(condition)[0];
        const target = parseFloat(condition[operator]);

        if (operator === '$gt' && !(actual > target)) match = false;
        if (operator === '$lt' && !(actual < target)) match = false;
        if (operator === '$gte' && !(actual >= target)) match = false;
        if (operator === '$lte' && !(actual <= target)) match = false;
        if (operator === '$eq' && !(actual === target)) match = false;
      }

      // Apply semantic document filter (if whereDocument keywords are given)
      if (whereDocument.length > 0) {
        const containsKeyword = whereDocument.some(keyword => documentText.includes(keyword.toLowerCase()));
        if (!containsKeyword) match = false;
      }

      if (match) {
        allMatched.push(documents[i]); // ✅ Return the document, not metadata
      }
    }

    offset += BATCH_SIZE;
    batchCount++;
  }

  return allMatched;
}

module.exports = listEmployees;
