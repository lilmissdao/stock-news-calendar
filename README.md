# Stock News Calendar

A single-user notebook for Dao. It lays market news on a calendar, lists the same items on a timeline, plots the prices and percent moves that were actually written down, and draws the links between stories.

There is no login. The app reads one file, `data/news.json`, at build time. Updating the news means committing a new version of that file.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run build` produces a production build that Vercel can deploy with no extra configuration and no environment variables.

The search box in the top bar matches a ticker or a company name as you type. `nvd`, `nvidia`, `lilly`, and `LLY` all work. A Story hint means that name has a story page. Otherwise the pick opens the ticker chart. Names live in `data/ticker-names.json`.

## Views

- **Calendar** opens on the current month and day in America/New_York. Move to earlier or later months with Prev and Next, or jump back with Today. Items with a day-level date sit on that day, color-coded by industry. Month, quarter, and uncertain dates stay in the “This month / undated” strip instead of being pinned to a guessed day. A crowded day keeps a few headlines in the cell and lists the rest in the agenda. Click an item for the summary, key number, stated price, stated move, and related items.
- **List** is the same filtered set as a timeline.
- **Ticker** picks one symbol and shows its items in order. A price line is drawn only from `price_mentioned` rows whose ticker is the one you picked. Percent moves are markers from `move_pct`. Filled markers are items that name only that ticker. Open markers name several tickers, so the percent may describe the group or the tape rather than that symbol alone. Linked items from `related_ids` can be shown on the same timeline, including reactions that land on a later date. If that symbol has a story page, a Story button opens it.
- **Stocks** is one page per major ticker: a short summary of what happened, what’s coming, and the outside risks, then the dated history, upcoming catalysts, cautions, and links to related stocks and calendar items. The list of tickers lives in `data/stocks.json`. Recent items come from `data/news.json`. Older rows in that file are a researched backfill. A figure is included only when a source states it.
- **Connections** is a graph of `related_ids`. Drag to pan, drag a node to move it, and click a node for the write-up. Two reading paths are laid out from links already in the file: Meta capex → Nvidia → CoreWeave debt → rates, and Iran / oil → airlines and defense. **Biotech drug rivalries** draws a bubble for every row that has a `graph_node`. Size is reliance on that drug (very high means the only product), nudged by a stated market cap. A solid line is a rival drug, a dashed line is a generic threat, a dotted line is a royalty, and a faint dashed line was not verified. Those rows are Pharma/Biotech, so the Pharma/Biotech industry filter keeps the set on screen.
- **Pharma/Biotech** is one area with three sections: the Pharma/Biotech news, the drug-rivalry graph, and Binary Bets. Open [http://localhost:3000/pharma](http://localhost:3000/pharma). `/pharma/rivalries` is the graph. `/pharma/binary-bets` is the catalyst list. `/binary-bets` redirects there. Binary Bets is not its own top-level tab.
- **Upcoming**, in the side column, is the next 14 days of items whose status is `upcoming`. It follows the filters.

Filters (industry, ticker or company or headline, event type, status, stated price range, and move direction plus a minimum size) apply to every view. Prices and moves are never filled in when the file leaves them null.

Light and dark follow the system preference until you toggle them. The choice is stored in this browser.

## News file

`data/news.json` is a JSON array. One object per item:

| Field | Meaning |
| --- | --- |
| `id` | Stable slug, usually `YYYY-MM-DD-short-name`. Other items point at this. |
| `date` | `YYYY-MM-DD`. When the news happened or the event is scheduled. For a month or quarter, use a day inside that period (the first day is fine). |
| `date_precision` | `day`, `month`, `quarter`, or `unknown`. Only `day` is pinned to a calendar cell. |
| `status` | `happened`, `upcoming`, or `developing`. |
| `title` | Short headline. |
| `summary` | One or two plain sentences. |
| `tickers` | Symbols, or `[]`. |
| `companies` | Names, or `[]`. |
| `industry` | Free text. Known industries get a stable color; a new one still gets a color. Rare-disease rows use `Pharma/Biotech`, not a separate industry. |
| `tags` | Optional list of strings. `rare disease` marks a row that used to be filed under Biotech / rare disease. Use `[]` or omit the field when there is no tag. |
| `event_type` | `earnings`, `fda`, `trial`, `fed`, `macro_data`, `policy`, `deal`, `ipo`, `lockup`, `analyst`, `market_move`, `geopolitics`, or `other`. |
| `key_number` | The figure worth remembering, or `""`. |
| `price_mentioned` | `{ "ticker": "ORCL", "price": 136 }` or `null`. Do not invent a price. |
| `move_pct` | Signed percent, such as `-4.4`, or `null`. Do not invent a move. |
| `source_digest_date` | `YYYY-MM-DD` the note was written down. |
| `related_ids` | Ids of connected items. Use `[]` when nothing connects. |
| `connection_notes` | Why the links exist, or `""`. |
| `graph_node` | Optional. Present when the row is a bubble on Biotech drug rivalries. The graph uses this field, not the industry name. Fields: `label`, `drug`, `reliance` (`very_high`, `high`, `medium`, `low`, or null), `market_cap_b` (billions, or null), `cluster`, `order`. |
| `graph_only` | Optional `true`. Hides the row from the calendar. Use it for a company bubble that is not itself a dated event. |
| `link_kinds` | Optional map of a related id to `rival`, `generic_threat`, `royalty`, or `unverified`. |

Only record what was actually in the source notes. Leave price and move null when a number was not stated.

### Stock stories

`data/stocks.json` is the list behind the Stocks tab. One object per ticker. To add a ticker, copy an object and change the fields. No component edit is required.

| Field | Meaning |
| --- | --- |
| `ticker`, `name`, `industry`, `group`, `order` | How the chip is labeled and sorted. `group` can be a new name; it still gets a row. |
| `blurb` | One or two blunt sentences. |
| `peers` | Tickers to show as connections. |
| `pin_ids` | News ids to force onto the timeline, even when this ticker is not the first symbol on the row. |
| `skip_ids` | News ids to leave off, even when this ticker is listed first. |
| `macro_ids` | Shared upcoming items, such as CPI or a chip-export date, shown under What’s coming. |
| `backfill` | Dated history that is not in `news.json`. Use a real source. Set `unverified` to true if a date or figure is not confirmed. Leave the number out if you do not have it. |
| `catalysts` | Dated events still ahead that are not their own news rows. `news_ids` can point at a calendar item. |
| `cautions` | Outside risks. `reason` is the plain version. `via` is the other company or event. `level` is `high`, `medium`, or `low`. `tickers` and `news_ids` are the click-throughs. |

The caution count on each chip is the number of cautions in that object. The bars on the page use the same list.

### Add an item

1. Open `data/news.json`.
2. Copy an existing object and give it a new `id`.
3. Fill the fields above. Point `related_ids` at ids that already exist, and add the new id onto those items when the link should be visible from both sides (the graph treats a link in either direction as one edge).
4. Check that the file is still valid JSON.
5. Run `npm run briefs` and commit `data/news.json` together with `data/briefs.json`. A connected Vercel project will rebuild from that commit.

```json
{
  "id": "2026-10-24-example",
  "date": "2026-10-24",
  "date_precision": "day",
  "status": "happened",
  "title": "Short headline",
  "summary": "One or two sentences with only figures that were stated.",
  "tickers": ["NVDA"],
  "companies": ["Nvidia"],
  "industry": "Semiconductors",
  "event_type": "market_move",
  "key_number": "",
  "price_mentioned": null,
  "move_pct": null,
  "source_digest_date": "2026-10-24",
  "related_ids": [],
  "connection_notes": ""
}
```

## Enterprise AI tracker

Open [http://localhost:3000/enterprise-ai](http://localhost:3000/enterprise-ai). Two more sections live at `/enterprise-ai/neoclouds` and `/enterprise-ai/datacenters`. The same pages are linked from the Enterprise AI tab. On the calendar, these rows use an Enterprise AI badge and an amber bar. The Enterprise AI button in the top bar keeps only those rows.

`data/enterprise-ai.json` is the file the daily update edits. `npm run briefs` checks it and writes a count into `data/briefs.json`. It does not copy the rows into `data/news.json`. The site merges them at build time.

`companies` is the card and filter list. `items` is the timeline.

| Field | Meaning |
| --- | --- |
| `id` | Stable slug. Other rows in this file point at it. Do not reuse an id from `news.json`. |
| `date`, `date_precision` | Same rules as the news file. Only `day` is pinned to a calendar cell. |
| `sections` | One or more of `deal`, `neocloud`, `datacenter`. The row shows in each section. |
| `status` | `done`, `in_the_works`, or `rumored`. |
| `deal_type` | `partnership`, `contract`, `reseller`, `infrastructure`, `datacenter`, `sovereign`, `customer_win`, `pricing`, `product_launch`, `ipo`, `earnings`, `capacity`, `financing`, or `power`. |
| `title`, `summary` | Short headline and one plain-English summary. |
| `company_ids` | Ids from `companies`. A CoreWeave contract that also names Meta is listed under both, and shows on both cards. |
| `tickers`, `companies` | Symbols and names for the calendar search. Put the company the row is mainly about first. |
| `key_number` | The figure worth remembering, or `""`. Do not invent one. |
| `why_it_matters` | One sentence on the stocks. |
| `source`, `source_label` | Link and a short description of where the figure came from. |
| `unconfirmed` | `true` when a date or figure is only reported and was not read from a company page or filing. `false` when it was. |
| `related_ids` | Other ids in this file. |

A company needs `id`, `name`, `ticker` (`""` if private), `sections`, `card_in` (sections that show a card; `[]` if it is only a filter), `watch` (the four cards at the top of Deals), `order`, `blurb`, `facts` (label/value pairs already in a source), `next_event` or `null`, `links`, and the project fields `location`, `size`, `cost`, `power`, `partners`, `project_status`. `next_event.item_id` must be an item id. `next_event.unconfirmed` follows the same rule as an item.

```json
{
  "id": "eai-2026-11-16-example",
  "date": "2026-11-16",
  "date_precision": "day",
  "sections": ["deal", "neocloud"],
  "status": "done",
  "deal_type": "contract",
  "title": "Short headline",
  "summary": "One sentence with only a figure the source stated.",
  "company_ids": ["crwv", "meta"],
  "tickers": ["CRWV", "META"],
  "companies": ["CoreWeave", "Meta"],
  "key_number": "",
  "why_it_matters": "Why a holder of either stock would care.",
  "source": "https://example.com/source",
  "source_label": "Company release, Nov 16, 2026",
  "unconfirmed": false,
  "related_ids": []
}
```

## Binary Bets

Open [http://localhost:3000/pharma/binary-bets](http://localhost:3000/pharma/binary-bets). That page is the Binary Bets section inside Pharma/Biotech. [http://localhost:3000/binary-bets](http://localhost:3000/binary-bets) redirects there. On the calendar, these rows use industry Pharma/Biotech, a Binary Bets badge, and an indigo bar, separate from the amber Enterprise AI bar. The Binary Bets button in the top bar keeps only those rows. The Early warning button, and the same chip in Filters and on the Binary Bets page, keeps only catalysts the code has flagged. A month or quarter stays in the undated strip. Only a confirmed day is pinned to a cell.

`data/binary-bets.json` is the file to edit. `npm run briefs` checks it and writes a count into `data/briefs.json`. It does not copy the rows into `data/news.json`. The site merges them at build time.

One object in `items` is one catalyst.

| Field | Meaning |
| --- | --- |
| `id` | Stable slug starting with `bb-`. Do not reuse an id from `news.json`. |
| `ticker`, `company` | The stock and the company name. |
| `drug`, `indication` | What is being tested and in whom. |
| `catalyst_type` | `pdufa`, `phase3`, or `adcom`. |
| `date`, `date_precision` | Same rules as the news file. A month or quarter uses the first day of that window. Only `day` is pinned to a calendar cell. |
| `date_window` | Empty when the day is confirmed. For an expected window, the words the company used, such as `Q1 2027` or `December 2026`. |
| `timing` | `confirmed` only with `date_precision` `day`. `expected` only with `month` or `quarter`. |
| `status` | `upcoming` or `resolved`. A resolved row needs an `outcome`. An upcoming row keeps `outcome` null. |
| `market_cap` | A sourced approximate market cap, or `""` when the sources used do not state one. If it is filled in, a fact whose label contains “market cap” must source it. |
| `cash` | `null`, or the latest quarter: `on_hand`, `as_of` (`YYYY-MM-DD`), `scope` (what the cash line includes), `runway` (the company’s words, or `""`), `quarters` (only when that word can be restated without a burn-rate model, or `""`), `quarters_note` (required when `quarters` is set), `source`, `source_label`, `reported`. |
| `success_means`, `miss_means` | What a positive result and a negative result likely mean for this company. Stay inside the sourced facts. |
| `why_it_matters` | One short plain-English paragraph. |
| `outcome` | `null` until the event is decided. Then `result` is `success` or `miss`, `move` is the stock move a source stated, plus `source`, `source_label`, and `reported`. If quotes disagree, say so in `move` and do not invent a close. |
| `facts` | At least one. Each fact is `label`, `value`, `source` (https), `source_label`, and `reported` (`true` when the figure was not read from a company filing or company page). One fact label must name the date or the window. Cash and market cap, when present, need their own facts. |
| `title`, `summary`, `key_number` | The calendar headline, one or two sentences, and the figure worth remembering. |
| `related_ids` | Other ids in this file. |
| `event_counter` | Optional. `{ "current", "target", "as_of", "source", "source_label" }` for an event-driven trial, such as 78 of 80 deaths. The card draws a progress bar. Omit it, or use `null`, when there is no count. |
| `guidance_history` | Optional list of `{ "date", "wording", "source", "source_label", "missed" }`. `wording` is the company's timing language. `missed` is true when that guided date passed without the event. The card shows a Guidance missed badge if any row is missed. |
| `short_interest` | Optional. `{ "pct_float", "days_to_cover", "as_of", "source", "source_label" }`. `days_to_cover` may be `null` when a source states the percent and not the days. |
| `analyst_moves` | Optional list of `{ "date", "firm", "action", "target", "source", "source_label" }`. |
| `prior_phase_data` | Optional plain-English line comparing an earlier-phase result with standard of care, or `""`. |
| `dilution` | Optional. `{ "summary", "source", "source_label" }`. The summary is the share-count trend and recent offerings, warrants, or at-the-market use. |
| `early_warning` | Do not put this in the file. `npm run briefs` and the site compute it. An upcoming catalyst is flagged when any of these is true: the event counter is at least 90% of its target, the latest guidance wording is this quarter or sooner (including a named month or quarter that is the current one), or the catalyst `date` is today or within the next 30 days. For an expected month or quarter, that date is the first day of the window. A resolved catalyst is not flagged. The flag is a red Early warning badge on the card, on the calendar item, and in the filters. |
| `quarterly_burn` | Optional. `{ "amount_usd", "basis", "period", "source", "source_label" }`. `amount_usd` is one quarter of burn in dollars, the year-to-date figure divided by the number of quarters in `period`, rounded to the nearest dollar. `basis` is `net cash used in operating activities, YTD / quarters`, or `net loss / quarters` when the cash-flow line was not in the filing. The card does not store the runway. It computes `runway months = cash / (quarterly burn / 3)` from the first dollar amount in `cash.on_hand`, rounds to the nearest month, and shows that as quarters and years. The color follows the rounded quarter count: fewer than 4 quarters (under 12 months) is red, 4 to 8 quarters (12 to 24 months) is amber, and 9 or more (over 24 months) is green. The company’s own `cash.runway` words sit beside it. If those words name an end such as “into 2028” and that end is at least 12 months shorter than the computed runway, the card says the company plans to spend more. “At least 12 months” is not treated as an end date. If cash is not a dollar figure, or burn was not read, the card says `Runway: not computed` and why. |

Do not invent a date, a price, a percent, or a dollar amount. Leave the field empty, or mark the fact `reported`, when the number is only in a news report.

```json
{
  "id": "bb-2026-11-22-example",
  "ticker": "EXMP",
  "company": "Example Bio",
  "drug": "Exampledrug",
  "indication": "A rare disease",
  "catalyst_type": "pdufa",
  "date": "2026-11-22",
  "date_precision": "day",
  "date_window": "",
  "timing": "confirmed",
  "status": "upcoming",
  "market_cap": "",
  "cash": {
    "on_hand": "$100 million",
    "as_of": "2026-09-30",
    "scope": "cash and cash equivalents",
    "runway": "at least the next 12 months",
    "quarters": "at least 4",
    "quarters_note": "The company said 12 months. Twelve months is four quarters.",
    "source": "https://example.com/filing",
    "source_label": "Company 10-Q",
    "reported": false
  },
  "success_means": "An approval would be the first product.",
  "miss_means": "A rejection would leave the company with no approved drug.",
  "why_it_matters": "This is the only late-stage program.",
  "outcome": null,
  "facts": [
    {
      "label": "PDUFA date",
      "value": "November 22, 2026",
      "source": "https://example.com/filing",
      "source_label": "Company 10-Q",
      "reported": false
    },
    {
      "label": "Cash",
      "value": "$100 million as of September 30, 2026",
      "source": "https://example.com/filing",
      "source_label": "Company 10-Q",
      "reported": false
    }
  ],
  "title": "Binary: Example Bio PDUFA",
  "summary": "One sentence with only a figure the source stated.",
  "key_number": "PDUFA Nov 22, 2026.",
  "related_ids": []
}
```

## Summaries

Day cards, stock pages, and long notes get a short summary made only from titles, key numbers, prices, moves, and cautions already in the files. A long note keeps its full text; the short version is the first sentence, or the key number when the note is one long sentence. `npm run briefs` writes `data/briefs.json`. The site uses that text when it still matches the items on screen, and rebuilds the same lines when a filter hides some of them. No model and no API key.
