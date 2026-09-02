# Player boost database operations

Run `001_create_money_boost_requests.sql`, `002_create_portable_hole_boost_requests.sql`,
`003_create_arcane_tome_boost_requests.sql`, and then
`004_create_character_level_boost_requests.sql` while connected to the schema named by
`PORTAL_STATE_DATABASE`. The portal process does not create schemas, tables, users, or grants.

Grant the application account only:

- `SELECT`, `INSERT`, and `UPDATE` on `money_boost_requests` in the portal-state schema;
- `SELECT`, `INSERT`, and `UPDATE` on `portable_hole_boost_requests` in the portal-state schema;
- `SELECT`, `INSERT`, and `UPDATE` on `arcane_tome_boost_requests` in the portal-state schema;
- `SELECT`, `INSERT`, and `UPDATE` on `character_level_boost_requests` in the portal-state schema;
- column-level `SELECT` for `guid`, `account`, `name`, `level`, `race`, `class`, and
  `deleteInfos_Name` on the AzerothCore `characters` table;
- column-level `SELECT` for `id`, `receiver`, `subject`, `body`, `has_items`, and `money` on the
  AzerothCore `mail` table;
- column-level `SELECT` for `mail_id` and `item_guid` on the AzerothCore `mail_items` table;
- column-level `SELECT` for `guid`, `itemEntry`, and `count` on the AzerothCore `item_instance`
  table.

Keep its existing column-level authentication reads. The account-settings feature is the sole auth
write exception: grant column-level `UPDATE` for only `account.salt` and `account.verifier` as
documented in the repository README and its feature specification. Do not grant any other writes on
AzerothCore auth, characters, mail, item, world, or statistics tables.

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

Apply the same bounded policy to resolved Portable Hole requests:

```sql
DELETE FROM portable_hole_boost_requests
WHERE created_at < TIMESTAMPADD(DAY, -90, UTC_TIMESTAMP())
  AND status IN ('sent', 'failed', 'unknown')
ORDER BY created_at
LIMIT 1000;
```

And to resolved Arcane Tome requests:

```sql
DELETE FROM arcane_tome_boost_requests
WHERE created_at < TIMESTAMPADD(DAY, -90, UTC_TIMESTAMP())
  AND status IN ('sent', 'failed', 'unknown')
ORDER BY created_at
LIMIT 1000;
```

And to resolved character-level requests:

```sql
DELETE FROM character_level_boost_requests
WHERE created_at < TIMESTAMPADD(DAY, -90, UTC_TIMESTAMP())
  AND status IN ('applied', 'failed', 'unknown')
ORDER BY created_at
LIMIT 1000;
```

Repeat only until one batch affects fewer than 1,000 rows. Automating this job and granting
`DELETE` are optional and should be done only after the owner accepts the retention policy.
Never delete a `pending` row or an `unknown` row whose delivery still needs reconciliation.
