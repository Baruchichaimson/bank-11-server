import { bankTools } from './tools/toolCatalog.js';
import { createToolExecutor } from './tools/toolExecutor.js';
import { createBusinessServices } from './services/businessServices.js';

let defaultExecuteBankTool = null;

const getDefaultExecuteBankTool = () => {
  if (!defaultExecuteBankTool) {
    defaultExecuteBankTool = createToolExecutor({
      services: createBusinessServices()
    });
  }

  return defaultExecuteBankTool;
};

export { bankTools, createToolExecutor };

export const executeBankTool = async ({ name, args = {}, userId } = {}) => (
  getDefaultExecuteBankTool()({ name, args, userId })
);
