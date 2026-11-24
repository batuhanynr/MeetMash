# Meeting previews

The hub uses OpenRouter to interpret meeting requests. Set `OPENROUTER_API_KEY` in the ignored `.env` file or save the key in `~/.config/meetmesh/openrouter-api-key` with permissions `600`. Set `OPENROUTER_MODEL` to choose a model; the default is `google/gemini-3.5-flash-lite`. Meeting requests are sent to OpenRouter and the selected model provider.

The model returns an editable draft. Names are matched only against profiles visible to the requester, and the user confirms the meeting separately. If the model is unavailable, use the meeting form.

```sh
node --env-file-if-exists=.env scripts/intelligence/client.ts preview agent-a 'Yarın Ada ile yarım saat görüşelim'
node --env-file-if-exists=.env scripts/intelligence/evaluate.ts intent
node --env-file-if-exists=.env scripts/intelligence/smoke.ts
```
