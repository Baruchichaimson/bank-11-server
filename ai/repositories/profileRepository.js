import usersModel from '../../models/usersModel.js';

export class ProfileRepository {
  async findUserById(userId) {
    return usersModel.findUserById(userId);
  }

  async findUserByEmail(email) {
    return usersModel.findUserByEmail(String(email || '').toLowerCase());
  }
}
