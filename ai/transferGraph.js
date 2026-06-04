import { END, START, StateGraph } from '@langchain/langgraph';
import { Transaction } from '../entities/transactions.js';
import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import { transferMoney } from '../models/transactionsModel.js';
import { assessTransferRisk } from './riskAssessment.js';
import {
  TRANSFER_PHASE,
  TransferState,
  resetTransferFlow,
  buildTransferGraphInitialState,
  buildNextTransferState
} from './transferState.js';

const EXTRA_CONFIRMATION_THRESHOLD = 1000;
const RECENT_TRANSACTIONS_LIMIT = 5;
const RISK_RULES_AND_LIMITS = {
  extraConfirmationThreshold: EXTRA_CONFIRMATION_THRESHOLD,
  maxSingleTransferAmount: 20000,
  lowRemainingBalanceThreshold: 250,
  velocityWindowMinutes: 60,
  velocityModerateCount: 3,
  velocityHighCount: 5
};

const getBusinessServices = (config) => config?.configurable?.services || {};

const getFlowLanguage = (state) => (
  state.flowLanguage === 'he' ? 'he' : 'en'
);

const formatIls = (value) => Number(value || 0).toFixed(2);

const buildTransferFormErrorAction = (field, message, language) => ({
  type: 'transfer_form_error',
  field,
  message,
  language
});

const buildOpenTransferFormAction = (language) => ({
  type: 'open_money_transfer_inline',
  language
});

const buildHighAmountConfirmAction = (language, amount) => ({
  type: 'transfer_high_amount_confirm',
  language,
  amount: Number(amount || 0),
  message: language === 'he'
    ? `הסכום הוא ${formatIls(amount)} ILS (מעל 1000). האם לבצע את ההעברה?`
    : `The amount is ${formatIls(amount)} ILS (above 1000). Do you want to proceed?`
});

const buildResetTransferFormAction = (language) => ({
  type: 'reset_transfer_form',
  language
});

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const normalizePayloadEmail = (value) => {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : '';
};

const normalizePayloadAmount = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/,/g, '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

const normalizePayloadDescription = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const createEmptyTransferPayload = () => ({
  receiverEmail: '',
  amount: null,
  description: '',
  confirmation: null,
  skipDescription: false,
  startNewTransfer: false
});

const normalizeTransferPayload = (payload = {}) => {
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

const hasMeaningfulTransferPayload = (payload = {}) => Boolean(
  payload.receiverEmail
    || payload.amount
    || payload.description
    || payload.confirmation
    || payload.skipDescription
    || payload.startNewTransfer
);

const mergeTransferPayload = (basePayload, nextPayload) => {
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

const extractTransferDetailsWithLlm = async ({
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

const getSemanticTransferPayload = async (state, config) => {
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

  return mergeTransferPayload(normalized, llmExtracted);
};

const buildTransferConfirmationSummary = ({ language, amount, receiverEmail, description }) => (
  language === 'he'
    ? `לפני ביצוע ההעברה, נא לאשר את הפרטים:\nסכום: ${amount} ILS\nנמען: ${receiverEmail}${description ? `\nתיאור: ${description}` : ''}\n\nאם הכול נכון כתוב "כן". לביטול כתוב "לא".`
    : `Before I execute the transfer, please confirm the details:\nAmount: ${amount} ILS\nRecipient: ${receiverEmail}${description ? `\nDescription: ${description}` : ''}\n\nIf everything is correct, type "yes". To cancel, type "no".`
);

const buildLowBalanceSuggestion = (language, balance) => {
  if (balance > 300) return null;
  return language === 'he'
    ? `היתרה שלך לאחר ההעברה נמוכה (${balance} ILS). רוצה שאציע לך הלוואה?`
    : `Your post-transfer balance is low (${balance} ILS). Do you want me to suggest a loan?`;
};

const buildSafetyTips = (language, amount) => {
  if (language === 'he') {
    return [
      'ודא שכתובת האימייל של המקבל נכונה לפני העברה נוספת.',
      amount > EXTRA_CONFIRMATION_THRESHOLD
        ? 'בסכומים גבוהים מומלץ לבצע אימות נוסף מול המקבל.'
        : 'שמור תיעוד קצר של מטרת ההעברה למעקב עתידי.'
    ];
  }

  return [
    'Verify the recipient email before making another transfer.',
    amount > EXTRA_CONFIRMATION_THRESHOLD
      ? 'For larger amounts, perform an extra verification with the recipient.'
      : 'Keep a short note of the transfer purpose for future tracking.'
  ];
};

const processTransferInput = async (state, config) => {
  const userInput = String(state.userInput || '').trim();
  const userLanguage = getFlowLanguage(state);
  const phase = state.phase || TRANSFER_PHASE.IDLE;
  const semanticTransfer = await getSemanticTransferPayload(state, config);

  if (!userInput) {
    return { handled: false, reply: '', phase };
  }

  if (!state.transferIntent && phase === TRANSFER_PHASE.IDLE) {
    return { handled: false, reply: '', action: null, phase: TRANSFER_PHASE.IDLE };
  }

  if (semanticTransfer.confirmation === 'no') {
    return {
      handled: true,
      reply: userLanguage === 'he' ? 'ביטלתי את תהליך ההעברה.' : 'I canceled the transfer flow.',
      action: buildResetTransferFormAction(userLanguage),
      ...resetTransferFlow,
      shouldRunTransfer: false
    };
  }

  let nextPhase = phase;
  let receiverEmail = state.receiverEmail || '';
  let amount = state.amount ?? null;
  let description = state.description || '';
  let riskConfirmationAsked = Boolean(state.riskConfirmationAsked);
  let flowLanguage = state.flowLanguage || userLanguage;
  const parsedPayload = semanticTransfer.receiverEmail && semanticTransfer.amount
    ? {
        receiverEmail: semanticTransfer.receiverEmail,
        amount: semanticTransfer.amount,
        description: semanticTransfer.description
      }
    : null;

  // If the message already contains full transfer details (common with inline form submit),
  // run directly without an extra confirmation chat round.
  if (parsedPayload) {
    return {
      handled: true,
      reply: '',
      action: null,
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      receiverEmail: parsedPayload.receiverEmail,
      amount: parsedPayload.amount,
      description: parsedPayload.description || '',
      riskConfirmationAsked: false,
      flowLanguage,
      shouldRunTransfer: true
    };
  }

  // Only reopen a new transfer form for generic transfer requests.
  // A structured payload from the inline form should be processed immediately above.
  if (phase !== TRANSFER_PHASE.IDLE && semanticTransfer.startNewTransfer) {
    const nextFlowLanguage = state.userLanguage === 'he' ? 'he' : 'en';
    return {
      handled: true,
      reply: nextFlowLanguage === 'he'
        ? 'פתחתי עבורך טופס העברה חדש בתוך הצ׳אט. מלא פרטים ולחץ שלח.'
        : 'I opened a new transfer form in the chat. Fill the details and submit.',
      action: buildOpenTransferFormAction(nextFlowLanguage),
      phase: TRANSFER_PHASE.FORM_OPEN,
      receiverEmail: '',
      amount: null,
      description: '',
      riskConfirmationAsked: false,
      flowLanguage: nextFlowLanguage,
      shouldRunTransfer: false
    };
  }

  if (nextPhase === TRANSFER_PHASE.IDLE) {
    flowLanguage = state.userLanguage === 'he' ? 'he' : 'en';
    const parsedEmail = semanticTransfer.receiverEmail;
    const parsedAmount = semanticTransfer.amount;
    const parsedDescription = semanticTransfer.description;

    if (parsedEmail && parsedAmount) {
      receiverEmail = parsedEmail;
      amount = parsedAmount;
      description = parsedDescription;
      nextPhase = TRANSFER_PHASE.AWAIT_CONFIRMATION;
      riskConfirmationAsked = false;
      return {
        handled: true,
        reply: '',
        action: null,
        phase: nextPhase,
        receiverEmail,
        amount,
        description,
        riskConfirmationAsked,
        flowLanguage,
        shouldRunTransfer: true
      };
    } else {
      if (!parsedEmail && parsedAmount) {
        const message = userLanguage === 'he'
          ? 'כתובת האימייל של המקבל לא תקינה. תקן את השדה ונסה שוב.'
          : 'Recipient email is invalid. Please fix the email field and try again.';
        return {
          handled: true,
          reply: '',
          action: buildTransferFormErrorAction('receiverEmail', message, userLanguage),
          phase: TRANSFER_PHASE.FORM_OPEN,
          receiverEmail: '',
          amount: parsedAmount,
          description: parsedDescription || '',
          flowLanguage,
          shouldRunTransfer: false
        };
      }

      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט. מלא פרטים ולחץ שלח.'
          : 'I opened a quick transfer form in the chat. Fill the details and submit.',
        action: buildOpenTransferFormAction(userLanguage),
        phase: TRANSFER_PHASE.FORM_OPEN,
        receiverEmail: '',
        amount: null,
        description: '',
        riskConfirmationAsked: false,
        flowLanguage,
        shouldRunTransfer: false
      };
    }
  }

  if (nextPhase === TRANSFER_PHASE.FORM_OPEN) {
    const parsedEmail = semanticTransfer.receiverEmail;
    const parsedAmount = semanticTransfer.amount;
    const parsedDescription = semanticTransfer.description;
    const missingField = !parsedEmail ? 'receiverEmail' : 'amount';
    const message = missingField === 'receiverEmail'
      ? (userLanguage === 'he'
          ? 'כתובת האימייל של המקבל לא תקינה. תקן את השדה בטופס ולחץ שלח.'
          : 'Recipient email is invalid. Please fix the form field and press Send.')
      : (userLanguage === 'he'
          ? 'הסכום לא תקין. תקן את השדה בטופס ולחץ שלח.'
          : 'Amount is invalid. Please fix the form field and press Send.');

    return {
      handled: true,
      reply: '',
      action: buildTransferFormErrorAction(missingField, message, userLanguage),
      phase: TRANSFER_PHASE.FORM_OPEN,
      receiverEmail: parsedEmail || receiverEmail,
      amount: parsedAmount ?? amount,
      description: parsedDescription || description,
      riskConfirmationAsked,
      flowLanguage,
      shouldRunTransfer: false
    };
  }

  if (nextPhase === TRANSFER_PHASE.AWAIT_CONFIRMATION && semanticTransfer.confirmation !== 'yes') {
    const correctedEmail = semanticTransfer.receiverEmail;
    const correctedAmount = semanticTransfer.amount;
    const correctedDescription = semanticTransfer.description;

    if (correctedEmail) receiverEmail = correctedEmail;
    if (correctedAmount) amount = correctedAmount;
    if (correctedDescription) description = correctedDescription;
    if (correctedEmail || correctedAmount || correctedDescription) {
      riskConfirmationAsked = false;
    }

    const summary = buildTransferConfirmationSummary({
      language: userLanguage,
      amount,
      receiverEmail,
      description
    });

    return {
      handled: true,
      reply: summary,
      action: null,
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      receiverEmail,
      amount,
      description,
      riskConfirmationAsked,
      flowLanguage,
      shouldRunTransfer: false
    };
  }

  return {
    handled: true,
    reply: '',
    action: null,
    phase: nextPhase,
    receiverEmail,
    amount,
    description,
    riskConfirmationAsked,
    flowLanguage,
    shouldRunTransfer: true
  };
};

const findIntentNode = async (state) => {
  const phase = state.phase || TRANSFER_PHASE.IDLE;

  if (phase !== TRANSFER_PHASE.IDLE) {
    return { transferIntent: true, detectedIntent: 'transfer_money' };
  }

  const detectedIntent = state.semanticIntent || 'unknown';
  return {
    transferIntent: detectedIntent === 'transfer_money',
    detectedIntent
  };
};

const evaluateAccountNode = async (state, config) => {
  try {
    const services = getBusinessServices(config);
    const userLanguage = getFlowLanguage(state);
    const senderUser = services.profileService?.getUserById
      ? await services.profileService.getUserById(state.userId)
      : await usersModel.findUserById(state.userId);
    if (!senderUser) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא הצלחתי לזהות את המשתמש המחובר.' : 'I could not identify the authenticated user.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'sender_user_not_found'
      };
    }

    const receiverUser = services.profileService?.getUserByEmail
      ? await services.profileService.getUserByEmail(state.receiverEmail)
      : await usersModel.findUserByEmail(String(state.receiverEmail || '').toLowerCase());
    if (!receiverUser) {
      const message = userLanguage === 'he'
        ? 'המשתמש לא קיים במערכת. בדוק את כתובת האימייל ונסה שוב.'
        : 'Recipient user does not exist. Please check the email and try again.';
      return {
        handled: true,
        reply: '',
        action: buildTransferFormErrorAction('receiverEmail', message, userLanguage),
        phase: TRANSFER_PHASE.FORM_OPEN,
        receiverEmail: '',
        amount: null,
        description: '',
        shouldRunTransfer: false,
        errorMessage: 'receiver_user_not_found'
      };
    }

    if (String(receiverUser._id) === String(senderUser._id)) {
      const message = userLanguage === 'he'
        ? 'אי אפשר לבצע העברה לעצמך. הזן אימייל של נמען אחר.'
        : 'You cannot transfer money to yourself. Enter a different recipient email.';
      return {
        handled: true,
        reply: '',
        action: buildTransferFormErrorAction('receiverEmail', message, userLanguage),
        phase: TRANSFER_PHASE.FORM_OPEN,
        receiverEmail: '',
        amount: null,
        description: '',
        shouldRunTransfer: false,
        errorMessage: 'self_transfer'
      };
    }

    const senderAccount = services.accountService?.getAccountByUserId
      ? await services.accountService.getAccountByUserId(senderUser._id)
      : await accountsModel.findAccountByUserId(senderUser._id);
    const receiverAccount = services.accountService?.getAccountByUserId
      ? await services.accountService.getAccountByUserId(receiverUser._id)
      : await accountsModel.findAccountByUserId(receiverUser._id);

    if (!senderAccount || !receiverAccount) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא נמצא חשבון מקור או יעד לביצוע ההעברה.' : 'Source or target account was not found.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'account_not_found'
      };
    }

    const requestedAmount = Number(state.amount);
    const senderBalance = Number(senderAccount?.balance || 0);
    if (Number.isFinite(requestedAmount) && requestedAmount > senderBalance) {
      const message = userLanguage === 'he'
        ? `אין מספיק יתרה להעברה: ביקשת ${requestedAmount} ILS, יתרה זמינה ${senderBalance} ILS.`
        : `Insufficient balance: requested ${requestedAmount} ILS, available ${senderBalance} ILS.`;
      return {
        handled: true,
        reply: '',
        action: buildTransferFormErrorAction('amount', message, userLanguage),
        phase: TRANSFER_PHASE.FORM_OPEN,
        receiverEmail: String(state.receiverEmail || ''),
        description: String(state.description || ''),
        amount: null,
        shouldRunTransfer: false,
        errorMessage: 'insufficient_funds'
      };
    }

    const senderEmail = String(senderUser.email || '').toLowerCase();
    const recentTransactions = services.transactionService?.getRecentTransactionsByEmail
      ? await services.transactionService.getRecentTransactionsByEmail({
        email: senderEmail,
        limit: RECENT_TRANSACTIONS_LIMIT
      })
      : await Transaction.find({
        $or: [{ fromEmail: senderEmail }, { toEmail: senderEmail }]
      })
        .sort({ createdAt: -1 })
        .limit(RECENT_TRANSACTIONS_LIMIT)
        .lean();

    return {
      senderUser,
      receiverUser,
      senderAccount,
      receiverAccount,
      recentTransactions: (recentTransactions || []).map((tx) => ({
        id: tx.id ?? tx._id,
        amount: tx.amount,
        fromEmail: tx.fromEmail,
        toEmail: tx.toEmail,
        createdAt: tx.createdAt
      })),
      riskRulesAndLimits: RISK_RULES_AND_LIMITS,
      errorMessage: null
    };
  } catch (err) {
    return {
      handled: true,
      reply: `Transfer failed: ${String(err?.message || 'unknown error')}`,
      ...resetTransferFlow,
      shouldRunTransfer: false,
      errorMessage: 'evaluate_account_failure'
    };
  }
};

const riskAssessmentNode = async (state, config) => {
  if (state.handled && !state.shouldRunTransfer) return {};

  const services = getBusinessServices(config);
  const userLanguage = getFlowLanguage(state);

  if (Number(state.amount) > EXTRA_CONFIRMATION_THRESHOLD && !state.riskConfirmationAsked) {
    return {
      handled: true,
      reply: '',
      action: buildHighAmountConfirmAction(userLanguage, state.amount),
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      riskConfirmationAsked: true,
      shouldRunTransfer: false
    };
  }

  const riskPayload = {
    senderEmail: String(state.senderUser?.email || '').toLowerCase(),
    receiverEmail: String(state.receiverUser?.email || '').toLowerCase(),
    amount: Number(state.amount),
    senderBalance: state.senderAccount?.balance
  };
  const riskAssessment = services.riskService?.evaluateRisk
    ? await services.riskService.evaluateRisk(riskPayload)
    : await assessTransferRisk(riskPayload);

  if (riskAssessment.requiresReview) {
    const reasons = riskAssessment.reasons?.join(', ') || 'Policy checks';
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `ההעברה סומנה בסיכון גבוה ונשלחה לבדיקה ידנית. סיבה: ${reasons}.`
        : `This transfer was flagged as high risk and sent to manual review. Reason: ${reasons}.`,
      riskAssessment,
      ...resetTransferFlow,
      shouldRunTransfer: false,
      transferExecuted: false
    };
  }

  return { riskAssessment };
};

const executeTransferNode = async (state, config) => {
  const services = getBusinessServices(config);
  const userLanguage = getFlowLanguage(state);

  try {
    const transferPayload = {
      fromAccountId: state.senderAccount._id,
      toAccountId: state.receiverAccount._id,
      amount: Number(state.amount),
      description: state.description || undefined
    };
    const transaction = services.transactionService?.executeTransfer
      ? await services.transactionService.executeTransfer(transferPayload)
      : await transferMoney(transferPayload);

    const updatedSenderAccount = services.accountService?.findAccountById
      ? await services.accountService.findAccountById(state.senderAccount._id)
      : await accountsModel.findAccountById(state.senderAccount._id);

    return {
      transferExecuted: true,
      transactionResult: transaction,
      senderAccount: updatedSenderAccount || state.senderAccount,
      reply: userLanguage === 'he'
        ? `ההעברה בוצעה בהצלחה: ${formatIls(state.amount)} ILS ל־${state.receiverEmail}.`
        : `Transfer completed: ${formatIls(state.amount)} ILS to ${state.receiverEmail}.`
    };
  } catch (err) {
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `ההעברה נכשלה: ${String(err?.message || 'שגיאה לא ידועה')}`
        : `Transfer failed: ${String(err?.message || 'unknown error')}`,
      ...resetTransferFlow,
      shouldRunTransfer: false,
      transferExecuted: false,
      errorMessage: 'execute_transfer_failure'
    };
  }
};

const leverageDataNode = async (state, config) => {
  if (!state.transferExecuted) return { suggestions: [] };

  const services = getBusinessServices(config);
  const suggestions = [];
  const language = getFlowLanguage(state);

  const remainingBalance = Number(state.senderAccount?.balance || 0);
  const lowBalanceSuggestion = buildLowBalanceSuggestion(language, remainingBalance);
  if (lowBalanceSuggestion) suggestions.push(lowBalanceSuggestion);

  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const senderEmail = String(state.senderUser?.email || '').toLowerCase();
  const monthlyOutgoingCount = services.transactionService?.countMonthlyOutgoingTransfers
    ? await services.transactionService.countMonthlyOutgoingTransfers({
      email: senderEmail,
      since: oneMonthAgo
    })
    : await Transaction.countDocuments({
      fromEmail: senderEmail,
      createdAt: { $gte: oneMonthAgo }
    });

  if (monthlyOutgoingCount >= 10) {
    suggestions.push(
      language === 'he'
        ? 'ראיתי נפח העברות גבוה בחודש האחרון. רוצה שאציע לך תקרת תקציב חודשית?'
        : 'You had high transfer activity in the last month. Want me to suggest a monthly transfer budget cap?'
    );
  }

  return { suggestions };
};

const respondNode = async (state) => {
  if (state.handled && !state.transferExecuted) {
    return state;
  }

  const language = getFlowLanguage(state);
  const suggestions = Array.isArray(state.suggestions) ? state.suggestions.filter(Boolean) : [];
  const safetyTips = buildSafetyTips(language, Number(state.amount || 0));

  const transactionResultBlock = language === 'he'
    ? [
      'תוצאת ההעברה',
      '--------------------',
      'סטטוס: הצליח',
      `סכום: ${formatIls(state.amount)} ILS`,
      `נמען: ${state.receiverEmail || '-'}`,
      `יתרה חדשה: ${formatIls(state.senderAccount?.balance)} ILS`
    ]
    : [
      'Transaction Result:',
      '--------------------',
      'Status: Success',
      `Amount: ${formatIls(state.amount)} ILS`,
      `Recipient: ${state.receiverEmail || '-'}`,
      `Balance after transfer: ${formatIls(state.senderAccount?.balance)} ILS`
    ];

  const aiSuggestionsBlock = language === 'he'
    ? ['AI Suggestions:', ...(suggestions.length ? suggestions : ['אין כרגע הצעות נוספות.'])]
    : ['AI Suggestions:', ...(suggestions.length ? suggestions : ['No additional suggestions right now.'])];

  const safetyTipsBlock = language === 'he'
    ? ['Safety Tips:', ...safetyTips]
    : ['Safety Tips:', ...safetyTips];

  const replyWithSections = [
    language === 'he' ? 'ההעברה הושלמה בהצלחה' : 'Transfer completed successfully',
    '',
    ...transactionResultBlock,
    '',
    ...aiSuggestionsBlock,
    '',
    ...safetyTipsBlock
  ].join('\n');

  return {
    reply: replyWithSections,
    ...resetTransferFlow,
    shouldRunTransfer: false
  };
};

const shouldGoEvaluate = (state) => {
  if (!state.handled || !state.shouldRunTransfer) return END;
  return 'evaluate_account';
};

const shouldProcessInput = (state) => (
  state.transferIntent ? 'process_input' : END
);

const shouldGoExecute = (state) => {
  if (state.handled && !state.shouldRunTransfer) return END;
  return 'execute_transfer';
};

const transferGraph = new StateGraph(TransferState)
  .addNode('find_intent', findIntentNode)
  .addNode('process_input', processTransferInput)
  .addNode('evaluate_account', evaluateAccountNode)
  .addNode('risk_assessment', riskAssessmentNode)
  .addNode('execute_transfer', executeTransferNode)
  .addNode('leverage_data', leverageDataNode)
  .addNode('respond', respondNode)
  .addEdge(START, 'find_intent')
  .addConditionalEdges('find_intent', shouldProcessInput)
  .addConditionalEdges('process_input', shouldGoEvaluate)
  .addEdge('evaluate_account', 'risk_assessment')
  .addConditionalEdges('risk_assessment', shouldGoExecute)
  .addEdge('execute_transfer', 'leverage_data')
  .addEdge('leverage_data', 'respond')
  .addEdge('respond', END)
  .compile();

export const runTransferGraph = async ({
  userInput,
  userLanguage,
  userId,
  transferState,
  semanticIntent = 'unknown',
  transferPayload = null,
  correction = null,
  services,
  createChatCompletion,
  abortSignal
}) => {
  const result = await transferGraph.invoke(
    buildTransferGraphInitialState({
      userInput,
      userLanguage,
      userId,
      transferState,
      semanticIntent,
      transferPayload,
      correction
    }),
    {
      configurable: {
        services,
        createChatCompletion,
        abortSignal
      }
    }
  );

  return {
    handled: Boolean(result?.handled),
    reply: String(result?.reply || ''),
    action: result?.action || null,
    nextTransferState: buildNextTransferState(result)
  };
};
