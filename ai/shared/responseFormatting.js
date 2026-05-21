const formatDateForUser = (isoString, userLanguage) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(userLanguage === 'he' ? 'he-IL' : 'en-US');
};

export const getFriendlyErrorReply = (message, userLanguage) => {
  const normalized = String(message || '').toLowerCase().trim();

  if (normalized.includes('unauthorized') || normalized.includes('not authorized')) {
    return userLanguage === 'he'
      ? 'כדי לעזור עם נתוני החשבון שלך צריך להתחבר מחדש. אפשר לנסות להתנתק ולהתחבר שוב.'
      : 'To access your account details, please sign in again and try once more.';
  }

  if (normalized.includes('account not found')) {
    return userLanguage === 'he'
      ? 'לא הצלחתי למצוא חשבון פעיל עבור המשתמש שלך. אפשר לפנות לתמיכה כדי לבדוק את זה.'
      : 'I could not find an active account for your user. Please contact support to review this.';
  }

  if (normalized.includes('user not found')) {
    return userLanguage === 'he'
      ? 'לא הצלחתי לאמת את פרטי המשתמש שלך כרגע. נסה שוב בעוד רגע.'
      : 'I could not verify your user details right now. Please try again in a moment.';
  }

  if (normalized.includes('unable to retrieve data') || normalized.includes('failed') || normalized.includes('error')) {
    return userLanguage === 'he'
      ? 'אירעה תקלה זמנית בשליפת הנתונים. נסה שוב בעוד רגע.'
      : 'There was a temporary issue retrieving your data. Please try again shortly.';
  }

  return '';
};

export const formatFinancialResponse = (toolName, result, userLanguage) => {
  if (!result || result.found === false) {
    if (String(result?.message || '').toLowerCase().includes('invalid date range')) {
      return userLanguage === 'he'
        ? 'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "3 העברות אחרונות בחודש האחרון".'
        : 'I could not parse the date range. Try: "3 latest transfers in the last month".';
    }
    return (
      getFriendlyErrorReply(result?.message, userLanguage) ||
      (userLanguage === 'he'
        ? 'לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע.'
        : 'I could not retrieve your data right now. Please try again shortly.')
    );
  }

  if (userLanguage === 'he') {
    if (toolName === 'get_balance') {
      return `היתרה הנוכחית שלך היא ${result.balance} ${result.currency}. סטטוס החשבון הוא ${result.status}.`;
    }
    if (toolName === 'get_user_identity') {
      return `שמך הוא ${result.firstName} ${result.lastName}. כתובת האימייל שלך היא ${result.email}.`;
    }
    if (toolName === 'count_transfers') {
      return `ביצעת ${result.count} העברות בין ${formatDateForUser(result.from, userLanguage)} ל־${formatDateForUser(result.to, userLanguage)}.`;
    }
    if (toolName === 'get_last_transfer') {
      return `ההעברה האחרונה הייתה ${result.amount} ILS\nשולח: ${result.fromEmail}\nמקבל: ${result.toEmail}\nתאריך: ${formatDateForUser(result.createdAt, userLanguage)}.`;
    }
    if (toolName === 'get_last_sent_transfer_to_recipient') {
      if (!result.items?.length) return 'לא נמצאו העברות עם איש הקשר שביקשת.';
      const rows = result.items
        .map((tx, index) => `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`)
        .join('\n\n\n');
      return `מצאתי ${result.items.length} העברות דו־כיווניות עם "${result.recipientName}" (גם ששלחת וגם שקיבלת):\n\n${rows}`;
    }
    if (toolName === 'get_recent_transfers') {
      if (!result.items?.length) return 'לא נמצאו העברות בטווח התאריכים שביקשת.';
      const rows = result.items
        .map((tx, index) => `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`)
        .join('\n\n\n');
      return `מצאתי עבורך ${result.items.length} העברות אחרונות בטווח שביקשת:\n\n${rows}`;
    }
  }

  if (toolName === 'get_balance') {
    return `Your current balance is ${result.balance} ${result.currency}. Account status is ${result.status}.`;
  }
  if (toolName === 'get_user_identity') {
    return `Your name is ${result.firstName} ${result.lastName}. Your email is ${result.email}.`;
  }
  if (toolName === 'count_transfers') {
    return `You made ${result.count} transfers between ${formatDateForUser(result.from, userLanguage)} and ${formatDateForUser(result.to, userLanguage)}.`;
  }
  if (toolName === 'get_last_transfer') {
    return `Your latest transfer was ${result.amount} ILS\nFrom: ${result.fromEmail}\nTo: ${result.toEmail}\nDate: ${formatDateForUser(result.createdAt, userLanguage)}.`;
  }
  if (toolName === 'get_last_sent_transfer_to_recipient') {
    if (!result.items?.length) return 'No transfers were found with that contact.';
    const rows = result.items
      .map((tx, index) => `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`)
      .join('\n\n\n');
    return `I found ${result.items.length} bidirectional transfers with "${result.recipientName}" (both sent and received):\n\n${rows}`;
  }
  if (toolName === 'get_recent_transfers') {
    if (!result.items?.length) return 'No transfers were found in the requested date range.';
    const rows = result.items
      .map((tx, index) => `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`)
      .join('\n\n\n');
    return `I found ${result.items.length} recent transfers in your requested range:\n\n${rows}`;
  }

  return 'Data retrieved successfully.';
};
