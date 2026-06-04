import test from 'node:test';
import assert from 'node:assert/strict';
import { runBankingGraph } from '../ai/graphs/bankingGraph.js';
import { routeWorkflow } from '../ai/router/workflowRouter.js';
import { createBusinessServices } from '../ai/services/businessServices.js';

const services = createBusinessServices();

const createLlmMock = (payload) => async () => ({
  choices: [{
    message: {
      content: JSON.stringify({
        workflowContinuation: false,
        correction: null,
        transferPayload: null,
        semanticQuery: null,
        ...payload
      })
    }
  }]
});

const transferLlm = (payload = {}) => createLlmMock({
  domain: 'transactions',
  intent: 'transfer_money',
  ...payload
});

test('workflow router maps only closed supported intents to workflows', () => {
  assert.equal(routeWorkflow({ intent: 'check_balance', domain: 'unknown' }), 'balance_workflow');
  assert.equal(routeWorkflow({ intent: 'recent_transactions', domain: 'unknown' }), 'transactions_workflow');
  assert.equal(routeWorkflow({ intent: 'show_personal_details', domain: 'unknown' }), 'personal_details_workflow');
  assert.equal(routeWorkflow({ intent: 'contact_support', domain: 'unknown' }), 'support_workflow');
  assert.equal(routeWorkflow({ intent: 'transfer_money', domain: 'unknown' }), 'transfer_workflow');
  assert.equal(routeWorkflow({ intent: 'unknown', domain: 'account' }), 'unknown_workflow');
  assert.equal(routeWorkflow({ intent: 'unsupported_banking_question', domain: 'transactions' }), 'unknown_workflow');
});

test('banking graph routes support through LLM-selected support workflow', async () => {
  const result = await runBankingGraph({
    userInput: 'I need a representative',
    userId: 'user-1',
    history: [],
    createChatCompletion: createLlmMock({
      domain: 'support',
      intent: 'contact_support'
    }),
    services
  });

  assert.equal(result.action, 'open_video_call');
  assert.match(result.reply, /video call/i);
});

test('banking graph keeps casual non-banking input unknown without opening support', async () => {
  let calls = 0;
  const createChatCompletion = async () => {
    calls += 1;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            domain: 'unknown',
            intent: 'unknown',
            workflowContinuation: false,
            correction: null,
            transferPayload: null,
            semanticQuery: null
          })
        }
      }]
    };
  };

  const result = await runBankingGraph({
    userInput: 'מה קורה?',
    userId: 'user-1',
    history: [],
    createChatCompletion,
    services
  });

  assert.equal(result.action, null);
  assert.equal(result.nextTransferState, null);
  assert.match(result.reply, /אני עוזר בנקאי בלבד/);
  assert.match(result.reply, /יתרה/);
  assert.equal(calls, 1);
});

test('banking graph routes transaction follow-up using LLM conversation context', async () => {
  let executedQuery = null;
  const followupServices = {
    ...services,
    transactionService: {
      async executeStructuredQuery({ query }) {
        executedQuery = query;
        return {
          operation: 'get_first_n_transfers',
          result: { found: true, count: 0, items: [] }
        };
      }
    }
  };

  const result = await runBankingGraph({
    userInput: 'של חודש שעבר',
    userId: 'user-1',
    history: [
      { role: 'user', content: 'תביא 3 העברות אחרונות' },
      { role: 'assistant', content: 'מצאתי עבורך 3 העברות אחרונות...' }
    ],
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      workflowContinuation: true,
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: 'transfer_money',
        filters: { type: 'transfer' },
        timeRange: null,
        dateRange: { from: '2026-05-01', to: '2026-05-31' },
        aggregation: 'first_n',
        limit: 3
      }
    }),
    services: followupServices
  });

  assert.equal(executedQuery?.timeRange, null);
  assert.deepEqual(executedQuery?.dateRange, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(executedQuery?.aggregation, 'first_n');
  assert.equal(executedQuery?.limit, 3);
  assert.match(result.reply, /לא נמצאו העברות/);
});

test('banking graph passes explicit transaction date range to transactions workflow', async () => {
  let executedQuery = null;
  const dateRangeServices = {
    ...services,
    transactionService: {
      async executeStructuredQuery({ query }) {
        executedQuery = query;
        return {
          operation: 'get_recent_transfers',
          result: { found: true, count: 0, items: [] }
        };
      }
    }
  };

  await runBankingGraph({
    userInput: 'תראה לי העברות בין 01/05/2026 ל-10/05/2026',
    userId: 'user-1',
    history: [],
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: 'transfer_money',
        filters: { type: 'transfer' },
        timeRange: null,
        dateRange: { from: '2026-05-01', to: '2026-05-10' },
        aggregation: 'list',
        limit: null
      }
    }),
    services: dateRangeServices
  });

  assert.deepEqual(executedQuery?.dateRange, { from: '2026-05-01', to: '2026-05-10' });
  assert.equal(executedQuery?.timeRange, null);
  assert.equal(executedQuery?.filters?.type, 'transfer');
});

test('banking graph reports unavailable AI when no LLM parser is configured', async () => {
  const result = await runBankingGraph({
    userInput: 'מה קורה?',
    userId: 'user-1',
    history: [],
    createChatCompletion: null,
    services
  });

  assert.equal(result.action, null);
  assert.match(result.reply, /מנוע ה־AI לא מוגדר/);
  assert.doesNotMatch(result.reply, /בנושאי בנקאות/);
});

test('banking graph does not override LLM output with local balance keyword parsing', async () => {
  const isolatedServices = {
    ...services,
    profileService: {
      async getUserProfile() {
        return { found: true, firstName: 'Baruch', lastName: 'Haimson', email: 'chaimsonb2@gmail.com' };
      }
    }
  };

  const nameResult = await runBankingGraph({
    userInput: 'מה השם שלי?',
    userId: 'user-1',
    history: [],
    createChatCompletion: createLlmMock({
      domain: 'profile',
      intent: 'show_personal_details'
    }),
    services: isolatedServices
  });

  assert.match(nameResult.reply, /שמך הוא/);

  const balanceResult = await runBankingGraph({
    userInput: 'מה הייתרה שלי?',
    userId: 'user-1',
    history: nameResult.nextHistory,
    createChatCompletion: createLlmMock({
      domain: 'profile',
      intent: 'show_personal_details',
      toolName: 'get_user_identity'
    }),
    services: isolatedServices
  });

  assert.match(balanceResult.reply, /שמך הוא Baruch Haimson/);
  assert.doesNotMatch(balanceResult.reply, /היתרה הנוכחית/);
});

test('banking graph opens transfer form for transfer intent', async () => {
  const result = await runBankingGraph({
    userInput: 'send money',
    userId: 'user-1',
    history: [],
    createChatCompletion: transferLlm(),
    services
  });

  assert.equal(result.action?.type, 'open_money_transfer_inline');
  assert.equal(result.nextTransferState?.phase, 'form_open');
});

test('banking graph opens transfer form for Hebrew transfer start', async () => {
  const result = await runBankingGraph({
    userInput: 'אני רוצה לבצע העברה',
    userId: 'user-1',
    history: [],
    createChatCompletion: transferLlm(),
    services
  });

  assert.equal(result.action?.type, 'open_money_transfer_inline');
  assert.equal(result.nextTransferState?.phase, 'form_open');
});

test('banking graph submits an opened transfer form without a new LLM intent', async () => {
  let executedTransfer = null;
  let parserCalls = 0;
  const failIfIntentParserRuns = async () => {
    parserCalls += 1;
    throw new Error('open transfer form submit must not run main intent parser');
  };
  const transferServices = {
    ...services,
    profileService: {
      async getUserById() {
        return { _id: 'sender-1', email: 'sender@example.com' };
      },
      async getUserByEmail(email) {
        return { _id: 'receiver-1', email };
      }
    },
    accountService: {
      async getAccountByUserId(userId) {
        return {
          _id: userId === 'sender-1' ? 'account-sender' : 'account-receiver',
          balance: userId === 'sender-1' ? 5000 : 250
        };
      },
      async findAccountById() {
        return { _id: 'account-sender', balance: 4800 };
      }
    },
    transactionService: {
      async executeTransfer(payload) {
        executedTransfer = payload;
        return { _id: 'tx-1', ...payload };
      },
      async getRecentTransactionsByEmail() {
        return [];
      },
      async countMonthlyOutgoingTransfers() {
        return 0;
      }
    },
    riskService: {
      async evaluateRisk() {
        return { requiresReview: false, score: 0, level: 'LOW', reasons: [] };
      }
    }
  };

  const result = await runBankingGraph({
    userInput: 'transfer form submitted',
    userId: 'sender-1',
    history: [],
    transferState: {
      phase: 'form_open',
      receiverEmail: '',
      amount: null,
      description: '',
      riskConfirmationAsked: false,
      flowLanguage: 'en'
    },
    transferPayload: {
      receiverEmail: 'receiver@example.com',
      amount: 200,
      description: null
    },
    createChatCompletion: failIfIntentParserRuns,
    services: transferServices
  });

  assert.match(result.reply, /Transfer completed successfully/);
  assert.equal(result.nextTransferState?.phase, 'idle');
  assert.deepEqual(executedTransfer, {
    fromAccountId: 'account-sender',
    toAccountId: 'account-receiver',
    amount: 200,
    description: undefined
  });
  assert.equal(parserCalls, 0);
});

test('banking graph handles active transfer confirmation payload without a new LLM intent', async () => {
  let parserCalls = 0;
  const failIfParserRuns = async () => {
    parserCalls += 1;
    throw new Error('transfer confirmation payload must not run an LLM parser');
  };

  const result = await runBankingGraph({
    userInput: 'no',
    userId: 'user-1',
    history: [],
    transferState: {
      phase: 'await_confirmation',
      receiverEmail: 'dani@example.com',
      amount: 50,
      description: '',
      riskConfirmationAsked: false,
      flowLanguage: 'en'
    },
    transferPayload: {
      confirmation: 'no'
    },
    createChatCompletion: failIfParserRuns,
    services
  });

  assert.match(result.reply, /canceled/i);
  assert.equal(result.action?.type, 'reset_transfer_form');
  assert.equal(result.nextTransferState?.phase, 'idle');
  assert.equal(parserCalls, 0);
});

test('banking graph keeps transfer form active after validation error and accepts corrected form submit without reparsing', async () => {
  let initialParserCalls = 0;
  let executedTransfer = null;
  const transferServices = {
    ...services,
    profileService: {
      async getUserById() {
        return { _id: 'sender-1', email: 'sender@example.com' };
      },
      async getUserByEmail(email) {
        return { _id: 'receiver-1', email };
      }
    },
    accountService: {
      async getAccountByUserId(userId) {
        return {
          _id: userId === 'sender-1' ? 'account-sender' : 'account-receiver',
          balance: userId === 'sender-1' ? 500 : 100
        };
      },
      async findAccountById() {
        return { _id: 'account-sender', balance: 300 };
      }
    },
    transactionService: {
      async openTransferForm() {
        return { found: true, action: { type: 'open_money_transfer_inline' }, userId: 'sender-1' };
      },
      async executeTransfer(payload) {
        executedTransfer = payload;
        return { _id: 'tx-1', ...payload };
      },
      async getRecentTransactionsByEmail() {
        return [];
      },
      async countMonthlyOutgoingTransfers() {
        return 0;
      }
    },
    riskService: {
      async evaluateRisk() {
        return { requiresReview: false, score: 0, level: 'LOW', reasons: [] };
      }
    }
  };

  const openedForm = await runBankingGraph({
    userInput: 'send money',
    userId: 'sender-1',
    history: [],
    createChatCompletion: async () => {
      initialParserCalls += 1;
      return transferLlm()();
    },
    services: transferServices
  });

  assert.equal(initialParserCalls, 1);
  assert.equal(openedForm.action?.type, 'open_money_transfer_inline');
  assert.equal(openedForm.nextTransferState?.phase, 'form_open');

  let invalidSubmitParserCalls = 0;
  const validationError = await runBankingGraph({
    userInput: 'transfer form submitted',
    userId: 'sender-1',
    history: openedForm.nextHistory,
    transferState: openedForm.nextTransferState,
    transferPayload: {
      receiverEmail: 'receiver@example.com',
      amount: 1000,
      description: null
    },
    createChatCompletion: async () => {
      invalidSubmitParserCalls += 1;
      throw new Error('open transfer form submit must not run main intent parser');
    },
    services: transferServices
  });

  assert.equal(invalidSubmitParserCalls, 0);
  assert.equal(validationError.action?.type, 'transfer_form_error');
  assert.equal(validationError.action?.field, 'amount');
  assert.equal(validationError.nextTransferState?.phase, 'form_open');
  assert.equal(validationError.nextTransferState?.lastValidationError?.field, 'amount');

  let correctionParserCalls = 0;
  const correction = await runBankingGraph({
    userInput: 'transfer form submitted',
    userId: 'sender-1',
    history: validationError.nextHistory,
    transferState: validationError.nextTransferState,
    transferPayload: {
      receiverEmail: 'receiver@example.com',
      amount: 200,
      description: null
    },
    createChatCompletion: async () => {
      correctionParserCalls += 1;
      throw new Error('active transfer correction must not run main intent parser');
    },
    services: transferServices
  });

  assert.match(correction.reply, /Transfer completed successfully/);
  assert.equal(correction.nextTransferState?.phase, 'idle');
  assert.deepEqual(executedTransfer, {
    fromAccountId: 'account-sender',
    toAccountId: 'account-receiver',
    amount: 200,
    description: undefined
  });
  assert.equal(correctionParserCalls, 0);
});

test('banking graph executes high amount transfer after additional confirmation', async () => {
  let executedTransfer = null;
  const transferServices = {
    ...services,
    profileService: {
      async getUserById() {
        return { _id: 'sender-1', email: 'sender@example.com' };
      },
      async getUserByEmail(email) {
        return { _id: 'receiver-1', email };
      }
    },
    accountService: {
      async getAccountByUserId(userId) {
        return {
          _id: userId === 'sender-1' ? 'account-sender' : 'account-receiver',
          balance: userId === 'sender-1' ? 5000 : 250
        };
      },
      async findAccountById() {
        return { _id: 'account-sender', balance: 3500 };
      }
    },
    transactionService: {
      async executeTransfer(payload) {
        executedTransfer = payload;
        return { _id: 'tx-1', ...payload };
      },
      async getRecentTransactionsByEmail() {
        return [];
      },
      async countMonthlyOutgoingTransfers() {
        return 0;
      }
    },
    riskService: {
      async evaluateRisk() {
        return { requiresReview: false, score: 0, level: 'LOW', reasons: [] };
      }
    }
  };

  const request = await runBankingGraph({
    userInput: 'make transfer to receiver@example.com amount 1500',
    userId: 'sender-1',
    history: [],
    createChatCompletion: transferLlm({
      transferPayload: {
        receiverEmail: 'receiver@example.com',
        amount: 1500,
        description: null,
        confirmation: null,
        skipDescription: false,
        startNewTransfer: false
      }
    }),
    services: transferServices
  });

  assert.equal(request.action?.type, 'transfer_high_amount_confirm');
  assert.equal(request.nextTransferState?.riskConfirmationAsked, true);
  assert.equal(executedTransfer, null);

  let confirmationParserCalls = 0;
  const confirmation = await runBankingGraph({
    userInput: 'yes',
    userId: 'sender-1',
    history: request.nextHistory,
    transferState: request.nextTransferState,
    transferPayload: {
      confirmation: 'yes'
    },
    createChatCompletion: async () => {
      confirmationParserCalls += 1;
      throw new Error('transfer confirmation payload must not run an LLM parser');
    },
    services: transferServices
  });

  assert.match(confirmation.reply, /Transfer completed successfully/);
  assert.equal(confirmation.nextTransferState?.phase, 'idle');
  assert.deepEqual(executedTransfer, {
    fromAccountId: 'account-sender',
    toAccountId: 'account-receiver',
    amount: 1500,
    description: undefined
  });
  assert.equal(confirmationParserCalls, 0);
});

test('banking graph executes high amount transfer after Hebrew additional confirmation', async () => {
  let executedTransfer = null;
  const transferServices = {
    ...services,
    profileService: {
      async getUserById() {
        return { _id: 'sender-1', email: 'sender@example.com' };
      },
      async getUserByEmail(email) {
        return { _id: 'receiver-1', email };
      }
    },
    accountService: {
      async getAccountByUserId(userId) {
        return {
          _id: userId === 'sender-1' ? 'account-sender' : 'account-receiver',
          balance: userId === 'sender-1' ? 5000 : 250
        };
      },
      async findAccountById() {
        return { _id: 'account-sender', balance: 3500 };
      }
    },
    transactionService: {
      async executeTransfer(payload) {
        executedTransfer = payload;
        return { _id: 'tx-1', ...payload };
      },
      async getRecentTransactionsByEmail() {
        return [];
      },
      async countMonthlyOutgoingTransfers() {
        return 0;
      }
    },
    riskService: {
      async evaluateRisk() {
        return { requiresReview: false, score: 0, level: 'LOW', reasons: [] };
      }
    }
  };

  const request = await runBankingGraph({
    userInput: 'תבצע העברה ל receiver@example.com סכום 1500',
    userId: 'sender-1',
    history: [],
    createChatCompletion: transferLlm({
      transferPayload: {
        receiverEmail: 'receiver@example.com',
        amount: 1500,
        description: null,
        confirmation: null,
        skipDescription: false,
        startNewTransfer: false
      }
    }),
    services: transferServices
  });

  assert.equal(request.action?.type, 'transfer_high_amount_confirm');
  assert.equal(request.action?.language, 'he');
  assert.equal(request.nextTransferState?.riskConfirmationAsked, true);
  assert.equal(executedTransfer, null);

  let confirmationParserCalls = 0;
  const confirmation = await runBankingGraph({
    userInput: 'כן',
    userId: 'sender-1',
    history: request.nextHistory,
    transferState: request.nextTransferState,
    transferPayload: {
      confirmation: 'yes'
    },
    createChatCompletion: async () => {
      confirmationParserCalls += 1;
      throw new Error('transfer confirmation payload must not run an LLM parser');
    },
    services: transferServices
  });

  assert.match(confirmation.reply, /ההעברה הושלמה בהצלחה/);
  assert.equal(confirmation.nextTransferState?.phase, 'idle');
  assert.deepEqual(executedTransfer, {
    fromAccountId: 'account-sender',
    toAccountId: 'account-receiver',
    amount: 1500,
    description: undefined
  });
  assert.equal(confirmationParserCalls, 0);
});

test('banking graph enforces strict state isolation between name and balance queries', async () => {
  const isolatedServices = {
    ...services,
    profileService: {
      async getUserProfile() {
        return { found: true, firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' };
      }
    },
    accountService: {
      async getBalance() {
        return { found: true, balance: 4200, currency: 'ILS', status: 'active' };
      }
    }
  };

  const nameResult = await runBankingGraph({
    userInput: 'What is my name?',
    userId: 'user-1',
    history: [],
    createChatCompletion: createLlmMock({
      domain: 'profile',
      intent: 'show_personal_details'
    }),
    services: isolatedServices
  });

  assert.match(nameResult.reply, /your name is/i);

  const balanceResult = await runBankingGraph({
    userInput: 'What is my balance?',
    userId: 'user-1',
    history: [
      { role: 'user', content: 'What is my name?' },
      { role: 'assistant', content: nameResult.reply }
    ],
    createChatCompletion: createLlmMock({
      domain: 'account',
      intent: 'check_balance'
    }),
    services: isolatedServices
  });

  assert.match(balanceResult.reply, /your current balance is/i);
  assert.doesNotMatch(balanceResult.reply, /your name is/i);
});

test('banking graph routes Hebrew transfer requests to transfer form, not transaction history', async () => {
  const transferServices = {
    ...services,
    transactionService: {
      async openTransferForm() {
        return { found: true, action: { type: 'open_money_transfer_inline' }, userId: 'user-1' };
      },
      async executeStructuredQuery() {
        throw new Error('transfer request must not execute transaction history query');
      }
    }
  };

  const directRequest = await runBankingGraph({
    userInput: 'תבצע לי העברה',
    userId: 'user-1',
    history: [],
    createChatCompletion: transferLlm(),
    services: transferServices
  });

  assert.equal(directRequest.action?.type, 'open_money_transfer_inline');
  assert.doesNotMatch(directRequest.reply, /מצאתי עבורך/);

  const howToRequest = await runBankingGraph({
    userInput: 'איך מבצעים העברה?',
    userId: 'user-1',
    history: [],
    createChatCompletion: transferLlm(),
    services: transferServices
  });

  assert.equal(howToRequest.action?.type, 'open_money_transfer_inline');
  assert.doesNotMatch(howToRequest.reply, /מצאתי עבורך/);
});
