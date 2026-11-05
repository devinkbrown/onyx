#!/usr/bin/env python3
"""Validate structural E104 schema cases; this does not verify crypto or behavior."""
from __future__ import annotations

import json
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError as exc:  # optional reviewer tooling; not a project dependency
    raise SystemExit("Install jsonschema in the review environment to validate these fixtures") from exc

HERE = Path(__file__).resolve().parent


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


schema = read_json(HERE / "host-management-bridge.v1.schema.json")
vectors = read_json(HERE / "host-management-bridge.v1.vectors.json")
if not isinstance(schema, dict) or not isinstance(vectors, dict):
    raise SystemExit("schema and vector documents must be JSON objects")
Draft202012Validator.check_schema(schema)
definitions = schema.get("$defs")
if not isinstance(definitions, dict):
    raise SystemExit("schema must contain $defs")
cases = vectors.get("schemaCases")
if not isinstance(cases, list) or not cases:
    raise SystemExit("schemaCases must be a nonempty array")
required_case_ids = {
    "config-plan-required-capability-valid",
    "config-plan-wrong-required-capability-invalid",
    "restart-plan-required-capability-valid",
    "restart-plan-wrong-required-capability-invalid",
    "rollback-plan-required-capability-valid",
    "rollback-plan-wrong-required-capability-invalid",
    "cancel-success-cancelled-record-valid",
    "cancel-rejected-terminal-applied-record-valid",
    "cancel-rejected-accepted-record-invalid",
    "cancel-rejected-running-record-invalid",
    "cancel-rejected-outcome-unknown-record-invalid",
}
case_ids = {case.get("id") for case in cases if isinstance(case, dict)}
missing_required = required_case_ids - case_ids
if missing_required:
    raise SystemExit("missing required structural cases: " + ", ".join(sorted(missing_required)))
errors: list[str] = []
seen_ids: set[str] = set()

for index, case in enumerate(cases):
    if not isinstance(case, dict):
        errors.append(f"schemaCases[{index}]: case must be an object")
        continue
    case_id = case.get("id")
    if not isinstance(case_id, str) or not case_id:
        errors.append(f"schemaCases[{index}]: id must be a nonempty string")
        case_id = f"schemaCases[{index}]"
    elif case_id in seen_ids:
        errors.append(f"{case_id}: duplicate case id")
    seen_ids.add(case_id)
    schema_ref = case.get("schemaRef")
    if not isinstance(schema_ref, str) or not schema_ref.startswith("#/$defs/"):
        errors.append(f"{case_id}: schemaRef must name a local $defs entry")
        continue
    def_name = schema_ref.removeprefix("#/$defs/")
    if not def_name or "/" in def_name or def_name not in definitions:
        errors.append(f"{case_id}: unknown schema target {schema_ref}")
        continue
    if "value" not in case:
        errors.append(f"{case_id}: value is required")
        continue
    expected = case.get("expectedValid")
    if type(expected) is not bool:
        errors.append(f"{case_id}: expectedValid must be a boolean")
        continue

    # Validate the selected target, with the complete definitions table retained
    # so its nested local $refs resolve against the same schema document.
    selected_schema = {
        "$schema": schema["$schema"],
        "$id": schema["$id"],
        "$defs": definitions,
        "allOf": [{"$ref": schema_ref}],
    }
    Draft202012Validator.check_schema(selected_schema)
    valid = Draft202012Validator(selected_schema).is_valid(case["value"])
    if valid != expected:
        errors.append(f"{case_id}: expectedValid={expected}, actual={valid}")

if errors:
    raise SystemExit("\n".join(errors))
print(f"validated {len(cases)} design-only schema cases")
print("No JCS digest, Ed25519 proof, WebAuthn assertion, service behavior, or deployment acceptance was tested.")
