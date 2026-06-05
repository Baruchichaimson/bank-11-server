import { bankTools } from './tools/toolCatalog.js';
import { createBusinessServices } from './services/businessServices.js';
import { createToolExecutor } from './tools/toolExecutor.js';

export { bankTools };

export const executeBankTool = async ({ name, args = {}, userId }) => {
  const services = createBusinessServices();
  const executeTool = createToolExecutor({ services });
  return executeTool({ name, args, userId });
};
