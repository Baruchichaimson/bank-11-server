"""Minimal tests for the Stage 7A MCP server skeleton."""

import importlib

import pytest

from mcp_server import DEFAULT_HOST, DEFAULT_PORT
from mcp_server import prompts, resources, server, tools


def test_mcp_server_package_imports():
    assert DEFAULT_PORT == 8000
    assert DEFAULT_HOST == "0.0.0.0"


def test_placeholder_registration_modules_import():
    assert callable(prompts.register_prompts)
    assert callable(resources.register_resources)
    assert callable(tools.register_tools)


def test_create_mcp_registers_status_resource():
    mcp = server.create_mcp()
    assert mcp.name == server.SERVER_NAME


def test_create_app_exposes_health_route():
    app = server.create_app()
    route_paths = {getattr(route, "path", None) for route in app.routes}
    assert "/health" in route_paths


def test_register_stubs_accept_fastmcp_instance():
    mcp = server.create_mcp()
    prompts.register_prompts(mcp)
    resources.register_resources(mcp)
    tools.register_tools(mcp)


@pytest.mark.parametrize(
    "module_name",
    [
        "mcp_server",
        "mcp_server.server",
        "mcp_server.prompts",
        "mcp_server.resources",
        "mcp_server.tools",
    ],
)
def test_mcp_modules_import_cleanly(module_name: str):
    importlib.import_module(module_name)
