function buildChromaWhereFilter({ metadataFilters = {}, metadataConditionalFields = {} }) {
  const andConditions = [];

  // Exact match filters
  for (const [key, value] of Object.entries(metadataFilters)) {
    andConditions.push({ [key]: { $eq: value } });
  }

  // Conditional filters (e.g., salary > 50000)
  for (const [key, condition] of Object.entries(metadataConditionalFields)) {
    const operator = Object.keys(condition)[0];
    const value = condition[operator];
    andConditions.push({ [key]: { [operator]: value } });
  }

  return andConditions.length > 0 ? { $and: andConditions } : {};
}

module.exports = buildChromaWhereFilter;
