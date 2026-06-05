export const ACTION_TO_TYPE = {
  transfer_money: 'transfer',
  withdraw_money: 'withdraw',
  deposit_money: 'deposit'
};

export const TYPE_TO_ACTION = {
  transfer: 'transfer_money',
  withdraw: 'withdraw_money',
  deposit: 'deposit_money'
};

export const TOOL_CATALOG = [
  {
    toolName: 'get_user_identity',
    domain: 'profile',
    intent: 'show_personal_details',
    workflow: 'personal_details_workflow',
    purpose: 'Return personal profile data already stored for the authenticated user.',
    payload: { type: 'none' }
  },
  {
    toolName: 'get_balance',
    domain: 'account',
    intent: 'check_balance',
    workflow: 'balance_workflow',
    purpose: 'Return current account balance, available money, or account status.',
    payload: { type: 'none' }
  },
  {
    toolName: 'get_recent_transfers',
    domain: 'transactions',
    intent: 'recent_transactions',
    workflow: 'transactions_workflow',
    purpose: 'Return transaction history, including transfer, withdrawal, or deposit history.',
    payload: { type: 'semanticQuery' }
  },
  {
    toolName: 'count_transfers',
    domain: 'transactions',
    intent: 'recent_transactions',
    workflow: 'transactions_workflow',
    purpose: 'Return the number of matching transactions or transfers.',
    payload: { type: 'semanticQuery' }
  },
  {
    toolName: 'get_last_sent_transfer_to_recipient',
    domain: 'transactions',
    intent: 'recent_transactions',
    workflow: 'transactions_workflow',
    purpose: 'Return transactions involving a named counterparty.',
    payload: { type: 'semanticQuery', requiredFields: ['recipientName'] }
  },
  {
    toolName: 'open_money_transfer_inline',
    domain: 'transactions',
    intent: 'transfer_money',
    workflow: 'transfer_workflow',
    purpose: 'Start or continue the inline chat workflow that collects transfer details and may execute a money transfer.',
    payload: { type: 'transferPayload' }
  },
  {
    toolName: 'open_video_call_window',
    domain: 'support',
    intent: 'contact_support',
    workflow: 'support_workflow',
    purpose: 'Connect the user to support or a representative through a video-call flow.',
    payload: { type: 'none' }
  }
];

export const ALLOWED_DOMAINS = ['profile', 'account', 'transactions', 'support', 'unknown'];
export const ALLOWED_INTENTS = [
  'show_personal_details',
  'check_balance',
  'recent_transactions',
  'transfer_money',
  'contact_support',
  'unknown'
];
export const ALLOWED_ACTIONS = ['transfer_money', 'withdraw_money', 'deposit_money', null];
export const ALLOWED_TYPES = ['transfer', 'withdraw', 'deposit', null];
export const ALLOWED_TIME_RANGES = [null];
export const ALLOWED_AGGREGATIONS = ['count', 'list', 'first_n', 'counterparty'];
export const ALLOWED_CORRECTION_FIELDS = ['amount', 'recipient', 'account', 'note', 'unknown'];
export const ALLOWED_CONFIRMATIONS = ['yes', 'no', null];
export const ALLOWED_TOOL_NAMES = [...TOOL_CATALOG.map((tool) => tool.toolName), null];

export const SEMANTIC_CATALOG = {
  catalogVersion: 2,
  role: 'semantic_intent_contract',
  localePolicy: {
    primaryUserLanguage: 'he-IL',
    supportedUserLanguages: ['he-IL', 'en'],
    classifyByMeaningNotByKeywords: true,
    tolerateTyposSlangAndInformalGrammar: true
  },
  matchingPolicy: {
    closedIntentSet: true,
    chooseExactlyOneIntent: true,
    unsupportedOrAmbiguousGoesToUnknown: true,
    extractOnlyExplicitValues: true,
    doNotAnswerTheUser: true,
    doNotSelectBySingleWordOverlap: true
  },
  intents: [
    {
      intent: 'check_balance',
      domain: 'account',
      workflow: 'balance_workflow',
      chooseWhen: 'The user wants to know their current balance, available money, account balance, or account status.',
      doNotChooseWhen: 'The user asks for transaction history, transfer execution, personal profile details, or support.'
    },
    {
      intent: 'recent_transactions',
      domain: 'transactions',
      workflow: 'transactions_workflow',
      chooseWhen: 'The user wants to inspect, list, count, filter, search, or summarize existing financial activity or past transactions.',
      doNotChooseWhen: 'The user wants to initiate a new money transfer or asks for support.',
      semanticQueryRequired: true
    },
    {
      intent: 'show_personal_details',
      domain: 'profile',
      workflow: 'personal_details_workflow',
      chooseWhen: 'The user asks for personal information stored on their own profile, such as identity, name, email, or registered details.',
      doNotChooseWhen: 'The user asks for balance, transactions, support, or changing profile information.'
    },
    {
      intent: 'contact_support',
      domain: 'support',
      workflow: 'support_workflow',
      chooseWhen: 'The user wants a human representative, support contact, service help, or a video-call interaction.',
      doNotChooseWhen: 'The user asks a general greeting, generic question, balance, transactions, profile details, or money transfer execution.'
    },
    {
      intent: 'transfer_money',
      domain: 'transactions',
      workflow: 'transfer_workflow',
      chooseWhen: 'The user wants to start, continue, correct, confirm, cancel, or submit a money-transfer workflow.',
      doNotChooseWhen: 'The user only wants to inspect past transfers or count previous transfer activity.',
      transferPayload: {
        extractableFields: ['receiverEmail', 'amount', 'description', 'confirmation', 'skipDescription', 'startNewTransfer'],
        rules: [
          'Extract only values explicitly present in the current message.',
          'Never invent recipient, amount, description, or confirmation.',
          'Use confirmation only when the user clearly confirms or cancels an active transfer step.'
        ]
      }
    },
    {
      intent: 'unknown',
      domain: 'unknown',
      workflow: 'unknown_workflow',
      chooseWhen: 'No supported banking workflow clearly matches the current message, or the message is ambiguous between workflows.',
      doNotChooseWhen: 'A supported workflow is clearly requested.'
    }
  ],
  disambiguationRules: [
    'Past, existing, previous, historical, count, list, search, or filter activity means recent_transactions.',
    'Future action, sending money, submitting transfer details, correction, confirmation, or cancellation means transfer_money.',
    'A message that only mentions transfer without enough meaning to separate history from execution is unknown.',
    'Do not route casual greetings or unsupported service questions to support unless the user is clearly asking for a representative or support interaction.',
    'When profile, balance, and transaction concepts appear together, classify the primary requested action in the current message.'
  ],
  transactionQueryModel: {
    transactionKinds: [
      { type: 'transfer', action: 'transfer_money', meaning: 'money movement between users or accounts' },
      { type: 'withdraw', action: 'withdraw_money', meaning: 'money leaving the account as a withdrawal' },
      { type: 'deposit', action: 'deposit_money', meaning: 'money entering the account as a deposit' }
    ],
    aggregationRules: [
      { aggregation: 'count', meaning: 'the user asks how many matching activities exist', limit: null },
      { aggregation: 'first_n', meaning: 'the user asks for a specific number of newest matching activities', limitSource: 'explicit_user_number' },
      { aggregation: 'list', meaning: 'the user asks to show matching activities without asking only for a count' },
      { aggregation: 'counterparty', meaning: 'the user asks about activity involving a named person or counterparty', requiredFields: ['recipientName'] }
    ],
    timeExtraction: {
      dateRange: {
        field: 'dateRange',
        shape: { from: 'YYYY-MM-DD|null', to: 'YYYY-MM-DD|null' },
        rules: [
          'Resolve every user time expression into dateRange when the user asks for a dated transaction query.',
          'Use currentDate from the user message payload to resolve relative phrases like today, this month, last month, last week, since the beginning of the month, and until today.',
          'Normalize all dates to YYYY-MM-DD before returning JSON.',
          'For Hebrew or European numeric dates, interpret day before month.',
          'Keep timeRange null. It is a legacy field and should not be used.',
          'If the date range cannot be resolved safely, return unknown unless the same transaction query is still valid without a date filter.'
        ]
      },
      createdAtMapping: {
        meaning: 'The application will convert dateRange.from to createdAt >= start of that day and dateRange.to to createdAt <= end of that day.',
        modelResponsibility: 'Return only normalized calendar dates, not database query syntax or Date objects.'
      }
    },
    queryConstructionRules: [
      'For generic financial activity history, keep action null and filters.type null.',
      'For transfer history, set action transfer_money and filters.type transfer.',
      'For withdrawal history, set action withdraw_money and filters.type withdraw.',
      'For deposit history, set action deposit_money and filters.type deposit.',
      'Use limit only when the user explicitly requests a number of rows; do not invent a default limit.'
    ]
  },
  tools: TOOL_CATALOG
};

export const RESPONSE_CONTRACT = {
  requiredTopLevelFields: {
    domain: ALLOWED_DOMAINS,
    intent: ALLOWED_INTENTS,
    confidence: 'number between 0 and 1',
    isAmbiguous: 'boolean',
    ambiguityReason: ['string', null],
    toolName: ALLOWED_TOOL_NAMES,
    toolArgs: 'legacy compatibility object; prefer semanticQuery/transferPayload for banking logic',
    workflowContinuation: 'boolean',
    correction: null,
    transferPayload: null,
    semanticQuery: null
  },
  correctionShape: {
    field: ALLOWED_CORRECTION_FIELDS,
    value: ['string', 'number', null]
  },
  transferPayloadShape: {
    receiverEmail: ['string', null],
    amount: ['number', null],
    description: ['string', null],
    confirmation: ALLOWED_CONFIRMATIONS,
    skipDescription: 'boolean',
    startNewTransfer: 'boolean'
  },
  semanticQueryShape: {
    domain: ['transactions'],
    intent: ['transactions_query'],
    action: ALLOWED_ACTIONS,
    filters: { type: ALLOWED_TYPES },
    timeRange: ALLOWED_TIME_RANGES,
    dateRange: { from: ['YYYY-MM-DD', null], to: ['YYYY-MM-DD', null] },
    aggregation: ALLOWED_AGGREGATIONS,
    limit: ['number', null],
    recipientName: ['string', null]
  }
};

const COMPACT_ROUTER_CONTRACT = {
  output: RESPONSE_CONTRACT,
  intents: [
    {
      domain: 'account',
      intent: 'check_balance',
      toolName: null,
      chooseWhen: 'current balance, available money, account balance, יתרה, יתרת חשבון, כמה כסף יש לי',
      doNotChooseWhen: 'transaction history, transfer execution, profile details, or support'
    },
    {
      domain: 'transactions',
      intent: 'recent_transactions',
      semanticQueryRequired: true,
      chooseWhen: 'past activity, transaction history, list/count/filter transfers, העברות שביצעתי, פעולות אחרונות, כמה העברות',
      doNotChooseWhen: 'starting, confirming, correcting, or canceling a new transfer',
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: ALLOWED_ACTIONS,
        filters: { type: ALLOWED_TYPES },
        timeRange: null,
        dateRange: { from: 'YYYY-MM-DD|null', to: 'YYYY-MM-DD|null' },
        aggregation: ALLOWED_AGGREGATIONS,
        limit: 'explicit user row limit or null',
        recipientName: 'explicit counterparty name or null'
      }
    },
    {
      domain: 'transactions',
      intent: 'transfer_money',
      toolName: 'open_money_transfer_inline',
      chooseWhen: 'start/continue/correct/confirm/cancel a new money transfer',
      doNotChooseWhen: 'the user only asks to inspect past transfers or count existing transfers',
      transferPayload: 'extract explicit transfer fields; execution is handled only by the transfer workflow'
    },
    {
      domain: 'profile',
      intent: 'show_personal_details',
      toolName: null,
      chooseWhen: 'stored user name, stored email, personal profile details',
      doNotChooseWhen: 'balance, transactions, support, or transfer execution'
    },
    {
      domain: 'support',
      intent: 'contact_support',
      toolName: 'open_video_call_window',
      chooseWhen: 'human representative, support interaction, video call',
      doNotChooseWhen: 'generic greetings or ordinary banking actions'
    },
    {
      domain: 'unknown',
      intent: 'unknown',
      toolName: null,
      chooseWhen: 'unsupported, ambiguous, casual greeting only, confidence below 0.65',
      doNotChooseWhen: 'a supported workflow is clearly requested'
    }
  ],
  transactionRules: [
    'past/list/show/history/filter existing activity => recent_transactions',
    'how many/count/number of activities => aggregation count and limit null',
    'N newest/latest/recent rows => aggregation first_n and limit N',
    'show matching activity without explicit count => aggregation list',
    'transfer history => action transfer_money and filters.type transfer',
    'generic activity history => action null and filters.type null',
    'resolve relative dates using currentDate from payload; return YYYY-MM-DD only',
    'European/Hebrew numeric dates are day/month/year'
  ]
};

export const formatResponseContractForPrompt = () => JSON.stringify(RESPONSE_CONTRACT);

export const formatSemanticCatalogForPrompt = () => JSON.stringify(COMPACT_ROUTER_CONTRACT);
