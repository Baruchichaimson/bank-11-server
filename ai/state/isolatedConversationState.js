export const createIsolatedTurnState = ({ userInput, userId, userLanguage }) => ({
  immutableIntentInput: String(userInput || '').trim(),
  routing: {
    intentSource: 'safe_unknown',
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
