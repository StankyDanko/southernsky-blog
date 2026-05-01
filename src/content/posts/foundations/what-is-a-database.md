---
title: "What Is a Database? Build Your First One with SQLite"
description: "Every app you use runs on a database. Here's what that actually means — and how to build your first one in 10 minutes with SQLite."
publishDate: 2026-05-01
author: j-martin
tier: foundations
postType: tutorial
difficulty: beginner
estimatedMinutes: 11
prerequisites: []
category: python
tags: ["sqlite", "databases", "sql", "beginner"]
heroImage: "/images/posts/what-is-a-database.webp"
featured: false
draft: false
---

## Why Should You Care?

Every app you use — Instagram, Spotify, your bank — runs on a database. But what IS a database?

It's not some mysterious black box that only computer science majors understand. A database is just an organized way to store and retrieve information. You've already used one. If you've ever opened a spreadsheet, typed data into rows and columns, and then sorted or filtered it — you were doing database work. You just didn't know it yet.

By the end of this post, you'll have built a real database on your own computer. Not a toy. The same technology that runs inside your phone, your browser, and apps used by billions of people. And it takes about ten minutes.

## A Spreadsheet Is Almost a Database

Open a spreadsheet. Make three columns: `Title`, `Author`, `Year`. Add some books.

| Title | Author | Year |
|-------|--------|------|
| Dune | Frank Herbert | 1965 |
| Neuromancer | William Gibson | 1984 |
| The Hobbit | J.R.R. Tolkien | 1937 |

That's data. It's organized. You can sort it by year. You can search for "Tolkien." So what makes a real database different from this spreadsheet?

Three things:

**Structure enforcement.** A spreadsheet lets you type anything anywhere. You could put "banana" in the Year column and it wouldn't blink. A database has a schema — a set of rules that says "Year must be a number." If you try to put "banana" in a number column, the database rejects it. Your data stays clean.

**Querying power.** Spreadsheet filters work for small datasets. But imagine a million rows. Try filtering a million-row spreadsheet and your computer will freeze. Databases are built for exactly this — they use indexes (think of them like a book's index) to find rows in milliseconds, even across millions of records.

**Concurrent access.** A spreadsheet is one file. If two people open it at the same time and both make changes, somebody's work gets overwritten. Databases handle multiple simultaneous readers and writers without data loss. That's why every website with user accounts needs one — thousands of people are reading and writing data at the same moment.

## Meet SQLite

There are many database systems out there — PostgreSQL, MySQL, MongoDB. Most of them require you to install and run a server, configure users, set passwords, manage connections. That's a lot of ceremony before you can store a single row of data.

SQLite is different. Your entire database is a single file. No server. No configuration. No passwords. It ships inside your phone — every iPhone and Android device runs SQLite. Your web browser uses it internally. It's the most widely deployed database engine in the world, with literally trillions of active instances.

And it's already installed on most computers. Let's check.

Open your terminal and type:

```bash
sqlite3 --version
```

If you see a version number, you're ready. If not, install it:

```bash
# macOS (already installed)
# Linux (Debian/Ubuntu)
sudo apt install sqlite3

# Windows — download from sqlite.org/download.html
```

## Creating Your First Database

Let's build a music library. You'll track albums you own — title, artist, year, and a rating out of 10.

In your terminal:

```bash
sqlite3 music.db
```

That's it. You just created a database. The file `music.db` now exists in your current directory. SQLite opens it and gives you a prompt:

```
SQLite version 3.45.1 2024-01-30 16:01:20
Enter ".help" for usage hints.
sqlite>
```

Everything you type at this `sqlite>` prompt is either a SQL command (the language databases understand) or a dot-command (SQLite-specific utilities). Let's start with SQL.

## CREATE TABLE: Defining Your Structure

Before you can store data, you need to define what shape your data takes. That's what `CREATE TABLE` does — it creates a table (like a spreadsheet tab) with named, typed columns.

```sql
CREATE TABLE albums (
  id      INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  artist  TEXT NOT NULL,
  year    INTEGER,
  rating  INTEGER
);
```

Type that into your SQLite prompt and press Enter.

Let's break it down:

- `albums` is the name of your table
- `id INTEGER PRIMARY KEY` — every row gets a unique number, automatically assigned. This is how you identify a specific album
- `title TEXT NOT NULL` — the album title, stored as text. `NOT NULL` means this column can't be empty — every album needs a title
- `artist TEXT NOT NULL` — same idea, every album needs an artist
- `year INTEGER` — the release year, stored as a number. No `NOT NULL`, so this one is optional
- `rating INTEGER` — your personal rating, also optional

Remember the spreadsheet problem? Try inserting an album without a title later — SQLite will refuse. The schema protects your data.

## INSERT: Adding Data

Now let's add some albums:

```sql
INSERT INTO albums (title, artist, year, rating) VALUES
  ('OK Computer', 'Radiohead', 1997, 10);

INSERT INTO albums (title, artist, year, rating) VALUES
  ('Random Access Memories', 'Daft Punk', 2013, 9);

INSERT INTO albums (title, artist, year, rating) VALUES
  ('Blue Train', 'John Coltrane', 1958, 10);

INSERT INTO albums (title, artist, year, rating) VALUES
  ('Blonde', 'Frank Ocean', 2016, 9);

INSERT INTO albums (title, artist, year, rating) VALUES
  ('Abbey Road', 'The Beatles', 1969, 8);
```

Each `INSERT INTO` statement adds one row. Notice you don't specify `id` — SQLite fills it in automatically, starting at 1 and counting up.

The format is always: `INSERT INTO table_name (columns) VALUES (values);`

The values must match the columns in order: first value goes in the first column, second in the second, and so on.

## SELECT: Reading Your Data

Data goes in. Now let's get it back out. `SELECT` is the most important SQL command — it's how you ask questions about your data.

Get everything:

```sql
SELECT * FROM albums;
```

```
1|OK Computer|Radiohead|1997|10
2|Random Access Memories|Daft Punk|2013|9
3|Blue Train|John Coltrane|1958|10
4|Blonde|Frank Ocean|2016|9
5|Abbey Road|The Beatles|1969|8
```

The `*` means "all columns." You can also pick specific ones:

```sql
SELECT title, artist FROM albums;
```

```
OK Computer|Radiohead
Random Access Memories|Daft Punk
Blue Train|John Coltrane
Blonde|Frank Ocean
Abbey Road|The Beatles
```

Want it to look nicer? SQLite has formatting options:

```sql
.mode column
.headers on
SELECT title, artist, year FROM albums;
```

```
title                   artist         year
----------------------  -------------  ----
OK Computer             Radiohead      1997
Random Access Memories  Daft Punk      2013
Blue Train              John Coltrane  1958
Blonde                  Frank Ocean    2016
Abbey Road              The Beatles    1969
```

Now we're talking.

## WHERE: Asking Specific Questions

`WHERE` is where queries get powerful. It's how you filter — show me only the rows that match a condition.

Albums rated 10:

```sql
SELECT title, artist FROM albums WHERE rating = 10;
```

```
title          artist
-------------  -------------
OK Computer    Radiohead
Blue Train     John Coltrane
```

Albums released after 2000:

```sql
SELECT title, year FROM albums WHERE year > 2000;
```

```
title                   year
----------------------  ----
Random Access Memories  2013
Blonde                  2016
```

Albums by a specific artist:

```sql
SELECT * FROM albums WHERE artist = 'Radiohead';
```

You can combine conditions with `AND` and `OR`:

```sql
SELECT title, artist, rating FROM albums
WHERE rating >= 9 AND year > 1990;
```

```
title                   artist      rating
----------------------  ----------  ------
OK Computer             Radiohead   10
Random Access Memories  Daft Punk   9
Blonde                  Frank Ocean 9
```

And you can sort results:

```sql
SELECT title, year FROM albums ORDER BY year ASC;
```

```
title                   year
----------------------  ----
Blue Train              1958
Abbey Road              1969
OK Computer             1997
Random Access Memories  2013
Blonde                  2016
```

`ASC` means ascending (oldest first). Use `DESC` for descending (newest first).

## UPDATE and DELETE: Changing Your Mind

Maybe you relistened to Abbey Road and it's actually a 9 now:

```sql
UPDATE albums SET rating = 9 WHERE title = 'Abbey Road';
```

The `WHERE` clause is critical here. Without it, you'd update every album's rating to 9. Always include `WHERE` on `UPDATE` and `DELETE` statements — it's one of the first rules you learn.

Want to remove an album entirely?

```sql
DELETE FROM albums WHERE title = 'Blonde';
```

Again, `WHERE` is your safety net. `DELETE FROM albums;` without a WHERE clause deletes everything. Databases do exactly what you tell them to, even if what you told them is catastrophic.

## COUNT, MIN, MAX: Asking Bigger Questions

SQL can do math across your entire dataset:

```sql
SELECT COUNT(*) FROM albums;
```

```
4
```

Four albums (we deleted one, remember).

```sql
SELECT AVG(rating) FROM albums;
```

```
9.5
```

```sql
SELECT MIN(year), MAX(year) FROM albums;
```

```
1958|1997
```

These are called aggregate functions. They collapse many rows into a single answer. Real applications use these constantly — "how many users signed up this month?" is just a `COUNT` with a `WHERE` on the date.

## It's Just a File

Here's the part that surprises people. Quit SQLite:

```sql
.quit
```

Now look at your directory:

```bash
ls -la music.db
```

```
-rw-r--r-- 1 user user 8192 May  1 14:30 music.db
```

Eight kilobytes. Your entire database — the schema, the data, the indexes — is one 8KB file. You can copy it to a USB drive, email it to someone, put it on your phone. Wherever SQLite is installed (which is almost everywhere), that file works.

This is fundamentally different from databases like PostgreSQL or MySQL, which run as background services and store data across dozens of internal files. SQLite's single-file design is why it shows up in places you wouldn't expect: every iPhone app that stores local data, every Firefox and Chrome browser (your bookmarks, history, cookies — all SQLite), every Android device.

## Real-World Scale: Indexing a Million Files

I use SQLite on my workstation to index over a million files across the machine. The database tracks the file path, name, extension, size, and type of every file on the system — 1,088,796 of them. The whole thing sits in a single `.db` file.

Need to find every Python file?

```sql
SELECT COUNT(*) FROM files WHERE file_ext = 'py';
-- 126,139
```

Find the largest files on the system?

```sql
SELECT file_name, file_size / (1024*1024*1024.0) AS gb
FROM files
ORDER BY file_size DESC
LIMIT 5;
```

Search for a file by name when you can't remember where you put it?

```sql
SELECT file_path FROM files
WHERE file_name LIKE '%budget%';
```

These queries return results in milliseconds. The database has indexes on the columns I search most — name, extension, type, size — so SQLite doesn't have to scan all million rows. It jumps straight to the matching ones. That's the querying power we talked about earlier, and it's the reason a database beats a spreadsheet the moment your data gets real.

## What Comes Next

You've learned the core operations that every database application uses:

- **CREATE TABLE** — define the shape of your data
- **INSERT** — add rows
- **SELECT** — read rows, with filtering (`WHERE`), sorting (`ORDER BY`), and aggregation (`COUNT`, `AVG`)
- **UPDATE** — change existing rows
- **DELETE** — remove rows

These five operations cover about 80% of what most applications do with a database. The remaining 20% — joins between tables, transactions, foreign keys, indexes — builds on exactly what you learned here.

If you want to keep going, here are some things to try:

**Add a genres table.** Create a second table called `genres` with an `id` and `name`. Add a `genre_id` column to your `albums` table. This is a relationship between tables — the concept that makes relational databases relational.

**Try DB Browser for SQLite.** It's a free graphical tool ([sqlitebrowser.org](https://sqlitebrowser.org)) that lets you browse your database visually, run queries, and see your schema in a GUI. Some people find it easier than the command line when starting out.

**Build something real.** A workout tracker. A recipe book. A journal with dates and tags. Pick something you actually want to track and build the schema for it. The best way to learn SQL is to need it for something you care about.

## What You Learned

You just built a database. The same technology that powers billion-dollar apps.

It's not magic. It's a file on your computer with structured data inside it, and a language called SQL that lets you ask it questions. Instagram's database is bigger than yours, but the `SELECT`, `INSERT`, `UPDATE`, and `DELETE` commands they use are the same ones you just learned. The fundamentals don't change at scale — they just get more important.

Your `music.db` file is still sitting in your terminal's working directory. Open it back up anytime: `sqlite3 music.db`. Add more albums. Write new queries. Break things and fix them. That's how you learn.
