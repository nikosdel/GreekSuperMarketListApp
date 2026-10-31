"""Review the catalog tools from the terminal. This command does not call an AI."""

from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal

from catalog.tools import TOOL_SPECS, cheapest_basket, compare_product, search_products


def _utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass


def main(argv: list[str]) -> int:
    _utf8_stdio()
    parser = argparse.ArgumentParser(
        prog="python -m catalog",
        description="Read the local supermarket catalog. No AI API is called.",
    )
    parser.add_argument("--json", action="store_true", help="print JSON instead of text")
    sub = parser.add_subparsers(dest="command", required=True)

    search = sub.add_parser("search", help="find offers by name")
    search.add_argument("query")
    search.add_argument("--category", help="words that must appear in the category path")
    search.add_argument("--limit", type=int, default=12)

    compare = sub.add_parser("compare", help="compare one product across shops")
    compare.add_argument("query")

    basket = sub.add_parser("basket", help="cheapest pack for each item")
    basket.add_argument("items", nargs="+")

    sub.add_parser("tools", help="list the tool definitions for a later free model")

    args = parser.parse_args(argv[1:])
    try:
        if args.command == "search":
            payload = [
                offer.to_dict()
                for offer in search_products(args.query, category=args.category, limit=args.limit)
            ]
            text = _search_text(args.query, payload, category=args.category)
        elif args.command == "compare":
            result = compare_product(args.query)
            payload = result.to_dict()
            text = _compare_text(payload)
        elif args.command == "basket":
            result = cheapest_basket(args.items)
            payload = result.to_dict()
            text = _basket_text(payload)
        else:
            payload = TOOL_SPECS
            text = json.dumps(TOOL_SPECS, ensure_ascii=False, indent=2)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if args.json or args.command == "tools":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(text)
    return 0


def _search_text(query: str, offers: list[dict], *, category: str | None) -> str:
    title = f"Search: {query}"
    if category:
        title += f"  in {category}"
    lines = [title, f"{len(offers)} offers, cheapest pack price first", ""]
    if not offers:
        lines.append("No product name contains those words.")
        return "\n".join(lines)
    for offer in offers:
        lines.append(_offer_line(offer))
        if offer["category_path"]:
            lines.append(f"    {offer['category_path']}")
    return "\n".join(lines)


def _compare_text(result: dict) -> str:
    lines = [f"Compare: {result['query']}"]
    if not result["chosen_name"]:
        lines.append("No product name contains those words.")
        return "\n".join(lines)
    chosen = next(hit for hit in result["candidates"] if hit["name"] == result["chosen_name"])
    lines.append(f"Chosen: {result['chosen_name']} ({chosen['shops']} shops)")
    others = [hit for hit in result["candidates"] if hit["name"] != result["chosen_name"]]
    if others:
        lines.append("Other names with the same words:")
        for hit in others:
            lines.append(f"  {hit['shops']} shops  {hit['name']}")
    category = next(
        (offer["category_path"] for offer in result["offers"] if offer["category_path"]),
        None,
    )
    if category:
        lines.append(f"Category: {category}")
    lines.append("")
    lines.append(f"{len(result['offers'])} shops, cheapest pack price first")
    for offer in result["offers"]:
        lines.append(_offer_line(offer, include_name=False))
    return "\n".join(lines)


def _basket_text(result: dict) -> str:
    lines = ["Basket"]
    if not result["complete"]:
        lines.append("One or more items had no matching product, so there is no one-shop total.")
    lines.append("")
    lines.append("Cheapest pack of each chosen product (shops may differ)")
    for line in result["lines"]:
        lines.append(f"Item: {line['query']}")
        if line["offer"] is None:
            lines.append("  No product name contains those words.")
            continue
        lines.append(f"  Chosen: {line['chosen_name']}")
        if line["offer"]["category_path"]:
            lines.append(f"  {line['offer']['category_path']}")
        others = [hit for hit in line["candidates"] if hit["name"] != line["chosen_name"]]
        if others:
            lines.append("  Also matched:")
            for hit in others[:3]:
                lines.append(f"    {hit['shops']} shops  {hit['name']}")
        lines.append(f"  {_offer_line(line['offer'], include_name=False)}")
    lines.append("")
    lines.append(f"Split total: {_money(result['split_total'])}")
    lines.append("")
    if result["one_shop"]:
        lines.append("One shop for every chosen product, cheapest total first")
        for shop in result["one_shop"]:
            lines.append(f"{_money(shop['total'])}  {shop['shop']}")
    elif result["complete"]:
        lines.append("No single shop sells every chosen product.")
    return "\n".join(lines)


def _offer_line(offer: dict, *, include_name: bool = True) -> str:
    unit = offer["unit_price_text"] or "no unit price"
    observed = offer["observed_on"] or "no date"
    name = f"  {offer['name']}" if include_name else ""
    return f"{_money(offer['price'])}   {unit}   {observed}   {offer['shop']}{name}"


def _money(value: str) -> str:
    quantized = Decimal(value).quantize(Decimal("0.01"))
    return f"{quantized} €"


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
