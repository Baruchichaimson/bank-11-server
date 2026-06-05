export const bankTools = [
  {
    type: 'function',
    function: {
      name: 'open_video_call_window',
      description: 'Open the video call window so the user can start a call with a representative or another user',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_money_transfer_inline',
      description: 'Open the inline chat transfer form so the user can perform a new transfer',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_user_identity',
      description: 'Get authenticated user first name, last name and email',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_balance',
      description: 'Get the authenticated user current account balance and status',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_last_transfer',
      description: 'Get the most recent transfer (incoming or outgoing) for authenticated user',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'count_transfers',
      description: 'Count user transfers in optional date range',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_last_sent_transfer_to_recipient',
      description: 'Get recent transfers with a person by email local-part before @ (both outgoing and incoming)',
      parameters: {
        type: 'object',
        properties: {
          recipientName: { type: 'string' }
        },
        required: ['recipientName']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_transfers',
      description: 'Get recent transfers in optional date range for authenticated user',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          from: { type: 'string' },
          to: { type: 'string' }
        }
      }
    }
  }
];
