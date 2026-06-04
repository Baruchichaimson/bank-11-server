# Intent module structure

This folder converts a user message into a safe structured intent for the banking assistant.

## Main flow

```text
userInput
  -> detectIntent.js
  -> llmSemanticParser.js
  -> semanticQueryValidator.js
  -> transactionQueryNormalizer.js
  -> workflow / query execution
```

## Files

### detectIntent.js
Entry point for intent detection.

Responsibilities:
- calls the LLM semantic parser
- falls back to safe unknown when parsing fails
- applies deterministic transaction normalization after the LLM result
- returns the final intent object used by the graph

### llmSemanticParser.js
LLM adapter for semantic parsing.

Responsibilities:
- builds the system prompt
- sends the current user message and recent conversation to the LLM
- parses the JSON response
- validates the parsed response
- returns one normalized parser result

This file should stay small and orchestrate other helpers.

### semanticCatalog.js
The contract/catalog for the intent system.

Responsibilities:
- allowed domains
- allowed intents
- allowed tool names
- allowed transaction actions/types/aggregations
- prompt contract formatting helpers

Update this file when adding a new domain, intent, tool name, or semantic-query enum.

### transactionQueryNormalizer.js
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

### semanticQueryValidator.js
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

This file is the gatekeeper before query execution.

### transferPayloadValidator.js
Validator for money-transfer workflow payloads.

Responsibilities:
- validates transfer correction objects
- validates receiver email
- validates amount
- validates description
- validates confirmation state
- validates tool args such as recipientName

This file is for starting, confirming, and correcting a new transfer, not for transaction history.

### llmPromptPayloadBuilder.js
Builds the user payload sent to the LLM.

Responsibilities:
- limits recent conversation history
- trims long messages
- normalizes message roles
- adds currentDate and timeZone

### llmParserLogger.js
Logging helpers for the LLM parser.

Responsibilities:
- logs parse failures
- truncates raw LLM output in logs
- includes detailed logs only outside production or when debug is enabled

### llmValueNormalizers.js
Small shared value-normalization helpers.

Responsibilities:
- converts string `"null"` to real null
- normalizes enum strings
- trims string fields
- clamps confidence between 0 and 1

## Rule of thumb

- If the file talks to the LLM: use `llmSemanticParser.js`.
- If the file fixes transaction-history meaning from the original text: use `transactionQueryNormalizer.js`.
- If the file validates safe structured query shape: use `semanticQueryValidator.js`.
- If the file validates new-transfer payload fields: use `transferPayloadValidator.js`.
- If the file changes the allowed contract/enums: use `semanticCatalog.js`.
