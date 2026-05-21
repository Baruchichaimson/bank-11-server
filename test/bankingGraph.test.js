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
