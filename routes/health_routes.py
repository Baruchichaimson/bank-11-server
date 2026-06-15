from flask import Blueprint
from controllers.health_controller import get_health, get_health_ai

health_bp = Blueprint("health", __name__)

health_bp.get("")(get_health)
health_bp.get("/ai")(get_health_ai)
