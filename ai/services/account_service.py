from ai.repositories.account_repository import AccountRepository


def create_account_service(account_repository=None):
    repo = account_repository or AccountRepository()

    async def get_balance(*, user_id):
        account = repo.find_account_by_user_id(user_id)
        if not account:
            return {"found": False, "message": "Account not found"}
        return {
            "found": True,
            "balance": float(account.get("balance") or 0),
            "status": account.get("status") or "UNKNOWN",
            "currency": "ILS",
        }

    async def get_account_summary(*, user_id):
        return await get_balance(user_id=user_id)

    async def get_account_by_user_id(user_id):
        return repo.find_account_by_user_id(user_id)

    async def find_account_by_id(account_id):
        return repo.find_account_by_id(account_id)

    class AccountService:
        async def get_balance(self, *, user_id, **_):
            return await get_balance(user_id=user_id)

        async def get_account_summary(self, *, user_id, **_):
            return await get_balance(user_id=user_id)

        async def get_account_by_user_id(self, user_id):
            return repo.find_account_by_user_id(user_id)

        async def find_account_by_id(self, account_id):
            return repo.find_account_by_id(account_id)

    return AccountService()
