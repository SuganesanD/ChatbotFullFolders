const chroma = require('../config/chromaClient');

/**
 * Count employees using filters (metadata, conditionals, keywords)
 * @param {Object} classified - Structured filters from classifier
 * @returns {Promise<number>} - Total count of matched employees
 */
async function countEmployees(classified) {
  const BATCH_SIZE = 500;
  let offset = 0;
  let totalCount = 0;

  const {
    metadataFilters = {},
    metadataConditionalFields = {},
    whereDocument = []
  } = classified;

  // ✅ Check collection
  const collections = await chroma.listCollections();
  // if (!collections.includes( enterprise-collection)) {
  //   throw new Error(`❌ Collection '${ enterprise-collection}' not found.`);
  // }
  const collection = await chroma.getCollection({ name:  'enterprise-collection' });

  console.log(`🔍 Starting countEmployees with filters:`);
  console.log("• metadataFilters:", metadataFilters);
  console.log("• metadataConditionalFields:", metadataConditionalFields);
  console.log("• whereDocument keywords:", whereDocument);

  while (true) {
    const response = await collection.get({
      include: ['metadatas', 'documents'],
      limit: BATCH_SIZE,
      offset
    });

    const metadatas = response?.metadatas || [];
    const documents = response?.documents || [];

    if (metadatas.length === 0) break;

    for (let i = 0; i < metadatas.length; i++) {
      const metadata = metadatas[i];
      const docText = documents[i]?.toLowerCase() || '';
      let isMatch = true;

      // ✅ Exact Match Filters
      for (const [key, expected] of Object.entries(metadataFilters)) {
        const actual = metadata[key];
        if (!actual || actual.toString().toLowerCase() !== expected.toString().toLowerCase()) {
          isMatch = false;
          break;
        }
      }

      // ✅ Conditional Numeric Filters
      if (isMatch) {
        for (const [key, condition] of Object.entries(metadataConditionalFields)) {
          const actual = parseFloat(metadata[key]);
          const operator = Object.keys(condition)[0];
          const expected = parseFloat(condition[operator]);

          if (isNaN(actual)) {
            isMatch = false;
            break;
          }

          switch (operator) {
            case '$gt': if (!(actual > expected)) isMatch = false; break;
            case '$lt': if (!(actual < expected)) isMatch = false; break;
            case '$gte': if (!(actual >= expected)) isMatch = false; break;
            case '$lte': if (!(actual <= expected)) isMatch = false; break;
            case '$eq': if (!(actual === expected)) isMatch = false; break;
            default:
              console.warn(`⚠️ Unknown operator "${operator}"`);
              isMatch = false;
          }

          if (!isMatch) break;
        }
      }

      // ✅ Semantic Keyword Filter
      if (isMatch && whereDocument.length > 0) {
        const foundKeyword = whereDocument.some(keyword =>
          docText.includes(keyword.toLowerCase())
        );
        if (!foundKeyword) isMatch = false;
      }

      if (isMatch) {
        totalCount++;
      }
    }

    offset += BATCH_SIZE;
  }

  console.log(`✅ Total matched employees: ${totalCount}`);
  return totalCount;
}

module.exports = countEmployees;
