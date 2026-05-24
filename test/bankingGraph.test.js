import test from 'node:test';
import assert from 'node:assert/strict';
import { runBankingGraph } from '../ai/graphs/bankingGraph.js';
import { createBusinessServices } from '../ai/services/businessServices.js';

const services = createBusinessServices();

test('banking graph routes support through deterministic support workflow', async () => {
  const result = await runBankingGraph({
    userInput: 'I need a representative',
    userId: 'user-1',
    history: [],
    createChatCompletion: null,
    services
  });

  assert.equal(result.action, 'open_video_call');
  assert.match(result.reply, /video call/i);
});

test('banking graph opens transfer form for transfer intent', async () => {
  const result = await runBankingGraph({
    userInput: 'send money',
    userId: 'user-1',
    history: [],
    createChatCompletion: null,
    services
  });

  assert.equal(result.action?.type, 'open_money_transfer_inline');
  assert.equal(result.nextTransferState?.phase, 'idle');
});

test('banking graph keeps an active transfer workflow without a new LLM intent', async () => {
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
    createChatCompletion: null,
    services
  });

  assert.match(result.reply, /canceled/i);
  assert.equal(result.action?.type, 'reset_transfer_form');
  assert.equal(result.nextTransferState?.phase, 'idle');
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
    createChatCompletion: null,
    services: transferServices
  });

  assert.equal(request.action?.type, 'transfer_high_amount_confirm');
  assert.equal(request.nextTransferState?.riskConfirmationAsked, true);
  assert.equal(executedTransfer, null);

  const confirmation = await runBankingGraph({
    userInput: 'yes',
    userId: 'sender-1',
    history: request.nextHistory,
    transferState: request.nextTransferState,
    createChatCompletion: null,
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
    createChatCompletion: null,
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
    createChatCompletion: null,
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
        return { found: true, action: 'open_money_transfer', userId: 'user-1' };
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
    createChatCompletion: null,
    services: transferServices
  });

  assert.equal(directRequest.action?.type, 'open_money_transfer_inline');
  assert.doesNotMatch(directRequest.reply, /מצאתי עבורך/);

  const howToRequest = await runBankingGraph({
    userInput: 'איך מבצעים העברה?',
    userId: 'user-1',
    history: [],
    createChatCompletion: null,
    services: transferServices
  });

  assert.equal(howToRequest.action?.type, 'open_money_transfer_inline');
  assert.doesNotMatch(howToRequest.reply, /מצאתי עבורך/);
});
