// // src/index.js
// const express = require('express');
// const cors = require('cors');
// const path = require('path');
// require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Ensure .env is loaded from root

// const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
// const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');
// const { AIMessage, HumanMessage } = require('@langchain/core/messages'); // Correct import for message classes

// // Import the agent initialization function
// const initializeAgentExecutor = require('./agent/langchainAgent');

// // --- Configuration ---
// const PORT = process.env.PORT || 3000;
// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
// const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS || 'localhost:19530'; // Default to localhost

// // --- MODIFICATION START ---
// // Define the list of Milvus collection names to be loaded
// const MILVUS_COLLECTIONS_TO_LOAD = ['schools', 'students', 'leaves'];

// // A Set to keep track of which collections have been successfully loaded into Milvus memory.
// // This Set would typically be accessed by your Milvus search tool (wherever it is defined).
// const loadedCollections = new Set();
// // --- MODIFICATION END ---

// // --- Input Validation ---
// if (!GOOGLE_API_KEY) {
//     console.error("ERROR: GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
//     process.exit(1);
// }

// // --- Initialize Milvus and LLM Clients (Global/Singleton) ---
// let milvusClient;
// let embeddings;
// let chatModel;
// let agentExecutor; // Declare agentExecutor here

// try {
//     milvusClient = new MilvusClient({ address: MILVUS_ADDRESS });
//     embeddings = new GoogleGenerativeAIEmbeddings({
//         apiKey: GOOGLE_API_KEY,
//         model: "embedding-001",
//     });
//     chatModel = new ChatGoogleGenerativeAI({
//         apiKey: GOOGLE_API_KEY,
//         model: "gemini-1.5-flash", // Changed to 1.5-flash, generally better for tool calling
//         temperature: 0.3,
//     });
//     console.log("Milvus, Embeddings, and Chat Model clients initialized.");

//     // Initialize the agent executor after all dependencies are ready
//     // We pass the initialized chatModel to the agent initialization function
//     // IMPORTANT: Ensure your './agent/langchainAgent.js' initializes the agent with the necessary tools
//     // and that those tools have access to `milvusClient`, `embeddings`, and the `loadedCollections` set.
//     initializeAgentExecutor({ chatModel }).then(executor => {
//         agentExecutor = executor;
//         console.log("LangChain AgentExecutor initialized.");
//     }).catch(error => {
//         console.error("Failed to initialize LangChain AgentExecutor:", error);
//         process.exit(1);
//     });

// } catch (error) {
//     console.error("Failed to initialize Milvus or LLM clients:", error);
//     process.exit(1); // Exit if clients cannot be initialized
// }

// // --- Express App Setup ---
// const app = express();

// // Enable CORS for all origins (for development). In production, restrict to your frontend's origin.
// app.use(cors());
// app.use(express.json()); // Enable JSON body parsing

// // In-memory chat history storage (for demonstration purposes)
// // In a real application, you'd use a database for persistent storage
// const chatHistories = new Map(); // Maps sessionId to an array of chat messages

// // --- Milvus Collection Loading on Server Start ---
// // This is crucial for performance: load collections once when the server starts
// // instead of on every incoming chat request.

// // --- MODIFICATION START ---
// async function loadMilvusCollections() { // Renamed from loadMilvusCollection
//     for (const collectionName of MILVUS_COLLECTIONS_TO_LOAD) { // Loop through the defined collection names
//         try {
//             console.log(`Attempting to load collection '${collectionName}' into memory for search...`);
//             await milvusClient.loadCollection({ collection_name: collectionName });
//             console.log(`Collection '${collectionName}' loaded successfully for search.`);
//             loadedCollections.add(collectionName); // Add the name to our set of loaded collections
//         } catch (error) {
//             console.error(`ERROR: Failed to load Milvus collection '${collectionName}'. ` +
//                 `Please ensure Milvus is running, the collection exists, and the index is built. ` +
//                 `Error: ${error.message}`);
//             // For now, we'll log and allow the server to start, but queries against this collection will fail
//             // if it couldn't be loaded.
//         }
//     }
// }

// // Call the loading function when the server starts
// loadMilvusCollections(); // Updated function call
// // --- MODIFICATION END ---

// // --- Chatbot API Endpoint ---
// app.post('/api/chatbot', async (req, res) => {
//     const { query, sessionId } = req.body; // Expect a sessionId from the frontend

//     if (!query) {
//         return res.status(400).json({ error: 'Query is required in the request body.' });
//     }
//     if (!sessionId) {
//         // For demonstration, if no session ID, generate a simple one.
//         // In production, enforce a proper session management.
//         console.warn("No sessionId provided. Generating a temporary one.");
//         req.body.sessionId = 'temp_session_' + Date.now();
//     }

//     // Ensure agentExecutor is initialized before proceeding
//     if (!agentExecutor) {
//         console.error("AgentExecutor not yet initialized. Please wait or check initialization errors.");
//         return res.status(503).json({ error: "Chatbot service is not ready. Please try again in a moment." });
//     }

//     // Retrieve or initialize chat history for the session
//     let currentChatHistory = chatHistories.get(sessionId) || [];
//     console.log(`Received query: "${query}" for session: ${sessionId}`);
//     console.log("Current chat history length:", currentChatHistory.length);

//     try {
//         // Invoke the agent with the current input and chat history.
//         // The agentExecutor will internally manage the ReAct loop.
//         const result = await agentExecutor.invoke({
//             input: query,
//             chat_history: currentChatHistory, // Pass the chat history to the agent
//         });

//         const botResponseText = result.output;
//         console.log("Agent's final response:", botResponseText);

//         // Update chat history with the new turn
//         currentChatHistory.push(new HumanMessage(query)); // Correct usage
//         currentChatHistory.push(new AIMessage(botResponseText)); // Correct usage
//         chatHistories.set(sessionId, currentChatHistory);

//         // Send the agent's response back to the frontend
//         res.json({ answer: botResponseText });

//     } catch (error) {
//         console.error("Error during chatbot interaction:", error);
//         // If the agent fails, try to provide a fallback or inform the user
//         const fallbackMessage = "I apologize, but I encountered an error while trying to process your request. Please try again or rephrase your query.";
//         res.status(500).json({ error: `An error occurred during processing: ${error.message}.`, answer: fallbackMessage });
//     }
// });

// // --- Start the Server ---
// app.listen(PORT, () => {
//     console.log(`Chatbot backend server listening on port ${PORT}`);
//     console.log(`Access the API at http://localhost:${PORT}/api/chatbot`);
// });


// src/index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); // Ensure .env is loaded from root

const { MilvusClient } = require('@zilliz/milvus2-sdk-node');
const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { AIMessage, HumanMessage } = require('@langchain/core/messages'); // Correct import for message classes

// Import the agent initialization function
const initializeAgentExecutor = require('./agent/langchainAgentobject');
// const initializeAgentExecutorobject = require('../../MilvusSeperateObject/src/agent/langchainAgentobject');

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const MILVUS_ADDRESS = process.env.MILVUS_ADDRESS || 'localhost:19530'; // Default to localhost

// --- MODIFICATION START ---
// Define the list of Milvus collection names to be loaded
const MILVUS_COLLECTIONS_TO_LOAD = ['schools', 'students', 'leaves'];

// A Set to keep track of which collections have been successfully loaded into Milvus memory.
// This Set will be passed to your tools.
const loadedCollections = new Set();
// --- MODIFICATION END ---

// --- Input Validation ---
if (!GOOGLE_API_KEY) {
    console.error("ERROR: GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
    process.exit(1);
}

// --- Initialize Milvus and LLM Clients (Global/Singleton) ---
let milvusClient;
let embeddings;
let chatModel;
let agentExecutor; // Declare agentExecutor here

try {
    milvusClient = new MilvusClient({ address: MILVUS_ADDRESS });
    embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: GOOGLE_API_KEY,
        model: "embedding-001",
    });
    chatModel = new ChatGoogleGenerativeAI({
        apiKey: GOOGLE_API_KEY,
        model: "gemini-1.5-flash", // Changed to 1.5-flash, generally better for tool calling
        temperature: 0.3,
    });
    console.log("Milvus, Embeddings, and Chat Model clients initialized.");

    // Initialize the agent executor after all dependencies are ready
    // We now pass all necessary instances for the tools to operate correctly.
    initializeAgentExecutor({
        chatModel,
        milvusClientInstance: milvusClient,         // Pass the Milvus client instance
        embeddingsInstance: embeddings,             // Pass the embeddings instance
        loadedCollectionsSet: loadedCollections,    // Pass the set of loaded collection names
        milvusCollections: MILVUS_COLLECTIONS_TO_LOAD // Pass the list of all available collections
    }).then(executor => {
        agentExecutor = executor;
        console.log("LangChain AgentExecutor initialized.");
    }).catch(error => {
        console.error("Failed to initialize LangChain AgentExecutor:", error);
        process.exit(1);
    });

} catch (error) {
    console.error("Failed to initialize Milvus or LLM clients:", error);
    process.exit(1); // Exit if clients cannot be initialized
}

// --- Express App Setup ---
const app = express();

// Enable CORS for all origins (for development). In production, restrict to your frontend's origin.
app.use(cors());
app.use(express.json()); // Enable JSON body parsing

// In-memory chat history storage (for demonstration purposes)
// In a real application, you'd use a database for persistent storage
const chatHistories = new Map(); // Maps sessionId to an array of chat messages

// --- Milvus Collection Loading on Server Start ---
// This is crucial for performance: load collections once when the server starts
// instead of on every incoming chat request.

async function loadMilvusCollections() { // Renamed from loadMilvusCollection
    for (const collectionName of MILVUS_COLLECTIONS_TO_LOAD) { // Loop through the defined collection names
        try {
            console.log(`Attempting to load collection '${collectionName}' into memory for search...`);
            await milvusClient.loadCollection({ collection_name: collectionName });
            console.log(`Collection '${collectionName}' loaded successfully for search.`);
            loadedCollections.add(collectionName); // Add the name to our set of loaded collections
        } catch (error) {
            console.error(`ERROR: Failed to load Milvus collection '${collectionName}'. ` +
                `Please ensure Milvus is running, the collection exists, and the index is built. ` +
                `Error: ${error.message}`);
            // For now, we'll log and allow the server to start, but queries against this collection will fail
            // if it couldn't be loaded.
        }
    }
}

// Call the loading function when the server starts
loadMilvusCollections();

// --- Chatbot API Endpoint ---
app.post('/api/chatbot', async (req, res) => {
    const { query, sessionId } = req.body; // Expect a sessionId from the frontend

    if (!query) {
        return res.status(400).json({ error: 'Query is required in the request body.' });
    }
    if (!sessionId) {
        // For demonstration, if no session ID, generate a simple one.
        // In production, enforce a proper session management.
        console.warn("No sessionId provided. Generating a temporary one.");
        req.body.sessionId = 'temp_session_' + Date.now();
    }

    // Ensure agentExecutor is initialized before proceeding
    if (!agentExecutor) {
        console.error("AgentExecutor not yet initialized. Please wait or check initialization errors.");
        return res.status(503).json({ error: "Chatbot service is not ready. Please try again in a moment." });
    }

    // Retrieve or initialize chat history for the session
    let currentChatHistory = chatHistories.get(sessionId) || [];
    console.log(`Received query: "${query}" for session: ${sessionId}`);
    console.log("Current chat history length:", currentChatHistory.length);

    try {
        // Invoke the agent with the current input and chat history.
        // The agentExecutor will internally manage the ReAct loop.
        const result = await agentExecutor.invoke({
            input: query,
            chat_history: currentChatHistory, // Pass the chat history to the agent
        });

        const botResponseText = result.output;
        console.log("Agent's final response:", botResponseText);

        // Update chat history with the new turn
        currentChatHistory.push(new HumanMessage(query)); // Correct usage
        currentChatHistory.push(new AIMessage(botResponseText)); // Correct usage
        chatHistories.set(sessionId, currentChatHistory);

        // Send the agent's response back to the frontend
        res.json({ answer: botResponseText });

    } catch (error) {
        console.error("Error during chatbot interaction:", error);
        // If the agent fails, try to provide a fallback or inform the user
        const fallbackMessage = "I apologize, but I encountered an error while trying to process your request. Please try again or rephrase your query.";
        res.status(500).json({ error: `An error occurred during processing: ${error.message}.`, answer: fallbackMessage });
    }
});

// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Chatbot backend server listening on port ${PORT}`);
    console.log(`Access the API at http://localhost:${PORT}/api/chatbot`);
});