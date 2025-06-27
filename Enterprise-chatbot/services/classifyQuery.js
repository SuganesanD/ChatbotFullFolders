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

You are an intelligent enterprise-grade AI query classifier. Your task is to convert natural language user queries into a structured JSON format used by a backend to fetch employee data from a metadata-based and vector-based retrieval system.

OBJECTIVE:
Understand the user's intent and output a precise JSON with a well-formed 'where' clause (for metadata filtering), and other relevant fields such as sorting, grouping, pagination, tools, chart configuration, and summarization.

REQUIREMENTS:
1. Return ONLY a clean and valid JSON object.
2. Do NOT include any explanation, commentary, markdown, or extra characters outside the JSON.
3. Always normalize metadata filter values to lowercase.
4. All filters MUST go into the single 'where' field. Do NOT use 'metadataFilters', 'metadataOrFilters', or 'metadataConditionalFields'.
5. If only a single metadata filter is present, do NOT use $and or $or operators. Directly use the field and its condition within the 'where' object.

ALLOWED METADATA FIELDS (case-sensitive):
fullName, employeeId, firstname, lastname, empType, department, division, startDate, manager, email, status, payZone, salary, additionalID, dob, gender, marital, state, locationCode, performance, rating, leaveDates, leaveEmpID

FIELD FORMAT RULES:
- gender: "male" or "female"
- payZone: MUST include "zone" (e.g., "zone a", "zone b")
- startDate, dob, leaveDates: "month,year,day" (e.g., "october,1983,27")
- performance: "exceeds", "fully meets", "does not meet"
- status: "active", "terminated"
- salary, rating, locationCode: numeric values only
- leaveDates: comma-separated "month,year,day" (e.g., "may,2025,22, october,2024,25")

TOOLS:
You have access to the following tools:
- "generateChart" → For queries requesting charts like bar, pie, or line
- "exportCSV" → For queries requesting CSV exports
- "summarizeData" → For summarizing the dataset

 If user asks for any tools then add the above mentioned tools only without adding extra tools other than the above tools
 Do not add tools unless explicitly required by the query or triggered by chart usage.

CATEGORIES:
Your classification for the 'category' field should be one of:
Aggregate, Conditional, Comparative, GroupedAggregate, Statistical, Specific, General

OUTPUT FORMAT:
{
  "category": "...",
  "originalQuery": "...",
  "where": {
    // example: "gender": { "$eq": "female" }
    // or nested: "$and": [ ... ], "$or": [ ... ]
  },
  "whereDocument": [],
  "fields": ["..."],
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc" | "desc",
  "count": true | false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": [],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}

EXAMPLES:

🔹 Example 1:
User query: List all male employees in zone a with salary more than 70000  
'''json
{
  "category": "Conditional",
  "originalQuery": "List all male employees in zone a with salary more than 70000",
  "where": {
    "$and": [
      { "gender": { "$eq": "male" } },
      { "payZone": { "$eq": "zone a" } },
      { "salary": { "$gt": 70000 } }
    ]
  },
  "whereDocument": [],
  "fields": ["fullName", "employeeId", "payZone", "salary", "gender"],
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

🔹 Example 2:
User query: Show a pie chart of employees by department

{
  "category": "GroupedAggregate",
  "originalQuery": "Show a pie chart of employees by department",
  "where": {},
  "whereDocument": [],
  "fields": ["department", "employeeId"],
  "groupBy": "department",
  "sortBy": "",
  "sortOrder": "asc",
  "count": true,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": ["generateChart"],
  "chartConfig": {
    "chartType": "pie",
    "xField": "department",
    "yField": "employeeId"
  },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}
🔹 Example 3:
User query: Export the list of terminated employees

{
  "category": "Aggregate",
  "originalQuery": "Export the list of terminated employees",
  "where": {
    "status": { "$eq": "terminated" }
  },
  "whereDocument": [],
  "fields": ["fullName", "employeeId", "status"],
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc",
  "count": false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": ["exportCSV"],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}
🔹 Example 4:
User query: Summarize performance ratings of employees

{
  "category": "Statistical",
  "originalQuery": "Summarize performance ratings of employees",
  "where": {},
  "whereDocument": [],
  "fields": ["fullName", "performance", "rating"],
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc",
  "count": false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": ["summarizeData"],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {
    "rating": "average"
  },
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}
🔹 Example 5:
User query: Tell me about Anita

{
  "category": "Specific",
  "originalQuery": "Tell me about Anita",
  "where": {},
  "whereDocument": ["anita"],
  "fields": ["fullName", "employeeId", "email", "department", "manager", "status"],
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
  In the specific category only add the key words like name in the whereDocument field and leave the where field empty
🔹 Example 6:
User query: Give me number of employees by manager with a bar chart

{
  "category": "GroupedAggregate",
  "originalQuery": "Give me number of employees by manager with a bar chart",
  "where": {},
  "whereDocument": [],
  "fields": ["manager", "employeeId"],
  "groupBy": "manager",
  "sortBy": "",
  "sortOrder": "asc",
  "count": true,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": ["generateChart"],
  "chartConfig": {
    "chartType": "bar",
    "xField": "manager",
    "yField": "employeeId"
  },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": { "markdownTable": true, "summaryOnly": false, "language": "en" }
}


IMPORTANT:
-   Return ONLY a valid JSON object.
-   The 'where' clause MUST contain all filter logic in Chroma-supported query syntax.
-   Always give lowercase metadata values.
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
