export const createSupportService = () => ({
  async connectRepresentative() {
    return {
      found: true,
      action: 'open_video_call'
    };
  },

  async createSupportTicket() {
    return { found: true, ticketId: null, mode: 'video_call_window' };
  }
});
