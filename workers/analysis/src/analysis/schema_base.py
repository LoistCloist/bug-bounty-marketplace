"""Hand-written base class for the generated schema models.

scripts/gen-types.sh passes ``--base-class analysis.schema_base.BaseModel`` to
datamodel-codegen, so every model in ``analysis.generated.models`` inherits
from this class.

The shared TS/zod contract only accepts UTC timestamps with a ``Z`` suffix
(``Date.prototype.toISOString()`` output, e.g. ``2026-01-08T00:00:00.000Z``).
JSON Schema ``pattern`` cannot be applied to a pydantic datetime, so instead:

* datetime fields are typed ``AwareDatetime`` (naive values are rejected),
* any aware datetime is normalised to UTC on validation, and
* datetimes are serialised as ``YYYY-MM-DDTHH:MM:SS.sssZ`` in JSON mode.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pydantic
from pydantic import SerializerFunctionWrapHandler, field_serializer, field_validator


def to_iso_z(value: datetime) -> str:
    """Format an aware datetime like JS ``toISOString`` (UTC, millisecond precision)."""
    utc = value.astimezone(UTC)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


class BaseModel(pydantic.BaseModel):
    @field_validator("*", mode="after")
    @classmethod
    def _normalise_datetimes_to_utc(cls, value: Any) -> Any:
        if isinstance(value, datetime):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("datetime must be timezone-aware")
            return value.astimezone(UTC)
        return value

    @field_serializer("*", mode="wrap", when_used="json")
    def _serialise_datetimes_as_z(self, value: Any, handler: SerializerFunctionWrapHandler) -> Any:
        if isinstance(value, datetime):
            return to_iso_z(value)
        return handler(value)
