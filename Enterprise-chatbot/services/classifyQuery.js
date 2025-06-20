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
You are a professional AI query classifier for an enterprise-grade employee chatbot. Your task is to convert any user query into a structured JSON instruction object used for backend processing.

🎯 GOAL:
Understand the user's intent and return a clean JSON object with filters, logic, and field details.

✅ OUTPUT FORMAT:
Return **only** a valid JSON object in this format (no comments, no extra text):

{
  category: "Specific" | "Aggregate" | "Comparative" | "Conditional" | "Statistical" | "GroupedAggregate" | "General",
  originalQuery: "...",
  metadataFilters: { key: value },
  metadataConditionalFields: { key: { "$gt" | "$lt" | "$gte" | "$lte": number | string } },
  metadataOrFilters: { key: [value1, value2, ...] },
  whereDocument: ["..."],
  fields: ["..."],
  groupBy: "fieldName",
  sortBy: "fieldName",
  sortOrder: "asc" | "desc",
  count: true | false,
  pagination: {
    limit: 100,
    offset: 0
  },
  tools: [],
  chartConfig: {
    chartType: "bar" | "line" | "pie" | "",
    xField: "fieldName",
    yField: "fieldName"
  },
  statisticalFields: { key: "sum" | "average" | "count" | "max" | "min" },
  pluginExtensions: {},
  formatting: {
    markdownTable: true,
    summaryOnly: false,
    language: "en"
  }
}

🔐 Use only these allowed metadata fields (case-sensitive):
${VALID_METADATA_FIELDS.join(', ')}

---

📌 Example 1:
"List all male employees in Finance"
{
  "category": "Aggregate",
  "originalQuery": "List all male employees in Finance",
  "metadataFilters": { "gender": "male", "department": "Finance" },
  "metadataConditionalFields": {},
  "metadataOrFilters": {},
  "whereDocument": [],
  "fields": ["fullName", "employeeId", "email"],
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc",
  "count": false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": [],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}

📌 Example 2:
"List employees in Sales or Marketing department"
{
  "category": "Aggregate",
  "originalQuery": "List employees in Sales or Marketing department",
  "metadataFilters": {},
  "metadataConditionalFields": {},
  "metadataOrFilters": { "department": ["Sales", "Marketing"] },
  "whereDocument": [],
  "fields": ["fullName", "department"],
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc",
  "count": false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": [],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}

🛑 Return only the valid JSON object — no markdown, no explanation, no extra text.

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
