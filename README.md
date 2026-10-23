# Stock News Calendar

A single-user notebook for Dao. It lays market news on a calendar, lists the same items on a timeline, plots the prices and percent moves that were actually written down, and draws the links between stories.

There is no login. The app reads one file, `data/news.json`, at build time. Updating the news means committing a new version of that file.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `npm run build` produces a production build that Vercel can deploy with no extra configuration and no environment variables.

## Views

- **Calendar** opens on October 2026. Move to earlier or later months with Prev and Next. Items with a day-level date sit on that day, color-coded by industry. Month, quarter, and uncertain dates stay in the “This month / undated” strip instead of being pinned to a guessed day. A crowded day keeps a few headlines in the cell and lists the rest in the agenda. Click an item for the summary, key number, stated price, stated move, and related items.
- **List** is the same filtered set as a timeline.
- **Ticker** picks one symbol and shows its items in order. A price line is drawn only from `price_mentioned` rows whose ticker is the one you picked. Percent moves are markers from `move_pct`. Filled markers are items that name only that ticker. Open markers name several tickers, so the percent may describe the group or the tape rather than that symbol alone. Linked items from `related_ids` can be shown on the same timeline, including reactions that land on a later date.
- **Connections** is a graph of `related_ids`. Drag to pan, drag a node to move it, and click a node for the write-up. Two reading paths are laid out from links already in the file: Meta capex → Nvidia → CoreWeave debt → rates, and Iran / oil → airlines and defense.
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
| `industry` | Free text. Known industries get a stable color; a new one still gets a color. |
| `event_type` | `earnings`, `fda`, `trial`, `fed`, `macro_data`, `policy`, `deal`, `ipo`, `lockup`, `analyst`, `market_move`, `geopolitics`, or `other`. |
| `key_number` | The figure worth remembering, or `""`. |
| `price_mentioned` | `{ "ticker": "ORCL", "price": 136 }` or `null`. Do not invent a price. |
| `move_pct` | Signed percent, such as `-4.4`, or `null`. Do not invent a move. |
| `source_digest_date` | `YYYY-MM-DD` the note was written down. |
| `related_ids` | Ids of connected items. Use `[]` when nothing connects. |
| `connection_notes` | Why the links exist, or `""`. |

Only record what was actually in the source notes. Leave price and move null when a number was not stated.

### Add an item

1. Open `data/news.json`.
2. Copy an existing object and give it a new `id`.
3. Fill the fields above. Point `related_ids` at ids that already exist, and add the new id onto those items when the link should be visible from both sides (the graph treats a link in either direction as one edge).
4. Check that the file is still valid JSON.
5. Commit the file. A connected Vercel project will rebuild from that commit.

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
