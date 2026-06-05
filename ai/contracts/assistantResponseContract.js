const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const normalizeAction = (action) => {
  if (!action) return null;

  if (typeof action === 'string') {
    return { type: action };
  }

  if (!isPlainObject(action) || typeof action.type !== 'string' || !action.type.trim()) {
    return null;
  }

  const { type, payload, ...rest } = action;
  const normalized = { type };

  if (isPlainObject(payload)) {
    normalized.payload = payload;
  } else if (Object.keys(rest).length) {
    normalized.payload = rest;
  }

  return normalized;
};

const normalizeExecution = (execution = {}) => ({
  executed: Boolean(execution?.executed),
  operation: execution?.operation || null,
  result: isPlainObject(execution?.result) ? execution.result : null
});

export const createWorkflowResponse = ({
  message = '',
  action = null,
  nextConversationState = null,
  execution = {}
} = {}) => ({
  message: String(message || ''),
  action: normalizeAction(action),
  nextConversationState: isPlainObject(nextConversationState) ? nextConversationState : null,
  execution: normalizeExecution(execution)
});

export const createExecutedWorkflowResponse = ({
  message = '',
  action = null,
  nextConversationState = null,
  operation = null,
  result = null
} = {}) => createWorkflowResponse({
  message,
  action,
  nextConversationState,
  execution: {
    executed: true,
    operation,
    result
  }
});

export const createEmptyWorkflowResponse = ({
  message = '',
  action = null,
  nextConversationState = null,
  operation = null,
  result = null
} = {}) => createWorkflowResponse({
  message,
  action,
  nextConversationState,
  execution: {
    executed: false,
    operation,
    result
  }
});

export const normalizeWorkflowResponse = (response = {}) => {
  if (!response) return createEmptyWorkflowResponse();

  if (response.workflowResponse) {
    return normalizeWorkflowResponse(response.workflowResponse);
  }

  const execution = response.execution || {};
  return createWorkflowResponse({
    message: response.message ?? response.reply ?? response.ui?.message ?? '',
    action: response.action ?? response.ui?.action ?? null,
    nextConversationState:
      response.nextConversationState
      ?? response.nextTransferState
      ?? response.transfer?.nextTransferState
      ?? null,
    execution: {
      executed: execution.executed,
      operation: execution.operation ?? null,
      result: execution.result ?? null
    }
  });
};
