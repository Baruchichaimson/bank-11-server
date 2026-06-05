import { TRANSFER_PHASE } from '../../transferState.js';

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export const normalizePayloadEmail = (value) => {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
};

export const normalizePayloadAmount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/,/g, '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

export const normalizePayloadDescription = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const createEmptyTransferPayload = () => ({
  receiverEmail: '',
  amount: null,
  description: '',
  confirmation: null,
  skipDescription: false,
  startNewTransfer: false
});

export const normalizeTransferPayload = (payload = {}) => {
  const confirmation = ['yes', 'no'].includes(payload.confirmation) ? payload.confirmation : null;

  return {
    receiverEmail: normalizePayloadEmail(payload.receiverEmail),
    amount: normalizePayloadAmount(payload.amount),
    description: normalizePayloadDescription(payload.description),
    confirmation,
    skipDescription: Boolean(payload.skipDescription),
    startNewTransfer: Boolean(payload.startNewTransfer)
  };
};

export const hasMeaningfulTransferPayload = (payload = {}) => Boolean(
  payload.receiverEmail
    || payload.amount
    || payload.description
    || payload.confirmation
    || payload.skipDescription
    || payload.startNewTransfer
);

export const mergeTransferPayload = (basePayload, nextPayload) => {
  const base = basePayload || createEmptyTransferPayload();
  const next = nextPayload || createEmptyTransferPayload();

  return {
    receiverEmail: base.receiverEmail || next.receiverEmail || '',
    amount: base.amount ?? next.amount ?? null,
    description: base.description || next.description || '',
    confirmation: base.confirmation || next.confirmation || null,
    skipDescription: Boolean(base.skipDescription || next.skipDescription),
    startNewTransfer: Boolean(base.startNewTransfer || next.startNewTransfer)
  };
};

const parseJsonObject = (content) => {
  const text = String(content || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const extractTransferDetailsWithLlm = async ({
  userInput,
  phase,
  createChatCompletion,
  abortSignal
}) => {
  if (!createChatCompletion) return createEmptyTransferPayload();

  try {
    const response = await createChatCompletion({
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You extract fields for an already-active money transfer workflow.',
            'Do not classify user intent, route workflows, or answer the user.',
            `Current transfer phase: ${phase}.`,
            'Return only strict JSON with this shape:',
            '{"receiverEmail":null,"amount":null,"description":null,"confirmation":null,"skipDescription":false,"startNewTransfer":false}',
            'Extract only values explicitly present in the current message.',
            'confirmation must be "yes", "no", or null.'
          ].join('\n')
        },
        { role: 'user', content: String(userInput || '').trim() }
      ],
      abortSignal
    });
    const parsed = parseJsonObject(response?.choices?.[0]?.message?.content);
    return normalizeTransferPayload(parsed?.transferPayload || parsed || {});
  } catch {
    return createEmptyTransferPayload();
  }
};

export const getSemanticTransferPayload = async (state, config) => {
  const payload = state.transferPayload || {};
  const correction = state.correction || {};
  const merged = { ...payload };

  if (correction.field === 'recipient' && merged.receiverEmail == null) {
    merged.receiverEmail = correction.value;
  }
  if (correction.field === 'amount' && merged.amount == null) {
    merged.amount = correction.value;
  }
  if (correction.field === 'note' && merged.description == null) {
    merged.description = correction.value;
  }

  let normalized = normalizeTransferPayload(merged);
  const phase = state.phase || TRANSFER_PHASE.IDLE;

  if (phase === TRANSFER_PHASE.IDLE) return normalized;

  if (hasMeaningfulTransferPayload(normalized)) return normalized;

  const llmExtracted = await extractTransferDetailsWithLlm({
    userInput: state.userInput,
    phase,
    createChatCompletion: config?.configurable?.createChatCompletion,
    abortSignal: config?.configurable?.abortSignal
  });

  normalized = mergeTransferPayload(normalized, llmExtracted);
  return normalized;
};
