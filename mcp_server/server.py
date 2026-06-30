"""
Bank MCP server skeleton (Stage 7A).

Run independently from the Flask/LangGraph app:
    python -m mcp_server.server
"""

from __future__ import annotations

import json
import os
import sys
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from mcp_server import DEFAULT_HOST, DEFAULT_PORT
from mcp_server.prompts import register_prompts
from mcp_server.resources import register_resources
from mcp_server.tools import register_tools

SERVER_NAME = "Bank One One MCP"


def create_mcp() -> FastMCP:
    mcp = FastMCP(
        SERVER_NAME,
        stateless_http=True,
        json_response=True,
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
    )

    register_prompts(mcp)
    register_resources(mcp)
    register_tools(mcp)

    @mcp.resource("bank://status")
    def server_status() -> str:
        """MCP-native status resource for startup verification."""
        return json.dumps({"status": "ok", "service": "bank-mcp"})

    return mcp


def create_app(mcp: FastMCP | None = None) -> Starlette:
    mcp = mcp or create_mcp()

    async def health_check(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "service": "bank-mcp"})

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        async with mcp.session_manager.run():
            yield

    return Starlette(
        routes=[
            Route("/health", health_check, methods=["GET"]),
            Mount("/", app=mcp.streamable_http_app()),
        ],
        lifespan=lifespan,
    )


def main() -> None:
    host = os.environ.get("MCP_HOST", DEFAULT_HOST)
    port = int(os.environ.get("MCP_PORT", str(DEFAULT_PORT)))

    import uvicorn

    sys.stderr.write(f"[mcp] Starting MCP server on {host}:{port}\n")
    sys.stderr.write(f"[mcp] Health: http://{host}:{port}/health\n")
    sys.stderr.write(f"[mcp] MCP endpoint: http://{host}:{port}/mcp\n")
    sys.stderr.flush()

    uvicorn.run(create_app(), host=host, port=port)


if __name__ == "__main__":
    main()
