import { END, START, StateGraph } from '@langchain/langgraph';
import {
  TRANSFER_PHASE,
  TransferState,
  resetTransferFlow
} from '../../transferState.js';
import {
  getSemanticTransferPayload
} from './transferPayloadParser.js';
import {
  getSenderUser,
  validateAccountsExist,
  validateNotSelfTransfer,
  validateRecipientExists,
  validateSufficientBalance
} from './transferValidator.js';
import {
  RISK_RULES_AND_LIMITS,
  evaluateTransferRisk,
  requiresHighAmountConfirmation
} from './transferRiskPolicy.js';
import {
  buildHighAmountConfirmAction,
  buildLowBalanceSuggestion,
  buildOpenTransferFormAction,
  buildResetTransferFormAction,
  buildTransferConfirmationSummary,
  buildTransferFormErrorAction,
  buildTransferSuccessReply,
  formatIls
} from './transferResponseBuilder.js';

const RECENT_TRANSACTIONS_LIMIT = 5;

const getBusinessServices = (config) => config?.configurable?.services || {};

const getFlowLanguage = (state) => (
  state.flowLanguage === 'he' ? 'he' : 'en'
);

const mapRecentTransaction = (tx) => ({
  id: tx.id ?? tx._id,
  amount: tx.amount,
  fromEmail: tx.fromEmail,
  toEmail: tx.toEmail,
  createdAt: tx.createdAt
});

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

  // Inline form submissions already contain complete details, so they can proceed directly.
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
    }

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

export const parseInputNode = async (state, config) => {
  const phase = state.phase || TRANSFER_PHASE.IDLE;
  const detectedIntent = state.semanticIntent || 'unknown';
  const transferIntent = phase !== TRANSFER_PHASE.IDLE || detectedIntent === 'transfer_money';
  const parsedState = await processTransferInput({
    ...state,
    transferIntent,
    detectedIntent
  }, config);

  return {
    transferIntent,
    detectedIntent,
    ...parsedState
  };
};

export const validateTransferNode = async (state, config) => {
  if (state.handled && !state.shouldRunTransfer) return {};

  try {
    const services = getBusinessServices(config);
    const userLanguage = getFlowLanguage(state);
    const senderUser = await getSenderUser({ services, userId: state.userId });

    if (!senderUser) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא הצלחתי לזהות את המשתמש המחובר.' : 'I could not identify the authenticated user.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'sender_user_not_found'
      };
    }

    const receiverUser = await validateRecipientExists({
      services,
      receiverEmail: state.receiverEmail
    });
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

    if (!validateNotSelfTransfer({ senderUser, receiverUser })) {
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

    const {
      senderAccount,
      receiverAccount,
      isValid: accountsExist
    } = await validateAccountsExist({ services, senderUser, receiverUser });

    if (!accountsExist) {
      return {
        handled: true,
        reply: userLanguage === 'he' ? 'לא נמצא חשבון מקור או יעד לביצוע ההעברה.' : 'Source or target account was not found.',
        ...resetTransferFlow,
        shouldRunTransfer: false,
        errorMessage: 'account_not_found'
      };
    }

    const {
      requestedAmount,
      senderBalance,
      isValid: hasSufficientBalance
    } = validateSufficientBalance({
      amount: state.amount,
      senderAccount
    });

    if (!hasSufficientBalance) {
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
      : [];

    return {
      senderUser,
      receiverUser,
      senderAccount,
      receiverAccount,
      recentTransactions: (recentTransactions || []).map(mapRecentTransaction),
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

export const riskCheckNode = async (state, config) => {
  if (state.handled && !state.shouldRunTransfer) return {};

  const services = getBusinessServices(config);
  const userLanguage = getFlowLanguage(state);

  if (requiresHighAmountConfirmation({
    amount: state.amount,
    riskConfirmationAsked: state.riskConfirmationAsked
  })) {
    return {
      handled: true,
      reply: '',
      action: buildHighAmountConfirmAction(userLanguage, state.amount),
      phase: TRANSFER_PHASE.AWAIT_CONFIRMATION,
      riskConfirmationAsked: true,
      shouldRunTransfer: false
    };
  }

  const riskAssessment = await evaluateTransferRisk({
    services,
    senderUser: state.senderUser,
    receiverUser: state.receiverUser,
    amount: state.amount,
    senderAccount: state.senderAccount
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

export const executeTransferNode = async (state, config) => {
  const services = getBusinessServices(config);
  const userLanguage = getFlowLanguage(state);

  try {
    if (!services.transactionService?.executeTransfer) {
      throw new Error('Transfer service unavailable');
    }

    const transferPayload = {
      fromAccountId: state.senderAccount._id,
      toAccountId: state.receiverAccount._id,
      amount: Number(state.amount),
      description: state.description || undefined
    };
    const transaction = await services.transactionService.executeTransfer(transferPayload);
    const updatedSenderAccount = services.accountService?.findAccountById
      ? await services.accountService.findAccountById(state.senderAccount._id)
      : state.senderAccount;

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

export const buildResponseNode = async (state, config) => {
  if (state.handled && !state.transferExecuted) {
    return state;
  }

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
    : 0;

  if (monthlyOutgoingCount >= 10) {
    suggestions.push(
      language === 'he'
        ? 'ראיתי נפח העברות גבוה בחודש האחרון. רוצה שאציע לך תקרת תקציב חודשית?'
        : 'You had high transfer activity in the last month. Want me to suggest a monthly transfer budget cap?'
    );
  }

  return {
    reply: buildTransferSuccessReply({
      language,
      amount: state.amount,
      receiverEmail: state.receiverEmail,
      balance: state.senderAccount?.balance,
      suggestions
    }),
    suggestions,
    ...resetTransferFlow,
    shouldRunTransfer: false
  };
};

const shouldValidateTransfer = (state) => {
  if (!state.handled || !state.shouldRunTransfer) return END;
  return 'validate_transfer';
};

const shouldExecuteTransfer = (state) => {
  if (state.handled && !state.shouldRunTransfer) return END;
  return 'execute_transfer';
};

export const transferStateMachine = new StateGraph(TransferState)
  .addNode('parse_input', parseInputNode)
  .addNode('validate_transfer', validateTransferNode)
  .addNode('risk_check', riskCheckNode)
  .addNode('execute_transfer', executeTransferNode)
  .addNode('build_response', buildResponseNode)
  .addEdge(START, 'parse_input')
  .addConditionalEdges('parse_input', shouldValidateTransfer)
  .addEdge('validate_transfer', 'risk_check')
  .addConditionalEdges('risk_check', shouldExecuteTransfer)
  .addEdge('execute_transfer', 'build_response')
  .addEdge('build_response', END)
  .compile();
