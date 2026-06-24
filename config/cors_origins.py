from config.settings import CORS_ORIGINS, SOCKET_CORS_ORIGINS, FRONTEND_BASE_URL

DEFAULT_ORIGINS = [
    "http://35.187.14.48:3000"
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://bank-11-client.vercel.app",
    "https://bank-11-frontend.vercel.app",
]


def _parse_csv_origins(csv: str) -> list[str]:
    return [v.strip() for v in (csv or "").split(",") if v.strip()]


def get_allowed_origins() -> list[str]:
    env_origins = (
        _parse_csv_origins(CORS_ORIGINS)
        + _parse_csv_origins(SOCKET_CORS_ORIGINS)
        + _parse_csv_origins(FRONTEND_BASE_URL)
    )
    unique = dict.fromkeys(DEFAULT_ORIGINS + env_origins)
    return list(unique)
