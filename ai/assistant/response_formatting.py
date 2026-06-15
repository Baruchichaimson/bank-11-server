from datetime import datetime


def _format_date_for_user(iso_string: str | None, user_language: str) -> str:
    if not iso_string:
        return ""
    try:
        d = datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
        locale = "he-IL" if user_language == "he" else "en-US"
        return d.strftime("%d/%m/%Y %H:%M") if user_language == "he" else d.strftime("%m/%d/%Y %I:%M %p")
    except Exception:
        return str(iso_string)


def _format_range_for_user(result: dict, user_language: str) -> str:
    if not result.get("hasDateRange"):
        return ""
    from_ = _format_date_for_user(result.get("from"), user_language)
    to_ = _format_date_for_user(result.get("to"), user_language)
    if from_ and to_:
        return f" בין {from_} ל־{to_}" if user_language == "he" else f" between {from_} and {to_}"
    if from_:
        return f" החל מ־{from_}" if user_language == "he" else f" from {from_}"
    if to_:
        return f" עד {to_}" if user_language == "he" else f" until {to_}"
    return ""


def _get_hebrew_list_direction_label(result: dict) -> str:
    return "ראשונות" if result.get("sortDirection") == "asc" else "אחרונות"


def _get_english_list_direction_label(result: dict) -> str:
    return "earliest" if result.get("sortDirection") == "asc" else "latest"


def _format_transfer_rows(items: list, user_language: str) -> str:
    rows = []
    for i, tx in enumerate(items):
        amount = tx.get("amount", 0)
        from_email = tx.get("fromEmail", "")
        to_email = tx.get("toEmail", "")
        date = _format_date_for_user(tx.get("createdAt"), user_language)
        if user_language == "he":
            rows.append(
                f"העברה {i + 1}\n--------------------\nסכום: {amount} ILS\nשולח: {from_email}\nמקבל: {to_email}\nתאריך: {date}"
            )
        else:
            rows.append(
                f"Transfer {i + 1}\n--------------------\nAmount: {amount} ILS\nFrom: {from_email}\nTo: {to_email}\nDate: {date}"
            )
    return "\n\n\n".join(rows)


def get_friendly_error_reply(message: str, user_language: str) -> str:
    normalized = str(message or "").lower().strip()
    if "unauthorized" in normalized or "not authorized" in normalized:
        return (
            "כדי לעזור עם נתוני החשבון שלך צריך להתחבר מחדש. אפשר לנסות להתנתק ולהתחבר שוב."
            if user_language == "he"
            else "To access your account details, please sign in again and try once more."
        )
    if "account not found" in normalized:
        return (
            "לא הצלחתי למצוא חשבון פעיל עבור המשתמש שלך. אפשר לפנות לתמיכה כדי לבדוק את זה."
            if user_language == "he"
            else "I could not find an active account for your user. Please contact support to review this."
        )
    if "user not found" in normalized:
        return (
            "לא הצלחתי לאמת את פרטי המשתמש שלך כרגע. נסה שוב בעוד רגע."
            if user_language == "he"
            else "I could not verify your user details right now. Please try again in a moment."
        )
    if "unable to retrieve" in normalized or "failed" in normalized or "error" in normalized:
        return (
            "אירעה תקלה זמנית בשליפת הנתונים. נסה שוב בעוד רגע."
            if user_language == "he"
            else "There was a temporary issue retrieving your data. Please try again shortly."
        )
    return ""


def format_financial_response(tool_name: str, result: dict | None, user_language: str) -> str:
    if not result or result.get("found") is False:
        if "invalid date range" in str(result.get("message", "")).lower():
            return (
                'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "3 העברות אחרונות בחודש האחרון".'
                if user_language == "he"
                else 'I could not parse the date range. Try: "3 latest transfers in the last month".'
            )
        return (
            get_friendly_error_reply(result.get("message") if result else "", user_language)
            or (
                "לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע."
                if user_language == "he"
                else "I could not retrieve your data right now. Please try again shortly."
            )
        )

    if user_language == "he":
        if tool_name == "get_balance":
            return f"היתרה הנוכחית שלך היא {result['balance']} {result['currency']}. סטטוס החשבון הוא {result['status']}."
        if tool_name == "get_user_identity":
            return f"שמך הוא {result['firstName']} {result['lastName']}. כתובת האימייל שלך היא {result['email']}."
        if tool_name == "count_transfers":
            return f"ביצעת {result['count']} העברות{_format_range_for_user(result, user_language)}."
        if tool_name == "get_last_transfer":
            return (
                f"ההעברה האחרונה הייתה {result['amount']} ILS\n"
                f"שולח: {result['fromEmail']}\nמקבל: {result['toEmail']}\n"
                f"תאריך: {_format_date_for_user(result.get('createdAt'), user_language)}."
            )
        if tool_name == "get_last_sent_transfer_to_recipient":
            if not result.get("items"):
                return "לא נמצאו העברות עם איש הקשר שביקשת."
            rows = _format_transfer_rows(result["items"], user_language)
            return f"מצאתי {len(result['items'])} העברות דו־כיווניות עם \"{result['recipientName']}\"{_format_range_for_user(result, user_language)}:\n\n{rows}"
        if tool_name == "get_recent_transfers":
            if not result.get("items"):
                return "לא נמצאו העברות בטווח התאריכים שביקשת."
            rows = _format_transfer_rows(result["items"], user_language)
            return f"מצאתי עבורך {len(result['items'])} העברות {_get_hebrew_list_direction_label(result)}{_format_range_for_user(result, user_language)}:\n\n{rows}"
        if tool_name == "get_first_n_transfers":
            if not result.get("items"):
                return "לא נמצאו העברות בטווח התאריכים שביקשת."
            rows = _format_transfer_rows(result["items"], user_language)
            requested = result.get("requestedLimit") or len(result["items"])
            return f"מצאתי עבורך {len(result['items'])} מתוך {requested} העברות {_get_hebrew_list_direction_label(result)}{_format_range_for_user(result, user_language)}:\n\n{rows}"
    else:
        if tool_name == "get_balance":
            return f"Your current balance is {result['balance']} {result['currency']}. Account status is {result['status']}."
        if tool_name == "get_user_identity":
            return f"Your name is {result['firstName']} {result['lastName']}. Your email is {result['email']}."
        if tool_name == "count_transfers":
            return f"You made {result['count']} transfers{_format_range_for_user(result, user_language)}."
        if tool_name == "get_last_transfer":
            return (
                f"Your latest transfer was {result['amount']} ILS\n"
                f"From: {result['fromEmail']}\nTo: {result['toEmail']}\n"
                f"Date: {_format_date_for_user(result.get('createdAt'), user_language)}."
            )
        if tool_name == "get_last_sent_transfer_to_recipient":
            if not result.get("items"):
                return "No transfers were found with that contact."
            rows = _format_transfer_rows(result["items"], user_language)
            return f"I found {len(result['items'])} bidirectional transfers with \"{result['recipientName']}\"{_format_range_for_user(result, user_language)}:\n\n{rows}"
        if tool_name == "get_recent_transfers":
            if not result.get("items"):
                return "No transfers were found in the requested date range."
            rows = _format_transfer_rows(result["items"], user_language)
            return f"I found {len(result['items'])} {_get_english_list_direction_label(result)} transfers{_format_range_for_user(result, user_language)}:\n\n{rows}"
        if tool_name == "get_first_n_transfers":
            if not result.get("items"):
                return "No transfers were found in the requested date range."
            rows = _format_transfer_rows(result["items"], user_language)
            requested = result.get("requestedLimit") or len(result["items"])
            return f"I found {len(result['items'])} of {requested} {_get_english_list_direction_label(result)} transfers{_format_range_for_user(result, user_language)}:\n\n{rows}"

    return "Data retrieved successfully."
