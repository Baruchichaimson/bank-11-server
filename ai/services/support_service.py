def create_support_service():
    class SupportService:
        async def connect_representative(self, **_):
            return {"found": True, "action": "open_video_call"}

        async def create_support_ticket(self, **_):
            return {"found": True, "ticketId": None, "mode": "video_call_window"}

    return SupportService()
