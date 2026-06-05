import { ProfileRepository } from '../repositories/profileRepository.js';

export const createProfileService = ({ profileRepository = new ProfileRepository() } = {}) => ({
  async getUserProfile({ userId }) {
    const user = await profileRepository.findUserById(userId);
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
    return profileRepository.findUserById(userId);
  },

  async getUserByEmail(email) {
    return profileRepository.findUserByEmail(email);
  }
});
