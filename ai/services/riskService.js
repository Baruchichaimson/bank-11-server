import { assessTransferRisk } from '../riskAssessment.js';
import { TransactionRepository } from '../repositories/transactionRepository.js';

export const createRiskService = ({ transactionRepository = new TransactionRepository() } = {}) => ({
  async evaluateRisk(payload) {
    return assessTransferRisk({ ...payload, transactionRepository });
  }
});
