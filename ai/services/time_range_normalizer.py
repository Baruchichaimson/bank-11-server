from datetime import datetime, time


def _start_of_day(d: datetime) -> datetime:
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _end_of_day(d: datetime) -> datetime:
    return d.replace(hour=23, minute=59, second=59, microsecond=999000)


def _parse_iso_date(value) -> datetime | None:
    if not value:
        return None
    text = str(value or "").strip()
    import re
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", text)
    if not match:
        return None
    try:
        return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def normalize_time_range(*, date_range=None) -> dict:
    if not (
        date_range
        and isinstance(date_range, dict)
        and not isinstance(date_range, list)
        and (date_range.get("from") or date_range.get("to"))
    ):
        return {"startDate": None, "endDate": None, "label": None}

    from_date = _parse_iso_date(date_range.get("from"))
    to_date = _parse_iso_date(date_range.get("to"))

    if (date_range.get("from") and not from_date) or (date_range.get("to") and not to_date):
        raise ValueError("Invalid date range")

    start_date = _start_of_day(from_date) if from_date else None
    end_date = _end_of_day(to_date) if to_date else None

    if start_date and end_date and start_date > end_date:
        raise ValueError("Invalid date range")

    return {"startDate": start_date, "endDate": end_date, "label": "date_range"}
