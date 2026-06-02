import usersModel from '../models/usersModel.js';
import accountsModel from '../models/accountsModel.js';

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export const cleanupExpiredPendingRegistrations = async () => {
  const now = new Date();
  const expiredUsers = await usersModel.findExpiredUnverifiedUsers(now);

  if (expiredUsers.length === 0) {
    return { deletedUsers: 0, deletedAccounts: 0 };
  }

  const userIds = expiredUsers.map((user) => user._id);
  const deletedAccounts = await accountsModel.deletePendingAccountsByUserIds(userIds);
  const deletedUsers = await usersModel.deleteExpiredUnverifiedUsersByIds(userIds, now);

  return {
    deletedUsers: deletedUsers.deletedCount || 0,
    deletedAccounts: deletedAccounts.deletedCount || 0
  };
};

export const startPendingRegistrationCleanup = () => {
  const configuredInterval = Number(process.env.PENDING_REGISTRATION_CLEANUP_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval > 0
    ? configuredInterval
    : DEFAULT_CLEANUP_INTERVAL_MS;

  cleanupExpiredPendingRegistrations()
    .then(({ deletedUsers, deletedAccounts }) => {
      if (deletedUsers || deletedAccounts) {
        console.log(
          `Cleaned expired pending registrations: users=${deletedUsers}, accounts=${deletedAccounts}`
        );
      }
    })
    .catch((err) => {
      console.error('Initial pending registration cleanup failed:', err?.message || err);
    });

  const timer = setInterval(() => {
    cleanupExpiredPendingRegistrations()
      .then(({ deletedUsers, deletedAccounts }) => {
        if (deletedUsers || deletedAccounts) {
          console.log(
            `Cleaned expired pending registrations: users=${deletedUsers}, accounts=${deletedAccounts}`
          );
        }
      })
      .catch((err) => {
        console.error('Pending registration cleanup failed:', err?.message || err);
      });
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
};
