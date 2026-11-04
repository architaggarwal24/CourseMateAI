"""The terminal log format (LOG_FORMAT=pretty): short, readable, and never alarming for normal lines."""
import logging

from observability.logs import PrettyFormatter


def _line(name: str, msg: str, level: int = logging.INFO) -> str:
    rec = logging.LogRecord(name, level, __file__, 1, msg, None, None)
    return PrettyFormatter().format(rec)


def test_uvicorn_startup_lines_are_labelled_server_not_error():
    # uvicorn logs its normal startup on a logger called "uvicorn.error"; that name is not a level
    line = _line("uvicorn.error", "Application startup complete.")
    assert "  server  Application startup complete." in line
    assert "error" not in line.lower()


def test_other_loggers_keep_their_short_name_and_real_problems_say_so():
    assert "  arena  boss ready" in _line("services.arena", "boss ready")
    assert "ERRO" in _line("uvicorn.error", "boom", logging.ERROR)
