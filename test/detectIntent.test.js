import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent } from '../ai/intents/detectIntent.js';
import { validateLlmSemanticParse } from '../ai/intents/llmSemanticParser.js';

test('detectIntent uses LLM fallback as current-message-only semantic parser', async () => {
  let receivedMessages = [];
  const createChatCompletion = async ({ messages }) => {
    receivedMessages = messages;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            domain: 'transactions',
            intent: 'recent_transactions',
            semanticQuery: {
              domain: 'transactions',
              intent: 'transactions_query',
              action: 'transfer_money',
              filters: { type: 'transfer' },
              timeRange: 'this_month',
              aggregation: 'list',
              limit: 25
            }
          })
        }
      }]
    };
  };

  const result = await detectIntent({
    userInput: 'תראה לי עשרים וחמש העברות אחרונות החודש',
    createChatCompletion
  });

  assert.equal(receivedMessages.length, 2);
  assert.equal(receivedMessages[1].role, 'user');
  assert.equal(receivedMessages[1].content, 'תראה לי עשרים וחמש העברות אחרונות החודש');
  assert.equal(result.source, 'current_message_llm_fallback');
  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.semanticQuery.limit, 25);
  assert.equal(result.semanticQuery.timeRange, 'this_month');
});

test('validateLlmSemanticParse rejects unsupported or unsafe transaction values', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'recent_transactions',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'delete_account',
      filters: { type: 'wire' },
      timeRange: 'next_year',
      aggregation: 'list',
      limit: 1000
    }
  });

  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'list',
    limit: null
  });
});
