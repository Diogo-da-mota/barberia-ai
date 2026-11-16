# Instagram Comments Scraper (`apify/instagram-comment-scraper`) Actor

Scrape Instagram comments from posts or reels. Just add one or more Instagram post URLs to get comment text, post and comment IDs, replies, timestamp, owner IDs, usernames, profile pics. Export scraped datasets, run the scraper via API, schedule and monitor runs or integrate with other tools.

- **URL**: https://apify.com/apify/instagram-comment-scraper.md
- **Developed by:** [Apify](https://apify.com/apify) (Apify)
- **Categories:** Social media
- **Features:** Limited permissions
- **Stats:** 73,489 total users, 10,478 monthly users, 100.0% runs succeeded, 458 bookmarks
- **User rating**: 4.38 out of 5 stars

## Pricing

from $1.90 / 1,000 comments

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

### What can Instagram Comment Scraper do?

Our Instagram Comment Scraper **extracts comments from Instagram posts** quickly and efficiently. Just **add one or more Instagram post URLs**, and you're ready to:

💬 **Scrape Instagram comments and comment replies at scale** from any public post with no limits on requests

📊 Extract **engagement data and sentiment insights** from user comments and replies

👥 Get **commenter profiles** including usernames, verification status, and profile pictures

⏰ Track **comment timestamps** to analyze engagement patterns over time

🔢 Monitor **comment positions** to understand visibility and engagement order

⬇️ **Download Instagram comment data** in JSON, CSV, Excel, or other formats

🦾 Export comment datasets via SDKs (Python & Node.js), use **API Endpoints & webhooks**

🤳 Explore our other [Instagram scrapers](https://apify.com/store/collections/instagram-scrapers)

You can use Instagram Comment Scraper for sentiment analysis on marketing campaigns, tracking audience engagement, monitoring brand mentions and feedback, detecting misinformation or abuse, and analyzing competitor content performance.

### What data can I scrape from Instagram comments?

Using this Instagram comment API, you will be able to extract the following data from Instagram comments:

<table>
<tr>
<td>🆔 Comment ID</td>
<td>📮 Post ID</td>
<td>💬 Comment text</td>
<td>🔢 Comment position</td>
</tr>
<tr>
<td>⏰ Timestamp</td>
<td>👤 Owner ID</td>
<td>✅ Owner verification status</td>
<td>🏷️ Owner username</td>
</tr>
<tr>
<td>📷 Owner profile picture URL</td>
<td>↩️ Reply comments (if enabled)</td>
<td>📊 Engagement metrics</td>
<td>🔗 Comment URL</td>
</tr>
</table>

> If you need to **scrape both posts and comments by profile** in a single run, check out 🔗 [Export Instagram Comments and Posts Tool](https://apify.com/apify/export-instagram-comments-posts). It lets you extract all comments and post content for any public profile at once.

> Want to **track comment trends over time**? Use [webhooks](https://docs.apify.com/integrations/webhooks) to schedule regular scraping runs and monitor how comments evolve on specific posts or campaigns.

### How to scrape Instagram comments?

Instagram Comment Scraper is designed to be fast and easy to use, so there aren't too many parameters or settings. Just follow the steps below:

1. [Create](https://console.apify.com/sign-up) a free Apify account.
2. Open [Instagram Comment Scraper](https://apify.com/apify/instagram-comment-scraper).
3. Add **one or multiple Instagram post or reel URLs** to scrape.
4. Click "Save & Start" and wait for the datasets to be extracted.
5. Download your data in JSON, XML, CSV, Excel, or HTML.

If you want more guidance on how to use Instagram Comment Scraper, here's a full video that explains it:

https://www.youtube.com/watch?v=LY76G1G1_xE

For more details, check out our tutorial on [how to scrape data from Instagram](https://blog.apify.com/scrape-instagram-posts-comments-and-more-21d05506aeb3/), full of tips and tricks.

> If you need to **get Instagram comments along with post content** in one workflow, try combining this scraper with our 🔗 [Instagram Post Scraper](https://apify.com/apify/instagram-post-scraper). You can use the Post Scraper to find posts, then feed those URLs directly to the Comment Scraper.

### How much will scraping Instagram comments cost you?

Instagram Comment Scraper works on our pay-per-event (PPE) model, meaning you're charged for each result you receive. On the Free plan, the price is $2.60 per 1,000 results ($0.0026 per comment), giving you **over 1,900 Instagram comments for free with the $5 credit.**

On paid plans, you get more monthly credit for regular data extraction. For example, on the Starter plan ($19/month), the price is $2.30 per 1,000 results and you can scrape **over 8,200 comments per month**. Check the [pricing tab](https://apify.com/apify/instagram-comment-scraper/pricing) for full details.

### ⬇️ Input

To use this Instagram comment scraper, **enter one or more Instagram post URLs.** You can enter them one by one or all at once using the **Bulk edit** function.

<a href="https://console.apify.com/actors/SbK00X0JYCPblD2wp/">
<img src="https://github.com/apify-projects/actor-readme-images/blob/master/Instagram-comments-input.png?raw=true" alt="Instagram Comment Scraper input" style="width:70%;">
</a>

### ⬆️ Output

The results will be wrapped into a dataset, which you can find in the **Storage** tab. Here's an excerpt from the dataset you'd get if you apply the input parameters above:

<a href="https://console.apify.com/actors/SbK00X0JYCPblD2wp/">
<img src="https://github.com/apify-projects/actor-readme-images/blob/master/Instagram-comments-output.png?raw=true" alt="Instagram Comment Scraper output" style="width:100%;">
</a>

Besides the table view, you can also view your data as JSON, as well as download it as CSV, XML, Excel file, or through an API.

#### 💬 Extracted Instagram Comment data sample

You can export the data in common formats such as JSON, XML, CSV, or Excel. The JSON sample below shows the structure of each comment in the dataset:

```json
[
    {
        "id": "17949788698583607",
        "text": "Imagine scrolling to find the end of these comments! 😂",
        "ownerUsername": "gabriel2005120",
        "ownerProfilePicUrl": "https://scontent-msp1-1.cdninstagram.com/...",
        "timestamp": "2021-11-19T13:54:13.000Z",
        "likesCount": 12,
        "repliesCount": 1,
        "replies": [
            {
                "id": "17891234567890123",
                "text": "@gabriel2005120 right? It never ends 😅",
                "ownerUsername": "maria_adventures",
                "ownerProfilePicUrl": "https://scontent-msp1-1.cdninstagram.com/...",
                "timestamp": "2021-11-19T14:02:45.000Z",
                "likesCount": 3,
                "repliesCount": 0,
                "replies": []
            }
        ]
    },
    {
        "id": "17856789012345678",
        "text": "This is absolutely stunning! 🔥",
        "ownerUsername": "photo_enthusiast",
        "ownerProfilePicUrl": "https://scontent-msp1-1.cdninstagram.com/...",
        "timestamp": "2021-11-18T09:21:07.000Z",
        "likesCount": 45,
        "repliesCount": 0,
        "replies": []
    },
    {
        "id": "17923456789012345",
        "text": "Can someone explain the context?",
        "ownerUsername": "curious_user99",
        "ownerProfilePicUrl": "https://scontent-msp1-1.cdninstagram.com/...",
        "timestamp": "2021-11-20T16:38:22.000Z",
        "likesCount": 0,
        "repliesCount": 0,
        "replies": []
    }
]
```

You can manage the results in any language (Python, PHP, Node.js/NPM). See the [Apify API docs](https://docs.apify.com/api/v2) to learn more about getting results from the Instagram comment scraper.

### Want to scrape Instagram hashtags, posts, or profiles?

You can use the other dedicated scrapers below if you want to scrape specific Instagram data. You'll have fewer settings to change and faster results. Just enter one or more Instagram usernames or URLs and click to scrape. Browse the full [Instagram scrapers collection](https://apify.com/store/collections/instagram-scrapers) for more options.

<table>
<tr>
<td>#️⃣ <a href="https://apify.com/apify/instagram-hashtag-scraper">Instagram Hashtag Scraper</a></td>
<td>📷 <a href="https://apify.com/apify/instagram-post-scraper">Instagram Post Scraper</a></td>
</tr>
<tr>
<td>👤 <a href="https://apify.com/apify/instagram-profile-scraper">Instagram Profile Scraper</a></td>
<td>🔮 <a href="https://apify.com/apify/brand-collaboration-scraper">Instagram Influencer Collaboration Scraper</a></td>
</tr>
<tr>
<td>🏷️ <a href="https://apify.com/apify/instagram-tagged-scraper">Instagram Mentions Scraper</a></td>
<td>🎞️ <a href="https://apify.com/apify/instagram-reel-scraper">Instagram Reel Scraper</a></td>
</tr>
<tr>
<td>👥 <a href="https://apify.com/apify/instagram-followers-count-scraper">Instagram Followers Count Scraper</a></td>
<td>📊 <a href="https://apify.com/apify/instagram-hashtag-analytics-scraper">Instagram Hashtag Analytics Scraper</a></td>
</tr>
<tr>
<td>📤 <a href="https://apify.com/apify/export-instagram-comments-posts">Export Instagram Comments and Posts Tool</a></td>
</tr>
<tr>
<td>🥸 <a href="https://apify.com/apify/instagram-followers-following-scraper">Instagram Followers and Following Scraper</a></td>
</tr>
</table>

> If you're comfortable with more complex settings, use our more advanced 🔗 [Instagram Scraper](https://apify.com/apify/instagram-scraper) or 🔗 [Instagram API Scraper](https://apify.com/apify/instagram-api-scraper). They cover almost all functionalities of the dedicated scrapers.

### Want to scrape comments from other platforms?

<table>
<tr>
<td>📘 <a href="https://apify.com/apify/facebook-comments-scraper">Facebook Comments Scraper</a></td>
<td>🎵 <a href="https://apify.com/clockworks/tiktok-comments-scraper">TikTok Comments Scraper</a></td>
</tr>
<tr>
<td>▶️ <a href="https://apify.com/streamers/youtube-comments-scraper">YouTube Comments Scraper</a></td>
<td>🤖 <a href="https://apify.com/apify/comments-analyzer-agent">Comments Analyzer Agent</a></td>
</tr>
</table>

### ❓FAQ

#### How many results can you scrape with Instagram Comment Scraper?

The scraper extracts only the comments shown to Instagram users who are not logged in. That means the results may differ from what you see when logged in to your Instagram account. To try it out, open an incognito window in your browser and copy the post URL. The comments you see there are the ones this Actor will save to a dataset.

Usually, the scraper delivers as many comments and replies as it can access. However, scraping Instagram is dynamic and subject to change. There's no one-size-fits-all number for all use cases. **The maximum number of results may vary depending on the complexity of the input, location, and other factors.**

While we regularly run Actor tests to keep benchmarks in check, results may still fluctuate unexpectedly. The best way to know what to expect for your particular use case is to do a test run yourself.

#### Why scrape Instagram comments?

Scraping comments on Instagram posts can give you quick insights into how an audience is reacting to marketing campaigns and enable you to spot misinformation or abuse, track audience engagement, or help you monitor how competing content is being received.

#### Can I get Instagram comment replies?

Yes. Instagram Comment Scraper supports extracting reply comments if you enable the `includeReplies` option in the input settings. This allows you to capture full conversation threads and analyze how users interact with each other in the comments.

#### Is it legal to scrape Instagram comments?

Our Instagram scrapers are ethical and do not extract any private user data, such as email addresses, gender, or location. They only extract what the user has chosen to share publicly.

However, you should be aware that your results could contain personal data. Personal data is protected by the [GDPR](https://en.wikipedia.org/wiki/General_Data_Protection_Regulation) in the European Union and by other regulations around the world. You should not scrape personal data unless you have a legitimate reason to do so. If you're unsure whether your reason is legitimate, consult your lawyers. You can also read our blog post on the [legality of web scraping](https://blog.apify.com/is-web-scraping-legal/).

#### Can I use integrations with Instagram Comment Scraper?

You can integrate comment data scraped from Instagram with almost any cloud service or web app. We offer integrations with **Zapier, n8n, Slack, Make, Airbyte, Gumloop, CrewAI, IFTTT, Lindy, GitHub, Google Sheets, Google Drive**, [and plenty more](https://apify.com/integrations).

Alternatively, you could use [webhooks](https://docs.apify.com/integrations/webhooks) to carry out an action whenever an event occurs, such as getting a notification whenever the Instagram Comment Scraper successfully finishes a run.

#### Can I use this Instagram comment API with the Apify API?

Yes. The Apify API gives you programmatic access to the Apify platform. The API is organized around RESTful HTTP endpoints that enable you to manage, schedule, and run Apify Actors. Meaning the API will let you access any datasets, monitor actor performance, fetch scraped comment results, create and update versions, and more.

To access the API using Node.js, use the `apify-client` [NPM package](https://apify.com/apify/instagram-comment-scraper/api/javascript). To access the API using Python, use the `apify-client` [PyPI package](https://apify.com/apify/instagram-comment-scraper/api/python). Check out the [Apify API reference](https://docs.apify.com/api/v2) docs for all the details.

#### Can I get Instagram comments through an MCP Server?

With Apify API, you can use almost any Actor in conjunction with an MCP server. You can connect to the MCP server using clients like ClaudeDesktop and LibreChat, or even build your own. Read all about how you can [set up Apify Actors with MCP](https://blog.apify.com/how-to-use-mcp/).

For Instagram Comment Scraper, go to the [MCP](https://apify.com/apify/instagram-comment-scraper/api/mcp) tab and then go through the following steps:

1. Start a Server-Sent Events (SSE) session to receive a `sessionId`
2. Send API messages using that `sessionId` to trigger the scraper
3. The message starts the Instagram Comment Scraper with the provided input
4. The response should be: `Accepted`

#### Instagram Comment Scraper not working

We're always working on improving the performance of our Actors. So if you've got any technical feedback for Instagram Comment Scraper or simply found a bug, please create an issue on the Actor's [Issues tab](https://apify.com/apify/instagram-comment-scraper/issues/open) in Apify Console.

# Changelog

This Actor's version history is a separate document: https://apify.com/apify/instagram-comment-scraper/changelog.md

# Actor input Schema

## `directUrls` (type: `array`):

Add one or multiple URLs to scrape comments from - posts or reels. You can add URLs one by one or upload a list using the <b>Bulk edit</b> option.

## `resultsLimit` (type: `integer`):

Set the number of comments you expect to scrape from each post or reel. <br><br> If set to <b>5</b>, you will get <b>5</b> comments per URL. If you add 2 URLs, you will extract <b>10</b> results altogether.<br>❗️ If you choose to scrape replies as well, the total number will be greater than you set for comments.

## `includeNestedComments` (type: `boolean`):

This feature is for paying users only. If checked, the scraper will extract replies for each comment.<br>⚠️ Note that each reply/comment will be displayed as a separate result, so <b>you'll get more results in total</b> than you set in `resultsLimit` section above.

## Actor input object example

```json
{
  "directUrls": [
    "https://www.instagram.com/p/DN8-GjPkgjS",
    "https://www.instagram.com/reel/DDIJAfeyemG"
  ],
  "resultsLimit": 15
}
```

# Actor output Schema

## `dataset` (type: `string`):

Dataset containing all scraped comments

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
    "directUrls": [
        "https://www.instagram.com/p/DN8-GjPkgjS",
        "https://www.instagram.com/reel/DDIJAfeyemG"
    ],
    "resultsLimit": 15
};

// Run the Actor and wait for it to finish
const run = await client.actor("apify/instagram-comment-scraper").call(input);

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
    "directUrls": [
        "https://www.instagram.com/p/DN8-GjPkgjS",
        "https://www.instagram.com/reel/DDIJAfeyemG",
    ],
    "resultsLimit": 15,
}

# Run the Actor and wait for it to finish
run = client.actor("apify/instagram-comment-scraper").call(run_input=run_input)

# Fetch and print Actor results from the run's dataset (if there are any)
print(f"💾 Check your data here: https://console.apify.com/storage/datasets/{run.default_dataset_id}")
for item in client.dataset(run.default_dataset_id).iterate_items():
    print(item)

# 📚 Want to learn more 📖? Go to → https://docs.apify.com/api/client/python/docs/quick-start

```

## CLI example

```bash
echo '{
  "directUrls": [
    "https://www.instagram.com/p/DN8-GjPkgjS",
    "https://www.instagram.com/reel/DDIJAfeyemG"
  ],
  "resultsLimit": 15
}' |
apify call apify/instagram-comment-scraper --silent --output-dataset

```

## MCP server setup

```json
{
    "mcpServers": {
        "apify": {
            "type": "http",
            "url": "https://mcp.apify.com/?tools=fetch-actor-details,apify/instagram-comment-scraper"
        }
    }
}
```

The hosted server signs you in with OAuth on first connect, so no API token belongs in this config. Clients without OAuth support can send an `Authorization: Bearer <APIFY_API_TOKEN>` header instead, using a token from API & Integrations in Apify Console (https://console.apify.com/settings/integrations).

## OpenAPI specification

Download the OpenAPI definition: https://api.apify.com/v2/actors/SbK00X0JYCPblD2wp/builds/9wOFyuTb24hgolIHf/openapi.json
