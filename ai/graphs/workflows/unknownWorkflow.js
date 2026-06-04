import {
  getLlmParseFailedReply,
  getLlmUnavailableReply
} from '../../shared/shared.js';

const getUnknownIntentReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'אני עוזר בנקאי בלבד, ולכן אני לא יכול לענות על שאלות מסוג זה. אפשר לבקש ממני יתרה, פירוט פעולות או העברות, פרטים אישיים, שיחת וידאו עם נציג או ביצוע העברה.'
    : 'I am only a banking assistant, so I cannot answer this type of request. You can ask for your balance, transaction or transfer details, personal details, a video call with a representative, or a money transfer.'
);

const generateUnknownReply = ({ state }) => {
  if (state.intent?.source === 'llm_unavailable') {
    return getLlmUnavailableReply(state.session.userLanguage);
  }

  if (state.intent?.source === 'llm_parse_failed') {
    return getLlmParseFailedReply(state.session.userLanguage);
  }

  return getUnknownIntentReply(state.session.userLanguage);
};

export const runUnknownWorkflow = async ({ state }) => {
  const message = generateUnknownReply({ state });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Return Response with Suggestions' },
    execution: {
      executed: false,
      result: null
    },
    ui: {
      ...state.ui,
      message,
      suggestions: []
    }
  };
};
