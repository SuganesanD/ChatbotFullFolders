// src/agent/langchainAgent.js
const { AgentExecutor } = require('langchain/agents');
const { createToolCallingAgent } = require('langchain/agents');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { AIMessage, HumanMessage } = require('@langchain/core/messages');

// Import your custom tools
const MilvusSearchTool = require('../tools/milvusSearchTools');
const PythonInterpreterTool = require('../tools/pythonInterpreterTool'); // Import the refactored Python tool

/**
 * Initializes and returns the LangChain AgentExecutor.
 * @param {object} params
 * @param {ChatGoogleGenerativeAI} params.chatModel The initialized ChatGoogleGenerativeAI model.
 * @returns {AgentExecutor} The configured LangChain AgentExecutor.
 */
async function initializeAgentExecutor({ chatModel }) {
    const milvusSearchToolInstance = new MilvusSearchTool();
    const pythonInterpreterToolInstance = new PythonInterpreterTool(); // Instantiate the Python tool

    // Add all available tools here.
    const tools = [milvusSearchToolInstance, pythonInterpreterToolInstance]; // Include Python tool

    const agentPrompt = ChatPromptTemplate.fromMessages([
        new AIMessage("You are a helpful AI assistant tasked with answering questions about student leave records and school information. You have access to a `milvus_search_tool` to retrieve relevant information from a Milvus vector database, and a `python_interpreter_tool` for performing complex calculations."),

        // **CRITICAL: ENFORCING SEQUENTIAL EXECUTION AND QUERY DECOMPOSITION**
        new AIMessage("Your primary goal is to answer the user's question accurately and completely. If a user asks a multi-part question, you MUST break it down into distinct, sequential sub-problems. Address one sub-problem at a time by performing a single tool action, observing the result, and then deciding the next logical step."),
        new AIMessage("Do NOT attempt to answer multiple parts of a question or call multiple tools in a single action. Always complete one 'Thought -> Action -> Observation' cycle before proceeding to the next sub-problem."),
        new AIMessage("For example, if asked 'What is X and what is Y?', your thought process should be: 'Thought: First, I need to find X. Action: Call tool for X. Observation: X found. Thought: Now, I need to find Y. Action: Call tool for Y. Observation: Y found. Thought: I have both X and Y, now I can combine them into a final answer.'"),

        new AIMessage("When the user asks about a specific entity (e.g., a student by name, a school by name, or a specific leave ID), you MUST use the `filter` parameter in `milvus_search_tool` to precisely narrow down the results. For example, if the user asks about 'Tina Garcia', your filter should be `studentName == \"Tina Garcia\"`. Always include the `studentName` field in `outputFields` if filtering by student name to confirm the match. If the filter yields no results, consider a broader query or state that the specific entity was not found."),

        new AIMessage("If the user asks for information that can be filtered, construct a `filter` expression using available fields like `studentName`, `leaveType`, `leaveStatus`, `schoolName`, `leaveStartDateUnix`, `leaveEndDateUnix`, `leaveIsEmergency`, `studentGradeLevel`, `schoolCity` etc. Ensure to convert dates to Unix timestamps (seconds since epoch) for `leaveStartDateUnix` and `leaveEndDateUnix` if a date range is specified in the query. Boolean values in filters should be 'true' or 'false' (lowercase)."),
        new AIMessage("If you need to extract specific fields, use the `outputFields` parameter, otherwise, the tool will return a default set."),

        // **INSTRUCTIONS FOR USING PYTHON INTERPRETER TOOL (ENHANCED for Type Conversion):**
        new AIMessage("For questions requiring calculations (e.g., 'average', 'sum', 'count'), you MUST use the `python_interpreter_tool`."),
        new AIMessage("Before using `python_interpreter_tool` for calculations, you MUST first use `milvus_search_tool` to retrieve all necessary raw data (e.g., all `schoolEstablishedDate` values). When retrieving data for calculations, use `outputFields` to get only the necessary fields and use a broad or no filter to get all relevant records."),
        new AIMessage("When calling `python_interpreter_tool`, provide the Python code as a string. Your Python code should include `import json`. To embed the JSON string received from a previous tool's observation, use Python's triple-quoted strings (`\"\"\"...\"\"\"`) to handle multi-line JSON data without issues. Then, parse it using `json.loads()`. **IMPORTANT: If numerical values (like years, grades) are returned as strings, you MUST convert them to integers or floats within your Python code before performing calculations.** Ensure your Python code prints the final calculated result to standard output (stdout)."),
        new AIMessage("Example Python code for averaging dates from an observation, including string to integer conversion:"),
        new AIMessage("```python\nimport json\n# Assume 'milvus_results_json_string' is the observation from milvus_search_tool\nmilvus_results_json = \"\"\"[{\"schoolEstablishedYear\": \"2000\"}, {\"schoolEstablishedYear\": \"2005\"}, {\"schoolEstablishedYear\": \"1998\"}]\"\"\"\ndata = json.loads(milvus_results_json)\ndates_as_strings = [item['schoolEstablishedYear'] for item in data]\n# Convert strings to integers\ndates = [int(date_str) for date_str in dates_as_strings]\n# Handle empty list to prevent division by zero\nif len(dates) > 0:\n    average = sum(dates) / len(dates)\n    print(average)\nelse:\n    print(\"No school established dates found to calculate average.\")\n```"),
        new AIMessage("Always ensure the JSON string you embed into the Python code is valid and correctly escaped if necessary, though triple quotes usually handle it. Pay close attention to the field names (e.g., 'schoolEstablishedYear')."),


        new AIMessage("For general knowledge questions or if the tools do not provide relevant information, use your own knowledge or state that you cannot find the information."),
        new AIMessage("If the user's input is a greeting (e.g., 'hi', 'hello') or a simple conversational remark that does not require searching for information, respond naturally and politely without attempting to use any tools. For example, if the user says 'hi', you can respond with 'Hello! How can I help you with student leave records today?'"),

        new MessagesPlaceholder("chat_history"),
        ["human", "{input}"],
        new MessagesPlaceholder("agent_scratchpad"),
    ]);

    const agent = createToolCallingAgent({
        llm: chatModel,
        tools,
        prompt: agentPrompt,
    });

    const agentExecutor = new AgentExecutor({
        agent,
        tools,
        verbose: false, // Keeping this false for concise logs, as requested
        maxIterations: 10,
    });

    return agentExecutor;
}

module.exports = initializeAgentExecutor;
