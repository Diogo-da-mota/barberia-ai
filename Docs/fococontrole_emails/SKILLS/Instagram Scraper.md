# Instagram Scraper (`apify/instagram-scraper`) Actor

Extract Instagram posts, reels, profiles, places, hashtags, carousels, and comments. Get data from Instagram using one or more Instagram URLs or search queries: content, context, metrics, metadata. Export scraped data, run the scraper via API, schedule and monitor runs or integrate with other tools.

- **URL**: https://apify.com/apify/instagram-scraper.md
- **Developed by:** [Apify](https://apify.com/apify) (Apify)
- **Categories:** Social media
- **Features:** Limited permissions
- **Stats:** 486,178 total users, 69,180 monthly users, 100.0% runs succeeded, 4,537 bookmarks
- **User rating**: 4.67 out of 5 stars

## Pricing

from $1.50 / 1,000 results

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

### What can Instagram Scraper do?

Instagram Scraper **extracts public data from across Instagram** in a single tool: posts and reels from a profile, comments on a single video, mentions of a brand, profile details for a creator, place metadata for a city, or volume and reach for a hashtag. Add a URL match it with one of the 5 available content types and you can:

<table>
<tr>
<th>📦 What you can extract</th>
<th>⚙️ Features & integrations</th>
</tr>
<tr>
<td valign="top">

📷 **Posts and carousels** from profiles, hashtagged posts, or tagged posts <br>
🎞️ **Reels** from profiles, hashtagged reels, or tagged reels <br>
💬 **Comments and replies** from posts or reels <br>
🏷️ **Mentions, tagged photos**, and collaborators <br>
👤 **Profiles**: bio, followers, websites <br>
\#️⃣ **Hashtags**: volume, related tags, post count <br>
📍 **Places**: coordinates, address, post count, category <br>
🖼️ **Media**: images, videos, thumbnails, profile pics

</td>
<td valign="top">

🔎 **Search** Instagram by user, hashtag, or place <br>
📅 **Date filters and scheduling** to get only recent content <br>
⬇️ **Export data** to JSON, CSV, Excel, or XML <br>
🦾 **API access, webhooks**, Node.js & Python SDKs <br>
🤖 **LLM-ready data** for MCP, Claude, Gemini, ChatGPT

</td>
</tr>
</table>

If you're in the market for influencer discovery, trend tracking, competitor monitoring, local business discovery, content and image analysis, UGC discovery, sentiment analysis, campaign performance tracking, brand monitoring, and more, you can get it all from a single tool.

### What data can I scrape from Instagram?

Instagram Scraper is the **unofficial Instagram API that 300K+ users rely on** to pull the public data Instagram cut off from its official API in 2020. No Business or Creator account, no OAuth, no limits on public data. You get the **content, context, engagement metrics, and metadata** behind any social media insight:

- **Posts and reels:** *what was posted, how it landed, who's around it*. Captions, hashtags, mentions, image and video URLs, carousel children, engagement (likes, comments, views, plays, first + latest comments), and context (location, owner, tagged users, co-authors, music). Plus `shortCode`, `url`, `type`, and `productType` for joining and filtering.

- **Mentions:** *who's tagging you*. Same shape as a post, filtered to posts where a target profile is tagged. Drop in a profile URL, get every public post pointing at it.

- **Comments:** *what people are saying*. Text, author identity (username, ID, profile pic, verified status), timestamp, likes, replies, and links to the comment and parent post.

- **Profiles:** *who's behind the account*. Bio, full name, follower/following counts, posts and highlight reel counts, verified and business status.

- **Hashtags:** *how big and how reachable*. Post count, posts per day, related-tag clusters bucketed by reach tier (frequent, average, rare). Useful for finding less-saturated adjacent tags.

- **Places:** *where it happened*. Name, coordinates, address (city, country, category), post count, top and latest posts.

You can scrape from an **existing list of URLs** (profile, post, reel, hashtag, or place), or **discover and scrape** by running a search query for matching profiles, hashtags, or places.

> Need more? Try these dedicated scrapers for features and data not covered by the main Instagram Scraper:
>
> - 📢 [Instagram Ads Scraper](https://apify.com/apify/facebook-ads-scraper): ads and creatives data with pricing enrichment
> - 🎞️ [Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper): reels with share counts and transcripts, plus a reels download option
> - 👤 [Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper): profile extraction with location and verification data
> - 🤝 [Brand Collaboration Scraper](https://apify.com/apify/brand-collaboration-scraper): find brand and influencer collaborations across Instagram
> - 💬 [Export Instagram Comments and Posts](https://apify.com/apify/export-instagram-comments-posts): scrape posts and their comments in one run

### How much will scraping Instagram cost?

Instagram Scraper uses a **pay-per-event (PPE)** pricing model, where one result equals one scraped item (a post, reel, comment, profile, hashtag, or place). On the Free plan, it costs **$2.70 per 1,000 results**, with no discount applied.

Paid plans offer discounted rates and higher monthly credit. For example, the Starter plan charges $2.30 per 1,000 results, which allows you to **scrape over 8,200 results per month**. The Scale and Business plans reduce the price to **$1.90 with 104,700 results per month**, and **$1.50 with 666,000 results per month**, respectively. Check the [pricing tab](https://apify.com/apify/instagram-scraper/pricing) for full details.

### How do I use Instagram Scraper?

Instagram Scraper was designed to be easy to start with, even if you've never scraped a website before. Here's how to extract Instagram data with this tool:

1. [Create](https://console.apify.com/sign-up) a free Apify account using your email.
2. Open **[Instagram Scraper](https://console.apify.com/actors/shu8hvrXbJbY3Eb9W)** in Apify Console.
3. Pick what you want to scrape under **Content to scrape**: Posts, Reels, Comments, Mentions, or Details for profiles, hashtags, or places.
4. Paste one or more **Instagram URLs** matching that content type.
5. Set how many results you want per URL under **Results limit**, and optionally filter by date.
6. Alternatively, run a **search query**. Enter one or more keywords and pick a search type: hashtag, profile, or place.
7. Click **Save & Start** and wait for the data to be extracted.
8. Download your dataset in **JSON, CSV, Excel, or XML**, or pull it programmatically via the Apify API.

For a step-by-step walkthrough with screenshots, follow our [How to scrape Instagram tutorial](https://blog.apify.com/scrape-instagram-posts-comments-and-more-21d05506aeb3/) 📝, or watch this video guide:

https://www.youtube.com/watch?v=hz9tSv3CP6k

### ⬇️ Input

Instagram Scraper has two input modes: **scrape by URL** when you already know which pages to scrape, or **discover by search query** when you don't. Pick one mode per run; you can't mix them, and URLs always take priority if both are filled in.

#### Mode 1: Scrape by URL

- Paste one or more Instagram URLs (or profile IDs). Use **Bulk edit** to add many at once. Then choose:
- **Content to scrape** — the result type (posts, reels, comments, mentions, or details)
- **Results limit** — how many results per URL
- **Filter by date** (optional) — only return content newer than a date or relative period (UTC)

<a href="https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/input"><img src="https://raw.githubusercontent.com/apify-projects/actor-readme-images/39819ad7d7f8b81c2a313376237be123b1b1e22b/Screenshot%202026-06-23%20at%2010.26.43.png" style="width:100%;"></a>

The URL type drives what's returned:

| Paste this URL            | And you can get                                    |
| ------------------------- | -------------------------------------------------- |
| Profile URL or Profile ID | Profile details, posts, reels, or profile mentions |
| Post URL or Reel URL      | Post/reel details or its comments                  |
| Hashtag URL               | Hashtagged posts or reels, or hashtag volume       |
| Location URL              | Place details                                      |

#### Mode 2: Discover by search query

Enter one or more keywords (comma-separated, e.g. `travel, fitness`) and pick a search type. Enter hashtags as plaintext (`travel`, not `#travel`).

<a href="https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/input"><img src="https://raw.githubusercontent.com/apify-projects/actor-readme-images/2e60e8b7c6c0221034bc36194be507b3cffdcab6/Screenshot%202026-06-23%20at%2010.27.02.png" style="width:100%;"></a>

| Search type | What it returns                                         |
| ----------- | ------------------------------------------------------- |
| `hashtag`   | Hashtag volume and related hashtags matching your query |
| `place`     | Tagged places and small businesses matching your query  |
| `user`      | Users (and content from users) matching your query      |

### ⬆️ Output and setup

<a href="https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/input"><img src="https://raw.githubusercontent.com/apify-projects/actor-readme-images/6026a46967b559d744283728b81ef1b86e76e0fc/What%20URL%20to%20input.jpg" style="width:100%;"></a>

The most important thing to know is that **URL type drives output schema.** Hashtag, location, and explore URLs return their respective metadata even when paired with another content mode.

Results land in a dataset in the **Storage** tab. View as a table, download in **JSON, CSV, Excel, or XML**, or pull via API. Note that different outputs cannot be combined in a single run. Each content type produces a different output schema. Samples below.

<a href="https://console.apify.com/actors/shu8hvrXbJbY3Eb9W/input"><img src="https://raw.githubusercontent.com/apify-projects/actor-readme-images/afcc6b03302916d82e5d3d53671acbb15187905c/Instagram%20Scraper_output%20data.png" style="width:100%;"></a>

#### 📸 Posts and carousels

Posts and carousels from a profile, hashtag, or place. Note: you can extract posts from a known list of profiles, or you can discover posts by hashtags and places.

**Supported URL inputs:**

- `https://www.instagram.com/natgeo/` (profile)
- `https://www.instagram.com/197622247/` (profile ID)
- `https://www.instagram.com/p/DLNsnpUTdVS/` (post)
- `https://www.instagram.com/explore/tags/crossfit/` (hashtag)
- `https://www.instagram.com/explore/locations/7538318/copenhagen/` (place)

**Posts data sample**

```json
{
    "inputUrl": "https://www.instagram.com/p/DZxvMgyH8yR/",
    "id": "3923124318436838545",
    "type": "Image",
    "shortCode": "DZxvMgyH8yR",
    "caption": "In the Democratic Republic of the Congo, photographer @carstenpeter followed a team of scientists into the crater of Mount Nyiragongo, where they crossed the cooled surface of a lava lake that reached nearly 1,800°F (982°C). In 2021, an eruption sent a river of lava to the outskirts of nearby Goma, home to 1.5 million people.\n\nHead to the link in bio to uncover more iconic stories and images like this in our Nat Geo archive.",
    "hashtags": [],
    "mentions": ["carstenpeter"],
    "url": "https://www.instagram.com/p/DZxvMgyH8yR/",
    "commentsCount": 110,
    "firstComment": "runnin up that hill",
    "latestComments": [
        {
            "id": "18185100808388160",
            "text": "runnin up that hill",
            "ownerUsername": "liljuliff",
            "timestamp": "2026-06-22T08:05:38.000Z",
            "likesCount": 1
        },
        {
            "id": "18107281966978531",
            "text": "is bro in creative mode",
            "ownerUsername": "csukitch",
            "timestamp": "2026-06-22T07:57:01.000Z",
            "likesCount": 0
        }
    ],
    "dimensionsHeight": 718,
    "dimensionsWidth": 1080,
    "displayUrl": "https://scontent.cdninstagram.com/.../722859170_n.jpg",
    "images": [],
    "alt": null,
    "likesCount": 55952,
    "timestamp": "2026-06-20T10:00:04.000Z",
    "childPosts": [],
    "ownerFullName": "National Geographic",
    "ownerUsername": "natgeo",
    "ownerId": "787132",
    "isCommentsDisabled": false
}
```

#### 🎞️ Reels

Reels from a profile, hashtag, or reel page. Note: you can extract reels from a known list of profiles, or you can discover reels by hashtags and places.

**Supported URL inputs:**

- `https://www.instagram.com/natgeo/` (profile)
- `https://www.instagram.com/humansofny/reels/` (reels section)
- `https://www.instagram.com/reel/CigMSGeD4Hd/` (single reel)
- `https://www.instagram.com/reels/CigMSGeD4Hd/` (plural form)
- `https://www.instagram.com/explore/tags/crossfit/` (hashtag)

**Or a search query:**

- `searchType: "hashtag"`, e.g. `"travel"` or `"travel, fitness"`

**Reels data sample**

```json
{
    "id": "3913028191006298064",
    "type": "Video",
    "shortCode": "DZN3mhZBQ_Q",
    "caption": "The universe is full of clues hidden in light, and Webb has tools to find them.\n\nIn this video, learn about some of the most exciting discoveries Webb has made through spectroscopy, from mapping carbon dioxide on Jupiter's moon Europa, to characterizing the earliest known galaxies, to measuring cloud cover on a distant exoplanet.",
    "hashtags": [],
    "mentions": [],
    "url": "https://www.instagram.com/p/DZN3mhZBQ_Q/",
    "commentsCount": 92,
    "dimensionsHeight": 1920,
    "dimensionsWidth": 1080,
    "images": ["https://scontent.cdninstagram.com/.../715570175_n.jpg"],
    "videoUrl": "https://scontent.cdninstagram.com/.../AQNAWZ3Z8McL43Do9rcY6i8PMk.mp4",
    "likesCount": 11481,
    "timestamp": "2026-06-05T19:58:30.000Z",
    "ownerFullName": "NASA Webb Telescope",
    "ownerUsername": "nasawebb",
    "ownerId": "549313808",
    "isPinned": true,
    "productType": "clips",
    "videoDuration": 228,
    "inputUrl": "https://www.instagram.com/nasawebb/reels/",
    "firstComment": "hi :)",
    "latestComments": [
        {
            "id": "18103001009006012",
            "text": "hi :)",
            "ownerUsername": "lina.mov1",
            "timestamp": "2026-06-18T06:36:30.000Z",
            "likesCount": 1
        }
    ],
    "displayUrl": "https://scontent.cdninstagram.com/.../715570175_n.jpg",
    "audioUrl": "https://scontent.cdninstagram.com/.../AQPKnYITuQNYL1nTDTxgShU8ZT.mp4",
    "alt": null,
    "videoViewCount": 41365,
    "videoPlayCount": 241820,
    "childPosts": [],
    "musicInfo": {
        "artist_name": "nasawebb",
        "song_name": "Original audio",
        "uses_original_audio": true,
        "should_mute_audio": false,
        "should_mute_audio_reason": "",
        "audio_id": "27237433435884969"
    },
    "isCommentsDisabled": false
}
```

#### 💬 Comments

Comments from a single post or reel. **Search queries are not supported for comments**; only direct post or reel URLs.

**Supported URL inputs:**

- `https://www.instagram.com/p/DN8-GjPkgjS/` (post, shortCode)
- `https://www.instagram.com/p/3369450800358839406/` (post, ID)
- `https://www.instagram.com/reel/CigMSGeD4Hd/` (reel, shortCode)
- `https://www.instagram.com/reel/3515099125383817606/` (reel, ID)

**Comments data sample**

```json
{
  "postUrl": "https://www.instagram.com/p/DZ5T2XPllXv/",
  "commentUrl": "https://www.instagram.com/p/DZ5T2XPllXv/c/18093536360613690",
  "id": "18093536360613690",
  "text": "We love you NASA 💙🌎🌊",
  "ownerUsername": "mavideniz5521__",
  "ownerProfilePicUrl": "https://scontent-ord5-3.cdninstagram.com/v/t51.2885-19/410567170_365154746196531_3259133934415110146_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=107&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=9sOZurNh10wQ7kNvwH2lslG&_nc_oc=Adq1_pie8-u-2EtJYEl_qHGdbHVPEViwwdaNVTeRuVtcy0yVD-YcEBgzf7WOYwalh7E&_nc_zt=24&_nc_ht=scontent-ord5-3.cdninstagram.com&_nc_ss=7ca8c&oh=00_Af_b-N0KUNf3uoWohP_2OjEfMwIGWeIIz9ADUutHKCs-Bg&oe=6A42E2E1",
  "timestamp": "2026-06-22T17:24:20.000Z",
  "repliesCount": null,
  "replies": null,
  "likesCount": 4,
  "owner": {
    "username": "mavideniz5521__",
    "profile_pic_url": "https://scontent-ord5-3.cdninstagram.com/v/t51.2885-19/410567170_365154746196531_3259133934415110146_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=107&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=9sOZurNh10wQ7kNvwH2lslG&_nc_oc=Adq1_pie8-u-2EtJYEl_qHGdbHVPEViwwdaNVTeRuVtcy0yVD-YcEBgzf7WOYwalh7E&_nc_zt=24&_nc_ht=scontent-ord5-3.cdninstagram.com&_nc_ss=7ca8c&oh=00_Af_b-N0KUNf3uoWohP_2OjEfMwIGWeIIz9ADUutHKCs-Bg&oe=6A42E2E1",
    "is_verified": false,
    "id": "51071346237",
    "fbid_v2": "17841450947133918",
    "full_name": null,
    "is_mentionable": null,
    "is_private": null,
    "profile_pic_id": null,
    "latest_reel_media": null
  }
},
{
  "postUrl": "https://www.instagram.com/p/DZ5T2XPllXv/",
  "commentUrl": "https://www.instagram.com/p/DZ5T2XPllXv/c/18077796728279537",
  "id": "18077796728279537",
  "text": "",
  "ownerUsername": "_.chun_chun_maru._",
  "ownerProfilePicUrl": "https://scontent-ord5-3.cdninstagram.com/v/t51.82787-19/726890359_18104011688095194_4173193513048581478_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=110&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=931kF_84KW0Q7kNvwHbqKVS&_nc_oc=AdozP0GFEU6uuF4FSGkA2UDIP66AFkSTgAkYspRYNcO-UkG5TPcuJOey5PziWM8LT5s&_nc_zt=24&_nc_ht=scontent-ord5-3.cdninstagram.com&_nc_gid=WLZ1_bwBtUL2keja-Fk0pQ&_nc_ss=7ca8c&oh=00_Af-A4YjociKUQQgaHfcRx9rGPnqDu-SfoZPcF39IufFARA&oe=6A42EBDB",
  "timestamp": "2026-06-22T17:23:24.000Z",
  "repliesCount": null,
  "replies": null,
  "likesCount": 220,
  "owner": {
    "username": "_.chun_chun_maru._",
    "profile_pic_url": "https://scontent-ord5-3.cdninstagram.com/v/t51.82787-19/726890359_18104011688095194_4173193513048581478_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=110&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=931kF_84KW0Q7kNvwHbqKVS&_nc_oc=AdozP0GFEU6uuF4FSGkA2UDIP66AFkSTgAkYspRYNcO-UkG5TPcuJOey5PziWM8LT5s&_nc_zt=24&_nc_ht=scontent-ord5-3.cdninstagram.com&_nc_gid=WLZ1_bwBtUL2keja-Fk0pQ&_nc_ss=7ca8c&oh=00_Af-A4YjociKUQQgaHfcRx9rGPnqDu-SfoZPcF39IufFARA&oe=6A42EBDB",
    "is_verified": false,
    "id": "32824791193",
    "fbid_v2": "17841432855813098",
    "full_name": null,
    "is_mentionable": null,
    "is_private": null,
    "profile_pic_id": null,
    "latest_reel_media": null
  },
  "media": {
    "first_party_cdn_proxied_images": {
      "fixed_height": {
        "url": "https://cdn.fbsbx.com/v/t59.2708-21/540281769_1516894573012379_4776510866004392932_n.gif?_nc_cat=101&ccb=1-7&_nc_sid=9dcd69&_nc_ohc=iFOxjs_ckzoQ7kNvwEQgcdT&_nc_oc=AdqKXbOItAjaB9JcMhqx7MtzZOYpbYGT9SPmNuZg_VADfaE-CxwSLGtgXMkMJt3ahZc&_nc_zt=7&_nc_ht=cdn.fbsbx.com&_nc_gid=WLZ1_bwBtUL2keja-Fk0pQ&_nc_ss=7ca8c&oh=03_Q7cD5gH7HrMkFlEK3VsYFNCeWhC8U-5B14403q6m_ejHgqPJWw&oe=6A3EE756"
      }
    },
    "images": {
      "fixed_height": {
        "url": "https://static.cdninstagram.com/rsrc.php/v4/yr/r/xg_5YoVlvjp.gif"
      }
    },
    "id": "1570703541415172"
  }
},
{
  "postUrl": "https://www.instagram.com/p/DZ5T2XPllXv/",
  "commentUrl": "https://www.instagram.com/p/DZ5T2XPllXv/c/18119325979762265",
  "id": "18119325979762265",
  "text": "Anda el diablo, 😂😂",
  "ownerUsername": "mr_ventura.j",
  "ownerProfilePicUrl": "https://scontent-ord5-2.cdninstagram.com/v/t51.2885-19/482946673_610886311778265_2668206524915634709_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=104&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy44MjguQzMifQ%3D%3D&_nc_ohc=FIVuIcZTqkQQ7kNvwGW3APs&_nc_oc=AdrhdG57pw80dCHmaTX-MRdvfLX5iYJJ8oPnsao0wFImBqMfQn7RGFOY_shbwu7YrFI&_nc_zt=24&_nc_ht=scontent-ord5-2.cdninstagram.com&_nc_ss=7ca8c&oh=00_Af8niwMDCab4KfDLxkew8K3RP6dtHNLKaB4XWb7LQFvacw&oe=6A430456",
  "timestamp": "2026-06-22T17:21:43.000Z",
  "repliesCount": null,
  "replies": null,
  "likesCount": 3,
  "owner": {
    "username": "mr_ventura.j",
    "profile_pic_url": "https://scontent-ord5-2.cdninstagram.com/v/t51.2885-19/482946673_610886311778265_2668206524915634709_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=104&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy44MjguQzMifQ%3D%3D&_nc_ohc=FIVuIcZTqkQQ7kNvwGW3APs&_nc_oc=AdrhdG57pw80dCHmaTX-MRdvfLX5iYJJ8oPnsao0wFImBqMfQn7RGFOY_shbwu7YrFI&_nc_zt=24&_nc_ht=scontent-ord5-2.cdninstagram.com&_nc_ss=7ca8c&oh=00_Af8niwMDCab4KfDLxkew8K3RP6dtHNLKaB4XWb7LQFvacw&oe=6A430456",
    "is_verified": false,
    "id": "4298523042",
    "fbid_v2": "17841404171287315",
    "full_name": null,
    "is_mentionable": null,
    "is_private": null,
    "profile_pic_id": null,
    "latest_reel_media": null
  }
},
{
  "postUrl": "https://www.instagram.com/p/DZ5T2XPllXv/",
  "commentUrl": "https://www.instagram.com/p/DZ5T2XPllXv/c/18080756183267307",
  "id": "18080756183267307",
  "text": "Infinite space and yet we don’t know half of our ocean. Stop wasting resources for wondrous shit",
  "ownerUsername": "idlehandsoraidolshands",
  "ownerProfilePicUrl": "https://scontent-ord5-1.cdninstagram.com/v/t51.82787-19/589085310_18161660818396753_1518200406298839070_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=111&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=d00l4vlIpGgQ7kNvwEBivSj&_nc_oc=AdozkM1zr_i2jPZsH2WSUT1OLakC7nzhCKKuD0_E7z9muVqYIAoAS_D-cPoPdPT9yTs&_nc_zt=24&_nc_ht=scontent-ord5-1.cdninstagram.com&_nc_gid=WLZ1_bwBtUL2keja-Fk0pQ&_nc_ss=7ca8c&oh=00_Af-kGNEr1yj0T3kYro6HAF02e-2djfXgIZhezmZaJqxM3w&oe=6A42F8B1",
  "timestamp": "2026-06-22T17:21:19.000Z",
  "repliesCount": null,
  "replies": null,
  "likesCount": 1,
  "owner": {
    "username": "idlehandsoraidolshands",
    "profile_pic_url": "https://scontent-ord5-1.cdninstagram.com/v/t51.82787-19/589085310_18161660818396753_1518200406298839070_n.jpg?stp=dst-jpg_s150x150_tt6&_nc_cat=111&ccb=7-5&_nc_sid=f7ccc5&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLnd3dy4xMDgwLkMzIn0%3D&_nc_ohc=d00l4vlIpGgQ7kNvwEBivSj&_nc_oc=AdozkM1zr_i2jPZsH2WSUT1OLakC7nzhCKKuD0_E7z9muVqYIAoAS_D-cPoPdPT9yTs&_nc_zt=24&_nc_ht=scontent-ord5-1.cdninstagram.com&_nc_gid=WLZ1_bwBtUL2keja-Fk0pQ&_nc_ss=7ca8c&oh=00_Af-kGNEr1yj0T3kYro6HAF02e-2djfXgIZhezmZaJqxM3w&oe=6A42F8B1",
    "is_verified": false,
    "id": "11823308752",
    "fbid_v2": "17841411902567913",
    "full_name": null,
    "is_mentionable": null,
    "is_private": null,
    "profile_pic_id": null,
    "latest_reel_media": null
  }
```

#### 👤 Profile details

Profile metadata: bio, followers, posts count, verified status.

**Supported URL inputs:**

- `https://www.instagram.com/nike/` (username)
- `https://www.instagram.com/13460080/` (profile ID)
- `https://www.instagram.com/humansofny/reels/` (reels section)

**Profile data sample**

```json
{
    "inputUrl": "https://www.instagram.com/humansofny/",
    "id": "242598499",
    "username": "humansofny",
    "url": "https://www.instagram.com/humansofny",
    "fullName": "Humans of New York",
    "biography": "New York City, one story at a time.\nCreated by Brandon Stanton\nDear New York available wherever books are sold.",
    "externalUrls": [
        {
            "title": "Join HONY's Patreon",
            "url": "https://bit.ly/4tX4uZt",
            "link_type": "external"
        }
    ],
    "externalUrl": "https://bit.ly/4tX4uZt",
    "followersCount": 12613771,
    "followsCount": 738,
    "highlightReelCount": 1,
    "isBusinessAccount": false,
    "joinedRecently": false,
    "businessCategoryName": null,
    "private": false,
    "verified": true,
    "profilePicUrl": "https://scontent.cdninstagram.com/.../488057622_n.jpg",
    "profilePicUrlHD": "https://scontent.cdninstagram.com/.../488057622_n.jpg",
    "igtvVideoCount": 0,
    "postsCount": 5863,
    "fbid": "17841401154973790",
    "latestPosts": [
        {
            "id": "3741054891297971261",
            "type": "Video",
            "shortCode": "DPq5ZpJDZw9",
            "caption": "Dear New York closes on October 19th. It's been the honor and joy of my life to see this take flight...",
            "hashtags": [],
            "mentions": [],
            "url": "https://www.instagram.com/p/DPq5ZpJDZw9/",
            "commentsCount": 942,
            "dimensionsHeight": 1136,
            "dimensionsWidth": 640,
            "displayUrl": "https://scontent.cdninstagram.com/.../562558918_n.jpg",
            "videoUrl": "https://scontent.cdninstagram.com/.../AQOZS_IaHCgcUdg7VqoJnQrUb7g.mp4",
            "likesCount": 106869,
            "videoViewCount": 1024817,
            "timestamp": "2025-10-11T13:27:07.000Z",
            "ownerUsername": "humansofny",
            "ownerId": "242598499",
            "productType": "clips",
            "isPinned": true,
            "isCommentsDisabled": false
        }
    ]
}
```

#### 📍 Place details

Location metadata: name, coordinates, category, post count.

**Supported URL inputs:**

- `https://www.instagram.com/explore/locations/7538318/copenhagen/` (with slug)
- `https://www.instagram.com/explore/locations/7538318/` (ID only)

**Place details sample**

```json
{
    "inputUrl": "https://www.instagram.com/explore/locations/218622660/lucerna-music-bar/",
    "name": "Lucerna Music Bar",
    "phone": "",
    "category": "Live Music Venue",
    "media_count": 41997,
    "price_range": 0,
    "lat": 50.081113650673,
    "lng": 14.425622825572,
    "slug": "lucerna-music-bar",
    "location_id": "218622660",
    "location_address": "Vodičkova 36",
    "location_city": "",
    "location_zip": "110 00",
    "ig_business": {
        "profile": {
            "profile_pic_url": "https://scontent.cdninstagram.com/.../711514083_n.jpg",
            "username": "lucernamusicbar",
            "id": "571745390"
        }
    },
    "posts": [
        {
            "code": "DOyoz3eDwda",
            "id": "3725219327902680922_2428242588",
            "taken_at": 1758300771,
            "product_type": "carousel_container",
            "username": "rikafiorentina_ride",
            "caption": "getting ready for #ridePRG #INTERPLAYeurope2025\n3 May 2025\nLucerna Music Bar, Prague 🇨🇿\n#rikafiorentina_ride",
            "like_count": 1,
            "comment_count": 0,
            "location": "Lucerna Music Bar",
            "carousel_media": [
                "https://scontent.cdninstagram.com/.../551088079_n.jpg",
                "https://scontent.cdninstagram.com/.../550191647_n.jpg",
                "https://scontent.cdninstagram.com/.../551959801_n.jpg"
            ]
        }
    ],
    "hours": {
        "status": ""
    }
}
```

#### 🏷️ Mentions

Posts where a profile is tagged. Requires a known profile URL or ID.

**Supported URL inputs:**

- `https://www.instagram.com/nike/` (profile)
- `https://www.instagram.com/197622247/` (profile ID)
- `https://www.instagram.com/humansofny/reels/` (profile reels section)

**Mentions data sample**

```json
{
    "inputUrl": "https://www.instagram.com/humansofny/reels/",
    "id": "3924787795441061311",
    "type": "Sidecar",
    "shortCode": "DZ3pbSeDY2_",
    "caption": "Infinitely grateful to the @humansofny community for helping @stephen_james_campbell start his new life...",
    "hashtags": ["gratefulthankfulblessed", "summersolsticeblessings"],
    "mentions": ["humansofny", "stephen_james_campbell"],
    "url": "https://www.instagram.com/p/DZ3pbSeDY2_/",
    "commentsCount": 1,
    "likesCount": 14,
    "videoPlayCount": 0,
    "timestamp": "2026-06-22T01:19:46.000Z",
    "displayUrl": "https://scontent.cdninstagram.com/.../730022154_n.jpg",
    "carouselImageCount": 20,
    "carouselImages": [
        "https://scontent.cdninstagram.com/.../730022154_n.jpg",
        "https://scontent.cdninstagram.com/.../730083595_n.jpg",
        "https://scontent.cdninstagram.com/.../729128221_n.jpg"
    ],
    "ownerFullName": "Jordan Moody",
    "ownerUsername": "dexawild",
    "ownerId": "6521170568",
    "productType": "carousel_container",
    "taggedUsers": ["humansofny", "stephen_james_campbell"],
    "music": { "title": "Follow The Sun", "artist": "Xavier Rudd" }
}
```

#### #️⃣ Hashtag details

Hashtag metadata: name, post count, related tags, reach tiers.

**Supported URL input:**

- `https://www.instagram.com/explore/tags/crossfit/` (hashtag)

**Hashtag details sample**

```json
{
    "searchSource": "instagram",
    "name": "fathersday",
    "postsCount": 21310000,
    "url": "https://www.instagram.com/explore/tags/fathersday",
    "id": "fathersday",
    "posts": "21.31 M",
    "postsPerDay": "—",
    "difficulty": "",
    "related": [
        { "hash": "#giftideas", "info": "51.58 m" },
        { "hash": "#gifts", "info": "45.95 m" },
        { "hash": "#mothersday", "info": "41.33 m" },
        { "hash": "#anniversary", "info": "30.9 m" },
        { "hash": "#happymothersday", "info": "16.07 m" },
        { "hash": "#giftsforher", "info": "12.35 m" },
        { "hash": "#birthdaygift", "info": "10.44 m" },
        { "hash": "#happyfathersday", "info": "10.14 m" },
        { "hash": "#giftsforhim", "info": "6.48 m" }
    ],
    "frequent": [
        { "hash": "#fathersday", "info": "21.31 m" },
        { "hash": "#happyfathersday", "info": "10.14 m" },
        { "hash": "#fathersdaygifts", "info": "2.25 m" },
        { "hash": "#fathersdaygift", "info": "1.01 m" }
    ],
    "average": [{ "hash": "#fathersdaygiftideas", "info": "529.04 k" }],
    "rare": [{ "hash": "#fathersdaycard", "info": "93.89 k" }],
    "relatedFrequent": [
        { "hash": "#love", "info": "2.15 g" },
        { "hash": "#dad", "info": "28.71 m" },
        { "hash": "#family", "info": "475.12 m" },
        { "hash": "#mothersday", "info": "41.33 m" },
        { "hash": "#daddy", "info": "18.72 m" },
        { "hash": "#instagood", "info": "2.02 g" },
        { "hash": "#gift", "info": "91.25 m" },
        { "hash": "#birthday", "info": "177.31 m" },
        { "hash": "#giftideas", "info": "51.58 m" }
    ],
    "relatedAverage": [{ "hash": "#vatertag", "info": "656.9 k" }],
    "relatedRare": [{ "hash": "#dietsantai", "info": "42.03 k" }]
}
```

#### 💈 Place search

Discover Instagram places by keyword. Useful for small business discovery: the search query works best when it combines a city and a local business type, e.g. `vintage shop copenhagen`.

**Search query format:**

- Set `searchType` to `"place"`
- Set `search` to one or more keywords (comma-separated for multiple)

**Place search data sample**

```json
[
    {
        "searchTerm": "vintage shop copenhagen",
        "searchSource": "google",
        "inputUrl": "https://www.instagram.com/explore/locations/1016004479/fn92/",
        "name": "FN92",
        "phone": "+45 22 48 56 86",
        "category": "Clothing store",
        "media_count": 9,
        "price_range": 3,
        "lat": 55.71375,
        "lng": 12.56804,
        "slug": "fn92",
        "location_id": "1016004479",
        "location_address": "Bryggervangen 76",
        "location_city": "",
        "location_zip": "2100",
        "ig_business": { "profile": null },
        "hours": { "status": "" }
    },
    {
        "searchTerm": "vintage shop copenhagen",
        "searchSource": "google",
        "inputUrl": "https://www.instagram.com/explore/locations/334251990081960/jerome-vintage/",
        "name": "JEROME VINTAGE",
        "phone": "",
        "category": "Vintage Store",
        "media_count": 582,
        "price_range": 0,
        "lat": 55.67437,
        "lng": 12.54993,
        "slug": "jerome-vintage",
        "location_id": "334251990081960",
        "location_address": "Vesterbrogade 36",
        "location_city": "",
        "location_zip": "1620",
        "ig_business": {
            "profile": {
                "profile_pic_url": "https://scontent.cdninstagram.com/.../350941664_n.jpg",
                "username": "jerome_vintage",
                "id": "1401828165"
            }
        },
        "hours": { "status": "Closed" }
    },
    {
        "searchTerm": "vintage shop copenhagen",
        "searchSource": "google",
        "inputUrl": "https://www.instagram.com/explore/locations/318767455/robb-copenhagen-shop/",
        "name": "Robb Copenhagen (Shop)",
        "phone": "",
        "category": "Local business",
        "media_count": 100,
        "price_range": 0,
        "lat": 55.67264,
        "lng": 12.55788,
        "slug": "robb-copenhagen-shop",
        "location_id": "318767455",
        "location_address": "Vesterbrogade 35",
        "location_city": "",
        "location_zip": "1654",
        "ig_business": { "profile": null },
        "posts": [
            {
                "code": "vqBeQcAJg5",
                "id": "858505156247984185_506605037",
                "taken_at": 1416561811,
                "product_type": "feed",
                "username": "robbcopenhagen",
                "caption": "A few vintage BARBAR left // perfect gift 250,- remember we ship to other countries as well 🐘🐘 #robbcopenhagen #fashion #store #vesterbrogade35 #babarbar #vintage @robbcopenhagen",
                "like_count": 4,
                "comment_count": 0,
                "location": "Robb Copenhagen (Shop)",
                "image": "https://scontent.cdninstagram.com/.../632287548_n.jpg"
            }
        ],
        "hours": { "status": "" }
    }
]
```

#### 👥 Profile search

Discover Instagram profiles by keyword. Returns matching users along with their recent posts.

**Search query format:**

- Set `searchType` to `"profile"`
- Set `search` to one or more keywords, e.g. `"nike"` or `"nike, adidas"` (comma-separated for multiple)

**Profile search data sample**

```json
[
    {
        "id": "3924506097334912938",
        "shortCode": "DZ2pYCqgIeq",
        "type": "Sidecar",
        "ownerUsername": "nikesportswear",
        "ownerFullName": "Nike Sportswear",
        "caption": "Bring the love.\n\n@arynasabalenka on set with Nike Court.\n\nAll Love collection available June 22.",
        "url": "https://www.instagram.com/p/DZ2pYCqgIeq/",
        "likesCount": 39779,
        "commentsCount": 135,
        "timestamp": "2026-06-21T16:00:05.000Z",
        "taggedUsers": ["arynasabalenka"],
        "carouselImageCount": 5,
        "images": [
            "https://scontent.cdninstagram.com/.../729869204_n.jpg",
            "https://scontent.cdninstagram.com/.../729359762_n.jpg"
        ]
    },
    {
        "id": "3925170511466021648",
        "shortCode": "DZ5AciixUMQ",
        "type": "Video",
        "ownerUsername": "nike",
        "caption": "Time for liftoff @erling and @channingtatum",
        "url": "https://www.instagram.com/p/DZ5AciixUMQ/",
        "likesCount": 10720,
        "commentsCount": 64,
        "videoViewCount": 83809,
        "videoPlayCount": 506507,
        "videoDuration": 44.75,
        "timestamp": "2026-06-22T14:01:05.000Z",
        "taggedUsers": ["nikefootball", "erling", "channingtatum"],
        "displayUrl": "https://scontent.cdninstagram.com/.../729747056_n.jpg",
        "videoUrl": "https://scontent.cdninstagram.com/.../AQPNH7ACF2tBTf.mp4",
        "music": "Original audio - nike"
    },
    {
        "id": "3912183471120209303",
        "shortCode": "DZK3iOsRlWX",
        "type": "Video",
        "ownerUsername": "nike",
        "caption": "It was all going to plan until instincts took over…\n\nRip The Script",
        "url": "https://www.instagram.com/p/DZK3iOsRlWX/",
        "likesCount": 2487337,
        "commentsCount": 54939,
        "videoViewCount": 14401109,
        "videoPlayCount": 59671075,
        "videoDuration": 359.75,
        "timestamp": "2026-06-04T15:59:27.000Z",
        "isPinned": true,
        "taggedUsers": ["nikefootball"],
        "displayUrl": "https://scontent.cdninstagram.com/.../717154541_n.jpg",
        "videoUrl": "https://scontent.cdninstagram.com/.../AQNKUhlPLvsO.mp4",
        "music": "Original audio - nike"
    }
]
```

#### 👁️ Hashtag search

Discover related hashtags by keyword. Useful for finding adjacent or less-saturated tags around a topic.

**Search query format:**

- Set `searchType` to `"hashtag"`
- Set `search` to one or more keywords, e.g. `"travel"` or `"travel, fitness"` (comma-separated for multiple)

**Hashtag search data sample**

```json
[
    {
        "searchTerm": "fathersday",
        "searchSource": "google",
        "name": "raddad",
        "postsCount": 0,
        "url": "https://www.instagram.com/explore/tags/raddad",
        "id": "raddad"
    },
    {
        "searchTerm": "fathersday",
        "searchSource": "google",
        "name": "campdads",
        "postsCount": 117,
        "url": "https://www.instagram.com/explore/tags/campdads",
        "id": "campdads",
        "posts": "117",
        "postsPerDay": "—",
        "difficulty": "",
        "related": [],
        "average": [],
        "rare": []
    },
    {
        "searchTerm": "fathersday",
        "searchSource": "google",
        "name": "happyfather",
        "postsCount": 25209000,
        "url": "https://www.instagram.com/explore/tags/happyfather",
        "id": "happyfather",
        "posts": "252.09 K",
        "postsPerDay": "—",
        "difficulty": "",
        "related": [{ "hash": "#happyfathersday", "info": "10.14 m" }],
        "average": [{ "hash": "#happyfatherday", "info": "283.05 k" }],
        "rare": [{ "hash": "#happyfathersdaydad", "info": "59.63 k" }],
        "relatedFrequent": [
            { "hash": "#happy", "info": "737.91 m" },
            { "hash": "#father", "info": "46.02 m" },
            { "hash": "#love", "info": "2.15 g" }
        ],
        "relatedAverage": [{ "hash": "#dadsday", "info": "386.01 k" }],
        "relatedRare": [{ "hash": "#holidayphoto", "info": "74.76 k" }]
    }
]
```

### Features only in the specialized scrapers

Some features are only in the specialized Instagram scrapers. Use these Actors if you need them:

- [Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper): reels from an audio URL (`instagram.com/reels/audio/...`), the shares count, transcripts, and downloaded videos.
- [Instagram Post Scraper](https://apify.com/apify/instagram-post-scraper): the `Basic data` mode, which skips the extra charge for detailed post data.
- [Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper): the "About this account" information, such as the date the account joined and its country.
- [Instagram Hashtag Analytics Scraper](https://apify.com/apify/instagram-hashtag-analytics-scraper): a sample of top and recent posts for each hashtag, next to the hashtag stats.
- [Instagram Followers and Following Scraper](https://apify.com/apify/instagram-followers-following-scraper): the followers and following lists of an account.

### Notes and exceptions

- **URL type drives output schema.** Hashtag, location, and explore URLs return their respective metadata even when paired with another content mode.
- **URLs take priority over search queries**; they can't be combined.
- Multiple search words are allowed; you just need to comma-separate them.
- **Profile IDs are interchangeable with usernames** anywhere a profile URL is accepted.
- **`_u` and `profilecard` segments are stripped automatically**, so `instagram.com/_u/natgeo/profilecard/` works as a profile URL.
- **Story URLs** (`instagram.com/stories/emiliavizcarra/`) are reduced to the username before scraping.
- **Share URLs** (`instagram.com/share/BAC6cDeb_-`) are resolved to the canonical post URL via a redirect.
- **Location URLs accept the ID alone**, without the trailing slug: `instagram.com/explore/locations/7538318/` is valid.
- Date filters use **UTC**.
- **Not supported:** numeric post IDs in URL form (`instagram.com/p/3369450800358839406/`) for `posts`, `reels`, `mentions`, and `details` modes. Use the shortCode form. (This format works for `comments`.)

### What can you do with data after scraping Instagram?

Instagram Scraper is a very versatile tool that can handle hundreds of use cases. Here are a few tips on most common ways people get and interpret public Instagram data:

#### 🎯 [Influencer vetting and partnership research](https://apify.com/use-cases/influencer-vetting)

Follower count is a weak signal to find and filter influencer partnerships. Score creators on engagement quality, audience authenticity, and posting consistency instead. Here's how to find and vet Instagram creators using Instagram Scraper:

**Recipe:**

1. **Find creators in your niche.** Run `posts` or `reels` with a hashtag URL like `instagram.com/explore/tags/fitness/`. You'll get a pool of recent posts with creator usernames and engagement numbers.

2. **Profile each candidate.** Run `details` on the profile URLs (or IDs) from step 1 to pull bios, follower counts, verified status, and business category.

3. **Score real engagement.** Run `posts` or `reels` on the top 20–50 profile URLs to compare engagement rates, posting cadence, and format mix.

4. **Audit audience sentiment.** Run `comments` on the top-performing post URLs from step 3 to read actual reactions and spot bot patterns.

Re-run steps 2-3 weekly to catch follower drop-offs before signing. Send results to a creator CRM, Google Sheets, or your scoring dashboard.

#### 🔥 [Trend tracking and UGC intelligence](https://apify.com/use-cases/instagram-trends-search)

Trends move fast on Instagram, and the hashtags that drove reach last quarter rarely do today. Track what's gaining traction, which creators set the pace, and what's already saturated. Here's how to discover trends and UGC using Instagram Scraper:

**Recipe:**

1. **Monitor a target hashtag's content.** Run `posts` or `reels` with a hashtag URL like `instagram.com/explore/tags/cleanbeauty/` to see recent content under the tag and its engagement.

2. **Measure hashtag size and reach.** Run `details` on the same hashtag URL to get post count, posts-per-day, and frequent/average/rare usage buckets.

3. **Find adjacent, less-saturated tags.** Run `details` on the hashtag URL (or a hashtag search query) to surface related tags grouped by reach tier.

Daily runs for fast-moving categories (fashion, beauty, fitness). Weekly runs for steadier verticals (B2B, home, finance). Send output to trend dashboards, content planning tools, or Slack for daily digests.

#### 💯 Competition or campaign monitoring

Track what your competitors post, when they post, and how their audience reacts. The same workflow applies to monitoring your own campaigns. Here's how to track competitors, influencers, or campaigns using Instagram Scraper:

**Recipe:**

1. **Track competitor stats.** Run `details` on a competitor profile URL like `instagram.com/competitor/` to capture follower growth, bio updates, and posts count.

2. **Compare content output.** Run `posts` or `reels` on the same profile URL to see engagement rates, top-performing content, and format mix.

3. **Read audience reactions.** Run `comments` on the top competitor post URLs from step 2 to hear what their audience actually says.

4. **Map their hashtag strategy.** Run `details` on the hashtag URLs they use to see reach tier and related-tag clusters.

Run weekly. Send results to a competitive intelligence dashboard, a shared sheet, or your strategy doc.

#### 🔔 Brand monitoring and mentions

Instagram doesn't expose comments to search, which makes true real-time brand monitoring harder than on Twitter or Reddit. Combine three angles to get as close as possible. Here's how to work with brand mentions using Instagram Scraper:

**Recipe (run all three in parallel, then deduplicate):**

1. **Catch caption mentions.** Run `posts` with a search query of your brand name (set `searchType` to `"user"`) to find posts where your brand appears in the caption text.

2. **Track branded hashtag UGC.** Run `posts` or `reels` with a branded hashtag URL like `instagram.com/explore/tags/yourbrand/` to capture content from fans, customers, and creators who chose to tag you.

3. **Capture @-tag mentions.** Run `mentions` on your own profile URL like `instagram.com/yourbrand/` to find posts where your account is @-tagged.

Combine all three for the widest realistic net. Comments stay out of reach because Instagram doesn't expose comment text to search. Send results to a brand monitoring dashboard, your CRM, or Slack for daily alerts.

#### 🏙️ [Local business discovery and lead generation](https://apify.com/use-cases/local-businesses-discovery)

Many local businesses (salons, restaurants, gyms, boutiques) are active on Instagram but missing from Google Maps, Yelp, and traditional B2B lists. Here's how to find local businesses using Instagram Scraper:

**Recipe:**

1. **Discover places by category and city.** Run `details` with a search query like `vintage shop copenhagen` (set `searchType` to `"place"`) to get a list of tagged Instagram places matching your query.

2. **Get place data.** Run `details` on each place URL like `instagram.com/explore/locations/318767455/` to capture coordinates, category, post count, and the linked business profile.

3. **Enrich with profile info.** Run `details` on the linked profile URL from step 2 to pull the business's bio, follower count, contact info, and recent posts.

Use cases include market entry research, competitive mapping, hyper-local partnership prospecting, and CRM enrichment. Export to CSV or send to your CRM via API.

### Want to get other data from Instagram?

You can use the other dedicated scrapers below if you want to scrape specific Instagram data:

<table>
<tr>
<td>📷 <a href="https://apify.com/apify/instagram-post-scraper">Instagram Post Scraper</a></td>
<td>💬 <a href="https://apify.com/apify/instagram-comment-scraper">Instagram Comments Scraper</a></td>
</tr>
<tr>
<td>👤 <a href="https://apify.com/apify/instagram-profile-scraper">Instagram Profile Scraper</a></td>
<td>🎞️ <a href="https://apify.com/apify/instagram-reel-scraper">Instagram Reel Scraper</a></td>
</tr>
<tr>
<td>#️⃣ <a href="https://apify.com/apify/instagram-hashtag-scraper">Instagram Hashtag Scraper</a></td>
<td>📊 <a href="https://apify.com/apify/instagram-hashtag-analytics-scraper">Instagram Hashtag Analytics Scraper</a></td>
</tr>
<tr>
<td>🏷️ <a href="https://apify.com/apify/instagram-tagged-scraper">Instagram Mentions Scraper</a></td>
<td>👥 <a href="https://apify.com/apify/instagram-followers-count-scraper">Instagram Followers Count Scraper</a></td>
</tr>
<tr>
<td>🔎 <a href="https://apify.com/apify/instagram-search-scraper">Instagram Search Scraper</a></td>
<td>💾 <a href="https://apify.com/apify/export-instagram-comments-posts">Export Instagram Comments and Posts Tool</a></td>
</tr>
<tr>
<td>🔮 <a href="https://apify.com/apify/brand-collaboration-scraper">Instagram Influencer Collaboration Scraper</a></td>
<td>🛍️ <a href="https://apify.com/apify/facebook-ads-scraper">Instagram Ads Scraper</a></td>
</tr>
<tr>
<td>🥸 <a href="https://apify.com/apify/instagram-followers-following-scraper">Instagram Followers and Following Scraper</a></td>
</tr>
</table>

> Want Threads data too? Instagram and Threads share usernames, so the [Threads Profile Scraper](https://apify.com/apify/threads-profile-api-scraper) works the same way.

### ❓ Frequently Asked Questions

#### Can I scrape multiple content types in a single run?

No. Each run produces one content type, controlled by the **Content to scrape** parameter. To collect both posts and comments, run the Actor twice or chain runs via webhooks ot using MCP.

#### Can I combine URLs and search queries?

No. **URLs always take priority over search queries**, and they cannot be combined in the same run.

#### What's the difference between Posts, Reels, and Mentions output?

All three return media items with the same schema. The difference is which items come back: **Posts** returns the feed of a profile/hashtag/place, **Reels** filters to reel content (`productType: "clips"`), and **Mentions** returns posts where the target profile is tagged.

#### How many results can I scrape?

It depends on the content type, input, and what Instagram exposes publicly. There's no fixed cap. Open the target URL in an incognito window to see what's available to logged-out users, and test with a small run first. **Free plan users are limited to one page of comments per post (~15 comments)**; paid plans don't have this restriction.

#### Can I scrape private Instagram profiles?

In general, no, you cannot scrape private Instagram profiles with Apify Actors. However, if the private profile is **tagged as a collaborator/co-author on a post**, and at least one of the other collaborators has a public profile, Instagram treats that post as public — regardless of the target account’s own privacy setting. Because the Actor picks up whatever data Instagram’s API hands back for that profile’s content feed, those collaborative posts will get included even though the account itself is private.

#### Sometimes the scraped metrics (like, comment, and view counts) don’t match with what is shown on Instagram. Why is that?

If you compare a post or reel side by side with the Actor's output, the numbers can differ. There are two common reasons, and neither means the data is wrong.

1. The Actor sees the logged-out version of the page. The Actor scrapes public data, so it gets the same counts Instagram shows a visitor who isn't signed in. Instagram doesn't show logged-out visitors everything: engagement from private accounts, for example, is often hidden. That means the counts you see while logged into your own account can be higher than the ones the Actor returns.
   To check what the Actor should see, open the post in a private/incognito browser window. The counts there should match the Actor's output. If they do, the Actor is working correctly.

2. Counts are a snapshot from the moment of the run. Views, likes, and comments keep changing after the run finishes. A reel that returned 976 views in the morning can legitimately show 982 views when you check it in the afternoon. Always compare against the run's timestamp, not against the live page hours or days later. If the numbers still don't line up after both checks, contact support with the run ID and the post URL so we can look into it.

#### How do I exclude pinned posts?

Set `"skipPinnedPosts": true` (works with `resultsType: "posts"`). Two useful combinations:

- **Skip old pinned posts, keep recent ones:** `"skipPinnedPosts": true` + `"onlyPostsNewerThan": "1 day"` keeps pinned posts from the last day and skips older ones.
- **Scrape only pinned posts:** `"skipPinnedPosts": false` + `"onlyPostsNewerThan": "0 minutes"`.

#### How do I scrape only recent posts?

Use `"onlyPostsNewerThan"` with `resultsType: "posts"`. Accepted formats:

- Relative: `"1 day"`, `"2 months"`, `"3 years"`
- Date only: `"2024-09-05"`
- Date with time: `"2024-09-05T13:22:04"`
- Date with time in UTC: `"2024-09-05T13:22:04Z"` (the `Z` denotes UTC)
- With milliseconds: `"2024-09-05T13:22:04.123"`

Instagram applies UTC internally, so the filter compares against UTC regardless of your local timezone.

#### Can I scrape the newest comments first?

Yes. Set `"isNewestComments": true` when `resultsType: "comments"`. Free plans use the default order.

#### Can I get comment replies?

Yes, on paid plans. Set `"includeNestedComments": true` when `resultsType: "comments"`. Each reply is returned as a separate result, so the total count will exceed your `resultsLimit`.

#### Can I get extra profile statistics?

Set `"addProfileStatistics": true` when `resultsType: "details"`. This adds a `statistics` object to each profile result with fields like account type (1 = Personal, 2 = Business, 3 = Creator) and other profile-level data. Works for private profiles too.

#### Why is `likesCount` sometimes `-1`?

When a creator hides the like count on a reel or post, Instagram doesn't expose it. The scraper returns `-1` to indicate the value isn't publicly available.

#### Is it legal to scrape Instagram?

Our [social media scrapers](https://apify.com/store/collections/instagram-facebook-scrapers) only collects data that is publicly available on Instagram. It does not access private content. You should be aware that some public data may be considered personal data under regulations like the [GDPR](https://en.wikipedia.org/wiki/General_Data_Protection_Regulation). Only scrape data if you have a legitimate reason. For guidance, see our blog on [the legality of web scraping](https://blog.apify.com/is-web-scraping-legal/).

#### Can I integrate Instagram data with other services?

Yes. Scraped Instagram data can be integrated with almost any cloud service or web app. Apify supports **Zapier, n8n, Slack, Make, Airbyte, Gumloop, CrewAI, IFTTT, Lindy, GitHub, Google Sheets, Google Drive**, [and more](https://apify.com/integrations). You can also use [webhooks](https://docs.apify.com/integrations/webhooks) to trigger actions whenever a run finishes, like sending notifications or syncing datasets.

#### Can I use Instagram Scraper with the Apify API?

Yes. The Apify API provides programmatic access to run Actors, fetch datasets, monitor performance, and manage tasks. For Node.js, use the `apify-client` [NPM package](https://apify.com/apify/instagram-scraper/api/javascript). For Python, use the `apify-client` [PyPI package](https://apify.com/apify/instagram-scraper/api/python). Full API docs are available in the [Apify API reference](https://docs.apify.com/api/v2).

#### Can I get Instagram data through an MCP server?

Yes. You can [connect](https://apify.com/apify/instagram-scraper/api/mcp) to an MCP server using clients like ClaudeDesktop or LibreChat, or build your own integration. For Instagram Scraper:

1. Start a Server-Sent Events (SSE) session to receive a `sessionId`.
2. Send API messages using that `sessionId` to trigger the scraper.
3. The message starts the Instagram Scraper with the provided input.
4. The response should be: Accepted.

Learn more in the [MCP setup guide](https://blog.apify.com/how-to-use-mcp/).

#### Instagram Scraper not working?

The Apify team constantly improves Actor performance. If you find bugs or technical issues, please create an issue on the Actor's [Issues tab](https://apify.com/apify/instagram-scraper/issues/open).

# Changelog

This Actor's version history is a separate document: https://apify.com/apify/instagram-scraper/changelog.md

# Actor input Schema

## `resultsType` (type: `string`):

**Posts** returns a feed of content. **Profile, hashtag, or place details** returns metadata about the page: follower count, bio, post count, and profile picture.<br><br>Comments only work with post URLs, e.g. `instagram.com/p/ABC123xyz/` not `instagram.com/username/`.

## `directUrls` (type: `array`):

Add one or more Instagram URLs to scrape.<br><br>URL format must match your content type:<ul><li><code>/p/</code> for posts and comments</li><li><code>/reel/</code> for reels</li><li><code>/username/</code> for profile details</li></ul><br>Leave blank if using the search query instead.

## `resultsLimit` (type: `integer`):

Set how many posts or comments to scrape per Instagram URL. Higher values increase compute usage and cost.<br><br>⚠️ Free usage gets only the top 15 comments, sorted by newest, and around 21 mentions. Upgrade to <a href='https://console.apify.com/billing/subscription' target='_blank' rel='noopener'> Starter plan</a> for full access.<br><br>Use `1` to retrieve a single post per page.

## `onlyPostsNewerThan` (type: `string`):

Limit how far back to scrape. Enter a date in `YYYY-MM-DD`, ISO format, or as a relative value, e.g. `1 day`, `2 months`, `3 years`.<br><br>Times are in UTC, not local time. New York is UTC-5 in winter, UTC-4 in summer. Pinned posts may still appear even with this filter set.

## `search` (type: `string`):

Search for Instagram hashtags, profiles, or places.<br>Use `#` for hashtags, e.g. `#travel`.

## `searchType` (type: `string`):

Hashtag search returns posts tagged with that term. Profile search returns matching accounts. Place search returns matching locations.

## `searchLimit` (type: `integer`):

Set how many profiles, places, or hashtags to find.<br>To limit posts per result, use Results limit per URL.<br>Higher values increase compute usage and cost.

## `addParentData` (type: `boolean`):

This applies only to feed items. Adds a dataSource field to each result: profile posts are labeled `profile`, and tag posts are labeled `hashtag`.

## Actor input object example

```json
{
  "resultsType": "posts",
  "directUrls": [
    "https://www.instagram.com/humansofny/"
  ],
  "resultsLimit": 100,
  "searchType": "hashtag",
  "searchLimit": 10,
  "addParentData": false
}
```

# Actor output Schema

## `dataset` (type: `string`):

Dataset containing all scraped data

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
    "resultsType": "posts",
    "directUrls": [
        "https://www.instagram.com/humansofny/"
    ],
    "resultsLimit": 100,
    "searchType": "hashtag",
    "searchLimit": 10
};

// Run the Actor and wait for it to finish
const run = await client.actor("apify/instagram-scraper").call(input);

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
run_input = {
    "resultsType": "posts",
    "directUrls": ["https://www.instagram.com/humansofny/"],
    "resultsLimit": 100,
    "searchType": "hashtag",
    "searchLimit": 10,
}

# Run the Actor and wait for it to finish
run = client.actor("apify/instagram-scraper").call(run_input=run_input)

# Fetch and print Actor results from the run's dataset (if there are any)
print(f"💾 Check your data here: https://console.apify.com/storage/datasets/{run.default_dataset_id}")
for item in client.dataset(run.default_dataset_id).iterate_items():
    print(item)

# 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/python/docs/quick-start

```

## CLI example

```bash
echo '{
  "resultsType": "posts",
  "directUrls": [
    "https://www.instagram.com/humansofny/"
  ],
  "resultsLimit": 100,
  "searchType": "hashtag",
  "searchLimit": 10
}' |
apify call apify/instagram-scraper --silent --output-dataset

```

## MCP server setup

```json
{
    "mcpServers": {
        "apify": {
            "type": "http",
            "url": "https://mcp.apify.com/?tools=fetch-actor-details,apify/instagram-scraper"
        }
    }
}
```

The hosted server signs you in with OAuth on first connect, so no API token belongs in this config. Clients without OAuth support can send an `Authorization: Bearer <APIFY_API_TOKEN>` header instead, using a token from API & Integrations in Apify Console (https://console.apify.com/settings/integrations).

## OpenAPI specification

Download the OpenAPI definition: https://api.apify.com/v2/actors/shu8hvrXbJbY3Eb9W/builds/5FRxUovTlrFccb8Xd/openapi.json
