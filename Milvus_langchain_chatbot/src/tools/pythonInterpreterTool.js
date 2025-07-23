// src/tools/pythonInterpreterTool.js
const { tool } = require('@langchain/core/tools');
const { PythonInterpreterTool } = require('@langchain/community/experimental/tools/pyinterpreter');
const path = require('path'); // Import path module

let pythonInterpreter; // Declare a variable to hold the initialized interpreter

/**
 * Initializes the Python interpreter using Pyodide.
 * This function ensures the interpreter is initialized only once.
 * It's crucial that the `indexURL` points to the correct location
 * of your Pyodide installation (typically in node_modules/pyodide/).
 */
async function initializePythonInterpreter() {
  if (!pythonInterpreter) {
    console.log("Initializing Python Interpreter...");
    try {
      // Use path.resolve to ensure the path is correct regardless of where the script is run
      const pyodidePath = path.resolve(__dirname, '../../node_modules/pyodide/');
      console.log(`Pyodide indexURL set to: ${pyodidePath}`);
      
      pythonInterpreter = await PythonInterpreterTool.initialize({
        indexURL: pyodidePath, 
      });
      console.log("Python Interpreter initialized successfully.");
    } catch (error) {
      console.error("Failed to initialize Python Interpreter:", error);
      // Provide more specific guidance for common Pyodide issues
      if (error.message.includes("Failed to load pyodide.js")) {
          console.error("This often means the 'indexURL' path is incorrect or Pyodide is not installed.");
          console.error("Ensure 'npm install pyodide' has been run and the path in 'src/tools/pythonInterpreterTool.js' is accurate.");
      }
      throw new Error("Python Interpreter initialization failed. See console for details.");
    }
  }
  return pythonInterpreter;
}

/**
 * pythonTool is a LangChain tool that wraps the PythonInterpreterTool.
 * It allows the LLM agent to execute arbitrary Python code.
 * This is particularly useful for:
 * - Complex numerical calculations or statistical analysis.
 * - Data manipulation and transformation (e.g., filtering, sorting, aggregation).
 * - Deduplication of records retrieved from Milvus based on specific keys (e.g., employee_id).
 *
 * The LLM is expected to provide valid Python code as input.
 * The tool will return the standard output (stdout) or standard error (stderr) of the executed code.
 */
const pythonTool = tool(
  async (code) => {
    try {
      // Ensure the interpreter is initialized before invoking
      const interpreter = await initializePythonInterpreter();
      console.log("Executing Python code via python_interpreter_tool...");
      console.log("--- Python Code ---");
      console.log(code);
      console.log("-------------------");

      const result = await interpreter.invoke(code);

      // Return stdout or stderr. If no output, return a clear message.
      // LangChain tools typically expect a string output.
      if (result.stdout) {
        console.log("--- Python Output (stdout) ---");
        console.log(result.stdout);
        console.log("------------------------------");
        return result.stdout;
      } else if (result.stderr) {
        console.error("--- Python Output (stderr) ---");
        console.error(result.stderr);
        console.error("------------------------------");
        return `Python execution error: ${result.stderr}`;
      } else {
        console.log("Python script executed, no explicit output (stdout/stderr).");
        return "Python script executed successfully, but produced no explicit output.";
      }
    } catch (error) {
      console.error("Error in python_interpreter_tool:", error);
      // Return a user-friendly error message for the LLM
      return `Error executing Python code: ${error.message}. Please check the Python syntax or input data.`;
    }
  },
  {
    name: "python_interpreter_tool",
    description: `Executes Python code for complex numerical calculations, statistical analysis, or data manipulation.
    This tool is essential for performing aggregations (like average, sum, count) and crucial deduplication on data retrieved from Milvus.
    When processing lists of dictionaries (e.g., Milvus search results), you MUST deduplicate records by a unique identifier (e.g., 'employee_id') before performing aggregations to avoid skewed results.

    Input is a string containing valid Python code. Always ensure your Python code prints the final result to stdout.

    When providing data to the Python interpreter, ensure it's properly formatted as a JSON string within the Python code, which can then be parsed using \`json.loads()\`.
    `
  }
);

module.exports = pythonTool;
