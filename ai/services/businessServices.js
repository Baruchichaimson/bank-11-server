import { executeBankTool } from '../bankingTools.js';
import { createAccountService } from './accountService.js';
import { createProfileService } from './profileService.js';
import { createRiskService } from './riskService.js';
import { createSupportService } from './supportService.js';
import { createTransactionService } from './transactionService.js';

export const createBusinessServices = ({ bankToolExecutor = executeBankTool } = {}) => ({
  accountService: createAccountService({ executeBankTool: bankToolExecutor }),
  transactionService: createTransactionService({ executeBankTool: bankToolExecutor }),
  supportService: createSupportService({ executeBankTool: bankToolExecutor }),
  profileService: createProfileService({ executeBankTool: bankToolExecutor }),
  riskService: createRiskService()
});
