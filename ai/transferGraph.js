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

const parseEmail = (text) => {
  const value = String(text || '').toLowerCase();
  const match = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].trim() : '';
};

const parseAmount = (text) => {
  const value = String(text || '').replace(/,/g, '.');
  const match = value.match(/(\d+(\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

const parseDescription = (text) => {
  const value = String(text || '');
  const match = value.match(/description\s+(.+)$/i);
  if (!match?.[1]) return '';
  return String(match[1]).trim();
};

const normalizeConfirmationInput = (text) => (
  String(text || '')
    .toLowerCase()
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[.,!?'"`~:;()[\]{}<>]/g, '')
    .trim()
);

const isTransferIntent = (text) => {
  const value = String(text || '').toLowerCase().trim();

  const historyLike = [
    'היסטור',
    'history',
    'last transfer',
    'העברה אחרונה',
    'כמה העברות',
    'count transfers',
    'recent transfers',
    'העברות אחרונות'
  ].some((token) => value.includes(token));

  if (historyLike) return false;

  return [
    'send money',
    'make transfer',
    'new transfer',
    'transfer now',
    'start transfer',
    'להעביר כסף',
    'בצע העברה',
    'תבצע העברה',
    'העברה חדשה',
    'שלח כסף',
    'תעביר'
  ].some((token) => value.includes(token));
};

const isBalanceIntent = (text) => {
  const value = String(text || '').toLowerCase().trim();
  return [
    'check balance',
    'balance',
    'יתרה',
    'כמה כסף יש',
    'מצב חשבון'
  ].some((token) => value.includes(token));
};

const isViewTransactionsIntent = (text) => {
  const value = String(text || '').toLowerCase().trim();
  return [
    'view transactions',
    'recent transfers',
    'transfer history',
    'last transfer',
    'העברות אחרונות',
    'היסטוריית העברות',
    'העברה אחרונה'
  ].some((token) => value.includes(token));
};

const isAccountSummaryIntent = (text) => {
  const value = String(text || '').toLowerCase().trim();
  return [
    'account summary',
    'account status',
    'summary',
    'סיכום חשבון',
    'סטטוס חשבון',
    'מצב חשבון'
  ].some((token) => value.includes(token));
};

const classifyIntent = (text) => {
  if (isTransferIntent(text)) return 'transfer_money';
  if (isBalanceIntent(text)) return 'check_balance';
  if (isViewTransactionsIntent(text)) return 'view_transactions';
  if (isAccountSummaryIntent(text)) return 'account_summary';
  return 'general_banking_question';
};

const isYes = (text) => {
  const value = normalizeConfirmationInput(text);
  return (
    ['yes', 'confirm', 'ok', 'approve', 'כן', 'מאשר', 'אשר', 'תאשר'].includes(value) ||
    value.startsWith('yes ') ||
    value.startsWith('כן ')
  );
};

const isNo = (text) => {
  const value = normalizeConfirmationInput(text);
  return (
    ['no', 'cancel', 'stop', 'לא', 'בטל', 'ביטול'].includes(value) ||
    value.startsWith('no ') ||
    value.startsWith('לא ')
  );
};

const buildPrompt = (language, phase) => {
  if (language === 'he') {
    if (phase === TRANSFER_PHASE.COLLECT_RECEIVER) return 'כדי לבצע העברה, מה האימייל של המקבל?';
    if (phase === TRANSFER_PHASE.COLLECT_AMOUNT) return 'מה הסכום להעברה?';
    if (phase === TRANSFER_PHASE.COLLECT_DESCRIPTION) return 'רוצה להוסיף תיאור קצר להעברה? (או כתוב "דלג")';
  } else {
    if (phase === TRANSFER_PHASE.COLLECT_RECEIVER) return 'To make a transfer, what is the recipient email?';
    if (phase === TRANSFER_PHASE.COLLECT_AMOUNT) return 'What amount should I transfer?';
    if (phase === TRANSFER_PHASE.COLLECT_DESCRIPTION) return 'Do you want to add a short description? (or type "skip")';
  }
  return '';
};

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
      amount >= 1000
        ? 'בסכומים גבוהים מומלץ לבצע אימות נוסף מול המקבל.'
        : 'שמור תיעוד קצר של מטרת ההעברה למעקב עתידי.'
    ];
  }

  return [
    'Verify the recipient email before making another transfer.',
    amount >= 1000
      ? 'For larger amounts, perform an extra verification with the recipient.'
      : 'Keep a short note of the transfer purpose for future tracking.'
  ];
};

const processTransferInput = async (state) => {
  const userInput = String(state.userInput || '').trim();
  const userLanguage = state.userLanguage === 'he' ? 'he' : 'en';
  const phase = state.phase || TRANSFER_PHASE.IDLE;

  if (!userInput) {
    return { handled: false, reply: '', phase };
  }

  if (!state.transferIntent && phase === TRANSFER_PHASE.IDLE) {
    return { handled: false, reply: '', action: null, phase: TRANSFER_PHASE.IDLE };
  }

  if (isNo(userInput)) {
    return {
      handled: true,
      reply: userLanguage === 'he' ? 'ביטלתי את תהליך ההעברה.' : 'I canceled the transfer flow.',
      action: null,
      ...resetTransferFlow,
      shouldRunTransfer: false
    };
  }

  let nextPhase = phase;
  let receiverEmail = state.receiverEmail || '';
  let amount = state.amount ?? null;
  let description = state.description || '';
  let riskConfirmationAsked = Boolean(state.riskConfirmationAsked);

  if (nextPhase === TRANSFER_PHASE.IDLE) {
    const parsedEmail = parseEmail(userInput);
    const parsedAmount = parseAmount(userInput);
    const parsedDescription = parseDescription(userInput);

    if (parsedEmail && parsedAmount) {
      receiverEmail = parsedEmail;
      amount = parsedAmount;
      description = parsedDescription;
      nextPhase = TRANSFER_PHASE.AWAIT_CONFIRMATION;
      riskConfirmationAsked = false;
    } else {
      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט. מלא פרטים ולחץ שלח.'
          : 'I opened a quick transfer form in the chat. Fill the details and submit.',
        action: 'open_money_transfer_inline',
        ...resetTransferFlow,
        shouldRunTransfer: false
      };
    }
  }

  if (nextPhase === TRANSFER_PHASE.COLLECT_RECEIVER) {
    const parsed = parseEmail(userInput);
    if (!parsed) {
      return {
        handled: true,
        reply: buildPrompt(userLanguage, TRANSFER_PHASE.COLLECT_RECEIVER),
        action: null,
        phase: TRANSFER_PHASE.COLLECT_RECEIVER,
        receiverEmail,
        amount,
        description,
        shouldRunTransfer: false
      };
    }
    receiverEmail = parsed;
    nextPhase = TRANSFER_PHASE.COLLECT_AMOUNT;
    riskConfirmationAsked = false;
  }

  if (nextPhase === TRANSFER_PHASE.COLLECT_AMOUNT) {
    const parsed = parseAmount(userInput);
    if (!parsed) {
      return {
        handled: true,
        reply: buildPrompt(userLanguage, TRANSFER_PHASE.COLLECT_AMOUNT),
        action: null,
        phase: TRANSFER_PHASE.COLLECT_AMOUNT,
        receiverEmail,
        amount,
        description,
        shouldRunTransfer: false
      };
    }
    amount = parsed;
    nextPhase = TRANSFER_PHASE.COLLECT_DESCRIPTION;
    riskConfirmationAsked = false;
  }

  if (nextPhase === TRANSFER_PHASE.COLLECT_DESCRIPTION) {
    const value = userInput.toLowerCase();
    if (
      value !== String(receiverEmail).toLowerCase() &&
      value !== String(amount) &&
      !value.includes('דלג') &&
      value !== 'skip'
    ) {
      description = userInput;
    }
    nextPhase = TRANSFER_PHASE.AWAIT_CONFIRMATION;
    riskConfirmationAsked = false;
  }

  if (nextPhase === TRANSFER_PHASE.AWAIT_CONFIRMATION && !isYes(userInput)) {
    const summary = userLanguage === 'he'
      ? `אישור העברה\nסכום: ${amount} ILS\nלנמען: ${receiverEmail}${description ? `\nתיאור: ${description}` : ''}\n\nלאשר? כתוב "כן" או "לא".`
      : `Transfer confirmation\nAmount: ${amount} ILS\nRecipient: ${receiverEmail}${description ? `\nDescription: ${description}` : ''}\n\nConfirm? Type "yes" or "no".`;

    return {
      handled: true,
      reply: summary,
      action: null,
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      receiverEmail,
      amount,
      description,
      riskConfirmationAsked,
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
    shouldRunTransfer: true
  };
};

const findIntentNode = async (state) => {
  const phase = state.phase || TRANSFER_PHASE.IDLE;
  const userInput = String(state.userInput || '').trim();

  if (phase !== TRANSFER_PHASE.IDLE) {
    return { transferIntent: true, detectedIntent: 'transfer_money' };
  }

  const detectedIntent = classifyIntent(userInput);
  return {
    transferIntent: detectedIntent === 'transfer_money',
    detectedIntent
  };
};

const evaluateAccountNode = async (state) => {
  try {
    const userLanguage = state.userLanguage === 'he' ? 'he' : 'en';
    const senderUser = await usersModel.findUserById(state.userId);
    if (!senderUser) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא הצלחתי לזהות את המשתמש המחובר.' : 'I could not identify the authenticated user.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'sender_user_not_found'
      };
    }

    const receiverUser = await usersModel.findUserByEmail(String(state.receiverEmail || '').toLowerCase());
    if (!receiverUser) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא מצאתי משתמש עם כתובת האימייל הזו.' : 'I could not find a user with that email.',
        phase: TRANSFER_PHASE.COLLECT_RECEIVER,
        receiverEmail: '',
        amount: null,
        description: '',
        shouldRunTransfer: false,
        errorMessage: 'receiver_user_not_found'
      };
    }

    if (String(receiverUser._id) === String(senderUser._id)) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'אי אפשר לבצע העברה לעצמך. הזן אימייל אחר.' : 'You cannot transfer to your own account. Provide another email.',
        phase: TRANSFER_PHASE.COLLECT_RECEIVER,
        receiverEmail: '',
        amount: null,
        description: '',
        shouldRunTransfer: false,
        errorMessage: 'self_transfer'
      };
    }

    const senderAccount = await accountsModel.findAccountByUserId(senderUser._id);
    const receiverAccount = await accountsModel.findAccountByUserId(receiverUser._id);

    if (!senderAccount || !receiverAccount) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא נמצא חשבון מקור או יעד לביצוע ההעברה.' : 'Source or target account was not found.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'account_not_found'
      };
    }

    const senderEmail = String(senderUser.email || '').toLowerCase();
    const recentTransactions = await Transaction.find({
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

const riskAssessmentNode = async (state) => {
  const userLanguage = state.userLanguage === 'he' ? 'he' : 'en';

  if (Number(state.amount) > EXTRA_CONFIRMATION_THRESHOLD && !state.riskConfirmationAsked) {
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `הסכום גדול מ-${EXTRA_CONFIRMATION_THRESHOLD} ILS. האם זה הסכום שברצונך להעביר? כתוב "כן" כדי להמשיך או "לא" כדי לבטל.`
        : `Amount is above ${EXTRA_CONFIRMATION_THRESHOLD} ILS. Is this the amount you want to transfer? Type "yes" to continue or "no" to cancel.`,
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      riskConfirmationAsked: true,
      shouldRunTransfer: false
    };
  }

  const riskAssessment = await assessTransferRisk({
    senderEmail: String(state.senderUser?.email || '').toLowerCase(),
    receiverEmail: String(state.receiverUser?.email || '').toLowerCase(),
    amount: Number(state.amount),
    senderBalance: state.senderAccount?.balance
  });

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

const executeTransferNode = async (state) => {
  const userLanguage = state.userLanguage === 'he' ? 'he' : 'en';

  try {
    const transaction = await transferMoney({
      fromAccountId: state.senderAccount._id,
      toAccountId: state.receiverAccount._id,
      amount: Number(state.amount),
      description: state.description || undefined
    });

    const updatedSenderAccount = await accountsModel.findAccountById(state.senderAccount._id);

    return {
      transferExecuted: true,
      transactionResult: transaction,
      senderAccount: updatedSenderAccount || state.senderAccount,
      reply: userLanguage === 'he'
        ? `ההעברה בוצעה בהצלחה: ${state.amount} ILS ל־${state.receiverEmail}.`
        : `Transfer completed: ${state.amount} ILS to ${state.receiverEmail}.`
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

const leverageDataNode = async (state) => {
  if (!state.transferExecuted) return { suggestions: [] };

  const suggestions = [];
  const language = state.userLanguage === 'he' ? 'he' : 'en';

  const remainingBalance = Number(state.senderAccount?.balance || 0);
  const lowBalanceSuggestion = buildLowBalanceSuggestion(language, remainingBalance);
  if (lowBalanceSuggestion) suggestions.push(lowBalanceSuggestion);

  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const monthlyOutgoingCount = await Transaction.countDocuments({
    fromEmail: String(state.senderUser?.email || '').toLowerCase(),
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

  const language = state.userLanguage === 'he' ? 'he' : 'en';
  const suggestions = Array.isArray(state.suggestions) ? state.suggestions.filter(Boolean) : [];
  const safetyTips = buildSafetyTips(language, Number(state.amount || 0));
  const tx = state.transactionResult || {};

  const transactionResultBlock = language === 'he'
    ? [
      'Transaction Result:',
      `סטטוס: הצליח`,
      `סכום: ${Number(state.amount || 0)} ILS`,
      `נמען: ${state.receiverEmail || '-'}`,
      `יתרה לאחר העברה: ${Number(state.senderAccount?.balance || 0)} ILS`,
      `מזהה עסקה: ${tx.id ?? tx._id ?? '-'}`
    ]
    : [
      'Transaction Result:',
      'Status: Success',
      `Amount: ${Number(state.amount || 0)} ILS`,
      `Recipient: ${state.receiverEmail || '-'}`,
      `Balance after transfer: ${Number(state.senderAccount?.balance || 0)} ILS`,
      `Transaction ID: ${tx.id ?? tx._id ?? '-'}`
    ];

  const aiSuggestionsBlock = language === 'he'
    ? ['AI Suggestions:', ...(suggestions.length ? suggestions : ['אין כרגע הצעות נוספות.'])]
    : ['AI Suggestions:', ...(suggestions.length ? suggestions : ['No additional suggestions right now.'])];

  const safetyTipsBlock = language === 'he'
    ? ['Safety Tips:', ...safetyTips]
    : ['Safety Tips:', ...safetyTips];

  const replyWithSections = [
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
  transferState
}) => {
  const result = await transferGraph.invoke(
    buildTransferGraphInitialState({
      userInput,
      userLanguage,
      userId,
      transferState
    })
  );

  return {
    handled: Boolean(result?.handled),
    reply: String(result?.reply || ''),
    action: result?.action || null,
    nextTransferState: buildNextTransferState(result)
  };
};
