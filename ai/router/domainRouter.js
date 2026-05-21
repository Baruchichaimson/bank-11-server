const DOMAIN_TO_WORKFLOW = {
  profile: 'personal_details_workflow',
  account: 'balance_workflow',
  transactions: 'transactions_workflow',
  support: 'support_workflow',
  unknown: 'unknown_workflow'
};

export const routeWorkflowByDomain = (domain) => DOMAIN_TO_WORKFLOW[domain] || DOMAIN_TO_WORKFLOW.unknown;
