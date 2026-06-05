import { AccountRepository } from '../repositories/accountRepository.js';

export const createAccountService = ({ accountRepository = new AccountRepository() } = {}) => ({
  async getBalance({ userId }) {
    const account = await accountRepository.findAccountByUserId(userId);
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
    return accountRepository.findAccountByUserId(userId);
  },

  async findAccountById(accountId) {
    return accountRepository.findAccountById(accountId);
  }
});
