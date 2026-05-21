export const createDomainExecutor = ({ services }) => ({
  async execute({ domain, state, semanticQuery }) {
    if (domain === 'profile') {
      return services.profileService.getUserProfile({ userId: state.session.userId });
    }

    if (domain === 'account') {
      return services.accountService.getBalance({ userId: state.session.userId });
    }

    if (domain === 'transactions') {
      return services.transactionService.executeStructuredQuery({
        userId: state.session.userId,
        query: semanticQuery
      });
    }

    return null;
  }
});
