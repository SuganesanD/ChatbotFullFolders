const chroma = require('../config/chromaClient');

async function listEmployees(classified) {
  const {
    metadataFilters = {},
    metadataOrFilters = [],
    metadataConditionalFields = {},
    whereDocument = [],
    fields = [],
    pagination = { limit: 100, offset: 0 }
  } = classified;

  const collection = await chroma.getCollection({ name: 'enterprise-collection' });

  const andConditions = [];

  // Add exact filters as $eq
  for (const [key, value] of Object.entries(metadataFilters)) {
    andConditions.push({ [key]: { "$eq": value } });
  }

  // Add conditional filters like $gt, $lt, etc.
  for (const [key, condition] of Object.entries(metadataConditionalFields)) {
    andConditions.push({ [key]: condition });
  }

  const orConditions = [];
  for (const orBlock of metadataOrFilters) {
    const key = Object.keys(orBlock)[0];
    const value = orBlock[key];

    if (typeof value === "object") {
      // e.g., { salary: { "$lt": 50000 } }
      orConditions.push({ [key]: value });
    } else {
      // e.g., { department: "Engineering" }
      orConditions.push({ [key]: { "$eq": value } });
    }
  }

  // ✅ Compose the full `where` filter
  let where = {};
  if (andConditions.length > 0 && orConditions.length > 0) {
    where = { "$and": [ ...andConditions, { "$or": orConditions } ] };
  } else if (andConditions.length > 0) {
    where = { "$and": andConditions };
  } else if (orConditions.length > 0) {
    where = { "$or": orConditions };
  }

  console.log("where:", JSON.stringify(where, null, 2));


  const queryResult = await collection.query({
    where,
    whereDocument: whereDocument.length > 0 ? { "$contains": whereDocument.join(" ") } : undefined,
    nResults: pagination.limit,
    offset: pagination.offset
  });

  const results = [];

  for (let i = 0; i < queryResult.documents.length; i++) {
    const doc = queryResult.documents[i];
    const meta = queryResult.metadatas[i];

    if (fields.length > 0) {
      const filtered = {};
      for (const field of fields) {
        filtered[field] = meta[field];
      }
      results.push(filtered);
    } else {
      results.push({ ...meta });
    }
  }

  return results;
}

module.exports = listEmployees;
