---
title: "What Is an API? Build One in 15 Minutes"
description: "APIs are how apps talk to each other. Here's what that actually means — and how to build your own working API in 15 minutes flat."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: tutorial
difficulty: beginner
estimatedMinutes: 10
prerequisites: []
category: web-development
tags: ["api", "rest", "json", "node"]
heroImage: "/images/posts/what-is-an-api.webp"
featured: false
draft: false
---

## Why Should You Care?

Every time you check the weather on your phone, an API just did the work. Every time you search for a flight, see a stock price, or get a notification that your food is five minutes away — an API made that happen. You've been using APIs all day. You just didn't know it.

API stands for **Application Programming Interface**. That sounds like a mouthful, so let me translate: it's a way for two programs to talk to each other. Your weather app doesn't have meteorologists sitting inside it. It asks a weather service for the forecast, gets a response, and shows it to you. The thing it asked — and the rules for how to ask — is the API.

Once you understand APIs, you understand how the modern internet actually works. And by the end of this post, you'll have built one yourself.

## The Restaurant Analogy

Here's the simplest way to think about it.

You walk into a restaurant. You sit down at a table. You don't go into the kitchen and start cooking. You don't rummage through the fridge. You talk to the **waiter**.

- **You** are the app (or the user).
- **The waiter** is the API.
- **The kitchen** is the server where data lives.
- **The menu** is the documentation that tells you what you can ask for.
- **Your food** is the data that comes back.

You tell the waiter what you want. The waiter walks to the kitchen, tells the chef, and comes back with your plate. You never see the kitchen. You don't need to know how the stove works or where the ingredients are stored. You just need to know what's on the menu and how to ask.

That's an API. A waiter between your app and the server's data.

## What Does an API Call Actually Look Like?

Let's make this real. No metaphors — actual code.

There's a free earthquake API run by the U.S. Geological Survey. It returns real earthquakes happening right now. You can call it from your browser, your terminal, or your code. Let's try the terminal first.

Open a terminal and type:

```bash
curl https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson
```

You just made an **API call**. You sent a request to a URL, and a server responded with data. What came back is a wall of text — that's JSON, and we'll come back to it in a minute.

Here's the same call using JavaScript's `fetch`, which is what apps actually use:

```javascript
const response = await fetch(
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson"
);
const data = await response.json();
console.log(data.features[0].properties.title);
// → something like "M 6.2 - 45 km NE of Hualien, Taiwan"
```

Two lines of real code, and you've pulled live seismic data from a government server into your program. That's the power of APIs — you don't need to own a seismograph. Someone else already built that part. You just ask.

## JSON: The Language APIs Speak

When the earthquake API responded, it didn't send you a paragraph of English. It sent **JSON** — JavaScript Object Notation. JSON is how APIs structure their data so any programming language can read it.

Here's what a snippet of that earthquake response looks like, cleaned up:

```json
{
  "type": "Feature",
  "properties": {
    "title": "M 6.2 - 45 km NE of Hualien, Taiwan",
    "mag": 6.2,
    "place": "45 km NE of Hualien, Taiwan",
    "time": 1714540800000,
    "tsunami": 0
  },
  "geometry": {
    "type": "Point",
    "coordinates": [121.75, 24.22, 15.0]
  }
}
```

Notice the pattern: everything is organized in **key-value pairs**. `"mag"` is the key, `6.2` is the value. `"place"` is the key, `"45 km NE of Hualien, Taiwan"` is the value. Curly braces `{}` wrap objects. Square brackets `[]` wrap lists.

JSON is the universal language of APIs. It doesn't matter if the server is written in Python, Java, Rust, or JavaScript — the response comes back as JSON, and any language can parse it.

Think of it this way: if the API is the waiter, JSON is the plate. It's the standardized format the food arrives on. Every table gets the same kind of plate, so you always know how to eat.

## What Makes an API "RESTful"?

You'll hear the term **REST API** constantly. REST stands for Representational State Transfer, which is one of those names that tells you absolutely nothing about what it does. Here's what it actually means in practice:

- You use **URLs** to identify resources. `/stocks/quote?symbol=AAPL` means "I want a stock quote for Apple."
- You use **HTTP methods** to say what you want to do:
  - `GET` — read data (give me the stock price)
  - `POST` — create data (submit a new order)
  - `PUT` — update data (change my profile)
  - `DELETE` — remove data (cancel my subscription)
- The server responds with **JSON** and a **status code** (200 for success, 404 for not found, 500 for server error).

That's it. REST is just a set of conventions for organizing APIs around URLs and HTTP. Most of the APIs you'll interact with are REST APIs.

## How Real APIs Work: A Market Data Service

I run a market data API that aggregates stock prices, crypto, gold, and economic indicators into one service. Here's what one of its endpoints looks like — this is real production code:

```javascript
// GET /stocks/quote?symbol=AAPL
router.get('/quote', async (req, res) => {
  const symbol = req.query.symbol || 'SPY';

  const data = await fetchJSON('https://api.twelvedata.com/quote', {
    params: { symbol, apikey: API_KEY },
  });

  res.json({
    symbol: data.symbol,
    name: data.name,
    price: parseFloat(data.close),
    change: parseFloat(data.change),
    change_pct: parseFloat(data.percent_change),
    volume: parseInt(data.volume),
  });
});
```

Read that carefully. What's happening?

1. A user requests `/stocks/quote?symbol=AAPL`
2. The server reads `AAPL` from the query string
3. It calls *another* API (Twelve Data) to get the raw stock data
4. It picks out the fields it cares about, cleans them up, and sends them back as JSON

This is a very common pattern. **Your API is a waiter that talks to another kitchen.** The user asks you, you ask Twelve Data, and you pass the answer back in a cleaner format. APIs calling other APIs — that's how most of the internet works.

The response the user gets looks like this:

```json
{
  "symbol": "AAPL",
  "name": "Apple Inc",
  "price": 227.48,
  "change": 3.52,
  "change_pct": 1.57,
  "volume": 52341890
}
```

Clean, structured, easy to use. The user never needs to know about Twelve Data or deal with its raw format. Your API is the waiter, and you just served a clean plate.

## Build Your Own API in 15 Minutes

Enough reading. Let's build one.

You'll need [Node.js](https://nodejs.org) installed (version 18 or newer). Open a terminal and check:

```bash
node --version
```

If you see a version number, you're good. If not, download Node.js from the link above.

### Step 1: Set Up the Project

```bash
mkdir my-first-api
cd my-first-api
npm init -y
npm install express
```

This creates a new folder, initializes a Node.js project, and installs **Express** — a tiny framework that makes building APIs painless.

### Step 2: Write the API

Create a file called `server.js` and paste this in:

```javascript
const express = require('express');
const app = express();

// A simple book collection
const books = [
  { id: 1, title: "The Pragmatic Programmer", author: "David Thomas" },
  { id: 2, title: "Clean Code", author: "Robert C. Martin" },
  { id: 3, title: "Eloquent JavaScript", author: "Marijn Haverbeke" },
];

// GET /books — return all books
app.get('/books', (req, res) => {
  res.json(books);
});

// GET /books/:id — return one book by ID
app.get('/books/:id', (req, res) => {
  const book = books.find(b => b.id === parseInt(req.params.id));
  if (!book) return res.status(404).json({ error: "Book not found" });
  res.json(book);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.listen(3000, () => {
  console.log('API running at http://localhost:3000');
});
```

That's 25 lines. Let me walk you through what each piece does.

**`const app = express()`** — Creates your API application. Express handles all the HTTP plumbing so you can focus on what data to serve.

**`const books = [...]`** — A simple array of data. In a real API, this would come from a database. For learning, an array is perfect.

**`app.get('/books', ...)`** — When someone sends a GET request to `/books`, respond with the entire books array as JSON. That `res.json()` call converts the JavaScript array into JSON and sends it back.

**`app.get('/books/:id', ...)`** — The `:id` is a URL parameter. If someone requests `/books/2`, `req.params.id` will be `"2"`. We find the matching book and send it back. If there's no match, we send a 404 error.

**`app.get('/health', ...)`** — A health check endpoint. This is standard practice — every production API has one. Monitoring tools hit this URL to make sure the service is alive.

**`app.listen(3000, ...)`** — Start the server on port 3000 and print a message so you know it's running.

### Step 3: Run It

```bash
node server.js
```

You should see:

```
API running at http://localhost:3000
```

### Step 4: Test It

Open a new terminal (keep the server running in the first one) and try these:

```bash
# Get all books
curl http://localhost:3000/books

# Get one specific book
curl http://localhost:3000/books/2

# Try a book that doesn't exist
curl http://localhost:3000/books/99

# Check the health endpoint
curl http://localhost:3000/health
```

Or just open `http://localhost:3000/books` in your browser. You'll see JSON.

Here's what each response looks like:

**GET /books:**
```json
[
  { "id": 1, "title": "The Pragmatic Programmer", "author": "David Thomas" },
  { "id": 2, "title": "Clean Code", "author": "Robert C. Martin" },
  { "id": 3, "title": "Eloquent JavaScript", "author": "Marijn Haverbeke" }
]
```

**GET /books/2:**
```json
{
  "id": 2,
  "title": "Clean Code",
  "author": "Robert C. Martin"
}
```

**GET /books/99:**
```json
{
  "error": "Book not found"
}
```

**GET /health:**
```json
{
  "status": "ok",
  "uptime": 14.327
}
```

You built an API. A real one. It listens for HTTP requests, processes them, and responds with JSON. Every API on the internet — from Twitter to Stripe to the USGS earthquake feed — works on this same fundamental pattern: request in, JSON out.

## What You Could Add Next

This book API is tiny on purpose. But if you wanted to keep going, here's what you'd add:

**POST route** — Let users add new books:

```javascript
app.use(express.json()); // Add this near the top

app.post('/books', (req, res) => {
  const newBook = {
    id: books.length + 1,
    title: req.body.title,
    author: req.body.author,
  };
  books.push(newBook);
  res.status(201).json(newBook);
});
```

```bash
curl -X POST http://localhost:3000/books \
  -H "Content-Type: application/json" \
  -d '{"title": "You Don't Know JS", "author": "Kyle Simpson"}'
```

**Query parameters** — Filter books by author:

```javascript
app.get('/search', (req, res) => {
  const author = req.query.author;
  const results = books.filter(b =>
    b.author.toLowerCase().includes(author.toLowerCase())
  );
  res.json(results);
});
```

```bash
curl "http://localhost:3000/search?author=martin"
```

These patterns — POST for creating, query params for filtering — are the same ones used in every production API. You're learning the real thing, not a toy.

## The Bigger Picture

The book API you just built follows the exact same architecture as APIs that power real products:

- **Weather apps** call APIs like OpenWeatherMap to get forecasts. Your phone doesn't predict the weather — it asks a server.
- **Stock trading apps** call APIs like Twelve Data or Alpha Vantage for live prices. I built a market data service that aggregates multiple financial APIs into one clean endpoint — same pattern, just more data sources.
- **AI chatbots** call APIs like OpenAI or Anthropic. When you talk to ChatGPT, your browser sends your message to an API, and the response streams back.
- **Mapping apps** call APIs for satellite imagery, traffic data, and points of interest. My own project, OMNI, proxies a dozen external APIs for earthquake data, weather radar, flight tracking, and more — each one following the same request/response pattern you just learned.

The pattern never changes: make a request to a URL, get JSON back, use the data. Whether you're fetching book titles from localhost or satellite positions from NOAA, the mechanics are identical.

## What You Learned

- An API is a structured way for programs to communicate — a waiter between your app and a server's data
- JSON is the standard format APIs use to send and receive data — key-value pairs wrapped in curly braces
- REST APIs use URLs for resources and HTTP methods (GET, POST, PUT, DELETE) for actions
- Real APIs often call other APIs — your server is a waiter that talks to other kitchens
- You built a working API with Node.js and Express in about 15 minutes
- Every API on the internet — weather, stocks, AI, maps — uses this same request/response pattern

Next time you tap a button in an app and data appears, you'll know what happened behind the screen. A request went out, a server responded, and JSON came back. Now you know how to build the server, too.
