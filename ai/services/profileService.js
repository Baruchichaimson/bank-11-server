import usersModel from '../../models/usersModel.js';

export const createProfileService = ({ executeBankTool } = {}) => ({
  async getUserProfile({ userId }) {
    if (executeBankTool) {
      return executeBankTool({ name: 'get_user_identity', args: {}, userId });
    }

    const user = await usersModel.findUserById(userId);
    if (!user) return { found: false, message: 'User not found' };

    return {
      found: true,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };
  },

  async getUserById(userId) {
    return usersModel.findUserById(userId);
  },

  async getUserByEmail(email) {
    return usersModel.findUserByEmail(String(email || '').toLowerCase());
  }
});
