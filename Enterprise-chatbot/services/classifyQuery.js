// services/classifyQuery.js
const { generateGeminiResponse } = require('../config/geminiClient');

const VALID_METADATA_FIELDS = [
  'fullName', 'employeeId', 'firstname', 'lastname', 'empType', 'department',
  'division', 'startDate', 'manager', 'email', 'status', 'payZone', 'salary',
  'additionalID', 'dob', 'gender', 'marital', 'state', 'locationCode',
  'performance', 'rating', 'leaveDates', 'leaveEmpID'
];

// ✅ Gemini prompt
const promptTemplate = `
You are a professional AI query classifier for an enterprise-grade employee information system. Your task is to convert natural language user queries into structured JSON instructions.

🧠 Output a JSON object in the following format:

{
  category: "Specific" | "Aggregate" | "Comparative" | "Conditional" | "Statistical" | "GroupedAggregate" | "General",
  originalQuery: "...",                     
  metadataFilters: { key: value },          
  metadataConditionalFields: { key: { "$gt": value } }, 
  whereDocument: ["..."],                   
  fields: ["fullName", "email", ...],       
  groupBy: "",                              
  sortBy: "",                               
  sortOrder: "asc" | "desc",                
  count: true | false,                      
  pagination: {
    limit: 100,
    offset: 0
  },
  tools: [],                                
  chartConfig: {
    chartType: "",
    xField: "",
    yField: ""
  },
  statisticalFields: { key: "sum" | "average" | "count" | "max" | "min" },
  pluginExtensions: {},
  formatting: {
    markdownTable: true,
    summaryOnly: false,
    language: "en"
  }
}

🔒 Only use these allowed metadata fields:
${VALID_METADATA_FIELDS.join(', ')}

📌 Example 1:
"List all male employees in Finance"
→ category: "Aggregate"
→ metadataFilters: { gender: "male", department: "Finance" }
→ fields: ["fullName", "employeeId", "email"]

📌 Example 2:
"Show average salary of HR employees"
→ category: "Statistical"
→ metadataFilters: { department: "HR" }
→ statisticalFields: { salary: "average" }

Return **ONLY** the final JSON object. No comments, no markdown.

User Query:
`;

async function classifyQuery(userQuery) {
  try {
    const fullPrompt = `${promptTemplate}\n"${userQuery}"`;
    const response = await generateGeminiResponse(fullPrompt);

    const jsonStart = response.indexOf('{');
    const jsonEnd = response.lastIndexOf('}');
    const jsonString = response.slice(jsonStart, jsonEnd + 1);

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error('❌ Gemini returned an invalid JSON:\n' + response);
    }

    // 🛡️ Clean up invalid keys
    parsed.metadataFilters = filterValidKeys(parsed.metadataFilters);
    parsed.metadataConditionalFields = filterValidKeys(parsed.metadataConditionalFields);
    parsed.fields = parsed.fields?.filter(f => VALID_METADATA_FIELDS.includes(f)) || [];

    // 🧠 Fallback defaults
    if (parsed.fields.length === 0) {
      parsed.fields = ['fullName', 'employeeId', 'email'];
    }

    parsed.originalQuery = userQuery;
    parsed.sortOrder = parsed.sortOrder || 'asc';
    parsed.count = parsed.count ?? false;
    parsed.pagination = parsed.pagination || { limit: 100, offset: 0 };
    parsed.tools = parsed.tools || [];
    parsed.chartConfig = parsed.chartConfig || { chartType: '', xField: '', yField: '' };
    parsed.pluginExtensions = parsed.pluginExtensions || {};
    parsed.formatting = parsed.formatting || { markdownTable: true, summaryOnly: false, language: 'en' };

    return parsed;

  } catch (error) {
    console.error('❌ Error classifying query:', error);
    return {
      category: 'Unknown',
      originalQuery: userQuery,
      error: error.message || error
    };
  }
}

function filterValidKeys(obj = {}) {
  const filtered = {};
  for (const key in obj) {
    if (VALID_METADATA_FIELDS.includes(key)) {
      filtered[key] = obj[key];
    }
  }
  return filtered;
}

module.exports = { classifyQuery };
