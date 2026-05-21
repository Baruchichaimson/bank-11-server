import { assessTransferRisk } from '../riskAssessment.js';

export const createRiskService = () => ({
  async evaluateRisk(payload) {
    return assessTransferRisk(payload);
  }
});
