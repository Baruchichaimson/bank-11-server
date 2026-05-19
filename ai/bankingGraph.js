import { Annotation } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import { executeBankTool } from './bankingTools.js';
import { runTransferGraph } from './transferGraph.js';
import { OPENAI_MODEL, hasOpenAiKey, openai } from './openaiClient.js';

const BankingState = Annotation.Root({
  userInput: Annotation(),
  userLanguage: Annotation(),
  userId: Annotation(),
  transferState: Annotation(),
  intent: Annotation(),
  toolName: Annotation(),
  toolArgs: Annotation(),
  toolResult: Annotation(),
  transferFlow: Annotation(),
  handled: Annotation(),
  reply: Annotation(),
  action: Annotation(),
  nextTransferState: Annotation(),
  riskLevel: Annotation(),
  insights: Annotation()
});

const parseJsonObject = (text) => {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return null;
  }
};

const formatDateForUser = (isoString, userLanguage) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(userLanguage === 'he' ? 'he-IL' : 'en-US');
};

const formatFinancialResponse = (toolName, result, userLanguage) => {
  if (!result || result.found === false) {
    if (String(result?.message || '').toLowerCase().includes('invalid date range')) {
      return userLanguage === 'he'
        ? 'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "7 העברות אחרונות בחודש שעבר".'
        : 'I could not parse the date range. Try: "7 recent transfers from last month".';
    }
    return userLanguage === 'he'
      ? 'לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע.'
      : 'I could not retrieve your data right now. Please try again shortly.';
  }

  if (userLanguage === 'he') {
    if (toolName === 'get_balance') {
      return `היתרה הנוכחית שלך היא ${result.balance} ${result.currency}. סטטוס החשבון הוא ${result.status}.`;
    }
    if (toolName === 'count_transfers') {
      return `ביצעת ${result.count} העברות בין ${formatDateForUser(result.from, userLanguage)} ל־${formatDateForUser(result.to, userLanguage)}.`;
    }
    if (toolName === 'get_last_transfer') {
      return `ההעברה האחרונה הייתה ${result.amount} ILS\nשולח: ${result.fromEmail}\nמקבל: ${result.toEmail}\nתאריך: ${formatDateForUser(result.createdAt, userLanguage)}.`;
    }
    if (toolName === 'get_recent_transfers') {
      if (!result.items?.length) return 'לא נמצאו העברות בטווח שביקשת.';
      const rows = result.items.map(
        (tx, i) => `העברה ${i + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
      ).join('\n\n');
      return `מצאתי עבורך ${result.items.length} העברות:\n\n${rows}`;
    }
  }

  if (toolName === 'get_balance') {
    return `Your current balance is ${result.balance} ${result.currency}. Account status is ${result.status}.`;
  }
  if (toolName === 'count_transfers') {
    return `You made ${result.count} transfers between ${formatDateForUser(result.from, userLanguage)} and ${formatDateForUser(result.to, userLanguage)}.`;
  }
  if (toolName === 'get_last_transfer') {
    return `Your latest transfer was ${result.amount} ILS\nFrom: ${result.fromEmail}\nTo: ${result.toEmail}\nDate: ${formatDateForUser(result.createdAt, userLanguage)}.`;
  }
  if (toolName === 'get_recent_transfers') {
    if (!result.items?.length) return 'No transfers were found in the requested range.';
    const rows = result.items.map(
      (tx, i) => `Transfer ${i + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
    ).join('\n\n');
    return `I found ${result.items.length} transfers:\n\n${rows}`;
  }

  return userLanguage === 'he' ? 'הנתונים נשלפו בהצלחה.' : 'Data retrieved successfully.';
};

const ruleBasedIntent = (text) => {
  const value = String(text || '').toLowerCase();
  if (value.includes('transfer') || value.includes('העברה') || value.includes('להעביר') || value.includes('שלח כסף')) {
    return 'transfer_money';
  }
  if (value.includes('balance') || value.includes('יתרה')) return 'check_balance';
  if (value.includes('summary') || value.includes('סיכום')) return 'account_summary';
  if (value.includes('history') || value.includes('recent') || value.includes('היסטור') || value.includes('העברות')) {
    return 'view_transactions';
  }
  return 'general_banking_question';
};

const findIntentNode = async (state) => {
  if (!hasOpenAiKey || !openai) {
    return { intent: ruleBasedIntent(state.userInput) };
  }
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Classify user banking intent. Return JSON only.
Allowed intents: transfer_money, check_balance, view_transactions, account_summary, spending_insights, dispute_transaction, general_banking_question.`
        },
        { role: 'user', content: String(state.userInput || '') }
      ],
      response_format: { type: 'json_object' }
    });
    const parsed = parseJsonObject(response?.choices?.[0]?.message?.content);
    const intent = String(parsed?.intent || '').trim();
    return { intent: intent || ruleBasedIntent(state.userInput) };
  } catch {
    return { intent: ruleBasedIntent(state.userInput) };
  }
};

const evaluateAccountNode = async (state) => {
  const intent = String(state.intent || '');
  if (intent === 'transfer_money') {
    return { riskLevel: 'pending' };
  }
  if (intent === 'check_balance') {
    return { toolName: 'get_balance', toolArgs: {} };
  }
  if (intent === 'account_summary') {
    return { toolName: 'get_balance', toolArgs: {} };
  }

  if (intent === 'view_transactions' || intent === 'spending_insights') {
    if (!hasOpenAiKey || !openai) {
      return { toolName: 'get_recent_transfers', toolArgs: { limit: 5, from: 'last month' } };
    }
    try {
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `Extract transaction-query arguments. Return JSON only:
{
  "mode": "count" | "last" | "recent",
  "limit": number | null,
  "from": string | "",
  "to": string | ""
}`
          },
          { role: 'user', content: String(state.userInput || '') }
        ],
        response_format: { type: 'json_object' }
      });
      const parsed = parseJsonObject(response?.choices?.[0]?.message?.content) || {};
      const mode = String(parsed.mode || 'recent').trim();
      const limit = Number(parsed.limit);
      const toolArgs = {};
      if (parsed.from) toolArgs.from = String(parsed.from).trim();
      if (parsed.to) toolArgs.to = String(parsed.to).trim();
      if (Number.isFinite(limit) && limit > 0) toolArgs.limit = Math.min(Math.max(Math.floor(limit), 1), 100);

      if (mode === 'count') return { toolName: 'count_transfers', toolArgs };
      if (mode === 'last') return { toolName: 'get_last_transfer', toolArgs: {} };
      return { toolName: 'get_recent_transfers', toolArgs: { ...toolArgs, ...(toolArgs.limit ? {} : { limit: 5 }) } };
    } catch {
      return { toolName: 'get_recent_transfers', toolArgs: { limit: 5, from: 'last month' } };
    }
  }

  if (intent === 'dispute_transaction') {
    return {
      handled: true,
      reply: state.userLanguage === 'he'
        ? 'כרגע ניתן לצפות בהעברות, יתרה ולבצע העברה. פתיחת מחלוקת תהיה זמינה בהמשך.'
        : 'Dispute flow is not enabled yet. You can currently view transfers, balance, and make transfers.'
    };
  }

  return {
    handled: true,
    reply: state.userLanguage === 'he'
      ? 'אני יכול לעזור עם העברה, יתרה והיסטוריית העברות. נסה לנסח מה תרצה לבדוק.'
      : 'I can help with transfers, balance, and transfer history. Tell me what you want to check.'
  };
};

const riskAssessmentNode = async (state) => {
  if (state.intent !== 'transfer_money') return { riskLevel: 'low' };
  return { riskLevel: 'low' };
};

const runTransactionNode = async (state) => {
  if (state.intent === 'transfer_money') {
    const transferFlow = await runTransferGraph({
      userInput: state.userInput,
      userLanguage: state.userLanguage,
      userId: state.userId,
      transferState: state.transferState
    });
    return {
      transferFlow,
      handled: transferFlow.handled,
      reply: transferFlow.reply,
      action: transferFlow.action,
      nextTransferState: transferFlow.nextTransferState
    };
  }

  if (state.toolName) {
    const toolResult = await executeBankTool({
      name: state.toolName,
      args: state.toolArgs || {},
      userId: state.userId
    });
    return { toolResult, handled: true };
  }

  return {};
};

const leverageDataNode = async (state) => {
  if (state.intent !== 'spending_insights' || !state.toolResult?.items?.length) return {};
  const total = state.toolResult.items.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const avg = total / Math.max(state.toolResult.items.length, 1);
  return {
    insights: {
      total,
      avg
    }
  };
};

const respondNode = async (state) => {
  if (state.reply) return state;
  if (state.toolName && state.toolResult) {
    const baseReply = formatFinancialResponse(state.toolName, state.toolResult, state.userLanguage);
    if (state.intent === 'spending_insights' && state.insights) {
      const suffix = state.userLanguage === 'he'
        ? `\n\nתובנות: סך הוצאות בטווח ${state.insights.total.toFixed(2)} ILS, ממוצע לעסקה ${state.insights.avg.toFixed(2)} ILS.`
        : `\n\nInsights: total spending in range ${state.insights.total.toFixed(2)} ILS, average per transaction ${state.insights.avg.toFixed(2)} ILS.`;
      return { reply: `${baseReply}${suffix}` };
    }
    return { reply: baseReply };
  }
  return state;
};

const routeAfterIntent = (state) => (state.handled ? END : 'evaluate_account');
const routeAfterEvaluate = (state) => (state.handled ? END : 'risk_assessment');
const routeAfterRisk = (state) => (state.riskLevel === 'high' ? END : 'run_transaction');
const routeAfterRun = (state) => (state.handled ? 'leverage_data' : END);

const bankingGraph = new StateGraph(BankingState)
  .addNode('find_intent', findIntentNode)
  .addNode('evaluate_account', evaluateAccountNode)
  .addNode('risk_assessment', riskAssessmentNode)
  .addNode('run_transaction', runTransactionNode)
  .addNode('leverage_data', leverageDataNode)
  .addNode('respond', respondNode)
  .addEdge(START, 'find_intent')
  .addConditionalEdges('find_intent', routeAfterIntent)
  .addConditionalEdges('evaluate_account', routeAfterEvaluate)
  .addConditionalEdges('risk_assessment', routeAfterRisk)
  .addConditionalEdges('run_transaction', routeAfterRun)
  .addEdge('leverage_data', 'respond')
  .addEdge('respond', END)
  .compile();

export const runBankingGraph = async ({
  userInput,
  userLanguage,
  userId,
  transferState
}) => {
  const result = await bankingGraph.invoke({
    userInput,
    userLanguage,
    userId,
    transferState,
    intent: 'general_banking_question',
    toolName: '',
    toolArgs: {},
    toolResult: null,
    transferFlow: null,
    handled: false,
    reply: '',
    action: null,
    nextTransferState: transferState,
    riskLevel: 'pending',
    insights: null
  });

  return {
    handled: Boolean(result?.handled || result?.reply),
    reply: String(result?.reply || ''),
    action: result?.action || null,
    nextTransferState: result?.nextTransferState || transferState || null
  };
};
