from observability.langfuse_tracing import duration_ms, now_ms, start_tool


def create_support_service():
    class SupportService:
        async def connect_representative(self, **_):
            start = now_ms()
            tool = start_tool(
                name="open_video_call_window",
                input={"actionType": "open_video_call_window"},
                metadata={"toolName": "open_video_call_window"},
            )
            result = {"found": True, "action": "open_video_call"}
            summary = {
                "toolName": "open_video_call_window",
                "success": True,
                "actionType": "open_video_call_window",
                "duration_ms": duration_ms(start),
            }
            tool.end(output=summary, metadata=summary)
            return result

        async def create_support_ticket(self, **_):
            return {"found": True, "ticketId": None, "mode": "video_call_window"}

    return SupportService()
