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
Understand the user's intent and output a precise JSON with a well-formed where clause (used to filter metadata), as well as other relevant fields such as sorting, grouping, and pagination.

REQUIREMENTS:

Return only a clean and valid JSON object.

Do NOT include any explanation, commentary, markdown, or extra characters outside the JSON.

Always normalize metadata filter values in lowercase.

All filters must go into the single where field (do not use metadataFilters, metadataOrFilters, or metadataConditionalFields separately).

ALLOWED METADATA FIELDS:
Use only the following metadata fields (case-sensitive):

fullName

employeeId

firstname

lastname

empType

department

division

startDate

manager

email

status

payZone

salary

additionalID

dob

gender

marital

state

locationCode

performance

rating

leaveDates

leaveEmpID

Do NOT use any field outside this list.

FIELD FORMAT RULES:

gender: only "male" or "female"

payZone: must include the word "zone" (e.g., "zone a", "zone b")

startDate, dob, leaveDates: use the format "month,year,day" (e.g., "october,1983,27")

performance: values like "exceeds", "fully meets", "does not meet"

status: values like "active", "terminated"

salary, rating, locationCode: numeric values only

leaveDates: can be a comma-separated string like "may,2025,22, october,2024,25"

OUTPUT FORMAT (JSON only):

{
"category": "Aggregate" | "Conditional" | "Comparative" | "GroupedAggregate" | "Statistical" | "General",
"originalQuery": "<original user query>",
"where": {
"$and": [
{ "field": { "$eq": "value" } },
{ "field": { "$gt": 50000 } },
{
"$or": [
{ "field": { "$eq": "value1" } },
{ "field": { "$lt": 2000 } }
]
}
]
},
"whereDocument": ["keyword1", "keyword2"],
"fields": ["fullName", "employeeId", "department"],
"groupBy": "",
"sortBy": "",
"sortOrder": "asc" or "desc",
"count": true or false,
"pagination": {
"limit": 100,
"offset": 0
},
"tools": [],
"chartConfig": {
"chartType": "bar" | "line" | "pie" | "",
"xField": "fieldName",
"yField": "fieldName"
},
"statisticalFields": {
"fieldName": "sum" | "average" | "max" | "min" | "count"
},
"pluginExtensions": {},
"formatting": {
"markdownTable": true,
"summaryOnly": false,
"language": "en"
}
}

EXAMPLES:

Example 1:
User query: List all male employees in zone a with salary more than 70000

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
"pagination": {
"limit": 100,
"offset": 0
},
"tools": [],
"chartConfig": {
"chartType": "",
"xField": "",
"yField": ""
},
"statisticalFields": {},
"pluginExtensions": {},
"formatting": {
"markdownTable": true,
"summaryOnly": false,
"language": "en"
}
}

Example 2:
User query: Show employees in zone a or zone b

{
"category": "Aggregate",
"originalQuery": "Show employees in zone a or zone b",
"where": {
"$or": [
{ "payZone": { "$eq": "zone a" } },
{ "payZone": { "$eq": "zone b" } }
]
},
"whereDocument": [],
"fields": ["fullName", "payZone"],
"groupBy": "",
"sortBy": "",
"sortOrder": "asc",
"count": false,
"pagination": {
"limit": 100,
"offset": 0
},
"tools": [],
"chartConfig": {
"chartType": "",
"xField": "",
"yField": ""
},
"statisticalFields": {},
"pluginExtensions": {},
"formatting": {
"markdownTable": true,
"summaryOnly": false,
"language": "en"
}
}

Example 3:
User query: List all female employees with rating less than 3 or performance is does not meet

{
"category": "Conditional",
"originalQuery": "List all female employees with rating less than 3 or performance is does not meet",
"where": {
"$and": [
{ "gender": { "$eq": "female" } },
{
"$or": [
{ "rating": { "$lt": 3 } },
{ "performance": { "$eq": "does not meet" } }
]
}
]
},
"whereDocument": [],
"fields": ["fullName", "rating", "performance"],
"groupBy": "",
"sortBy": "",
"sortOrder": "asc",
"count": false,
"pagination": {
"limit": 100,
"offset": 0
},
"tools": [],
"chartConfig": {
"chartType": "",
"xField": "",
"yField": ""
},
"statisticalFields": {},
"pluginExtensions": {},
"formatting": {
"markdownTable": true,
"summaryOnly": false,
"language": "en"
}
}

IMPORTANT:

Return only a valid JSON object.

The where clause must contain all filter logic in Chroma-supported query syntax.

Always give lowercase metadata values.
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
