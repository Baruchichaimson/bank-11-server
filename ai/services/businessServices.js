import { executeBankTool } from '../bankingTools.js';
import { createAccountService } from './accountService.js';
import { createProfileService } from './profileService.js';
import { createRiskService } from './riskService.js';
import { createSupportService } from './supportService.js';
import { createTransactionService } from './transactionService.js';

export const createBusinessServices = ({ bankToolExecutor = executeBankTool } = {}) => {
  const accountService = createAccountService({ executeBankTool: bankToolExecutor });
  const profileService = createProfileService({ executeBankTool: bankToolExecutor });

  return {
    accountService,
    transactionService: createTransactionService({
      executeBankTool: bankToolExecutor,
      accountService,
      profileService
    }),
    supportService: createSupportService({ executeBankTool: bankToolExecutor }),
    profileService,
    riskService: createRiskService()
  };
};
