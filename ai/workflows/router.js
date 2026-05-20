import { handleTransferWorkflow } from './transferWorkflow.js';
import { handleBalanceWorkflow } from './balanceWorkflow.js';
import { handleTransactionsWorkflow } from './transactionsWorkflow.js';
import { handleLoanWorkflow } from './loanWorkflow.js';
import { handleSupportWorkflow } from './supportWorkflow.js';
import { handleGeneralBankingWorkflow } from './generalBankingWorkflow.js';
import { createReplyPayload, getOutOfScopeReply } from './shared.js';

export const routeWorkflow = async (intent, ctx) => {
  if (intent === 'transfer_workflow') return handleTransferWorkflow(ctx);
  if (intent === 'balance_workflow') return handleBalanceWorkflow(ctx);
  if (intent === 'transactions_workflow') return handleTransactionsWorkflow(ctx);
  if (intent === 'loan_workflow') return handleLoanWorkflow(ctx);
  if (intent === 'support_workflow') return handleSupportWorkflow(ctx);
  if (intent === 'general_banking_workflow') return handleGeneralBankingWorkflow(ctx);
  return createReplyPayload({
    history: ctx.shortHistory,
    userText: ctx.trimmed,
    reply: getOutOfScopeReply(ctx.userLanguage),
    transferState: ctx.transferState,
    action: null
  });
};
