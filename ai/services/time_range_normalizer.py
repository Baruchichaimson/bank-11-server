from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


DEFAULT_QUERY_TIME_ZONE = "Asia/Jerusalem"
SUPPORTED_TIME_RANGES = {"today", "this_week", "this_month", "last_month"}


def _get_timezone(timezone_name: str):
    try:
        return ZoneInfo(timezone_name or DEFAULT_QUERY_TIME_ZONE)
    except Exception:
        return timezone.utc


def _as_local_now(now: datetime | None, tz) -> datetime:
    if now is None:
        return datetime.now(tz)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(tz)


def _start_of_day(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _to_utc(d: datetime) -> datetime:
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def _parse_iso_date(value) -> date | None:
    if not value:
        return None
    text = str(value or "").strip()
    import re
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", text)
    if not match:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def _month_start(d: datetime) -> datetime:
    return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _add_months(d: datetime, months: int) -> datetime:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return d.replace(year=year, month=month, day=1)


def _build_result(
    *,
    start_local: datetime | None,
    end_local_exclusive: datetime | None,
    label: str | None,
) -> dict:
    return {
        "startDate": _to_utc(start_local) if start_local else None,
        "endDate": _to_utc(end_local_exclusive) if end_local_exclusive else None,
        "displayStartDate": start_local,
        "displayEndDate": (end_local_exclusive - timedelta(microseconds=1)) if end_local_exclusive else None,
        "label": label,
    }


def _normalize_explicit_date_range(*, date_range, tz) -> dict | None:
    if not (
        date_range
        and isinstance(date_range, dict)
        and not isinstance(date_range, list)
        and (date_range.get("from") or date_range.get("to"))
    ):
        return None

    from_date = _parse_iso_date(date_range.get("from"))
    to_date = _parse_iso_date(date_range.get("to"))

    if (date_range.get("from") and not from_date) or (date_range.get("to") and not to_date):
        raise ValueError("Invalid date range")

    if from_date and to_date and from_date > to_date:
        raise ValueError("Invalid date range")

    start_local = datetime.combine(from_date, datetime.min.time(), tzinfo=tz) if from_date else None
    end_local_exclusive = (
        datetime.combine(to_date + timedelta(days=1), datetime.min.time(), tzinfo=tz) if to_date else None
    )

    return _build_result(
        start_local=start_local,
        end_local_exclusive=end_local_exclusive,
        label="date_range",
    )


def _normalize_relative_time_range(*, time_range, now: datetime | None, tz) -> dict | None:
    normalized = str(time_range or "").strip()
    if not normalized:
        return None
    if normalized not in SUPPORTED_TIME_RANGES:
        raise ValueError("Invalid time range")

    local_now = _as_local_now(now, tz)
    today_start = _start_of_day(local_now)

    if normalized == "today":
        start_local = today_start
        end_local_exclusive = start_local + timedelta(days=1)
    elif normalized == "this_week":
        days_since_sunday = (local_now.weekday() + 1) % 7
        start_local = _start_of_day(local_now - timedelta(days=days_since_sunday))
        end_local_exclusive = start_local + timedelta(days=7)
    elif normalized == "this_month":
        start_local = _month_start(local_now)
        end_local_exclusive = _add_months(start_local, 1)
    else:
        end_local_exclusive = _month_start(local_now)
        start_local = _add_months(end_local_exclusive, -1)

    return _build_result(start_local=start_local, end_local_exclusive=end_local_exclusive, label=normalized)


def normalize_time_range(
    *,
    time_range=None,
    date_range=None,
    now: datetime | None = None,
    timezone_name=DEFAULT_QUERY_TIME_ZONE,
) -> dict:
    tz = _get_timezone(timezone_name)

    explicit_range = _normalize_explicit_date_range(date_range=date_range, tz=tz)
    if explicit_range:
        return explicit_range

    relative_range = _normalize_relative_time_range(time_range=time_range, now=now, tz=tz)
    if relative_range:
        return relative_range

    return {
        "startDate": None,
        "endDate": None,
        "displayStartDate": None,
        "displayEndDate": None,
        "label": None,
    }
