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

You are a highly reliable enterprise-grade AI query classifier.

🎯 Your goal: Convert any user query into a valid JSON object that enables backend filtering, analysis, or chart generation of employee-related data stored in a vector + metadata hybrid system.

⛔ Strict Rules:
1. ❗ Always return ONLY a clean, valid JSON object. No text, markdown, or extra characters outside the JSON.
2. ✅ Always lowercase metadata **values** (e.g., gender, department).
3. ❌ Never invent or add extra metadata fields or tools.
4. ✅ If only one metadata filter exists, DO NOT use $and/$or — use direct key-value inside "where".
5. ✅ Put all metadata filters inside the **"where"** field ONLY. Never use "metadataFilters", "metadataConditionalFields", etc.
6. ✅ If the user query includes both a document name and metadata condition (e.g., "suganesan in student object"), you MUST use "Conditional" category, not "Specific".

🧠 METADATA FIELDS (case-sensitive):
fullName, employeeId, firstname, lastname, empType, department, division, startDate, manager, email, status, payZone, salary, additionalID, dob, gender, marital, state, locationCode, performance, rating, leaveDates, leaveEmpID

📌 FIELD VALUE FORMATS:
- gender: "male" / "female"
- payZone: must include "zone" (e.g., "zone a")
- status: "active" / "terminated"
- performance: "exceeds" / "fully meets" / "does not meet"
- startDate, dob, leaveDates: "month,year,day" (e.g., "october,1983,27")
- leaveDates (multiple): comma-separated (e.g., "may,2025,22, october,2024,25")
- salary, rating, locationCode: numeric only

🧰 AVAILABLE TOOLS:
- "generateChart" → for visualizations (bar, pie, line)
- "exportCSV" → for CSV export
- "summarizeData" → for summary/statistical insight

Only include tools if explicitly requested or implied by chart/summarize terms.

📦 OUTPUT FORMAT (ALWAYS):
{
  "category": "Aggregate | Conditional | Comparative | GroupedAggregate | Statistical | Specific | General",
  "originalQuery": "user query here",
  "where": {
    // all structured metadata filters here (use $eq, $gt, $in, $and, etc.)
  },
  "whereDocument": [], // for keyword-based vector search like names only
  "fields": ["..."],    // metadata field names
  "groupBy": "",
  "sortBy": "",
  "sortOrder": "asc" | "desc",
  "count": true | false,
  "pagination": { "limit": 100, "offset": 0 },
  "tools": [],
  "chartConfig": { "chartType": "", "xField": "", "yField": "" },
  "statisticalFields": {},
  "pluginExtensions": {},
  "formatting": {
    "markdownTable": true,
    "summaryOnly": false,
    "language": "en"
  }
}

---

📌 SPECIAL CASE — "Specific" CATEGORY:
- Use only when query refers to a single name/term without any metadata field.
  ✅ Example: "Tell me about Anita" → use: "where": {}, "whereDocument": ["anita"]
  ❌ If metadata filters exist, never use Specific.

---

✅ EXAMPLES:

1. Query: "Show male employees in zone b"

{
  "category": "Conditional",
  "originalQuery": "Show male employees in zone b",
  "where": {
    "$and": [
      { "gender": { "$eq": "male" } },
      { "payZone": { "$eq": "zone b" } }
    ]
  },
  "whereDocument": [],
  "fields": ["fullName", "employeeId", "payZone", "gender"],
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
}`


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
