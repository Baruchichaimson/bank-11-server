const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const normalizeConfidence = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, 0), 1);
};

const normalizeObjectOrNull = (value) => (
  isPlainObject(value) ? value : null
);

const normalizeWorkflowContinuation = (value) => {
  if (isPlainObject(value)) return value;
  return value === true ? { active: true } : null;
};

const normalizeTool = ({ tool = null, toolName = null, toolArgs = {} } = {}) => {
  const rawName = isPlainObject(tool) ? tool.name : toolName || tool;
  const name = String(rawName || '').trim();
  if (!name) return null;

  const rawArgs = isPlainObject(tool) ? tool.args : toolArgs;
  return {
    name,
    args: isPlainObject(rawArgs) ? rawArgs : {}
  };
};

const normalizeAmbiguity = ({ ambiguity = null, isAmbiguous = false, ambiguityReason = null } = {}) => {
  const raw = isPlainObject(ambiguity) ? ambiguity : null;
  const reason = raw?.reason ?? ambiguityReason ?? null;
  const options = Array.isArray(raw?.options) ? raw.options : null;
  const ambiguous = Boolean(raw?.isAmbiguous || isAmbiguous || reason || options?.length);

  if (!ambiguous) return null;

  return {
    isAmbiguous: true,
    reason: reason ? String(reason) : null,
    ...(options ? { options } : {})
  };
};

export const createIntentResult = ({
  domain = 'unknown',
  intent = 'unknown',
  confidence = 0,
  source = 'safe_unknown',
  workflowContinuation = null,
  semanticQuery = null,
  transferPayload = null,
  correction = null,
  tool = null,
  ambiguity = null,
  toolName = null,
  toolArgs = {},
  isAmbiguous = false,
  ambiguityReason = null
} = {}) => ({
  domain: String(domain || 'unknown'),
  intent: String(intent || 'unknown'),
  confidence: normalizeConfidence(confidence),
  source: String(source || 'safe_unknown'),
  workflowContinuation: normalizeWorkflowContinuation(workflowContinuation),
  semanticQuery: normalizeObjectOrNull(semanticQuery),
  transferPayload: normalizeObjectOrNull(transferPayload),
  correction: normalizeObjectOrNull(correction),
  tool: normalizeTool({ tool, toolName, toolArgs }),
  ambiguity: normalizeAmbiguity({ ambiguity, isAmbiguous, ambiguityReason })
});

export const createUnknownIntent = ({
  source = 'safe_unknown',
  confidence = 0,
  workflowContinuation = null,
  semanticQuery = null,
  transferPayload = null,
  correction = null,
  tool = null,
  ambiguity = null
} = {}) => createIntentResult({
  domain: 'unknown',
  intent: 'unknown',
  confidence,
  source,
  workflowContinuation,
  semanticQuery,
  transferPayload,
  correction,
  tool,
  ambiguity
});

export const createAmbiguousIntent = ({
  source = 'safe_unknown',
  reason = null,
  options = null,
  confidence = 0,
  workflowContinuation = null,
  semanticQuery = null,
  transferPayload = null,
  correction = null,
  tool = null
} = {}) => createUnknownIntent({
  source,
  confidence,
  workflowContinuation,
  semanticQuery,
  transferPayload,
  correction,
  tool,
  ambiguity: {
    isAmbiguous: true,
    reason,
    ...(Array.isArray(options) ? { options } : {})
  }
});

export const createToolIntent = ({
  domain = 'unknown',
  intent = 'unknown',
  confidence = 0.85,
  source = 'tool',
  name,
  args = {},
  workflowContinuation = null,
  semanticQuery = null,
  transferPayload = null,
  correction = null
} = {}) => createIntentResult({
  domain,
  intent,
  confidence,
  source,
  workflowContinuation,
  semanticQuery,
  transferPayload,
  correction,
  tool: { name, args }
});

export const normalizeIntentResult = (value = {}) => {
  if (!value) return createUnknownIntent();

  return createIntentResult({
    domain: value.domain,
    intent: value.intent,
    confidence: value.confidence,
    source: value.source,
    workflowContinuation: value.workflowContinuation,
    semanticQuery: value.semanticQuery,
    transferPayload: value.transferPayload,
    correction: value.correction,
    tool: value.tool,
    toolName: value.toolName || value.name,
    toolArgs: value.toolArgs || value.args,
    ambiguity: value.ambiguity,
    isAmbiguous: value.isAmbiguous,
    ambiguityReason: value.ambiguityReason
  });
};
