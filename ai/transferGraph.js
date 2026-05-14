import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';
import { transferMoney } from '../models/transactionsModel.js';

const TRANSFER_PHASE = {
  IDLE: 'idle',
  COLLECT_RECEIVER: 'collect_receiver',
  COLLECT_AMOUNT: 'collect_amount',
  COLLECT_DESCRIPTION: 'collect_description',
  AWAIT_CONFIRMATION: 'await_confirmation'
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

const isTransferIntent = (text) => {
  const value = String(text || "").toLowerCase().trim();

  const historyLike = [
    "היסטור",
    "history",
    "last transfer",
    "העברה אחרונה",
    "כמה העברות",
    "count transfers",
    "recent transfers",
    "העברות אחרונות"
  ].some((token) => value.includes(token));

  if (historyLike) return false;

  const explicitTransferAction = [
    "send money",
    "make transfer",
    "new transfer",
    "transfer now",
    "start transfer",
    "להעביר כסף",
    "בצע העברה",
    "תבצע העברה",
    "העברה חדשה",
    "שלח כסף",
    "תעביר"
  ].some((token) => value.includes(token));

  return explicitTransferAction;
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
  action: Annotation()
});

const processTransfer = async (state) => {
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
      reply: userLanguage === 'he'
        ? 'ביטלתי את תהליך ההעברה.'
        : 'I canceled the transfer flow.',
      action: null,
      phase: TRANSFER_PHASE.IDLE,
      receiverEmail: '',
      amount: null,
      description: ''
    };
  }

  let nextPhase = phase;
  let receiverEmail = state.receiverEmail || '';
  let amount = state.amount ?? null;
  let description = state.description || '';

  if (nextPhase === TRANSFER_PHASE.IDLE) {
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט. מלא פרטים ולחץ שלח.'
        : 'I opened a quick transfer form in the chat. Fill the details and submit.',
      action: 'open_money_transfer_inline',
      phase: TRANSFER_PHASE.IDLE,
      receiverEmail: '',
      amount: null,
      description: ''
    };
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
        description
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
        description
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
      description
    };
  }

  try {
    const senderUser = await usersModel.findUserById(state.userId);
    if (!senderUser) {
      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'לא הצלחתי לזהות את המשתמש המחובר.'
          : 'I could not identify the authenticated user.',
        action: null,
        phase: TRANSFER_PHASE.IDLE
      };
    }

    const receiverUser = await usersModel.findUserByEmail(receiverEmail);
    if (!receiverUser) {
      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'לא מצאתי משתמש עם כתובת האימייל הזו.'
          : 'I could not find a user with that email.',
        action: null,
        phase: TRANSFER_PHASE.COLLECT_RECEIVER,
        receiverEmail: '',
        amount: null,
        description: ''
      };
    }

    if (String(receiverUser._id) === String(senderUser._id)) {
      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'אי אפשר לבצע העברה לעצמך. הזן אימייל אחר.'
          : 'You cannot transfer to your own account. Provide another email.',
        action: null,
        phase: TRANSFER_PHASE.COLLECT_RECEIVER,
        receiverEmail: '',
        amount: null,
        description: ''
      };
    }

    const senderAccount = await accountsModel.findAccountByUserId(senderUser._id);
    const receiverAccount = await accountsModel.findAccountByUserId(receiverUser._id);

    if (!senderAccount || !receiverAccount) {
      return {
        handled: true,
        reply: userLanguage === 'he'
          ? 'לא נמצא חשבון מקור או יעד לביצוע ההעברה.'
          : 'Source or target account was not found.',
        action: null,
        phase: TRANSFER_PHASE.IDLE
      };
    }

    await transferMoney({
      fromAccountId: senderAccount._id,
      toAccountId: receiverAccount._id,
      amount: Number(amount),
      description: description || undefined
    });

    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `ההעברה בוצעה בהצלחה: ${amount} ILS ל־${receiverEmail}.`
        : `Transfer completed: ${amount} ILS to ${receiverEmail}.`,
      action: null,
      phase: TRANSFER_PHASE.IDLE,
      receiverEmail: '',
      amount: null,
      description: ''
    };
  } catch (err) {
    return {
      handled: true,
      reply: userLanguage === 'he'
        ? `ההעברה נכשלה: ${String(err?.message || 'שגיאה לא ידועה')}`
        : `Transfer failed: ${String(err?.message || 'unknown error')}`,
      action: null,
      phase: TRANSFER_PHASE.IDLE,
      receiverEmail: '',
      amount: null,
      description: ''
    };
  }
};

const transferGraph = new StateGraph(TransferState)
  .addNode('process', processTransfer)
  .addEdge(START, 'process')
  .addEdge('process', END)
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
    action: null
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
