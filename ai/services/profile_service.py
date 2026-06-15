from ai.repositories.profile_repository import ProfileRepository


def create_profile_service(profile_repository=None):
    repo = profile_repository or ProfileRepository()

    class ProfileService:
        async def get_user_profile(self, *, user_id, **_):
            user = repo.find_user_by_id(user_id)
            if not user:
                return {"found": False, "message": "User not found"}
            return {
                "found": True,
                "firstName": user.get("firstName") or "",
                "lastName": user.get("lastName") or "",
                "email": user.get("email") or "",
            }

        async def get_identity(self, *, user_id, **_):
            return await self.get_user_profile(user_id=user_id)

        async def get_user_by_id(self, user_id):
            return repo.find_user_by_id(user_id)

        # sync alias used by transfer validator
        def getUserById(self, user_id):
            return repo.find_user_by_id(user_id)

        async def get_user_by_email(self, email: str):
            return repo.find_user_by_email(email)

        # sync alias
        def getUserByEmail(self, email: str):
            return repo.find_user_by_email(email)

    return ProfileService()
