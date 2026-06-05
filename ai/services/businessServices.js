import { createAccountService } from './accountService.js';
import { createProfileService } from './profileService.js';
import { createRiskService } from './riskService.js';
import { createSupportService } from './supportService.js';
import { createTransactionService } from './transactionService.js';

export const createBusinessServices = () => {
  const accountService = createAccountService();
  const profileService = createProfileService();

  return {
    accountService,
    transactionService: createTransactionService({
      accountService,
      profileService
    }),
    supportService: createSupportService(),
    profileService,
    riskService: createRiskService()
  };
};
