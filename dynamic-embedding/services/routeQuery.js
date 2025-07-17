const listEmployees = require('../handlers/listEmployees');
const countEmployees = require('../handlers/countEmployees');
const getSpecificEmployeeInfo = require('../handlers/getSpecificEmployeeInfo');
const compareEmployees = require('../handlers/compareEmployees');
const conditionalQuery = require('../handlers/conditionalQuery');
const handleGeneral = require('../handlers/handleGeneral');
const statisticalInsight = require('../handlers/statisticalInsight');
const groupByAggregate = require('../handlers/groupByAggregate');

// Tool plugins
const generateChart = require('../tools/generateChart');
const exportCSV = require('../tools/exportCSV');
const summarizeData = require('../tools/summarizeData');

const logger = require('./logger'); // optional logger

/**
 * Dispatch classified query to the appropriate handler and tool plugins
 * @param {Object} classified - Classified JSON from LLM
 * @returns {Promise<{ data: any, context: any }>} - raw data + formatted context for LLM
 */
async function routeQuery(classified) {
  const category = classified.category;
  const tools = classified.tools || [];
  let data = [];
  let context = [];

  try {
    logger.info(`🔀 Routing Category: ${category}`);

    // 🧠 Handle main logic based on intent category
    switch (category) {
      case 'Aggregate':
      case 'Conditional':  
        // data = classified.count
        //   ? await countEmployees(classified)
        //   : await listEmployees(classified);
        data=await listEmployees(classified);
        break;

      case 'Specific':
        data = await getSpecificEmployeeInfo(classified);
        break;

      case 'Comparative':
        data = await compareEmployees(classified);
        break;

      case 'Conditional':
        data = await conditionalQuery(classified);
        break;

      case 'General':
        data = await handleGeneral(classified);
        break;

      case 'Statistical':
        data = await statisticalInsight(classified);
        break;

      case 'GroupedAggregate':
        data = await groupByAggregate(classified);
        break;

      default:
        logger.warn(`⚠️ Unknown category '${category}', falling back to handleGeneral`);
        data = await handleGeneral(classified);
        break;
    }

    // 🧩 Execute plugin tools if defined
    for (const tool of tools) {
      try {
        logger.info(`🔧 Executing tool: ${tool}`);
        switch (tool) {
          case 'generateChart':
            data = await generateChart(data, classified);
            break;

          case 'exportCSV':
            await exportCSV(data, classified);
            break;

          case 'summarizeData':
            data = await summarizeData(data, classified);
            break;

          default:
            logger.warn(`⚠️ Unknown tool: ${tool}`);
        }
      } catch (toolErr) {
        logger.error(`❌ Error in tool '${tool}': ${toolErr.message}`);
      }
    }

    // 🎯 Format context for LLM answer generation
    context = Array.isArray(data) ? data : [data];
    console.log("context:",context);
    

    return { data, context };
  } catch (err) {
    logger.error(`❌ routeQuery error: ${err.message}`);
    throw err;
  }
}

module.exports = { routeQuery };
