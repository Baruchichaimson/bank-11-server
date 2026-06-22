from ai.repositories.profile_repository import ProfileRepository
from observability.langfuse_tracing import duration_ms, mask_email, now_ms, start_tool


def _profile_tool_output(user: dict | None) -> dict:
    if not user:
        return {"success": True, "found": False}
    return {
        "success": True,
        "found": True,
        "included_fields": [field for field in ("firstName", "lastName", "email") if user.get(field)],
        "hasEmail": bool(user.get("email")),
    }


def create_profile_service(profile_repository=None):
    repo = profile_repository or ProfileRepository()

    class ProfileService:
        async def get_user_profile(self, *, user_id, **_):
            start = now_ms()
            tool = start_tool(
                name="get_user_profile",
                input={"hasUserId": bool(user_id)},
                metadata={"toolName": "get_user_profile"},
            )
            try:
                user = repo.find_user_by_id(user_id)
                summary = {"toolName": "get_user_profile", **_profile_tool_output(user), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                if not user:
                    return {"found": False, "message": "User not found"}
                return {
                    "found": True,
                    "firstName": user.get("firstName") or "",
                    "lastName": user.get("lastName") or "",
                    "email": user.get("email") or "",
                }
            except Exception as err:
                summary = {"toolName": "get_user_profile", "success": False, "error": str(err), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                raise

        async def get_identity(self, *, user_id, **_):
            return await self.get_user_profile(user_id=user_id)

        async def get_user_by_id(self, user_id):
            return repo.find_user_by_id(user_id)

        # sync alias used by transfer validator
        def getUserById(self, user_id):
            return repo.find_user_by_id(user_id)

        async def get_user_by_email(self, email: str):
            start = now_ms()
            tool = start_tool(
                name="lookup_recipient",
                input={"email": mask_email(email), "hasEmail": bool(email)},
                metadata={"toolName": "lookup_recipient"},
            )
            try:
                user = repo.find_user_by_email(email)
                summary = {"toolName": "lookup_recipient", **_profile_tool_output(user), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                return user
            except Exception as err:
                summary = {"toolName": "lookup_recipient", "success": False, "error": str(err), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                raise

        # sync alias
        def getUserByEmail(self, email: str):
            start = now_ms()
            tool = start_tool(
                name="lookup_recipient",
                input={"email": mask_email(email), "hasEmail": bool(email)},
                metadata={"toolName": "lookup_recipient"},
            )
            try:
                user = repo.find_user_by_email(email)
                summary = {"toolName": "lookup_recipient", **_profile_tool_output(user), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                return user
            except Exception as err:
                summary = {"toolName": "lookup_recipient", "success": False, "error": str(err), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                raise

    return ProfileService()
