TOOL_CATALOG = [
    {"toolName": "get_user_identity", "domain": "profile", "intent": "show_personal_details"},
    {"toolName": "get_balance", "domain": "account", "intent": "check_balance"},
    {"toolName": "get_recent_transfers", "domain": "transactions", "intent": "recent_transactions"},
    {"toolName": "count_transfers", "domain": "transactions", "intent": "recent_transactions"},
    {"toolName": "get_last_sent_transfer_to_recipient", "domain": "transactions", "intent": "recent_transactions"},
    {"toolName": "open_money_transfer_inline", "domain": "transactions", "intent": "transfer_money"},
    {"toolName": "open_video_call_window", "domain": "support", "intent": "contact_support"},
]

ALLOWED_DOMAINS = ["profile", "account", "transactions", "support", "unknown"]
ALLOWED_INTENTS = [
    "show_personal_details",
    "check_balance",
    "recent_transactions",
    "transfer_money",
    "contact_support",
    "unknown",
]
ALLOWED_AGGREGATIONS = ["count", "list", "first_n", "counterparty"]
ALLOWED_TOOL_NAMES = [t["toolName"] for t in TOOL_CATALOG] + [None]

TOOL_BY_NAME = {t["toolName"]: t for t in TOOL_CATALOG}
