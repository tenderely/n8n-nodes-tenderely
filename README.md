# n8n-nodes-tenderely

[n8n](https://n8n.io) community nodes for **Tenderely BPM**: start workflows instantly when a
record is created, updated, completed or deleted in a Tenderely form, and create, update and
find records or complete process steps from any workflow.

## Nodes

| Node | What it does |
|---|---|
| **Tenderely Trigger** | Instant trigger for one form: *Record Created*, *Record Updated*, *Record Completed* or *Record Deleted*. Every delivery is signed by Tenderely and verified by the node; unsigned or altered requests never start the workflow. |
| **Tenderely** | *Create* a record (the form's process starts), *Update* a record (only the fields you fill in change), *Get* a record, *Get Many* records (filter by a field value and status, with paging), *Complete Step* of a record's process (with an optional decision and comment). |

Form fields load from your form automatically: required fields, choice lists and field types
come from Tenderely. Calculated and automatic fields are not shown because they cannot be written.

## Installation

Self-hosted n8n: **Settings → Community Nodes → Install** and enter `n8n-nodes-tenderely`.
See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

The nodes authenticate with a Tenderely **API key**, sent in the `x-api-key` header.

1. In Tenderely open **BPM → Integrations → API keys** and create a key.
2. Turn on **Allow writing** if your workflows will create or update records. A read-only key
   works for the trigger and for *Get* / *Get Many*.
3. In n8n create a **Tenderely API** credential and paste the key. Leave *Base URL* as it is.
   n8n tests the credential by reading your company name from Tenderely.

The key works only for your company's forms. You can limit it to some forms, and forms that hold
sensitive data must be allowed for the key explicitly. If you revoke the key, its triggers stop
receiving events.

## Usage

**Tenderely Trigger** — choose the event and the form. When you activate the workflow, n8n
subscribes in Tenderely; when you deactivate it, the subscription is removed. You can see these
subscriptions in Tenderely under *BPM → Integrations → Webhooks*; their names start with `n8n ·`.

**Tenderely** — choose the operation and the form.

- *Create*: the form's fields appear under **Fields**; map values to them. Use *Idempotency Key*
  (for example an order number) when the same event can arrive twice: Tenderely then returns the
  existing record instead of creating a copy.
- *Update*: map the record ID from a previous node and fill in only the fields you want to change.
- *Get Many*: optionally filter by one field value (exact match, case-insensitive for text) and by
  status. Turn on *Return All* to page through every record.
- *Complete Step*: completes the open step of the record's process. Set *Decision* when the step
  has decisions (for example `approve`), and *Step Key* only when more than one step is open.

## Example workflows

Import these from the [`examples`](examples) folder (*Workflows → Import from File*), then choose
your Tenderely credential and form in each Tenderely node.

| File | What it does |
|---|---|
| [`form-submission-to-record.json`](examples/form-submission-to-record.json) | An n8n form creates a record in a Tenderely form, which starts its process. |
| [`completed-record-to-slack.json`](examples/completed-record-to-slack.json) | When a record's process is completed, posts its title and link to a Slack channel. |
| [`payment-completes-step.json`](examples/payment-completes-step.json) | A payment provider calls an n8n webhook; the workflow finds the order record by its order number and completes the approval step. |

## Webhook address requirement

Tenderely only calls **public https addresses on port 443**. n8n Cloud already meets this. For
self-hosted n8n, put n8n behind a reverse proxy and set the
[`WEBHOOK_URL`](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
environment variable, for example `WEBHOOK_URL=https://n8n.example.com/`. If you skip this, the
trigger cannot be activated and shows an error that explains why.

## Output

All nodes return records in the same shape, so expressions keep working from one node to the next:

```json
{
  "id": "6a0c603dd6d5c8f6ae24a471",
  "title": "Service request",
  "status": "running",
  "form_id": "6a0c603dd6d5c8f6ae24a470",
  "form_name": "Service requests",
  "created_at": "2026-10-13T09:00:00.000Z",
  "updated_at": "2026-10-13T09:00:00.000Z",
  "completed_at": null,
  "current_steps": ["approval"],
  "url": "https://app.tenderely.com/#/bpm/instance/6a0c603dd6d5c8f6ae24a471",
  "fields": { "email": "customer@example.com", "quantity": 2 }
}
```

The trigger adds `event` and `occurred_at`.

## Compatibility

Tested with n8n 2.48 on Node.js 24. The package has no runtime dependencies and uses only the
standard `n8n-workflow` API.

## Development

```bash
npm install
npm run lint    # n8n community node linter
npm test        # build + signature tests
npm run dev     # local n8n with the nodes loaded
```

Releases are published to npm with provenance by the [`publish.yml`](.github/workflows/publish.yml)
GitHub Actions workflow: run `npm run release` locally to bump the version, tag and push.

## Resources

- [Tenderely developer documentation](https://tenderely.com/developers/#n8n)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)

## License

[MIT](LICENSE.md)
