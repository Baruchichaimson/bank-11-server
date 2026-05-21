export const createIsolatedTurnState = ({ userInput, userId, userLanguage }) => ({
  immutableIntentInput: String(userInput || '').trim(),
  routing: {
    intentSource: 'current_message_only',
    domain: 'unknown',
    intent: 'unknown'
  },
  memory: {
    userId,
    userLanguage,
    // Memory is intentionally data-only and never read by routing logic.
    userData: {}
  }
});
