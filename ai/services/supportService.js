export const createSupportService = ({ executeBankTool } = {}) => ({
  async connectRepresentative({ userId }) {
    if (executeBankTool) {
      return executeBankTool({ name: 'open_video_call_window', args: {}, userId });
    }

    return {
      found: true,
      action: 'open_video_call',
      userId
    };
  },

  async createSupportTicket() {
    return { found: true, ticketId: null, mode: 'video_call_window' };
  }
});
