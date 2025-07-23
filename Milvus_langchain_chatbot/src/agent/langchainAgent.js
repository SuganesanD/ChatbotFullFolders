// src/agent/employeeAgent.js
const { AgentExecutor, createReactAgent } = require('@langchain/agents');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const milvusSearchTool = require('../tools/milvusSearchTool'); // Import the Milvus search tool
const pythonTool = require('../tools/pythonInterpreterTool');   // Import the Python interpreter tool
require('dotenv').config(); // Load environment variables

// Initialize LLM for the agent
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  modelName: "gemini-2.0-flash", // Using Gemini 2.0 Flash for agent reasoning
  temperature: 0, // Lower temperature for more deterministic tool calls and reasoning
});

// Define the tools available to the agent
// The agent will decide which tool to use based on the user's query and the tool descriptions.
const tools = [milvusSearchTool, pythonTool];

// Define the agent's prompt template
// This prompt guides the LLM on its role, how to use the tools, and the ReAct pattern.
const agentPrompt = ChatPromptTemplate.fromMessages([
  ["system", `You are a helpful AI assistant specialized in employee data. You have access to the following tools:
    {tools}

    You should follow the Thought-Action-Observation-Thought-Action-Observation... pattern.
    When you have gathered all necessary information and performed any required calculations, respond with Final Answer: [your answer].
    
    When processing lists of dictionaries (e.g., Milvus search results) that represent employee records, remember that Milvus might return multiple documents for the same employee (e.g., different skill descriptions or performance reviews for the same 'employee_id').
    Therefore, before performing any calculation or aggregation that requires unique employee data (like average salary, count of unique employees, or total employees), you MUST use the 'python_interpreter_tool' to deduplicate the results based on a unique identifier such as 'employee_id'.
    
    Always aim to provide a clear, concise, and accurate answer based on the information retrieved from the tools.
    If a query asks for information that cannot be found or calculated with the available tools, state that you don't have enough information.
    `],
  ["human", "{input}"], // This is where the user's query will be inserted
  ["placeholder", "{agent_scratchpad}"], // This placeholder is crucial for the ReAct pattern, holding the history of Thought/Action/Observation steps
]);

// Create the ReAct agent
// This combines the LLM, tools, and prompt to form the intelligent agent.
const agent = createReactAgent({
  llm,
  tools,
  prompt: agentPrompt,
});

// Create the Agent Executor
// The Agent Executor is responsible for running the agent, managing the ReAct loop,
// executing tool calls, and passing observations back to the agent.
const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: true, // Set to true to see the agent's internal Thought/Action/Observation steps in the console.
                  // This is invaluable for debugging and understanding the agent's reasoning.
  maxIterations: 15, // Maximum number of Thought/Action/Observation steps the agent can take.
                      // This prevents infinite loops in complex scenarios.
});

module.exports = agentExecutor;
