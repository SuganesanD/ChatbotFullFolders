// src/index.js
const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatCohere } = require("@langchain/cohere");
const { AIMessage, HumanMessage } = require('@langchain/core/messages');

// Import the agent initialization function
const initializeAgentExecutor = require('./agent/langchainAgent');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS || 'localhost:19530'; // Default to localhost
// const COLLECTION_NAME = 'dynamicRecords';

// --- Input Validation ---
if (!GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// --- Initialize All LLM Clients and Agents at startup ---
let milvusClient;
let agents = {}; // This map will hold our pre-initialized agents

async function setupServer() {
    try {
        milvusClient = new MilvusClient({ address: MILVUS_ADDRESS });

        // Initialize Gemini chat model and its agent once
        const geminiChatModel = new ChatGoogleGenerativeAI({
            apiKey: GOOGLE_API_KEY,
            model: "gemini-2.5-flash",
            temperature: 0.3,
        });
        agents.gemini = await initializeAgentExecutor({ chatModel: geminiChatModel });
        console.log("Gemini AgentExecutor initialized.");

        // Initialize Cohere chat model and its agent once (if API key is available)
        if (COHERE_API_KEY) {
            const cohereChatModel = new ChatCohere({
                apiKey: COHERE_API_KEY,
                model: "command-r-plus", 
                temperature: 0.3,
            });
            agents.cohere = await initializeAgentExecutor({ chatModel: cohereChatModel });
            console.log("Cohere AgentExecutor initialized.");
        } else {
            console.warn("Cohere API key is not set. The 'cohere' model will not be available.");
        }
        
        console.log("All necessary LLM clients and agents are set up.");

    } catch (error) {
        console.error("Failed to initialize Milvus, LLM clients, or agents:", error);
        process.exit(1); // Exit if clients cannot be initialized
    }
}

// Call the setup function immediately
setupServer();


// --- Express App Setup ---
const app = express();

app.use(cors());
app.use(express.json());

// In-memory chat history storage
const chatHistories = new Map();



let collection_list=[]
// --- Chatbot API Endpoint ---
app.post('/api/chatbot', async (req, res) => {
    const { query, sessionId, collectionName, modal } = req.body; 

    console.log("the modal from frontend:", modal);
    console.log("collection_list before check:", collection_list);

    // This is the core change: use 'await' directly on the Milvus client call.
    // The code will now pause here until the collection is loaded or an error occurs.
    if (!collection_list.includes(collectionName)) {
        try {
            console.log(`Attempting to load collection '${collectionName}' into memory for search...`);
            let collection_loading_status = await milvusClient.loadCollection({ collection_name: collectionName });

            console.log("collection_loading_status:", collection_loading_status.code);

            // Handle the case where the collection isn't found
            // Instead of exiting the process, just send an error response to the client
            if (collection_loading_status.code === 100) {
                console.log("Collection not found, loading failed!!!");
                 return res.status(500).json({ error: `Please create the ${collectionName} and try again!!!` });
            }

            collection_list.push(collectionName);
            console.log(`Collection '${collectionName}' loaded successfully for search.`);
        } catch (error) {
            console.error(`ERROR: Failed to load Milvus collection '${collectionName}'. ` +
                `Please ensure Milvus is running, the collection exists, and the index is built. ` +
                `Error: ${error.message}`);
            // Send an error response and stop execution of this handler
            return res.status(500).json({ error: "Server failed to load the required collection. Please check server logs." });
        }
    }

    // All code from here will only run *after* the collection has been loaded successfully.
    console.log("collection_list after check:", collection_list);


    

    if (!query || !sessionId) {
        return res.status(400).json({ error: 'Query and sessionId are required in the request body.' });
    }
    
    // Default to gemini if modal is not specified or is invalid
    const selectedModal = modal && agents[modal] ? modal : 'gemini';
    const agentExecutor = agents[selectedModal];

    // Ensure the selected agent is available
    if (!agentExecutor) {
        console.error(`ERROR: Agent for modal '${selectedModal}' is not available.`);
        return res.status(503).json({ error: "Chatbot service is not ready for the requested model. Please try again with 'gemini'." });
    }

    // Retrieve or initialize chat history for the session
    let currentChatHistory = chatHistories.get(sessionId) || [];
    console.log(`Received query: "${query}" for session: ${sessionId}, using modal: ${selectedModal}`);
    
    try {
        // Invoke the pre-initialized agent. This is a very fast operation.
        const result = await agentExecutor.invoke({
            input: query + `collectionName:${collectionName}`,
            chat_history: currentChatHistory,
        });

        const botResponse = result.output;
        const botResponseText = typeof botResponse === 'string'
            ? botResponse
            : botResponse?.text || '';
        console.log("Agent's final response:", botResponseText);

        // Update chat history with the new turn
        currentChatHistory.push(new HumanMessage(query));
        currentChatHistory.push(new AIMessage(botResponseText));
        chatHistories.set(sessionId, currentChatHistory);

        // Send the agent's response back to the frontend
        res.json({ answer: botResponseText });

    } catch (error) {
        console.error("Error during chatbot interaction:", error);
        const fallbackMessage = "I apologize, but I encountered an error while trying to process your request. Please try again or rephrase your query.";
        res.status(500).json({ error: `An error occurred during processing: ${error.message}.`, answer: fallbackMessage });
    }
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Chatbot backend server listening on port ${PORT}`);
    console.log(`Access the API at http://localhost:${PORT}/api/chatbot`);
});
