export const createWorkflowResponse = ({
  message = '',
  action = null,
  nextTransferState = null,
  execution = null,
  suggestions = []
} = {}) => ({
  message,
  action,
  nextTransferState,
  execution: execution || {
    executed: false,
    operation: null,
    result: null
  },
  suggestions: Array.isArray(suggestions) ? suggestions : []
});

export const createExecutedWorkflowResponse = ({
  message = '',
  action = null,
  nextTransferState = null,
  operation = null,
  result = null,
  suggestions = []
} = {}) => createWorkflowResponse({
  message,
  action,
  nextTransferState,
  execution: {
    executed: true,
    operation,
    result
  },
  suggestions
});
