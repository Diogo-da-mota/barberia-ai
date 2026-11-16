# 🔔 Instagram Following Scraper (`louisdeconinck/instagram-following-scraper`) Actor

🚀 Instantly scrape who any Instagram user follows — no login needed. Just drop a profile URL, get thousands of “Following” users in seconds. Perfect for growth hacking, competitor research, and lead gen. Fast, cheap, reliable. Built by a top 1% Apify dev.

- **URL**: https://apify.com/louisdeconinck/instagram-following-scraper.md
- **Developed by:** [Louis Deconinck](https://apify.com/louisdeconinck) (community)
- **Categories:** Social media, Lead generation, Automation
- **Features:** Limited permissions
- **Stats:** 6,158 total users, 159 monthly users, 97.5% runs succeeded, 114 bookmarks
- **User rating**: 3.95 out of 5 stars

## Pricing

from $0.20 / 1,000 cookie results

This Actor is paid per event. You are not charged for the Apify platform usage, but only a fixed price for specific events.
Since this Actor supports Apify Store discounts, the price gets lower the higher subscription plan you have.

Learn more: https://docs.apify.com/actors/running/actors-in-store.md#pay-per-event

## What's an Apify Actor?

An Actor is a serverless cloud program that runs on the Apify platform. It has two run modes.
In Batch mode, an Actor accepts a well-defined JSON input, performs an action which can take anything from a few seconds to a few hours,
and optionally produces a well-defined JSON output, datasets with results, or files in key-value store.
In Standby mode, an Actor provides a web server which can be used as a website, API, or an MCP server.

Apify vocabulary and the platform model are defined once, in the agent quickstart at https://apify.com/agents.md.

## How to integrate an Actor?

If asked about integration, you help developers integrate Actors into their projects.
You adapt to their stack and deliver integrations that are safe, well-documented, and production-ready.

Do not guess an integration path. Every one of them is in the agent quickstart at https://apify.com/agents.md: the Apify MCP server, Agent Skills with the Apify CLI, the JavaScript and Python clients, the REST API, and the account-free path for an agent with no human to sign in. It also carries the rule on stating cost before the first paid run.

For examples already wired to this Actor's own input schema, see the [API](#api) section below.

Each client library has reference documentation the quickstart does not restate: [JavaScript/TypeScript](https://docs.apify.com/api/client/js/docs.md) (`npm install apify-client`) and [Python](https://docs.apify.com/api/client/python/docs.md) (`pip install apify-client`).

# README

## 🚀 Instantly Scrape Any Instagram User’s *Following* — No Login Required

Want to see exactly *who* someone follows on Instagram? Competitors, influencers, trendsetters — all of it?

**No logins. No rate limits. No BS.**
Just drop the profile URL.
⚡ Get thousands of users — in seconds.
💰 Pay only for what you use.

Built for people who move FAST: growth hackers, researchers, developers, founders.
If you've wasted time with janky bots or shady APIs, this is your upgrade.

### 💥 Real Results, Fast

Scraped 7,223 *followings* in under 45 seconds.
Perfect for targeting, research, and discovery.

One user said:

> “I pulled the following list from a niche influencer and instantly had 1,000 new leads. Total game changer.”

No login = no risk to your account.
No fluff = just raw, usable data.

### 🔑 What Makes It Different?

- ⚙️ **Plug & Play** – Just paste usernames.
- 🔐 **No Login Needed** – Zero risk of bans or shadowbans.
- ⚡ **Crazy Fast** – Up to 10,000 followings in under a minute.
- 📊 **Rich Data** – Full profile info for every user they follow.
- 💸 **Cheap at scale** – from $0.001 per account on the Business plan (see pricing below).

### 💡 What Can You Use This For?

Here’s where this becomes your *unfair advantage*:

- **Influencer Analysis** – See who your audience trusts.
- **Lead Gen** – Pull followings from niche creators or competitors.
- **Audience Mapping** – Build full graphs of who-follows-who.
- **Market Research** – Spot rising players and sleeper accounts.
- **Community Discovery** – Uncover hidden influencers in seconds.
- **Product Fit Testing** – See who follows certain brands, tools, or trends.
- **Growth Loops** – Use the data for outreach, lookalike audiences, and more.

### 📦 What You Get (Output Format)

Each *following* comes with full metadata:

- `id`: Unique identifier of the account
- `full_name`: Display name of the account
- `is_private`: Is the accoutn private or public
- `fbid_v2`: Facebook ID
- `profile_pic_id`: unique identifier of the profile picture
- `profile_pic_url`: URL of the profile picture
- `is_verfied`: Is the account verified
- `username`: Instagram username / handle of the account
- `latest_reel_media`: UNIX timestamp when the latest active reel was posted
- `followed_by`: Instagram username of who this account is followed by

Example:

```json
{
	"pk": "325734299",
	"pk_id": "325734299",
	"id": "325734299",
	"full_name": "Miley Cyrus",
	"is_private": false,
	"fbid_v2": 17841401148975088,
	"third_party_downloads_enabled": 1,
	"strong_id__": "325734299",
	"profile_pic_id": "3595458399378546616_325734299",
	"profile_pic_url": "https://scontent-lhr6-1.cdninstagram.com/v/t51.2885-19/486277039_643772535091475_8347667707701574216_n.jpg?stp=dst-jpg_e0_s150x150_tt6&_nc_ht=scontent-lhr6-1.cdninstagram.com&_nc_cat=1&_nc_oc=Q6cZ2QGh3Jye6AJW6VJMcgWrszmNoslCLscHlTK4xhgFbRiTkU5J_SdX4U8muEhPH9DtdBM&_nc_ohc=vrwb7dYvYKwQ7kNvwHCrvql&_nc_gid=wTeWvBtg-dJeeXrLIDIMBg&edm=ALB854YBAAAA&ccb=7-5&oh=00_AfJO4VOomIB0NFm-9vs8f46aiTgssvCBXlzvC0n1fbDDcw&oe=683A0B03&_nc_sid=ce9561",
	"is_verified": true,
	"username": "mileycyrus",
	"has_anonymous_profile_picture": false,
	"account_badges": [],
	"latest_reel_media": 1748192023,
	"is_favorite": false,
	"followed_by": "zuck"
}
```

You get the real data — no filters, no noise.
Use it in your CRM, targeting systems, or even spreadsheets.

### ⌨️ Simple Inputs

```json
{
  "usernames": ["zuck", "therock"]
}
```

### 💵 Pricing (Crystal Clear)

You pay per following account returned (the "API result" event) plus a tiny fee per run. The price per account depends on your Apify plan:

| Apify plan        | Per following | Per 1,000 followings | Per run   |
| ----------------- | ------------- | -------------------- | --------- |
| Free              | $0.004       | $4.00               | $0.001   |
| Starter           | $0.003       | $3.00               | $0.0009  |
| Scale             | $0.002       | $2.00               | $0.0008  |
| Business & higher | $0.001       | $1.00               | $0.0007  |

**Example (Starter plan):**
2,000 followings = 2,000 × $0.003 + $0.0009 = $6.0009

Note: the "Cookie result" event shown in the pricing table is no longer used. Cookie mode was removed because the cookieless API method is much more reliable, so every following account is billed as an "API result". Each account is returned and billed only once per profile.

Set a max budget per run — so you’re always in control.

### 🧠 Why It Works

Where you are:
⛔ Blocked by rate limits.
😤 Fed up with fake tools.
🔒 Locked out without login.

Where you want to be:
✅ Fast, clean, bulk Instagram data.
💡 Fully automated.
📈 Scalable as hell.

This actor clears the path. Fast, simple & reliable.

### 🚀 How to Start (In 30 Seconds)

1. Click **"Try for Free"**
2. Paste the usernames
3. Hit **Run** — get all the followings

Want lower prices per result? [Upgrade your Apify plan here](https://apify.com/pricing?fpr=7p4wu)

### 🔗 Built for Automation

Use it with [Make.com](https://www.make.com?pc=louisdeconinck) or the Apify API to build automations, alerts, CRM enrichments — without writing a single line of code.

### 👨‍💻 Who Built This?

![Louis Deconinck](https://ljhvfnp80s.ufs.sh/f/IPiMUaDXNCtTp3kxNx8QbD0FCznv9WcZk8auNX2OJtEAwxG4)

I’m **Louis Deconinck** — Top 1% Apify dev, Oxford grad, and creator of 60+ scrapers used by 1,000+ data pros every month.

- 🏆 Apify AI Agent Hackathon Winner
- 🧠 300+ contributions in Apify Discord
- 💼 Ex-data engineer in EU banking

Need a custom setup or advanced use case? [Message me here](https://apify.com/louisdeconinck?fpr=7p4wu)

### ❤️ What Others Are Saying

> “This would’ve taken my VA hours. Now I get it in seconds.” – Sarah M.
> “Game-changer for influencer discovery and niche targeting.” – Dany R.

👉 Click **“Try for Free”** now and get your competitor’s following list in minutes.
Your next customer might already be following them.

This is your edge. Use it.

# Actor input Schema

## `usernames` (type: `array`):

Instagram usernames to process.

## Actor input object example

```json
{
  "usernames": [
    "zuck",
    "therock"
  ]
}
```

# API

You can run this Actor programmatically using our API. Below are code examples in JavaScript, Python, and CLI, as well as the OpenAPI specification and MCP server setup.

## JavaScript example

```javascript
import { ApifyClient } from 'apify-client';

// Initialize the ApifyClient with your Apify API token
// Replace the '<YOUR_API_TOKEN>' with your token
const client = new ApifyClient({
    token: '<YOUR_API_TOKEN>',
});

// Prepare Actor input
const input = {
    "usernames": [
        "zuck",
        "therock"
    ]
};

// Run the Actor and wait for it to finish
const run = await client.actor("louisdeconinck/instagram-following-scraper").call(input);

// Fetch and print Actor results from the run's dataset (if any)
console.log('Results from dataset');
console.log(`💾 Check your data here: https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
const { items } = await client.dataset(run.defaultDatasetId).listItems();
items.forEach((item) => {
    console.dir(item);
});

// 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/js/docs

```

## Python example

```python
from apify_client import ApifyClient

# Initialize the ApifyClient with your Apify API token
# Replace '<YOUR_API_TOKEN>' with your token.
client = ApifyClient("<YOUR_API_TOKEN>")

# Prepare the Actor input
run_input = { "usernames": [
        "zuck",
        "therock",
    ] }

# Run the Actor and wait for it to finish
run = client.actor("louisdeconinck/instagram-following-scraper").call(run_input=run_input)

# Fetch and print Actor results from the run's dataset (if there are any)
print(f"💾 Check your data here: https://console.apify.com/storage/datasets/{run.default_dataset_id}")
for item in client.dataset(run.default_dataset_id).iterate_items():
    print(item)

# 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/python/docs/quick-start

```

## CLI example

```bash
echo '{
  "usernames": [
    "zuck",
    "therock"
  ]
}' |
apify call louisdeconinck/instagram-following-scraper --silent --output-dataset

```

## MCP server setup

```json
{
    "mcpServers": {
        "apify": {
            "type": "http",
            "url": "https://mcp.apify.com/?tools=fetch-actor-details,louisdeconinck/instagram-following-scraper"
        }
    }
}
```

The hosted server signs you in with OAuth on first connect, so no API token belongs in this config. Clients without OAuth support can send an `Authorization: Bearer <APIFY_API_TOKEN>` header instead, using a token from API & Integrations in Apify Console (https://console.apify.com/settings/integrations).

## OpenAPI specification

Download the OpenAPI definition: https://api.apify.com/v2/actors/w0pct4EQqHEnWRnj8/builds/7W7jyP2z7U5PQHnCp/openapi.json
