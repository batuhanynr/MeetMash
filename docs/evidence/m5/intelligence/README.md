# Local model evaluations

These runs used synthetic profiles and requests with locally installed Ollama models. The JSON reports include individual outputs, expected values, model and fixture digests, and the repository HEAD at the time of each evaluation. Both evaluation reports record uncommitted source changes (`sourceDirty: true`), so the HEAD alone cannot reproduce the exact source used.

- [Turkish meeting requests](intent-v2.json) uses Qwen3 4B and prompt `tr-meeting-2`. With a reference time of 09:00 on November 9, 2026 in Istanbul, all 12 clear requests produced the expected participants, duration and time window. All four ambiguous and all four restricted requests returned a clarification. These scores describe the 20 recorded requests.
- The [first prompt log](intent-v1-partial.txt) contains nine results, with three passes and six failures on clear requests. The run stopped before a complete report was written. Version two constrained timestamp choices using the request and reference date after the first run exposed formatting errors. It was evaluated on the same fixture.
- [Capability search](retrieval.json) uses BGE-M3 against 30 synthetic capability descriptions. The expected visible agent appeared in the first three results for all 15 labeled Turkish or English queries.
- The [WSS smoke result](wss-smoke.json) records one successful authenticated semantic lookup and one validated meeting preview. The hub's mailbox contained zero rows after the preview. An earlier attempt returned `clarify` where the smoke expected `ready`. The saved result records the subsequent successful attempt.

These runs exercise model inference, discovery and the preview endpoint. The mobile scheduling and live calendar checks have separate evidence.
