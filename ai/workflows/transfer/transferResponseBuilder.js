import { EXTRA_CONFIRMATION_THRESHOLD } from './transferRiskPolicy.js';

export const formatIls = (value) => Number(value || 0).toFixed(2);

export const buildTransferFormErrorAction = (field, message, language) => ({
  type: 'transfer_form_error',
  field,
  message,
  language
});

export const buildOpenTransferFormAction = (language) => ({
  type: 'open_money_transfer_inline',
  language
});

export const buildHighAmountConfirmAction = (language, amount) => ({
  type: 'transfer_high_amount_confirm',
  language,
  amount: Number(amount || 0),
  message: language === 'he'
    ? `הסכום הוא ${formatIls(amount)} ILS (מעל ${EXTRA_CONFIRMATION_THRESHOLD}). האם לבצע את ההעברה?`
    : `The amount is ${formatIls(amount)} ILS (above ${EXTRA_CONFIRMATION_THRESHOLD}). Do you want to proceed?`
});

export const buildResetTransferFormAction = (language) => ({
  type: 'reset_transfer_form',
  language
});

export const buildTransferConfirmationSummary = ({
  language,
  amount,
  receiverEmail,
  description
}) => (
  language === 'he'
    ? `לפני ביצוע ההעברה, נא לאשר את הפרטים:\nסכום: ${amount} ILS\nנמען: ${receiverEmail}${description ? `\nתיאור: ${description}` : ''}\n\nאם הכול נכון כתוב "כן". לביטול כתוב "לא".`
    : `Before I execute the transfer, please confirm the details:\nAmount: ${amount} ILS\nRecipient: ${receiverEmail}${description ? `\nDescription: ${description}` : ''}\n\nIf everything is correct, type "yes". To cancel, type "no".`
);

export const buildLowBalanceSuggestion = (language, balance) => {
  if (balance > 300) return null;
  return language === 'he'
    ? `היתרה שלך לאחר ההעברה נמוכה (${balance} ILS). רוצה שאציע לך הלוואה?`
    : `Your post-transfer balance is low (${balance} ILS). Do you want me to suggest a loan?`;
};

export const buildSafetyTips = (language, amount) => {
  if (language === 'he') {
    return [
      'ודא שכתובת האימייל של המקבל נכונה לפני העברה נוספת.',
      amount > EXTRA_CONFIRMATION_THRESHOLD
        ? 'בסכומים גבוהים מומלץ לבצע אימות נוסף מול המקבל.'
        : 'שמור תיעוד קצר של מטרת ההעברה למעקב עתידי.'
    ];
  }

  return [
    'Verify the recipient email before making another transfer.',
    amount > EXTRA_CONFIRMATION_THRESHOLD
      ? 'For larger amounts, perform an extra verification with the recipient.'
      : 'Keep a short note of the transfer purpose for future tracking.'
  ];
};

export const buildTransferSuccessReply = ({
  language,
  amount,
  receiverEmail,
  balance,
  suggestions = []
}) => {
  const safetyTips = buildSafetyTips(language, Number(amount || 0));
  const validSuggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];

  const transactionResultBlock = language === 'he'
    ? [
      'תוצאת ההעברה',
      '--------------------',
      'סטטוס: הצליח',
      `סכום: ${formatIls(amount)} ILS`,
      `נמען: ${receiverEmail || '-'}`,
      `יתרה חדשה: ${formatIls(balance)} ILS`
    ]
    : [
      'Transaction Result:',
      '--------------------',
      'Status: Success',
      `Amount: ${formatIls(amount)} ILS`,
      `Recipient: ${receiverEmail || '-'}`,
      `Balance after transfer: ${formatIls(balance)} ILS`
    ];

  const aiSuggestionsBlock = language === 'he'
    ? ['AI Suggestions:', ...(validSuggestions.length ? validSuggestions : ['אין כרגע הצעות נוספות.'])]
    : ['AI Suggestions:', ...(validSuggestions.length ? validSuggestions : ['No additional suggestions right now.'])];

  const safetyTipsBlock = language === 'he'
    ? ['Safety Tips:', ...safetyTips]
    : ['Safety Tips:', ...safetyTips];

  return [
    language === 'he' ? 'ההעברה הושלמה בהצלחה' : 'Transfer completed successfully',
    '',
    ...transactionResultBlock,
    '',
    ...aiSuggestionsBlock,
    '',
    ...safetyTipsBlock
  ].join('\n');
};
