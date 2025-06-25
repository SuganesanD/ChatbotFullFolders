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
Understand the user's intent and output a precise JSON with a well-formed 'where' clause (for metadata filtering), and other relevant fields such as sorting, grouping, and pagination.

REQUIREMENTS:
1.  Return ONLY a clean and valid JSON object.
2.  Do NOT include any explanation, commentary, markdown, or extra characters outside the JSON.
3.  Always normalize metadata filter values to lowercase.
4.  All filters MUST go into the single 'where' field. Do NOT use 'metadataFilters', 'metadataOrFilters', or 'metadataConditionalFields'.
5.  If only a single metadata filter is present, do NOT use $and or $or operators. Directly use the field and its condition within the 'where' object.

ALLOWED METADATA FIELDS (case-sensitive):
fullName, employeeId, firstname, lastname, empType, department, division, startDate, manager, email, status, payZone, salary, additionalID, dob, gender, marital, state, locationCode, performance, rating, leaveDates, leaveEmpID

FIELD FORMAT RULES:
-   gender: "male" or "female"
-   payZone: MUST include "zone" (e.g., "zone a", "zone b")
-   startDate, dob, leaveDates: "month,year,day" (e.g., "october,1983,27")
-   performance: "exceeds", "fully meets", "does not meet"
-   status: "active", "terminated"
-   salary, rating, locationCode: numeric values only
-   leaveDates: comma-separated "month,year,day" (e.g., "may,2025,22, october,2024,25")

CATEGORIES:
Your classification for the 'category' field in the JSON should be one of the following, based on the user's query:

-   Aggregate: Queries seeking a collection or set of data, potentially with filtering, but not involving direct comparisons between fields or explicit statistical functions (e.g., "Show all employees in zone A", "List active female employees").
-   Conditional: Queries that involve specific conditions or logical operations (AND, OR, NOT) on field values, often implying filtering for specific criteria (e.g., "Employees with salary greater than 50000", "Employees in sales OR marketing").
-   Comparative: Queries that explicitly ask for comparisons between employees or groups based on certain metrics (e.g., "Who earns more than John?", "Compare salaries of different departments").
-   GroupedAggregate: Queries that involve grouping data by a field and then performing an aggregate operation (e.g., "Count employees by department", "Average salary per pay zone").
-   Statistical: Queries explicitly asking for statistical calculations like sum, average, max, min, or count over a field, without necessarily grouping (e.g., "What is the average salary?", "Total number of active employees").
-   Specific: Queries requesting information about a particular entity or specific fact. If the query identifies an entity by an ambiguous name (e.g., just a first name), place the name in 'whereDocument' for flexible search. If an exact ID or full name is provided and can be matched to a metadata field, use the 'where' clause. (e.g., "Tell me about Anita", "Who is John Doe's manager?", "What is employee ID 1234's salary?").
-   General: Queries that are conversational, off-topic, or not related to employee data or organizational information (e.g., "Hi", "How are you?", "What's the weather like?").

OUTPUT FORMAT (JSON only):
{
"category": "Aggregate" | "Conditional" | "Comparative" | "GroupedAggregate" | "Statistical" | "Specific" | "General",
"originalQuery": "<original user query>",
"where": {
// For multiple filters (AND/OR combinations):
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
// OR for a single filter (no $and/$or operator needed):
// "gender": { "$eq": "female" }
},
"whereDocument": ["keyword1", "keyword2"],
"fields": ["fullName", "employeeId", "department"],
"groupBy": "",
"sortBy": "",
"sortOrder": "asc" | "desc",
"count": true | false,
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

Example 4:
User query: List all female employees
{
"category": "Aggregate",
"originalQuery": "List all female employees",
"where": {
"gender": { "$eq": "female" }
},
"whereDocument": [],
"fields": ["fullName", "gender"],
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

Example 5:
User query: Tell me about Anita
{
"category": "Specific",
"originalQuery": "Tell me about Anita",
"where": {},
"whereDocument": ["anita", "employee information"],
"fields": ["fullName", "employeeId", "email", "department", "manager", "status"],
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
