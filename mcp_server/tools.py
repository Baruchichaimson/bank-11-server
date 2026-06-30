"""MCP tool registration (Stage 7C)."""

from mcp.server.fastmcp import FastMCP

from services.risk_service import assess_transfer_risk


def register_tools(mcp: FastMCP) -> None:
    """Expose deterministic transfer risk evaluation over MCP."""

    @mcp.tool(name="evaluate_det_risk")
    def evaluate_det_risk(
        senderEmail: str,
        receiverEmail: str,
        amount: float,
        senderBalance: float,
    ) -> dict:
        """Evaluate deterministic transfer risk for a proposed transfer."""
        return assess_transfer_risk(
            sender_email=str(senderEmail or "").strip().lower(),
            receiver_email=str(receiverEmail or "").strip().lower(),
            amount=float(amount or 0),
            sender_balance=float(senderBalance or 0),
        )
