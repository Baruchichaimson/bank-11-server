import accountsModel from '../../models/accountsModel.js';

export class AccountRepository {
  async findAccountByUserId(userId) {
    return accountsModel.findAccountByUserId(userId);
  }

  async findAccountById(accountId) {
    return accountsModel.findAccountById(accountId);
  }
}
