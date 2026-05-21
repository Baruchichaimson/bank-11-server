const INTENT_TO_WORKFLOW = {
  transfer_money: 'transfer_workflow',
  recent_transactions: 'transactions_workflow',
  check_balance: 'balance_workflow',
  contact_support: 'support_workflow',
  show_personal_details: 'personal_details_workflow',
  unknown: 'unknown_workflow'
};

export const routeWorkflowByIntent = (intent) => INTENT_TO_WORKFLOW[intent] || 'unknown_workflow';

export const routeWorkflow = ({ intent, transferState }) => {
  if (transferState?.phase && transferState.phase !== 'idle') {
    return 'transfer_workflow';
  }

  return routeWorkflowByIntent(intent);
};
