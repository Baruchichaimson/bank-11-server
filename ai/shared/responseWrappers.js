import { MAX_HISTORY } from './legacyCompatUtils.js';

export const appendHistory = (history, userText, assistantText) => (
  [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText }
  ].slice(-MAX_HISTORY)
);

export const createReplyPayload = ({
  history,
  userText,
  reply,
  transferState = null,
  action = null
}) => ({
  reply,
  nextHistory: appendHistory(history, userText, reply),
  nextTransferState: transferState,
  action
});

export const getWindowToolReply = (toolName, userLanguage) => {
  if (toolName === 'open_video_call_window') {
    return userLanguage === 'he'
      ? 'פתחתי עבורך את חלון שיחת הווידאו.'
      : 'I opened the video call window for you.';
  }
  if (toolName === 'open_money_transfer_window') {
    return userLanguage === 'he'
      ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט.'
      : 'I opened a quick transfer form in the chat.';
  }
  return '';
};

export const getWindowToolAction = (toolName, toolResult) => {
  if (toolName === 'open_video_call_window') return toolResult?.action || 'open_video_call';
  if (toolName === 'open_money_transfer_window') return { type: 'open_money_transfer_inline' };
  return null;
};
