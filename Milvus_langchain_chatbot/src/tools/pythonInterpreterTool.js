// standalone code

// const path = require('path');
// require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// const { ChatPromptTemplate } = require('@langchain/core/prompts');
// const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
// const { StringOutputParser } = require('@langchain/core/output_parsers');
// const readline = require('readline');
// const { loadPyodide } = require('pyodide');

// const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// if (!GOOGLE_API_KEY) {
//   console.error("GOOGLE_API_KEY environment variable is not set. Please set it in your .env file.");
//   process.exit(1);
// }

// // Initialize Gemini model
// const model = new ChatGoogleGenerativeAI({
//   apiKey: GOOGLE_API_KEY,
//   model: 'gemini-1.5-flash',
//   temperature: 0,
// });

// // Define prompt to generate Python code
// const prompt = ChatPromptTemplate.fromTemplate(
//   `Generate Python code that performs the following task: {input}. 
//   Output only the Python code, nothing else.`
// );

// // Clean generated code to remove Markdown formatting
// function cleanPythonCode(code) {
//   // Remove ```python and ``` markers, trim whitespace
//   return code
//     .replace(/```python\n/, '')
//     .replace(/```\n/, '')
//     .replace(/```/, '')
//     .trim();
// }

// // Initialize Pyodide
// async function initializePyodide() {
//   try {
//     const pyodide = await loadPyodide({
//       indexURL: '../../node_modules/pyodide', // Adjusted for src/tools
//     });
//     // Ensure sys module for stdout capture
//     await pyodide.runPythonAsync(`
// import sys
// from io import StringIO
// sys.stdout = StringIO()
//     `);
//     return pyodide;
//   } catch (error) {
//     console.error('Error initializing Pyodide:', error.message);
//     console.error('Ensure pyodide@0.26.4 is installed (npm install pyodide@0.26.4) and indexURL is correct.');
//     process.exit(1);
//   }
// }

// // Main function to run the chain
// async function runPythonCode() {
//   const pyodide = await initializePyodide();
//   const chain = prompt.pipe(model).pipe(new StringOutputParser());

//   const rl = readline.createInterface({
//     input: process.stdin,
//     output: process.stdout,
//   });

//   // Get user input
//   rl.question('Enter a task for Python (e.g., "Calculate the square of 5"): ', async (input) => {
//     try {
//       const pythonCode = await chain.invoke({ input });
//       const cleanedCode = cleanPythonCode(pythonCode);
//       console.log('Generated Python Code:', cleanedCode);
//       await pyodide.runPythonAsync(cleanedCode);
//       const output = pyodide.globals.get('sys').stdout.getvalue();
//       console.log('Python Output:', output || 'No output');
//     } catch (error) {
//       console.error('Error executing Python code:', error.message);
//     }
//     rl.close();
//   });
// }

// runPythonCode();




// //langcaintool
// // src/tools/pythonInterpreterTool.js
// const { Tool } = require('@langchain/core/tools');
// const { z } = require('zod');
// const { loadPyodide } = require('pyodide');
// const path = require('path');

// let pyodideInstance = null; // Singleton instance for Pyodide

// /**
//  * Initializes the Pyodide interpreter. This ensures Pyodide is loaded only once.
//  * @returns {Promise<object>} The Pyodide interpreter instance.
//  */
// async function getPyodideInterpreter() {
//     if (!pyodideInstance) {
//         console.log("Initializing Python Interpreter (Pyodide)...");
//         try {
//             // Adjust indexURL based on where your node_modules/pyodide is relative to this tool file.
//             // Assuming src/tools/pythonInterpreterTool.js, so two levels up to node_modules.
//             const pyodidePath = path.resolve(__dirname, '../../node_modules/pyodide');
//             console.log(`Pyodide indexURL set to: ${pyodidePath}`);

//             pyodideInstance = await loadPyodide({
//                 indexURL: pyodidePath,
//             });

//             // Ensure sys module for stdout capture is set up
//             await pyodideInstance.runPythonAsync(`
// import sys
// from io import StringIO
// sys.stdout = StringIO()
//             `);
//             console.log("Python Interpreter (Pyodide) initialized successfully.");
//         } catch (error) {
//             console.error("Failed to initialize Python Interpreter (Pyodide):", error);
//             if (error.message.includes("Failed to load pyodide.js")) {
//                 console.error("This often means the 'indexURL' path is incorrect or Pyodide is not installed.");
//                 console.error("Ensure 'npm install pyodide' has been run and the path in 'src/tools/pythonInterpreterTool.js' is accurate.");
//             }
//             throw new Error("Python Interpreter initialization failed. See console for details.");
//         }
//     }
//     return pyodideInstance;
// }

/**
 * PythonInterpreterTool extends LangChain's Tool class to allow the LLM agent
 * to execute Python code.
 *
 * This tool is particularly useful for:
 * - Complex numerical calculations or statistical analysis.
 * - Data manipulation and transformation (e.g., filtering, sorting, aggregation)
 * on data retrieved from other tools (like Milvus).
 * - Deduplication of records.
 *
 * The LLM is expected to provide valid Python code as input.
 * The tool will return the standard output (stdout) or standard error (stderr)
 * of the executed code.
 */
// src/tools/pythonInterpreterTool.js
const { Tool } = require('@langchain/core/tools'); // Ensure Tool class is imported
const { z } = require('zod');
const { loadPyodide } = require('pyodide');
const path = require('path');

let pyodideInstance = null; // Singleton instance for Pyodide

/**
 * Initializes the Pyodide interpreter. This ensures Pyodide is loaded only once.
 * @returns {Promise<object>} The Pyodide interpreter instance.
 */
async function getPyodideInterpreter() {
    if (!pyodideInstance) {
        console.log("[PythonInterpreterTool] Initializing Python Interpreter (Pyodide)...");
        try {
            // Adjust indexURL based on where your node_modules/pyodide is relative to this tool file.
            // Assuming src/tools/pythonInterpreterTool.js, so two levels up to node_modules.
            const pyodidePath = path.resolve(__dirname, '../../node_modules/pyodide');
            console.log(`[PythonInterpreterTool] Pyodide indexURL set to: ${pyodidePath}`);

            pyodideInstance = await loadPyodide({
                indexURL: pyodidePath,
            });

            // Ensure sys module for stdout capture is set up
            await pyodideInstance.runPythonAsync(`
import sys
from io import StringIO
sys.stdout = StringIO()
            `);
            console.log("[PythonInterpreterTool] Python Interpreter (Pyodide) initialized successfully.");
        } catch (error) {
            console.error("[PythonInterpreterTool] Failed to initialize Python Interpreter (Pyodide):", error);
            if (error.message.includes("Failed to load pyodide.js")) {
                console.error("[PythonInterpreterTool] This often means the 'indexURL' path is incorrect or Pyodide is not installed.");
                console.error("[PythonInterpreterTool] Ensure 'npm install pyodide' has been run and the path in 'src/tools/pythonInterpreterTool.js' is accurate.");
            }
            throw new Error("Python Interpreter initialization failed. See console for details.");
        }
    }
    return pyodideInstance;
}

/**
 * PythonInterpreterTool extends LangChain's Tool class to allow the LLM agent
 * to execute Python code.
 *
 * This tool is particularly useful for:
 * - Complex numerical calculations or statistical analysis.
 * - Data manipulation and transformation (e.g., filtering, sorting, aggregation)
 * on data retrieved from other tools (like Milvus).
 * - Deduplication of records.
 *
 * The LLM is expected to provide valid Python code as input.
 * The tool will return the standard output (stdout) or standard error (stderr)
 * of the executed code.
 */
class PythonInterpreterTool extends Tool { // This class extends Tool directly
    name = "python_interpreter_tool";

    description = `
    Executes Python code for complex numerical calculations, statistical analysis, or data manipulation.
    This tool is essential for performing aggregations (like average, sum, count) and deduplication on data.

    Input is a string containing valid Python code. Always ensure your Python code prints the final result to stdout.

    When providing data to the Python interpreter (e.g., Milvus search results), you MUST format it as a JSON string
    within the Python code, which can then be parsed using \`import json; data = json.loads(your_json_string)\`.
    For example, if you get Milvus results as a JSON string, you can process them like this:
    \`\`\`python
    import json
    milvus_results_json = """[{"score": 0.7, "id": "REC_001", "value": 10}, {"score": 0.6, "id": "REC_002", "value": 20}]"""
    data = json.loads(milvus_results_json)
    # Perform calculations, e.g., average of 'value'
    values = [item['value'] for item in data]
    average = sum(values) / len(values)
    print(average)
    \`\`\`
    Remember to deduplicate records by a unique identifier (e.g., 'docId' or 'leaveId') before performing aggregations to avoid skewed results if the data might contain duplicates.
    `;

    schema = z.object({
        code: z.string().describe("The Python code string to execute.")
    });

    /**
     * Executes the provided Python code using the Pyodide interpreter.
     * @param {object} input - The input object containing the 'code' string.
     * @returns {Promise<string>} The standard output or error from the Python execution.
     */
    async _call(input) {
        const { code } = input;
        try {
            const pyodide = await getPyodideInterpreter(); // Get the singleton interpreter instance
            console.log("[PythonInterpreterTool] Executing Python code via python_interpreter_tool...");
            console.log("--- Python Code ---");
            console.log(code);
            console.log("-------------------");

            await pyodide.runPythonAsync(code);
            const output = pyodide.globals.get('sys').stdout.getvalue();
            pyodide.globals.get('sys').stdout = pyodide.globals.get('io').StringIO(); // Reset stdout

            if (output) {
                console.log("[PythonInterpreterTool] Python Output (stdout):", output.trim());
                return output.trim(); // Trim to remove trailing newlines
            } else {
                console.log("[PythonInterpreterTool] Python script executed, no explicit output (stdout/stderr).");
                return "Python script executed successfully, but produced no explicit output.";
            }
        } catch (error) {
            console.error("[PythonInterpreterTool] Error in python_interpreter_tool:", error);
            // Attempt to capture Python-specific errors from Pyodide's stderr
            let stderrOutput = "";
            if (pyodideInstance) {
                try {
                    stderrOutput = pyodideInstance.globals.get('sys').stderr.getvalue();
                    pyodideInstance.globals.get('sys').stderr = pyodideInstance.globals.get('io').StringIO(); // Reset stderr
                } catch (e) {
                    // Ignore errors if stderr cannot be retrieved
                }
            }
            const errorMessage = stderrOutput || error.message;
            console.error("[PythonInterpreterTool] Python Output (stderr):", errorMessage);
            return `Python execution error: ${errorMessage}. Please check the Python syntax or input data.`;
        }
    }
}

module.exports = PythonInterpreterTool;
