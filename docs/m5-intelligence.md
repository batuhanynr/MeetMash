# Meeting drafts and capability search

The authenticated WSS hub calls a local Ollama server. To install the models, start Ollama and run:

```sh
ollama pull qwen3:4b
ollama pull bge-m3
```

The hub defaults to `http://127.0.0.1:11434`. Override it with `MEETMESH_MODEL_URL` on the hub or evaluation process. `MEETMESH_CHAT_MODEL` and `MEETMESH_EMBEDDING_MODEL` choose the installed models. The model process runs separately from the hub and needs network access to download the initial weights.

A `meeting.preview` frame takes `requestId`, Turkish `text`, and an IANA `timeZone`. The server supplies the reference date. It validates the model's JSON, resolves names visible to the caller, and rejects invalid windows, including ambiguous or skipped local times at a DST transition. A ready preview contains editable request fields. Only the client's separate schedule action starts negotiation. A missing field or duplicate name yields clarification. If the model is offline, the response selects the manual form.

A `directory.lookup` frame with `by: "semantic"` ranks visible capability descriptions by cosine similarity. It returns up to three names and IDs. A permission check after inference covers changes during a search. Cached vectors are keyed by capability text. Only the query and the descriptions of visible capabilities go into the embedding model. When this model is offline the result carries `mode: "unavailable"`; the existing name and ID controls still work.

For a CLI preview, use a separately provisioned demo identity. Connecting it replaces any running session for the same agent.

```sh
node --env-file-if-exists=.env scripts/intelligence/client.ts preview agent-a 'Yarın 14:00-16:00 arası Carol ile bir saat görüşelim.'
node --env-file-if-exists=.env scripts/intelligence/client.ts semantic agent-a 'Toplantı saatlerini düzenleyecek biri'
node --test tests/intelligence/*.test.ts
node --env-file-if-exists=.env scripts/intelligence/evaluate.ts intent
node --env-file-if-exists=.env scripts/intelligence/evaluate.ts retrieval
```

The last two commands call real models and record the model digest, fixture digest and per-example outputs in `.state/evidence/m5-ai/`. Both fixtures were fixed before the first model run. The unit tests inject a model response to exercise validation and permission changes.

Local model API references: [structured chat](https://docs.ollama.com/api/chat) and [embeddings](https://docs.ollama.com/api/embed).

The [saved local evaluations](evidence/m5/intelligence/README.md) include the first partial prompt run, the second prompt's full per-request results, capability rankings and the authenticated WSS smoke result.
