# Task 003 — After the first release: the PostHog project, country only, no CI users

- **Sprint:** sprints/sprint-158-usage-data-close
- **Status:** backlog
- **Type:** test
- **Area:** GitHub environment, PostHog project, a published build
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-001, task-002

## Goal
The first published desktop release with the feature reaches the PostHog project, stores the country
and nothing finer, and its own release checks added no user.

## Context / why
Spec § 1 (the owner's two settings), D3, D13, TODO(verify) on the GeoIP properties. Needs the merge
and the owner's hand: the agent cannot set GitHub variables or PostHog settings.

## Scope references
- `swe/features/desktop-usage-data.md` § 1, § Acceptance criteria ("Once, after the first release")

## What to build
Nothing in the repository. Steps:
1. Owner, before the merge: the variable `POSTHOG_PROJECT_TOKEN` of environment `desktop-release` = D2's token (**done
   2026-11-25**); PostHog project → IP data capture "discard", and a property-filter transformation
   removing every `$geoip_*` property except `$geoip_country_code` / `$geoip_country_name` (on the
   event and in `$set`/`$set_once`).
2. After the release: read the `bundle-release` log for the variable's presence (masked or not);
   install the published build on Linux, start it once.
3. In PostHog, read that event: country present; no `$ip`, city, subdivision, postal code,
   coordinates or time zone. Note the exact `$geoip_*` list seen (closes the spec's TODO(verify)).
4. Count distinct IDs since the release: the `update-check` runs on three systems added none.

## Acceptance criteria
- [ ] Step 3 and step 4 hold, with the evidence (property list, counts) in the summary.
- [ ] The spec's § 1 TODO(verify) is replaced by the observed list; status line says released.

## Test / verification plan
Recorded in the summary. If step 3 shows a finer location, the filter is fixed in PostHog before
anything else; the app does not change.
