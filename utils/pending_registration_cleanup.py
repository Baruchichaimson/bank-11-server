"""
Periodic cleanup of expired, unverified user registrations.
Uses APScheduler for background job scheduling.
"""

from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from config.settings import PENDING_REGISTRATION_CLEANUP_INTERVAL_MS


def cleanup_expired_pending_registrations() -> dict:
    from models.user_model import find_expired_unverified_users, delete_expired_unverified_users_by_ids
    from models.account_model import delete_pending_accounts_by_user_ids

    now = datetime.now(timezone.utc)
    expired_users = find_expired_unverified_users(now)

    if not expired_users:
        return {"deletedUsers": 0, "deletedAccounts": 0}

    user_ids = [u["_id"] for u in expired_users]
    deleted_accounts = delete_pending_accounts_by_user_ids(user_ids)
    deleted_users = delete_expired_unverified_users_by_ids(user_ids, now)

    return {
        "deletedUsers": deleted_users.get("deletedCount", 0),
        "deletedAccounts": deleted_accounts.get("deletedCount", 0),
    }


def _run_cleanup():
    try:
        result = cleanup_expired_pending_registrations()
        if result["deletedUsers"] or result["deletedAccounts"]:
            print(
                f"Cleaned expired pending registrations: "
                f"users={result['deletedUsers']}, accounts={result['deletedAccounts']}"
            )
    except Exception as err:
        print(f"Pending registration cleanup failed: {err}")


def start_pending_registration_cleanup() -> BackgroundScheduler:
    interval_seconds = max(PENDING_REGISTRATION_CLEANUP_INTERVAL_MS / 1000, 60)

    _run_cleanup()

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(_run_cleanup, "interval", seconds=interval_seconds)
    scheduler.start()
    return scheduler
