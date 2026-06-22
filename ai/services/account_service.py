from ai.repositories.account_repository import AccountRepository
from observability.langfuse_tracing import capture_io_enabled, duration_ms, now_ms, start_tool


def _account_tool_output(account: dict | None) -> dict:
    if not account:
        return {"success": True, "found": False}
    output = {
        "success": True,
        "found": True,
        "status": account.get("status") or "UNKNOWN",
        "currency": account.get("currency") or "ILS",
        "hasBalance": account.get("balance") is not None,
    }
    if capture_io_enabled():
        output["balance"] = account.get("balance")
    return output


def create_account_service(account_repository=None):
    repo = account_repository or AccountRepository()

    async def get_balance(*, user_id):
        start = now_ms()
        tool = start_tool(name="get_balance", input={"hasUserId": bool(user_id)}, metadata={"toolName": "get_balance"})
        try:
            account = repo.find_account_by_user_id(user_id)
            if not account:
                summary = {"toolName": "get_balance", "success": True, "found": False, "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                return {"found": False, "message": "Account not found"}
            result = {
                "found": True,
                "balance": float(account.get("balance") or 0),
                "status": account.get("status") or "UNKNOWN",
                "currency": "ILS",
            }
            summary = {"toolName": "get_balance", **_account_tool_output(account), "duration_ms": duration_ms(start)}
            tool.end(output=summary, metadata=summary)
            return result
        except Exception as err:
            tool.end(output={"toolName": "get_balance", "success": False, "error": str(err), "duration_ms": duration_ms(start)}, metadata={"toolName": "get_balance", "success": False, "error": str(err), "duration_ms": duration_ms(start)})
            raise

    async def get_account_summary(*, user_id):
        return await get_balance(user_id=user_id)

    async def get_account_by_user_id(user_id):
        start = now_ms()
        tool = start_tool(
            name="get_account_status",
            input={"lookup": "user_id", "hasUserId": bool(user_id)},
            metadata={"toolName": "get_account_status", "lookup": "user_id"},
        )
        try:
            account = repo.find_account_by_user_id(user_id)
            summary = {"toolName": "get_account_status", **_account_tool_output(account), "lookup": "user_id", "duration_ms": duration_ms(start)}
            tool.end(output=summary, metadata=summary)
            return account
        except Exception as err:
            tool.end(output={"toolName": "get_account_status", "success": False, "lookup": "user_id", "error": str(err), "duration_ms": duration_ms(start)}, metadata={"toolName": "get_account_status", "success": False, "lookup": "user_id", "error": str(err), "duration_ms": duration_ms(start)})
            raise

    async def find_account_by_id(account_id):
        start = now_ms()
        tool = start_tool(
            name="get_account_status",
            input={"lookup": "account_id", "hasAccountId": bool(account_id)},
            metadata={"toolName": "get_account_status", "lookup": "account_id"},
        )
        try:
            account = repo.find_account_by_id(account_id)
            summary = {"toolName": "get_account_status", **_account_tool_output(account), "lookup": "account_id", "duration_ms": duration_ms(start)}
            tool.end(output=summary, metadata=summary)
            return account
        except Exception as err:
            tool.end(output={"toolName": "get_account_status", "success": False, "lookup": "account_id", "error": str(err), "duration_ms": duration_ms(start)}, metadata={"toolName": "get_account_status", "success": False, "lookup": "account_id", "error": str(err), "duration_ms": duration_ms(start)})
            raise

    class AccountService:
        async def get_balance(self, *, user_id, **_):
            return await get_balance(user_id=user_id)

        async def get_account_summary(self, *, user_id, **_):
            return await get_balance(user_id=user_id)

        async def get_account_by_user_id(self, user_id):
            return await get_account_by_user_id(user_id)

        async def find_account_by_id(self, account_id):
            return await find_account_by_id(account_id)

    return AccountService()
