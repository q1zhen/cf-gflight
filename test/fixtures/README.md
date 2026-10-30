# Round-trip payloads

These reduced public Google Flights HTML payloads were captured on 2026-10-30 for
JFK–LAX on 2027-01-20, returning 2027-01-27, one adult, economy, USD, nonstop.

The initial fixture retains outbound B6 123. The return fixture was fetched with
that outbound pinned in the compact `tfs` query and retains one recommended and
one other return option. Prices in the return response cover both directions.

Unused result rows and top-level sections were removed, and booking tokens were
replaced with fixture labels. No downloaded JavaScript is stored or evaluated.
These snapshots test parsing and response composition; availability and fares
are historical test data.
