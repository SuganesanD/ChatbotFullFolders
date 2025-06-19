const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config({ path: './couchdb_credentials.env' });

const genAI = new GoogleGenerativeAI('AIzaSyD4zXj3LQtUGxPRbAwxkVM4lzZpQE6urOk');

/**
 * Classifies a user query using Gemini Flash into 14 universal categories.
 * @param {string} userQuery    
 * @returns {Promise<Object>} Classification result
 */
async function classifyQuery(userQuery) {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  console.log("userQuery:",userQuery);
  
  const prompt = `
  You are an intelligent query classification agent for an enterprise search system.
  
  Your task is to classify a user query into a strict JSON format based on its intent and metadata content. Output must include classification, filters, and value normalization matching the database schema.
  
  Respond ONLY with a valid JSON object in the following format:
  
  {
    "category": "One of: General, Specific, Comparative, Aggregate, Conditional",
    "whereDocument": [ ... ],
    "metadataFilters": { ... },
    "metadataConditionalFields": { ... },
    "count": true | false,
    "originalQuery": "Exact user input"
  }
  
  ### Supported Metadata Keys (case-sensitive):
  
  - fullName  
  - employeeId  
  - firstname  
  - lastname  
  - empType  
  - department  
  - division  
  - startDate  
  - manager  
  - email  
  - status  
  - payZone  
  - salary  
  - additionalID  
  - dob  
  - gender  
  - marital  
  - state  
  - locationCode  
  - performance  
  - rating  
  - leaveDates  
  - leaveEmpID
  
  ### Classification Categories:
  
  - "General": Greetings, unrelated queries  
  - "Specific": Direct questions about specific individuals  
  - "Comparative": Comparisons between two or more people  
  - "Aggregate": Count or list based on **exact** filters  
  - "Conditional": Queries involving ranges or inequalities (e.g., greater than, less than)
  
  ### Normalization Rules:
  
  - gender → lowercase (e.g., "male", "female")  
  - payZone → capitalize as "Zone A", "Zone B", etc.  
  - department, performance, marital, status → Title Case  
  - salary, rating → numbers only (e.g., "above 1 lakh" → 100000)  
  - dates (dob, startDate) → convert to "YYYY-MM-DD"  
  - "after 2020" → convert to { "$gt": "2020-01-01" }  
  - metadataConditionalFields use operators: $gt, $gte, $lt, $lte, $eq
  
  ### Count Rule:
  
  - If the user query asks **how many**, **count**, or **number of** matching employees, then set ' "count": true '  
  - Otherwise, set ' "count": false '
  
  ### Examples:
  
  Query: "hi"  
  → {
    "category": "General",
    "whereDocument": [],
    "metadataFilters": {},
    "metadataConditionalFields": {},
    "count": false,
    "originalQuery": "hi"
  }
  
  Query: "what is the salary of oleta?"  
  → {
    "category": "Specific",
    "whereDocument": ["oleta"],
    "metadataFilters": {},
    "metadataConditionalFields": {},
    "count": false,
    "originalQuery": "what is the salary of oleta?"
  }
  
  Query: "who earns more, ram or kayal?"  
  → {
    "category": "Comparative",
    "whereDocument": ["ram", "kayal"],
    "metadataFilters": {},
    "metadataConditionalFields": {},
    "count": false,
    "originalQuery": "who earns more, ram or kayal?"
  }
  
  Query: "list all male employees"  
  → {
    "category": "Aggregate",
    "whereDocument": [],
    "metadataFilters": { "gender": "male" },
    "metadataConditionalFields": {},
    "count": false,
    "originalQuery": "list all male employees"
  }
  
  Query: "how many male employees are there?"  
  → {
    "category": "Aggregate",
    "whereDocument": [],
    "metadataFilters": { "gender": "male" },
    "metadataConditionalFields": {},
    "count": true,
    "originalQuery": "how many male employees are there?"
  }
  
  Query: "employees earning above 1 lakh"  
  → {
    "category": "Conditional",
    "whereDocument": [],
    "metadataFilters": {},
    "metadataConditionalFields": { "salary": { "$gt": 100000 } },
    "count": false,
    "originalQuery": "employees earning above 1 lakh"
  }
  
  Only respond with valid JSON. Do not add any comments or explanations.
  
  User query """${userQuery}"""
  `;
  

  


  
  

  const result = await model.generateContent(prompt);
  const response = result.response.text();

  // ✂️ Clean triple-backtick code block and parse JSON
  const cleaned = response
    .replace(/```json\s*([\s\S]*?)\s*```/, '$1')  // removes ```json ... ```
    .trim();

  try {
    return metajson=JSON.parse(cleaned);
    // metajson=JSON.parse(cleaned);
    // console.log("metajson:",metajson);
    

  } catch (err) {
    console.error('❌ Failed to parse JSON from Gemini:', err.message);
    console.log('Raw output:', response);
    throw new Error('Classification failed.');
  }
}

// classifyQuery("List the number of all the employee who have leaves less than  2 days")

module.exports = { classifyQuery };

