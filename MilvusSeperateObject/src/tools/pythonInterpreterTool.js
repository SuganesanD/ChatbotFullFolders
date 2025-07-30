// src/tools/pythonInterpreterTool.js
const { Tool } = require('@langchain/core/tools');
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
            const pyodidePath = path.resolve(__dirname, '../../node_modules/pyodide');
            console.log(`[PythonInterpreterTool] Pyodide indexURL set to: ${pyodidePath}`);

            pyodideInstance = await loadPyodide({
                indexURL: pyodidePath,
            });

            // Explicitly make StringIO buffers available in Python's global scope
            // and assign sys.stdout/stderr to them.
            await pyodideInstance.runPythonAsync(`
import sys
from io import StringIO

# Create and assign buffers to global variables that can be retrieved
_stdout_buffer = StringIO()
_stderr_buffer = StringIO()
sys.stdout = _stdout_buffer
sys.stderr = _stderr_buffer
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
class PythonInterpreterTool extends Tool {
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
        let pyodide = null;
        try {
            pyodide = await getPyodideInterpreter(); // Get the singleton interpreter instance
            console.log("[PythonInterpreterTool] Executing Python code via python_interpreter_tool...");
            console.log("--- Python Code ---");
            console.log(code);
            console.log("-------------------");

            // Get the global StringIO buffers and clear them before running new code
            const stdoutBuffer = pyodide.globals.get('_stdout_buffer');
            const stderrBuffer = pyodide.globals.get('_stderr_buffer');

            stdoutBuffer.seek(0);
            stdoutBuffer.truncate(0);
            stderrBuffer.seek(0);
            stderrBuffer.truncate(0);

            await pyodide.runPythonAsync(code);

            const output = stdoutBuffer.getvalue();
            const errorOutput = stderrBuffer.getvalue();

            if (output) {
                console.log("[PythonInterpreterTool] Python Output (stdout):", output.trim());
                return output.trim();
            } else if (errorOutput) {
                console.error("[PythonInterpreterTool] Python Output (stderr):", errorOutput.trim());
                return `Python execution error (stderr): ${errorOutput.trim()}`;
            } else {
                console.log("[PythonInterpreterTool] Python script executed, no explicit output (stdout/stderr).");
                return "Python script executed successfully, but produced no explicit output.";
            }
        } catch (error) {
            console.error("[PythonInterpreterTool] Error in python_interpreter_tool (JS side):", error);
            let stderrOutput = "";
            if (pyodide) {
                try {
                    // Attempt to get any error output that might have been written
                    const currentStderrBuffer = pyodide.globals.get('_stderr_buffer');
                    if (currentStderrBuffer) {
                        stderrOutput = currentStderrBuffer.getvalue();
                    }
                } catch (e) {
                    // Ignore errors if stderr cannot be retrieved
                }
            }
            const errorMessage = stderrOutput || error.message;
            console.error("[PythonInterpreterTool] Python Output (stderr/JS error):", errorMessage);
            return `Python execution error: ${errorMessage}. Please check the Python syntax or input data.`;
        }
    }
}

module.exports = PythonInterpreterTool;
