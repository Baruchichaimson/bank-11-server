const INTENT_TO_WORKFLOW = {
  show_personal_details: 'personal_details_workflow',
  check_balance: 'balance_workflow',
  recent_transactions: 'transactions_workflow',
  contact_support: 'support_workflow',
  transfer_money: 'transfer_workflow'
};

export const routeWorkflowByIntent = (intent) => (
  INTENT_TO_WORKFLOW[intent] || 'unknown_workflow'
);

export const routeWorkflow = ({ intent }) => routeWorkflowByIntent(intent);
