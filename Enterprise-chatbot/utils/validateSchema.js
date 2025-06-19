function validateSchema(schema) {
  if (!schema || typeof schema !== 'object') return false;

  const {
    category,
    originalQuery,
    metadataFilters,
    metadataConditionalFields,
    whereDocument,
    fields,
    groupBy,
    sortBy,
    sortOrder,
    count,
    pagination,
    tools,
    chartConfig,
    statisticalFields,
    pluginExtensions,
    formatting
  } = schema;

  // Basic required checks
  if (
    typeof category !== 'string' ||
    typeof originalQuery !== 'string' ||
    typeof metadataFilters !== 'object' ||
    typeof metadataConditionalFields !== 'object' ||
    !Array.isArray(whereDocument) ||
    !Array.isArray(fields) ||
    typeof groupBy !== 'string' ||
    typeof sortBy !== 'string' ||
    typeof sortOrder !== 'string' ||
    typeof count !== 'boolean' ||
    typeof pagination !== 'object' ||
    !Array.isArray(tools) ||
    typeof chartConfig !== 'object' ||
    typeof statisticalFields !== 'object' ||
    typeof pluginExtensions !== 'object' ||
    typeof formatting !== 'object'
  ) {
    return false;
  }

  // Optional deeper check for pagination
  if (
    typeof pagination.limit !== 'number' ||
    typeof pagination.offset !== 'number'
  ) {
    return false;
  }

  return true;
}

module.exports = {validateSchema};
