const requireServiceMethod = (services, serviceName, methodName) => {
  const method = services?.[serviceName]?.[methodName];
  if (!method) {
    throw new Error(`Missing service method: ${serviceName}.${methodName}`);
  }
  return method.bind(services[serviceName]);
};

export const getSenderUser = async ({ services, userId }) => {
  const getUserById = requireServiceMethod(services, 'profileService', 'getUserById');
  return getUserById(userId);
};

export const validateRecipientExists = async ({ services, receiverEmail }) => {
  const getUserByEmail = requireServiceMethod(services, 'profileService', 'getUserByEmail');
  return getUserByEmail(String(receiverEmail || '').toLowerCase());
};

export const validateNotSelfTransfer = ({ senderUser, receiverUser }) => (
  Boolean(senderUser && receiverUser && String(receiverUser._id) !== String(senderUser._id))
);

export const validateAccountsExist = async ({ services, senderUser, receiverUser }) => {
  const getAccountByUserId = requireServiceMethod(services, 'accountService', 'getAccountByUserId');
  const senderAccount = await getAccountByUserId(senderUser?._id);
  const receiverAccount = await getAccountByUserId(receiverUser?._id);

  return {
    senderAccount,
    receiverAccount,
    isValid: Boolean(senderAccount && receiverAccount)
  };
};

export const validateSufficientBalance = ({ amount, senderAccount }) => {
  const requestedAmount = Number(amount);
  const senderBalance = Number(senderAccount?.balance || 0);

  return {
    requestedAmount,
    senderBalance,
    isValid: Number.isFinite(requestedAmount) && requestedAmount <= senderBalance
  };
};
