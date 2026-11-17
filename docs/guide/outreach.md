# Outreach

The Outreach page tracks the organisations you reach out to. Each one is a lead. Use it to record who you have contacted, when to follow up, and what came back.

## Adding and editing a lead

Click **New lead** to open a blank lead. A lead has:

- An **Organisation** name, a **Segment** and a **Stage**.
- Contact name, email, channel, website and demo URL.
- A **Next step**, a **Next due date** and an optional time.
- A **Value estimate** (a number).
- Notes.
- **Do not contact** and **Industry conflict** checkboxes.

Click **Save lead** to keep your changes.

### Do not contact and Industry conflict

- Tick **Do not contact** to block approvals for this lead. The lead page shows "Do not contact. Approvals are blocked."
- Tick **Industry conflict** to block outreach for a flagged conflict. The lead page shows "Outreach is blocked for this flagged conflict."

Both flags also show as small labels on the lead in the list.

## The list

- Search by organisation or contact.
- Filter by **Segment** or **Stage** using the two dropdowns.
- Columns show the organisation, segment, stage, next step and due date.
- The due cell warns when a follow-up is overdue, or says "Follow up if no reply."

The stage key at the top explains each stage: prospect (researched, never emailed), contacted (emailed, waiting on a reply), replied (they wrote back), won (signed) and lost (said no or went cold).

## History

Open a lead to see its **History**: the sends, replies and calls recorded against it, plus the approval history.

## Importing from CSV

Click **Import outreach tracker** to bring in past outreach from CSV files. Aplyd asks you to pick a tracker CSV, then an optional suppression CSV (cancel to skip).

Rules and format:

- Each file must be smaller than 10 MB.
- The tracker CSV has a header row. Aplyd reads these columns: `org`, `segment`, `status`, `sent_at`, `to`, `subject`, `reply`, `followup_due`, `next_step`, `conflict_flag` and `id`.
- Only rows with `status` of `sent`, a valid `sent_at` date, an `org`, and a known `segment` are imported. Every other row is skipped and counted.
- The `segment` column accepts `Group A`, `Group B`, `Group C` or `Group D` (the names the app shows), or the letters `A` to `D` (`A` is Group A, and so on), in any case. A row with any other segment is skipped, and the notice after the import names the row and lists these values.
- Older spreadsheets still work: the old names `clubs`, `local`, `ai` and `3d` are read as Group A to Group D, in that order.
- The suppression CSV has `email`, `reason` and `date` columns. Listed emails are marked **Do not contact**. A listed email that is not already a lead is added as a new lead with the stage prospect, marked **Do not contact**, so it stays blocked later.
- Repeat imports preserve your changes. Only confirmed sends are imported.

Before an import, Aplyd writes a copy of your database into the `backups` folder (named `job-tracker-before-lead-import-...`), so you can go back if needed. See [docs/data.md](../data.md).

You should now see a notice with how many leads and sends were imported, how many rows were skipped, and why any row with an unknown segment was skipped.

## Related

- [Today](today.md)
- [Data and backups](../data.md)
- [Stats](stats.md)
