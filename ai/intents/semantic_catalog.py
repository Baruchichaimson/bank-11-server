import json

TOOL_CATALOG = [
    {
        "toolName": "get_user_identity",
        "domain": "profile",
        "intent": "show_personal_details",
        "workflow": "personal_details_workflow",
        "purpose": "Return personal profile data already stored for the authenticated user.",
        "payload": {"type": "none"},
    },
    {
        "toolName": "get_balance",
        "domain": "account",
        "intent": "check_balance",
        "workflow": "balance_workflow",
        "purpose": "Return current account balance, available money, or account status.",
        "payload": {"type": "none"},
    },
    {
        "toolName": "get_recent_transfers",
        "domain": "transactions",
        "intent": "recent_transactions",
        "workflow": "transactions_workflow",
        "purpose": "Return transaction history, including transfer, withdrawal, or deposit history.",
        "payload": {"type": "semanticQuery"},
    },
    {
        "toolName": "count_transfers",
        "domain": "transactions",
        "intent": "recent_transactions",
        "workflow": "transactions_workflow",
        "purpose": "Return the number of matching transactions or transfers.",
        "payload": {"type": "semanticQuery"},
    },
    {
        "toolName": "get_last_sent_transfer_to_recipient",
        "domain": "transactions",
        "intent": "recent_transactions",
        "workflow": "transactions_workflow",
        "purpose": "Return transactions involving a named counterparty.",
        "payload": {"type": "semanticQuery", "requiredFields": ["recipientName"]},
    },
    {
        "toolName": "open_money_transfer_inline",
        "domain": "transactions",
        "intent": "transfer_money",
        "workflow": "transfer_workflow",
        "purpose": "Start or continue the inline chat workflow that collects transfer details and may execute a money transfer.",
        "payload": {"type": "transferPayload"},
    },
    {
        "toolName": "open_video_call_window",
        "domain": "support",
        "intent": "contact_support",
        "workflow": "support_workflow",
        "purpose": "Connect the user to support or a representative through a video-call flow.",
        "payload": {"type": "none"},
    },
]

ACTION_TO_TYPE = {
    "transfer_money": "transfer",
    "withdraw_money": "withdraw",
    "deposit_money": "deposit",
}

TYPE_TO_ACTION = {
    "transfer": "transfer_money",
    "withdraw": "withdraw_money",
    "deposit": "deposit_money",
}

ALLOWED_DOMAINS = ["profile", "account", "transactions", "support", "unknown"]
ALLOWED_INTENTS = [
    "show_personal_details",
    "check_balance",
    "recent_transactions",
    "transfer_money",
    "contact_support",
    "unknown",
]
ALLOWED_ACTIONS = ["transfer_money", "withdraw_money", "deposit_money", None]
ALLOWED_TYPES = ["transfer", "withdraw", "deposit", None]
ALLOWED_DIRECTIONS = ["outgoing", "incoming", "all", None]
ALLOWED_TIME_RANGES = [None]
ALLOWED_AGGREGATIONS = ["count", "list", "first_n", "counterparty"]
ALLOWED_CORRECTION_FIELDS = ["amount", "recipient", "account", "note", "unknown"]
ALLOWED_CONFIRMATIONS = ["yes", "no", None]
ALLOWED_TOOL_NAMES = [t["toolName"] for t in TOOL_CATALOG] + [None]

TOOL_BY_NAME = {t["toolName"]: t for t in TOOL_CATALOG}

RESPONSE_CONTRACT = {
    "requiredTopLevelFields": {
        "domain": ALLOWED_DOMAINS,
        "intent": ALLOWED_INTENTS,
        "confidence": "number between 0 and 1",
        "isAmbiguous": "boolean",
        "ambiguityReason": ["string", None],
        "toolName": ALLOWED_TOOL_NAMES,
        "toolArgs": "legacy compatibility object; prefer semanticQuery/transferPayload for banking logic",
        "workflowContinuation": "boolean",
        "correction": None,
        "transferPayload": None,
        "semanticQuery": None,
    },
    "correctionShape": {
        "field": ALLOWED_CORRECTION_FIELDS,
        "value": ["string", "number", None],
    },
    "transferPayloadShape": {
        "receiverEmail": ["string", None],
        "amount": ["number", None],
        "description": ["string", None],
        "confirmation": ALLOWED_CONFIRMATIONS,
        "skipDescription": "boolean",
        "startNewTransfer": "boolean",
    },
    "semanticQueryShape": {
        "domain": ["transactions"],
        "intent": ["transactions_query"],
        "action": ALLOWED_ACTIONS,
        "filters": {"type": ALLOWED_TYPES, "direction": ALLOWED_DIRECTIONS},
        "timeRange": ALLOWED_TIME_RANGES,
        "dateRange": {"from": ["YYYY-MM-DD", None], "to": ["YYYY-MM-DD", None]},
        "aggregation": ALLOWED_AGGREGATIONS,
        "limit": ["number", None],
        "recipientName": ["string", None],
    },
}

_COMPACT_ROUTER_CONTRACT = {
    "output": RESPONSE_CONTRACT,
    "intents": [
        {
            "domain": "account",
            "intent": "check_balance",
            "toolName": None,
            "chooseWhen": "current balance, available money, account balance, יתרה, יתרת חשבון, כמה כסף יש לי",
            "doNotChooseWhen": "transaction history, transfer execution, profile details, or support",
        },
        {
            "domain": "transactions",
            "intent": "recent_transactions",
            "semanticQueryRequired": True,
            "chooseWhen": "past activity, transaction history, list/count/filter transfers, העברות שביצעתי, פעולות אחרונות, כמה העברות",
            "doNotChooseWhen": "balance/current money/current account balance questions, or starting/confirming/correcting/canceling a new transfer",
            "semanticQuery": {
                "domain": "transactions",
                "intent": "transactions_query",
                "action": ALLOWED_ACTIONS,
                "filters": {
                    "type": ALLOWED_TYPES,
                    "direction": "outgoing for שביצעתי/ששלחתי, incoming for שקיבלתי/נכנסות, all/null for כל ההעברות",
                },
                "timeRange": None,
                "dateRange": {"from": "YYYY-MM-DD|null", "to": "YYYY-MM-DD|null"},
                "aggregation": ALLOWED_AGGREGATIONS,
                "limit": "explicit user row limit or null",
                "recipientName": "explicit counterparty name or null",
            },
        },
        {
            "domain": "transactions",
            "intent": "transfer_money",
            "toolName": "open_money_transfer_inline",
            "chooseWhen": "start/continue/correct/confirm/cancel a new money transfer",
            "doNotChooseWhen": "the user only asks to inspect past transfers or count existing transfers",
            "transferPayload": "extract explicit transfer fields; execution is handled only by the transfer workflow",
        },
        {
            "domain": "profile",
            "intent": "show_personal_details",
            "toolName": None,
            "chooseWhen": "stored user name, stored email, personal profile details",
            "doNotChooseWhen": "balance, transactions, support, or transfer execution",
        },
        {
            "domain": "support",
            "intent": "contact_support",
            "toolName": "open_video_call_window",
            "chooseWhen": "human representative, support interaction, contact agent, video call, תתקשר לנציג, לדבר עם נציג, תחבר אותי לנציג, שיחת וידאו עם נציג",
            "doNotChooseWhen": "generic greetings, ordinary banking actions, or generic help without a representative/contact request",
        },
        {
            "domain": "unknown",
            "intent": "unknown",
            "toolName": None,
            "chooseWhen": "unsupported, ambiguous, casual greeting only, confidence below 0.65",
            "doNotChooseWhen": "a supported workflow is clearly requested",
        },
    ],
    "transactionRules": [
        "past/list/show/history/filter existing activity => recent_transactions",
        "how many/count/number of activities => aggregation count and limit null",
        "N newest/latest/recent rows => aggregation first_n and limit N",
        "show matching activity without explicit count => aggregation list",
        "transfer history => action transfer_money and filters.type transfer",
        "sent/performed transfers => filters.direction outgoing; received/incoming transfers => filters.direction incoming",
        "generic activity history => action null and filters.type null",
        "resolve relative dates using currentDate from payload; return YYYY-MM-DD only",
        "European/Hebrew numeric dates are day/month/year",
    ],
}


def format_response_contract_for_prompt() -> str:
    return json.dumps(RESPONSE_CONTRACT)


def format_semantic_catalog_for_prompt() -> str:
    return json.dumps(_COMPACT_ROUTER_CONTRACT)
