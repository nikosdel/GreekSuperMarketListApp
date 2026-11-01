# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The site and the phone apps share one Angular interface. Capacitor only supplies the Android and iPhone shells. That is a web design language in a native wrapper, recorded here as `web`. A separate iOS or Android visual language was not requested.

## Stack

Angular for the site, with SCSS for the styles. Capacitor wraps that same build for Android and iPhone. The Android project can be built on this PC. The iPhone shell is compiled in Xcode on a Mac.

The look is our own SCSS, not a visual component kit. Angular Material, Bootstrap, and PrimeNG were declined because those kits would decide the screens. Angular CDK may be used later for focus and overlays only. It does not supply the visual design.

The interface is responsive. The same layout works at phone width and at desktop width. There is no separate mobile site.

The API is Node and Express at http://127.0.0.1:3000. Postgres holds the catalog, accounts, and lists. Python loads the catalog and answers local price questions. The Angular app is in `web/` and is served at http://localhost:4200.

## Users

Inferred: a person in Greece choosing where to buy groceries, often with at least one other person on the same list. No household type, shopper segment, or store-staff role was confirmed.

## Product Purpose

Compare pack prices across Greek supermarket chains and keep a shared shopping list of real catalog products. Success is a price that comes from the catalog, a list that every member can manage while it is open, and a notice to the other members when that list changes.

## Positioning

Prices are the rows published by Πόσο Κάνει (https://posokanei.gov.gr/). They are not taken from a chain's own site and not guessed by a model. The same item at two shops is two catalog rows. Every member can edit an open list. Saving copies the current prices onto the lines and locks the list.

## Operating Context

The catalog is loaded on this PC from posokanei.gov.gr, Greece only, with at least 1.5 seconds between requests. Postgres runs in Docker on port 5433. The API listens on 127.0.0.1:3000.

A local command, `ask`, sends a question to Ollama on this PC (`qwen2.5:3b`, no paid API key). The model must call the catalog tools before a price is stated. The model's own sentence is a draft. The printed answer for a comparison or a multi-item basket is built from the tool result.

The screens to build are worked in: account, lists, notices, and history. They are app screens. A marketing page was not requested. No visual direction was dealt in this init.

## Capabilities and Constraints

Confirmed:

- Register and log in on this API. Passwords are bcrypt hashes. Login is the API's own OAuth2 password grant. Access tokens expire in 15 minutes. A refresh token lasts 14 days, and using it revokes the previous one.
- Shared lists: create, share an invite code, join as an editor. The owner and every editor can add, change, and remove products while the list is open. Saving snapshots the current pack price and unit price, then locks the list. A later edit is rejected.
- A list line points at a catalog product and keeps the short product name and the chain name. Images and long descriptions are not copied.
- The other members get a stored notice and, if connected, a live stream event when someone adds, updates, or removes a product, joins, or saves. The person who made the change is not notified about their own edit. The stream uses a 30-second single-use ticket so the access token is not put in the URL.
- Catalog results show the short name, the shop, the category, the pack price, the unit price, and the site's update date. Everyday Greek is folded so a phrase like "ένα γάλα 1 λίτρου" can match `γάλα` and `1lt`.
- A one-product comparison picks the cheapest matching pack and also shows the other matching products' cheapest shop prices. A two-item basket can show a split across shops and a one-shop total. A tie lists every tied shop.
- Phone lock-screen alerts are not built. They are planned for the installed apps through Firebase on Android and Apple push on iPhone.
- History is a page of lists this member already saved. Each entry shows the list title, when it was saved, who saved it, and the lines with the pack price and unit price copied at save. A saved list stays locked. `GET /lists` already returns `status` and `saved_at` for the member's lists, and the list detail returns those saved prices. A chart of one product's price over time was not requested.

Undecided:

- Public product name. The only title on record is the repository heading "Super Market Web App".
- Interface language. The catalog is Greek. Whether the screens are Greek, English, or both was not decided.
- Whether the first Angular screens include the price question, or only account, lists, notices, and history. The agreed first build is account, lists, notices, and history.
- A Firebase project for phone push does not exist yet.
- No accessibility standard was set.

## Evidence on Hand

- README.md describes the catalog fields, the shared-list API, and the `ask` command.
- The Express API is in `api/`. Migration `007_api_tokens_and_notifications.sql` adds refresh tokens and list notices.
- The loaded catalog is the Greece extract from posokanei.gov.gr. Chain names on that site include Χαλκιαδάκης, My Market, Γαλαξίας, Κρητικός, and Μασούτης.
- There is no logo file yet, no product photography, and no written brand voice. Do not invent prices, testimonials, shopper counts, or product images. Product images and long descriptions stay out of the product even when the source site has them.

## Brand Commitments

The mark is a short shopping list. It is not a shopping cart, and it has no item-count badge. A small price may sit beside the list only when the list alone is unclear. No logo file has been drawn. No public name, color, or typeface is set.

## Product Principles

- A price on screen is a catalog price, or it is absent.
- Every member of an open list can manage it. Saving is when the prices are kept and the list stops changing.
- One Angular interface is the website and both phone apps. It is responsive from phone width to desktop width.
- Show the short name, the shop, and the price. Leave out images and long descriptions.
- The other people on the list hear about a change. The person who made it does not get that notice.
