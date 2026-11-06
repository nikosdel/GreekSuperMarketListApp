# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The site and the phone apps share one Angular interface. Capacitor only supplies the Android and iPhone shells. That is a web design language in a native wrapper, recorded here as `web`. A separate iOS or Android visual language was not requested.

## Stack

Angular for the site, with SCSS for the styles. Capacitor wraps that same build for Android and iPhone. The Android project can be built on this PC. The iPhone shell is compiled in Xcode on a Mac.

The look is our own SCSS, not a visual component kit. Angular Material, Bootstrap, and PrimeNG were declined because those kits would decide the screens. Angular CDK may be used later for focus and overlays only. It does not supply the visual design.

The interface is responsive. The same layout works at phone width and at desktop width. There is no separate mobile site.

The phone is the primary use context, especially while shopping, but desktop remains important. Prioritize a clear, thumb-friendly phone experience without creating a separate mobile product.

The API is Node and Express at http://127.0.0.1:3000. Postgres holds the catalog, accounts, and lists. Python loads the catalog and answers local price questions. The Angular app is in `web/` and is served at http://localhost:4200.

## Users

People in Greece comparing grocery prices and managing shopping lists, often together with other people. Phone use while shopping is the primary context; desktop planning is also important. No household type, shopper segment, or store-staff role was confirmed.

## Product Purpose

The product name is **Super Market List**. Compare pack prices across Greek supermarket chains and manage shared shopping lists of real catalog products. The home screen is an overview of the user's lists; opening a list provides its product and member workspace. Success is a price that comes from the catalog, a list that its members can manage while it is open, and a notice to the other members when that list changes.

## Positioning

Prices are the rows published by Πόσο Κάνει (https://posokanei.gov.gr/). They are not taken from a chain's own site and not guessed by a model. An identical catalog name at multiple shops is presented as one product with separate shop offers; choosing an offer adds that shop's original catalog row. Brand, variant, and pack-size differences remain separate. Every member can edit products on an open list. Members join using its invite code; the owner can remove other members and delete an open list. Saving copies the current prices onto the lines and locks the list; saved lists in history cannot be deleted.

## Operating Context

The catalog is loaded on this PC from posokanei.gov.gr, Greece only, with at least 1.5 seconds between requests. Postgres runs in Docker on port 5433. The API listens on 127.0.0.1:3000.

A local command, `ask`, sends a question to Ollama on this PC (`qwen2.5:3b`, no paid API key). The model must call the catalog tools before a price is stated. The model's own sentence is a draft. The printed answer for a comparison or a multi-item basket is built from the tool result.

The interface is bilingual, with Greek as the default and English available. The screens are app screens, not a marketing site. The home screen lists all of the user's lists and opens each list's workspace. The workspace supports product management and shows the people sharing that list. Catalog browsing/search, notices, saved-list history, registration, and login are also part of the app.

## Capabilities and Constraints

Confirmed:

- Register and log in on this API. Passwords are bcrypt hashes. Login is the API's own OAuth2 password grant. Access tokens expire in 15 minutes. A refresh token lasts 14 days, and using it revokes the previous one.
- Shared lists: create, share an invite code, join as an editor. The owner and every editor can add, change, and remove products while the list is open. Saving snapshots the current pack price and unit price, then locks the list. A later edit is rejected.
- List item quantities are whole pack counts from 1 to 9,999; fractional quantities are rejected. Reducing a line to 0 removes it from the list.
- Member management: list details expose the current members and the current member's role. The owner may remove other members; editors may not. Joining uses an invite code.
- A list line points at a catalog product and keeps the short product name and the chain name. Its image is read from the catalog product URL; images and long descriptions are not copied onto the list line.
- The other members get a stored notice and, if connected, a live stream event when someone adds, updates, or removes a product, joins, or saves. The person who made the change is not notified about their own edit. The stream uses a 30-second single-use ticket so the access token is not put in the URL.
- Catalog results group only exact normalized product names across shops, then show each matching offer's shop, pack price, unit price, and update date in the offer chooser. Category and result counts refer to grouped products. Everyday Greek is folded so a phrase like "ένα γάλα 1 λίτρου" can match `γάλα` and `1lt`.
- Category totals use the same priced product groups as catalog results, and category tiles use representative `image_url` values already in the product table. When multiple lists are open, shoppers can choose the destination list directly in the catalog. The catalog also shows the selected open list in a collapsible basket sidebar, grouped by supermarket with quantities and totals; shoppers can update items or save the list without leaving the catalog.
- A one-product comparison picks the cheapest matching pack and also shows the other matching products' cheapest shop prices. A two-item basket can show a split across shops and a one-shop total. A tie lists every tied shop.
- Phone lock-screen alerts are not built. They are planned for the installed apps through Firebase on Android and Apple push on iPhone.
- History is a page of lists this member already saved. Each entry shows the list title, when it was saved, who saved it, and the lines with the pack price and unit price copied at save. A saved list stays locked. `GET /lists` already returns `status` and `saved_at` for the member's lists, and the list detail returns those saved prices. A chart of one product's price over time was not requested.

Still undecided:

- A Firebase project for phone push does not exist yet.
- No accessibility standard was set.

## Evidence on Hand

- README.md describes the catalog fields, the shared-list API, and the `ask` command.
- The Express API is in `api/`. Migration `007_api_tokens_and_notifications.sql` adds refresh tokens and list notices.
- The loaded catalog is the Greece extract from posokanei.gov.gr. Chain names on that site include Χαλκιαδάκης, My Market, Γαλαξίας, Κρητικός, and Μασούτης.
- There is no logo file yet and no written brand voice. Product thumbnails and category tiles use image URLs already stored in the catalog; do not invent product images, prices, testimonials, or shopper counts.

## Brand Commitments

The public product name is **Super Market List**. The mark is a short shopping list. It is not a shopping cart, and it has no item-count badge. A small price may sit beside the list only when the list alone is unclear. There is no separate logo file; the interface draws the list mark beside the product name.

The selected interface direction is **Verified Price Index**: a cool paper ground, aligned product and price rows, and a quiet teal signal. The interface defaults to Greek and provides an English language switch.

## Product Principles

- A price on screen is a catalog price, or it is absent.
- Every member of an open list can manage it. Saving is when the prices are kept and the list stops changing.
- Owners can delete open lists; saved lists in History are read-only and cannot be deleted.
- The home screen gives access to all lists; each list opens a workspace for its products and members.
- Only the owner can remove other people from a list.
- One bilingual Angular interface is the website and both phone apps. Greek is the default, English is available, and the same interface is responsive from phone width to desktop width, with phone use prioritized.
- Show the short name, shop, and price, with catalog thumbnails where an image URL exists. Leave out long descriptions.
- The other people on the list hear about a change. The person who made it does not get that notice.
