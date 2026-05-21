import accountsModel from '../../models/accountsModel.js';

export const createAccountService = ({ executeBankTool } = {}) => ({
  async getBalance({ userId }) {
    if (executeBankTool) {
      return executeBankTool({ name: 'get_balance', args: {}, userId });
    }

    const account = await accountsModel.findAccountByUserId(userId);
    if (!account) return { found: false, message: 'Account not found' };

    return {
      found: true,
      balance: Number(account.balance) || 0,
      status: account.status || 'UNKNOWN',
      currency: 'ILS'
    };
  },

  async getAccountSummary({ userId }) {
    return this.getBalance({ userId });
  },

  async getAccountByUserId(userId) {
    return accountsModel.findAccountByUserId(userId);
  },

  async findAccountById(accountId) {
    return accountsModel.findAccountById(accountId);
  }
});
