---
"loro-codemirror": patch
---

Apply the bound text's change when a batch of events also holds events for other containers. The import and undo handlers stopped at the first event that was not the bound text and dropped the rest of the batch.
