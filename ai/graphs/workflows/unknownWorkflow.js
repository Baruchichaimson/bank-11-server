import { getOutOfScopeReply } from '../../shared/shared.js';

export const runUnknownWorkflow = async ({ state }) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
  execution: {
    executed: false,
    result: null
  },
  ui: {
    ...state.ui,
    message: getOutOfScopeReply(state.session.userLanguage),
    suggestions: []
  }
});
