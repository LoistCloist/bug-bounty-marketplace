"""Enums used by the API contract get stable class names in the generated
models, so adding a schema never renames them (e.g. Status -> Status1)."""

from analysis.generated import models


def test_contract_and_analysis_status_enums_have_stable_names():
    assert {m.value for m in models.ContractStatus} == {"Open", "Claimed", "Resolved", "Expired"}
    assert {m.value for m in models.AnalysisJobStatus} == {"Queued", "Running", "Done", "Failed"}
    assert models.Contract.model_fields["status"].annotation is models.ContractStatus
    assert models.AnalysisStatus.model_fields["status"].annotation is models.AnalysisJobStatus
