import { routeWorkflowByDomain } from './domainRouter.js';

export const routeWorkflowByIntent = (intent) => (intent === 'transfer_money' ? 'transfer_workflow' : 'unknown_workflow');

export const routeWorkflow = ({ intent, domain }) => {
  const byIntent = routeWorkflowByIntent(intent);
  if (byIntent !== 'unknown_workflow') return byIntent;
  return routeWorkflowByDomain(domain);
};
