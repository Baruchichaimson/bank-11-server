import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { Transaction } from '../entities/transactions.js';
import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import { transferMoney } from '../models/transactionsModel.js';
import { assessTransferRisk } from './riskAssessment.js';

const TRANSFER_PHASE = {
  IDLE: 'idle',
  COLLECT_RECEIVER: 'collect_receiver',
  COLLECT_AMOUNT: 'collect_amount',
  COLLECT_DESCRIPTION: 'collect_description',
  AWAIT_CONFIRMATION: 'await_confirmation',
  AWAIT_RISK_CONFIRMATION: 'await_risk_confirmation'
};

const EXTRA_CONFIRMATION_THRESHOLD = 1000;

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

const isYes = (text) => {
  const value = String(text || '').trim().toLowerCase();
  return ['yes', 'confirm', 'ok', 'approve', 'כן', 'מאשר', 'אשר', 'תאשר'].includes(value);
};

const isNo = (text) => {
  const value = String(text || '').trim().toLowerCase();
  return ['no', 'cancel', 'stop', 'לא', 'בטל', 'ביטול'].includes(value);
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
  if (balance >= 300) return null;
  return language === 'he'
    ? `נשארה לך יתרה נמוכה (${balance} ILS). רוצה שאציע אפשרויות להלוואה קצרה או תכנון הוצאות?`
    : `Your remaining balance is low (${balance} ILS). Do you want me to suggest a short loan or spending plan options?`;
};

const TransferState = Annotation.Root({
  userInput: Annotation(),
  userLanguage: Annotation(),
  userId: Annotation(),
  phase: Annotation(),
  receiverEmail: Annotation(),
  amount: Annotation(),
  description: Annotation(),
  handled: Annotation(),
  reply: Annotation(),
  action: Annotation(),
  riskAssessment: Annotation(),
  senderUser: Annotation(),
  receiverUser: Annotation(),
  senderAccount: Annotation(),
  receiverAccount: Annotation(),
  shouldRunTransfer: Annotation(),
  transferExecuted: Annotation(),
  transactionResult: Annotation(),
  suggestions: Annotation(),
  errorMessage: Annotation()
});

const resetTransferFlow = {
  phase: TRANSFER_PHASE.IDLE,
  receiverEmail: '',
  amount: null,
  description: ''
};

const processTransferInput = async (state) => {
  const userInput = String(state.userInput || '').trim();
  const userLanguage = state.userLanguage === 'he' ? 'he' : 'en';
  const phase = state.phase || TRANSFER_PHASE.IDLE;

  if (!userInput) {
    return { handled: false, reply: '', phase };
  }

  if (!isTransferIntent(userInput) && phase === TRANSFER_PHASE.IDLE) {
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

  if (nextPhase === TRANSFER_PHASE.IDLE) {
    const parsedEmail = parseEmail(userInput);
    const parsedAmount = parseAmount(userInput);
    const parsedDescription = parseDescription(userInput);

    if (parsedEmail && parsedAmount) {
      receiverEmail = parsedEmail;
      amount = parsedAmount;
      description = parsedDescription;
      nextPhase = TRANSFER_PHASE.AWAIT_CONFIRMATION;
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
  }

  if (nextPhase === TRANSFER_PHASE.AWAIT_CONFIRMATION && !isYes(userInput)) {
    const summary = userLanguage === 'he'
      ? `לאשר העברה של ${amount} ILS אל ${receiverEmail}${description ? ` עם תיאור: ${description}` : ''}? כתוב "כן" לאישור או "לא" לביטול.`
      : `Confirm transfer of ${amount} ILS to ${receiverEmail}${description ? ` with description: ${description}` : ''}? Type "yes" to confirm or "no" to cancel.`;

    return {
      handled: true,
      reply: summary,
      action: null,
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      receiverEmail,
      amount,
      description,
      shouldRunTransfer: false
    };
  }

  if (nextPhase === TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION && !isYes(userInput)) {
    const prompt = userLanguage === 'he'
      ? `זוהתה העברה מעל ${EXTRA_CONFIRMATION_THRESHOLD} ILS. האם לאשר סופית העברה של ${amount} ILS אל ${receiverEmail}? כתוב "כן" או "לא".`
      : `Transfer above ${EXTRA_CONFIRMATION_THRESHOLD} ILS detected. Final confirmation required for ${amount} ILS to ${receiverEmail}. Type "yes" or "no".`;

    return {
      handled: true,
      reply: prompt,
      action: null,
      phase: TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION,
      receiverEmail,
      amount,
      description,
      shouldRunTransfer: false
    };
  }

  return {
    handled: true,
    reply: '',
    action: null,
    phase,
    receiverEmail,
    amount,
    description,
    shouldRunTransfer: true
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

    return {
      senderUser,
      receiverUser,
      senderAccount,
      receiverAccount,
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

  if (Number(state.amount) > EXTRA_CONFIRMATION_THRESHOLD && state.phase !== TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION) {
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `הסכום גדול מ-${EXTRA_CONFIRMATION_THRESHOLD} ILS. האם זה הסכום שברצונך להעביר? כתוב "כן" כדי להמשיך או "לא" כדי לבטל.`
        : `Amount is above ${EXTRA_CONFIRMATION_THRESHOLD} ILS. Is this the amount you want to transfer? Type "yes" to continue or "no" to cancel.`,
      phase: TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION,
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
  if (state.phase === TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION) {
    return state;
  }

  if (state.handled && !state.transferExecuted) {
    return state;
  }

  const suggestions = Array.isArray(state.suggestions) ? state.suggestions.filter(Boolean) : [];
  if (!suggestions.length) {
    return {
      reply: state.reply,
      ...resetTransferFlow,
      shouldRunTransfer: false
    };
  }

  const replyWithSuggestions = `${state.reply}\n\n${suggestions.join('\n')}`;

  return {
    reply: replyWithSuggestions,
    ...resetTransferFlow,
    shouldRunTransfer: false
  };
};

const shouldGoEvaluate = (state) => {
  if (!state.handled || !state.shouldRunTransfer) return END;
  return 'evaluate_account';
};

const shouldGoExecute = (state) => {
  if (state.phase === TRANSFER_PHASE.AWAIT_RISK_CONFIRMATION) return END;
  if (state.handled && !state.shouldRunTransfer) return END;
  return 'execute_transfer';
};

const transferGraph = new StateGraph(TransferState)
  .addNode('process_input', processTransferInput)
  .addNode('evaluate_account', evaluateAccountNode)
  .addNode('risk_assessment', riskAssessmentNode)
  .addNode('execute_transfer', executeTransferNode)
  .addNode('leverage_data', leverageDataNode)
  .addNode('respond', respondNode)
  .addEdge(START, 'process_input')
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
  const result = await transferGraph.invoke({
    userInput,
    userLanguage,
    userId,
    phase: transferState?.phase || TRANSFER_PHASE.IDLE,
    receiverEmail: transferState?.receiverEmail || '',
    amount: transferState?.amount ?? null,
    description: transferState?.description || '',
    handled: false,
    reply: '',
    action: null,
    riskAssessment: null,
    senderUser: null,
    receiverUser: null,
    senderAccount: null,
    receiverAccount: null,
    shouldRunTransfer: false,
    transferExecuted: false,
    transactionResult: null,
    suggestions: [],
    errorMessage: null
  });

  return {
    handled: Boolean(result?.handled),
    reply: String(result?.reply || ''),
    action: result?.action || null,
    nextTransferState: {
      phase: result?.phase || TRANSFER_PHASE.IDLE,
      receiverEmail: result?.receiverEmail || '',
      amount: result?.amount ?? null,
      description: result?.description || ''
    }
  };
};
