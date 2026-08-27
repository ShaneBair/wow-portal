# Player boost database operations

Run `001_create_money_boost_requests.sql` while connected to the schema named by
`PORTAL_STATE_DATABASE`. The portal process does not create schemas, tables, users, or grants.

Grant the application account only:

- `SELECT`, `INSERT`, and `UPDATE` on `money_boost_requests` in the portal-state schema;
- column-level `SELECT` for `guid`, `account`, `name`, `level`, `race`, `class`, and
  `deleteInfos_Name` on the AzerothCore `characters` table;
- column-level `SELECT` for `id`, `receiver`, `subject`, `body`, and `money` on the AzerothCore
  `mail` table.

Keep its existing column-level authentication reads. Do not grant writes on any AzerothCore
auth, characters, mail, item, world, or statistics table.

## Bounded retention

After audit retention is approved, an operator may run the following in small batches while
connected to the portal-state schema. The proposed window is 90 days. It deliberately leaves
`pending` rows untouched and never changes delivered AzerothCore mail.

```sql
DELETE FROM money_boost_requests
WHERE created_at < TIMESTAMPADD(DAY, -90, UTC_TIMESTAMP())
  AND status IN ('sent', 'failed', 'unknown')
ORDER BY created_at
LIMIT 1000;
```

Repeat only until one batch affects fewer than 1,000 rows. Automating this job and granting
`DELETE` are optional and should be done only after the owner accepts the retention policy.
