# Intent module structure

This folder converts a user message into a safe structured intent for the banking assistant.

## Main flow

```text
userInput
  -> before-llm/detectIntent.js
  -> llmSemanticParser.js
  -> after-llm validators and normalizers
  -> workflow / query execution
```

## Folder layout

```text
ai/intents/
├── before-llm/
│   ├── detectIntent.js
│   ├── llmPromptPayloadBuilder.js
│   └── semanticCatalog.js
│
├── after-llm/
│   ├── llmParserLogger.js
│   ├── llmValueNormalizers.js
│   ├── semanticQueryValidator.js
│   ├── transactionQueryNormalizer.js
│   └── transferPayloadValidator.js
│
├── llmSemanticParser.js
└── README.md
```

## before-llm

Files that prepare the request before calling the LLM.

### before-llm/detectIntent.js
The main intent-detection entry point.

Responsibilities:
- calls the LLM semantic parser
- handles safe fallback when the LLM is unavailable or parsing fails
- applies deterministic transaction normalization after the LLM result
- returns the final intent object used by the graph

### before-llm/llmPromptPayloadBuilder.js
Builds the user payload sent to the LLM.

Responsibilities:
- limits recent conversation history
- trims long messages
- normalizes message roles
- adds currentDate and timeZone

### before-llm/semanticCatalog.js
The contract/catalog used to instruct the LLM.

Responsibilities:
- allowed domains
- allowed intents
- allowed tool names
- allowed transaction actions/types/aggregations
- prompt contract formatting helpers

Update this file when adding a new domain, intent, tool name, or semantic-query enum.

## llmSemanticParser.js

The adapter around the actual LLM call.

Responsibilities:
- builds the system prompt from `before-llm/semanticCatalog.js`
- builds the user payload from `before-llm/llmPromptPayloadBuilder.js`
- calls the LLM
- parses the JSON response
- sends the response through `after-llm` validators

This file sits between the two folders because it is the actual model boundary.

## after-llm

Files that clean, validate, and correct the LLM response after it returns.

### after-llm/llmValueNormalizers.js
Small shared value-normalization helpers.

Responsibilities:
- converts string `"null"` to real null
- normalizes enum strings
- trims string fields
- clamps confidence between 0 and 1

### after-llm/semanticQueryValidator.js
Validator for `semanticQuery` objects.

Responsibilities:
- validates `domain="transactions"`
- validates `intent="transactions_query"`
- validates action/type consistency
- validates aggregation
- clamps limit to the allowed range
- validates ISO dateRange
- validates sortDirection
- validates recipientName for counterparty queries

### after-llm/transactionQueryNormalizer.js
Deterministic normalizer for transaction-history questions.

Responsibilities:
- reads the original userInput
- fixes LLM mistakes in transaction queries
- detects count vs list/detail requests
- extracts limits like `6`, `37`, `שלושים וחמש`
- detects sort direction: latest/oldest, אחרונות/ראשונות
- resolves Hebrew/English date ranges: today, yesterday, this week, last month, explicit dates, etc.
- forces transfer-related fields when the user asks about transfers

This file protects the product from LLM inconsistency.

### after-llm/transferPayloadValidator.js
Validator for money-transfer workflow payloads.

Responsibilities:
- validates transfer correction objects
- validates receiver email
- validates amount
- validates description
- validates confirmation state
- validates tool args such as recipientName

This file is for starting, confirming, and correcting a new transfer, not for transaction history.

### after-llm/llmParserLogger.js
Logging helpers for the LLM parser.

Responsibilities:
- logs parse failures
- truncates raw LLM output in logs
- includes detailed logs only outside production or when debug is enabled

## Rule of thumb

- Before the LLM call: use `before-llm/`.
- The actual LLM call: use `llmSemanticParser.js`.
- After the LLM returns: use `after-llm/`.
- Do not add duplicate files with the same responsibility at the root of `ai/intents`.
