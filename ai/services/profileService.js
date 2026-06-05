import usersModel from '../../models/usersModel.js';

export const createProfileService = () => ({
  async getUserProfile({ userId }) {
    const user = await usersModel.findUserById(userId);
    if (!user) return { found: false, message: 'User not found' };

    return {
      found: true,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || ''
    };
  },

  async getIdentity({ userId }) {
    return this.getUserProfile({ userId });
  },

  async getUserById(userId) {
    return usersModel.findUserById(userId);
  },

  async getUserByEmail(email) {
    return usersModel.findUserByEmail(String(email || '').toLowerCase());
  }
});
