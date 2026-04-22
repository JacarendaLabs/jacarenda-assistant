#!/usr/bin/env python3
"""
Full Fibery workspace scaffold for Jacarenda Labs.

Destroys the default Experimental Lab template (Projects / Experiments /
Hypotheses / Teams) and builds the complete 11-space business model in a
single idempotent pass:

  1. Brand                  (Brand, Audience Segment)
  2. Services               (Service Line, Engagement, Deliverable, Session, Time Entry)
  3. Marketing              (Campaign, Content, Channel Performance, Case Study,
                             Testimonial, Press Mention)
  4. CRM                    (Company, Contact, Lead, Opportunity)
  5. Accounting             (Invoice, Expense, Revenue Record, Vendor, Subscription)
  6. Product and Web        (Property, Feature, Release, Bug)
  7. Support                (Ticket, Reply, Knowledge Article, Known Issue)
  8. Operations             (SOP, Decision Log, Meeting Note)
  9. People                 (Team Member)
 10. Strategy               (Objective, Key Result, Metric, Metric Reading)
 11. Legal and Contracts    (Contract, Legal Document)

Seeds:
  - Brand             : Jacarenda Labs
  - Service Line × 4  : Consultancy, Advisory, Development, Training
  - Property × 2      : jacarendalabs.com, Jacarenda Assistant (assistant.jacarendalabs.com)

Env:
  FIBERY_WORKSPACE_URL   https://jacarendalabs.fibery.io
  FIBERY_API_TOKEN       Fibery API token

Re-runnable. Types/fields/relations/seeds are skipped if already present.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from typing import Any

WORKSPACE = os.environ.get("FIBERY_WORKSPACE_URL", "").rstrip("/")
TOKEN = os.environ.get("FIBERY_API_TOKEN", "")

if not WORKSPACE or not TOKEN:
    print("ERROR: set FIBERY_WORKSPACE_URL and FIBERY_API_TOKEN", file=sys.stderr)
    sys.exit(1)


# ---------------------------------------------------------------------------
# Field-type shortcuts
# ---------------------------------------------------------------------------
T = {
    "t": "fibery/text",
    "d": "Collaboration~Documents/Document",
    "date": "fibery/date",
    "dt": "fibery/date-time",
    "dec": "fibery/decimal",
}


# ---------------------------------------------------------------------------
# HTTP — shell out to curl (Python's SSL trust store is flaky on some hosts)
# ---------------------------------------------------------------------------


def api(commands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payload = json.dumps(commands)
    proc = subprocess.run(
        [
            "curl", "-sS", "-X", "POST",
            f"{WORKSPACE}/api/commands",
            "-H", f"Authorization: Token {TOKEN}",
            "-H", "Content-Type: application/json",
            "-d", payload,
        ],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        print(f"curl rc={proc.returncode} stderr={proc.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(proc.stdout)


def batch(inner: list[dict[str, Any]]) -> dict[str, Any]:
    return api([{"command": "fibery.schema/batch", "args": {"commands": inner}}])[0]


def one(cmd: str, args: dict[str, Any]) -> dict[str, Any]:
    return api([{"command": cmd, "args": args}])[0]


def get_schema() -> dict[str, Any]:
    return one("fibery.schema/query", {})["result"]


def type_exists(schema: dict[str, Any], qn: str) -> bool:
    return any(t.get("fibery/name") == qn for t in schema.get("fibery/types", []))


def field_exists(schema: dict[str, Any], type_qn: str, field_qn: str) -> bool:
    for t in schema.get("fibery/types", []):
        if t.get("fibery/name") == type_qn:
            return any(f.get("fibery/name") == field_qn for f in t.get("fibery/fields", []))
    return False


# ---------------------------------------------------------------------------
# Mandatory primitive fields every domain Type needs (cribbed from the
# fibery-unofficial npm package — MIT).
# ---------------------------------------------------------------------------

DOMAIN_FIELDS = [
    {"fibery/name": "fibery/name", "fibery/type": "fibery/text",
     "fibery/meta": {"ui/title?": True}},
    {"fibery/name": "fibery/id", "fibery/type": "fibery/uuid",
     "fibery/meta": {"fibery/id?": True, "fibery/readonly?": True}},
    {"fibery/name": "fibery/public-id", "fibery/type": "fibery/text",
     "fibery/meta": {"fibery/public-id?": True, "fibery/readonly?": True}},
    {"fibery/name": "fibery/creation-date", "fibery/type": "fibery/date-time",
     "fibery/meta": {"fibery/creation-date?": True,
                     "fibery/readonly?": True, "fibery/default-value": "$now"}},
    {"fibery/name": "fibery/modification-date", "fibery/type": "fibery/date-time",
     "fibery/meta": {"fibery/modification-date?": True,
                     "fibery/required?": True, "fibery/readonly?": True,
                     "fibery/default-value": "$now"}},
]


# ---------------------------------------------------------------------------
# Schema definition — one flat dict keyed by qualified type name
# ---------------------------------------------------------------------------

# Fields: list of (name, short_type). Mandatory Name field is auto-added.
TYPES: dict[str, list[tuple[str, str]]] = {
    # Brand
    "Brand/Brand": [
        ("Tagline", "t"), ("Positioning", "d"), ("Voice and Tone", "d"),
        ("Dos", "d"), ("Donts", "d"), ("Forbidden Phrases", "t"),
        ("Reference Examples", "d"), ("Website URL", "t"),
    ],
    "Brand/Audience Segment": [
        ("Description", "d"), ("Persona Notes", "d"),
        ("Pain Points", "d"), ("Where They Hang Out", "t"),
    ],

    # Services
    "Services/Service Line": [
        ("Description", "d"), ("Value Proposition", "t"),
        ("Typical Engagement", "t"), ("Ideal Client Profile", "d"),
        ("Pricing Model", "t"), ("Status", "t"),
    ],
    "Services/Engagement": [
        ("Start Date", "date"), ("End Date", "date"), ("Status", "t"),
        ("Scope", "d"), ("Objectives", "d"), ("Value", "dec"),
    ],
    "Services/Deliverable": [
        ("Description", "d"), ("Due Date", "date"),
        ("Status", "t"), ("Type", "t"),
    ],
    "Services/Session": [
        ("Date", "dt"), ("Duration Hours", "dec"),
        ("Format", "t"), ("Notes", "d"),
    ],
    "Services/Time Entry": [
        ("Date", "date"), ("Hours", "dec"),
        ("Description", "t"), ("Billable", "t"),
    ],

    # Marketing
    "Marketing/Campaign": [
        ("Objective", "d"), ("State", "t"), ("Start Date", "date"),
        ("End Date", "date"), ("Channels", "t"), ("Target Audience", "t"),
        ("Key Messages", "d"), ("KPIs", "d"), ("Budget", "dec"),
    ],
    "Marketing/Content": [
        ("Channel", "t"), ("State", "t"), ("Scheduled For", "dt"),
        ("Body", "d"), ("Approved By", "t"),
        ("Published At", "dt"), ("Performance Notes", "d"),
    ],
    "Marketing/Channel Performance": [
        ("Channel", "t"), ("Period Start", "date"), ("Period End", "date"),
        ("Impressions", "dec"), ("Engagements", "dec"),
        ("Clicks", "dec"), ("Followers Gained", "dec"), ("Notes", "d"),
    ],
    "Marketing/Case Study": [
        ("Challenge", "d"), ("Solution", "d"), ("Outcome", "d"),
        ("Quote", "d"), ("Status", "t"),
    ],
    "Marketing/Testimonial": [
        ("Quote", "d"), ("Attribution", "t"), ("Role", "t"), ("Status", "t"),
    ],
    "Marketing/Press Mention": [
        ("Publication", "t"), ("Date", "date"), ("URL", "t"),
        ("Summary", "d"), ("Sentiment", "t"),
    ],

    # CRM
    "CRM/Company": [
        ("Website", "t"), ("Industry", "t"), ("Size", "t"),
        ("Notes", "d"), ("Status", "t"),
    ],
    "CRM/Contact": [
        ("Email", "t"), ("Phone", "t"), ("Role", "t"),
        ("LinkedIn", "t"), ("Notes", "d"),
    ],
    "CRM/Lead": [
        ("Source", "t"), ("Status", "t"), ("Value Estimate", "dec"),
        ("Notes", "d"), ("Next Action", "t"),
    ],
    "CRM/Opportunity": [
        ("Stage", "t"), ("Value", "dec"), ("Probability", "dec"),
        ("Expected Close", "date"), ("Notes", "d"),
    ],

    # Accounting
    "Accounting/Invoice": [
        ("Number", "t"), ("Amount", "dec"), ("Currency", "t"),
        ("Status", "t"), ("Issued Date", "date"),
        ("Due Date", "date"), ("Paid Date", "date"), ("Notes", "d"),
    ],
    "Accounting/Expense": [
        ("Category", "t"), ("Amount", "dec"), ("Currency", "t"),
        ("Vendor Name", "t"), ("Date", "date"), ("Notes", "d"),
    ],
    "Accounting/Revenue Record": [
        ("Source", "t"), ("Amount", "dec"), ("Currency", "t"),
        ("Date", "date"), ("Notes", "d"),
    ],
    "Accounting/Vendor": [
        ("Website", "t"), ("Category", "t"),
        ("Status", "t"), ("Notes", "d"),
    ],
    "Accounting/Subscription": [
        ("Cost Monthly", "dec"), ("Cost Annual", "dec"), ("Currency", "t"),
        ("Renewal Date", "date"), ("Billing Email", "t"),
        ("Status", "t"), ("Notes", "d"),
    ],

    # Product and Web
    "Product/Property": [
        ("URL", "t"), ("Description", "d"),
        ("Tech Stack", "t"), ("Status", "t"),
    ],
    "Product/Feature": [
        ("Description", "d"), ("Status", "t"),
        ("Target Release", "t"), ("Notes", "d"),
    ],
    "Product/Release": [
        ("Version", "t"), ("Released At", "date"),
        ("Release Notes", "d"), ("Status", "t"),
    ],
    "Product/Bug": [
        ("Description", "d"), ("Severity", "t"), ("Status", "t"),
        ("Steps to Reproduce", "d"), ("Fix Notes", "d"),
    ],

    # Support
    "Support/Ticket": [
        ("Description", "d"), ("Status", "t"), ("Priority", "t"),
        ("Channel", "t"), ("Created At", "dt"),
        ("Resolved At", "dt"), ("SLA Deadline", "dt"),
    ],
    "Support/Reply": [
        ("Body", "d"), ("Direction", "t"), ("Via", "t"),
        ("Author", "t"), ("Timestamp", "dt"),
    ],
    "Support/Knowledge Article": [
        ("Problem", "d"), ("Solution", "d"),
        ("Tags", "t"), ("Status", "t"),
    ],
    "Support/Known Issue": [
        ("Description", "d"), ("Workaround", "d"), ("Status", "t"),
    ],

    # Operations
    "Operations/SOP": [
        ("Description", "d"), ("Steps", "d"), ("Owner", "t"),
        ("Last Reviewed", "date"), ("Status", "t"),
    ],
    "Operations/Decision Log": [
        ("Date", "date"), ("Context", "d"), ("Decision", "d"),
        ("Rationale", "d"), ("Participants", "t"),
    ],
    "Operations/Meeting Note": [
        ("Date", "dt"), ("Attendees", "t"),
        ("Agenda", "d"), ("Notes", "d"), ("Action Items", "d"),
    ],

    # People
    "People/Team Member": [
        ("Role", "t"), ("Email", "t"), ("Start Date", "date"),
        ("Status", "t"), ("Notes", "d"),
    ],

    # Strategy
    "Strategy/Objective": [
        ("Description", "d"), ("Quarter", "t"), ("Year", "t"),
        ("Status", "t"), ("Owner", "t"),
    ],
    "Strategy/Key Result": [
        ("Description", "t"), ("Target Value", "dec"),
        ("Current Value", "dec"), ("Unit", "t"), ("Status", "t"),
    ],
    "Strategy/Metric": [
        ("Description", "d"), ("Unit", "t"), ("Target", "dec"),
        ("Good Direction", "t"), ("Cadence", "t"),
    ],
    "Strategy/Metric Reading": [
        ("Value", "dec"), ("Date", "date"), ("Notes", "t"),
    ],

    # Legal and Contracts
    "Legal/Contract": [
        ("Type", "t"), ("Status", "t"), ("Signed Date", "date"),
        ("Effective Date", "date"), ("Expiration Date", "date"),
        ("Value", "dec"), ("Currency", "t"), ("Notes", "d"),
    ],
    "Legal/Legal Document": [
        ("Type", "t"), ("Status", "t"), ("Created Date", "date"),
        ("Expiration Date", "date"), ("Notes", "d"),
    ],
}


# Relations — paired fields on either side with a shared relation UUID.
#   from_many/to_many = "collection?" flag on that side. False = single value.
RELATIONS: list[dict[str, Any]] = [
    # Brand
    {"from": "Brand/Audience Segment", "to": "Brand/Brand",
     "from_field": "Brand", "to_field": "Audience Segments",
     "from_many": False, "to_many": True},

    # Services
    {"from": "Services/Engagement", "to": "Services/Service Line",
     "from_field": "Service Lines", "to_field": "Engagements",
     "from_many": True, "to_many": True},
    {"from": "Services/Engagement", "to": "CRM/Company",
     "from_field": "Client", "to_field": "Engagements",
     "from_many": False, "to_many": True},
    {"from": "Services/Deliverable", "to": "Services/Engagement",
     "from_field": "Engagement", "to_field": "Deliverables",
     "from_many": False, "to_many": True},
    {"from": "Services/Session", "to": "Services/Engagement",
     "from_field": "Engagement", "to_field": "Sessions",
     "from_many": False, "to_many": True},
    {"from": "Services/Time Entry", "to": "Services/Engagement",
     "from_field": "Engagement", "to_field": "Time Entries",
     "from_many": False, "to_many": True},
    {"from": "Services/Time Entry", "to": "People/Team Member",
     "from_field": "Team Member", "to_field": "Time Entries",
     "from_many": False, "to_many": True},

    # Marketing
    {"from": "Marketing/Campaign", "to": "Services/Service Line",
     "from_field": "Service Lines", "to_field": "Campaigns",
     "from_many": True, "to_many": True},
    {"from": "Marketing/Campaign", "to": "Brand/Brand",
     "from_field": "Brand", "to_field": "Campaigns",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Content", "to": "Marketing/Campaign",
     "from_field": "Campaign", "to_field": "Content",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Content", "to": "Brand/Brand",
     "from_field": "Brand", "to_field": "Content",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Channel Performance", "to": "Marketing/Campaign",
     "from_field": "Campaign", "to_field": "Performance Records",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Case Study", "to": "Services/Service Line",
     "from_field": "Service Lines", "to_field": "Case Studies",
     "from_many": True, "to_many": True},
    {"from": "Marketing/Case Study", "to": "CRM/Company",
     "from_field": "Client", "to_field": "Case Studies",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Testimonial", "to": "Marketing/Case Study",
     "from_field": "Case Study", "to_field": "Testimonials",
     "from_many": False, "to_many": True},
    {"from": "Marketing/Press Mention", "to": "Brand/Brand",
     "from_field": "Brand", "to_field": "Press Mentions",
     "from_many": False, "to_many": True},

    # CRM
    {"from": "CRM/Contact", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Contacts",
     "from_many": False, "to_many": True},
    {"from": "CRM/Lead", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Leads",
     "from_many": False, "to_many": True},
    {"from": "CRM/Opportunity", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Opportunities",
     "from_many": False, "to_many": True},
    {"from": "CRM/Opportunity", "to": "Services/Service Line",
     "from_field": "Service Lines", "to_field": "Opportunities",
     "from_many": True, "to_many": True},

    # Accounting
    {"from": "Accounting/Invoice", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Invoices",
     "from_many": False, "to_many": True},
    {"from": "Accounting/Invoice", "to": "Services/Engagement",
     "from_field": "Engagement", "to_field": "Invoices",
     "from_many": False, "to_many": True},
    {"from": "Accounting/Expense", "to": "Accounting/Vendor",
     "from_field": "Vendor", "to_field": "Expenses",
     "from_many": False, "to_many": True},
    {"from": "Accounting/Subscription", "to": "Accounting/Vendor",
     "from_field": "Vendor", "to_field": "Subscriptions",
     "from_many": False, "to_many": True},

    # Product and Web
    {"from": "Product/Feature", "to": "Product/Property",
     "from_field": "Property", "to_field": "Features",
     "from_many": False, "to_many": True},
    {"from": "Product/Release", "to": "Product/Property",
     "from_field": "Property", "to_field": "Releases",
     "from_many": False, "to_many": True},
    {"from": "Product/Bug", "to": "Product/Feature",
     "from_field": "Feature", "to_field": "Bugs",
     "from_many": False, "to_many": True},

    # Support
    {"from": "Support/Ticket", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Tickets",
     "from_many": False, "to_many": True},
    {"from": "Support/Ticket", "to": "CRM/Contact",
     "from_field": "Contact", "to_field": "Tickets",
     "from_many": False, "to_many": True},
    {"from": "Support/Reply", "to": "Support/Ticket",
     "from_field": "Ticket", "to_field": "Replies",
     "from_many": False, "to_many": True},

    # Strategy
    {"from": "Strategy/Key Result", "to": "Strategy/Objective",
     "from_field": "Objective", "to_field": "Key Results",
     "from_many": False, "to_many": True},
    {"from": "Strategy/Key Result", "to": "Strategy/Metric",
     "from_field": "Metric", "to_field": "Key Results",
     "from_many": False, "to_many": True},
    {"from": "Strategy/Metric Reading", "to": "Strategy/Metric",
     "from_field": "Metric", "to_field": "Readings",
     "from_many": False, "to_many": True},

    # Legal
    {"from": "Legal/Contract", "to": "CRM/Company",
     "from_field": "Company", "to_field": "Contracts",
     "from_many": False, "to_many": True},
    {"from": "Legal/Contract", "to": "Services/Engagement",
     "from_field": "Engagement", "to_field": "Contracts",
     "from_many": False, "to_many": True},
]


SEEDS: dict[str, list[str]] = {
    "Brand/Brand": ["Jacarenda Labs"],
    "Services/Service Line": ["Consultancy", "Advisory", "Development", "Training"],
    "Product/Property": [
        "jacarendalabs.com",
        "Jacarenda Assistant (assistant.jacarendalabs.com)",
    ],
}


# Delete the built-in Experimental Lab template so agents don't ingest it.
# Order matters on some backends — leaf types first, then ones that others
# reference. Fibery is usually tolerant within a batch, but we submit in
# reverse-dependency order just in case.
TEMPLATE_TYPES_TO_DELETE = [
    "Jacarenda Labs/Teams",
    "Jacarenda Labs/Hypotheses",
    "Jacarenda Labs/Experiments",
    "Jacarenda Labs/Projects",
]


# ---------------------------------------------------------------------------
# Implementation
# ---------------------------------------------------------------------------


def qname_field(type_qn: str, field: str) -> str:
    """e.g. 'Brand/Brand', 'Tagline' -> 'Brand/Tagline'."""
    app = type_qn.split("/", 1)[0]
    return f"{app}/{field}"


def field_list(type_qn: str) -> list[dict[str, Any]]:
    """Build the full field list for a type — mandatory primitives plus
    custom fields. Every Collaboration~Documents/Document field must be
    flagged as an entity-component (Fibery's validator requires the flag
    on every field of an entity-component database type)."""
    fields: list[dict[str, Any]] = list(DOMAIN_FIELDS)
    for name, short_type in TYPES[type_qn]:
        meta: dict[str, Any] = {}
        if short_type == "d":
            meta["fibery/entity-component?"] = True
        fields.append(
            {
                "fibery/name": qname_field(type_qn, name),
                "fibery/type": T[short_type],
                "fibery/meta": meta,
            },
        )
    return fields


def ensure_field_meta(type_qn: str, field_name: str) -> dict[str, Any]:
    """Meta for a field added via ensure_field (post-type-creation).
    First doc field gets entity-component flag."""
    fields = TYPES.get(type_qn, [])
    # Is this the first "d" field on the type? (only matters if no doc exists yet)
    for name, short_type in fields:
        if name == field_name and short_type == "d":
            # Check whether any earlier doc field exists in the spec
            for earlier_name, earlier_type in fields:
                if earlier_name == field_name:
                    break
                if earlier_type == "d":
                    return {}
            return {"fibery/entity-component?": True}
    return {}


def delete_template_types(schema: dict[str, Any]) -> bool:
    """Delete Experimental Lab template types. Returns True if anything changed."""
    to_delete = [t for t in TEMPLATE_TYPES_TO_DELETE if type_exists(schema, t)]
    if not to_delete:
        print("  (already clean — no template types present)")
        return False

    print(f"  deleting: {', '.join(to_delete)}")
    # Try batch delete in one shot. Fibery usually handles cross-references.
    inner = [
        {"command": "schema.type/delete", "args": {"fibery/name": t}}
        for t in to_delete
    ]
    r = batch(inner)
    if r.get("success"):
        return True

    # Fallback: try one at a time, both arg shapes.
    print(f"  batch delete failed, retrying per-type…")
    for t in to_delete:
        for arg_shape in ({"fibery/name": t}, {"name": t}):
            r = batch([{"command": "schema.type/delete", "args": arg_shape}])
            if r.get("success"):
                print(f"    deleted {t}  (arg={list(arg_shape.keys())[0]})")
                break
        else:
            print(f"    FAILED to delete {t}: {json.dumps(r, indent=2)[:500]}", file=sys.stderr)
    return True


def ensure_type(schema: dict[str, Any], type_qn: str) -> bool:
    if type_exists(schema, type_qn):
        return False
    print(f"  creating type {type_qn}")
    r = batch(
        [
            {
                "command": "schema.type/create",
                "args": {
                    "fibery/name": type_qn,
                    "fibery/meta": {"fibery/domain?": True, "fibery/secured?": True},
                    "fibery/fields": field_list(type_qn),
                },
            },
            {
                "command": "fibery.app/install-mixins",
                "args": {"types": {type_qn: ["fibery/rank-mixin"]}},
            },
        ],
    )
    if not r.get("success"):
        print(f"    FAIL: {json.dumps(r, indent=2)[:800]}", file=sys.stderr)
        sys.exit(1)
    return True


def ensure_relation(schema: dict[str, Any], rel: dict[str, Any]) -> None:
    from_field_qn = qname_field(rel["from"], rel["from_field"])
    to_field_qn = qname_field(rel["to"], rel["to_field"])
    have_from = field_exists(schema, rel["from"], from_field_qn)
    have_to = field_exists(schema, rel["to"], to_field_qn)
    if have_from and have_to:
        return
    print(f"  relation {rel['from']}.{rel['from_field']} ↔ {rel['to']}.{rel['to_field']}")
    relation_uuid = str(uuid.uuid4())
    r = batch(
        [
            {
                "command": "schema.field/create",
                "args": {
                    "fibery/holder-type": rel["from"],
                    "fibery/name": from_field_qn,
                    "fibery/type": rel["to"],
                    "fibery/meta": {
                        "fibery/collection?": rel["to_many"],
                        "fibery/relation": relation_uuid,
                    },
                },
            },
            {
                "command": "schema.field/create",
                "args": {
                    "fibery/holder-type": rel["to"],
                    "fibery/name": to_field_qn,
                    "fibery/type": rel["from"],
                    "fibery/meta": {
                        "fibery/collection?": rel["from_many"],
                        "fibery/relation": relation_uuid,
                    },
                },
            },
        ],
    )
    if not r.get("success"):
        print(f"    FAIL: {json.dumps(r, indent=2)[:800]}", file=sys.stderr)


def seed_entity(type_qn: str, name_value: str) -> None:
    # Query for an existing entity with this name
    query_r = one(
        "fibery.entity/query",
        {
            "query": {
                "q/from": type_qn,
                "q/select": {"fibery/id": "fibery/id", "fibery/name": "fibery/name"},
                "q/where": ["=", ["fibery/name"], "$name"],
                "q/limit": 1,
            },
            "params": {"$name": name_value},
        },
    )
    if query_r.get("success") and query_r.get("result"):
        return
    print(f"  seeding {type_qn}: {name_value}")
    r = one(
        "fibery.entity/create",
        {"type": type_qn, "entity": {"fibery/name": name_value}},
    )
    if not r.get("success"):
        print(f"    FAIL: {json.dumps(r, indent=2)[:500]}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


REQUIRED_SPACES = sorted({qn.split("/", 1)[0] for qn in TYPES.keys()})


def detect_missing_spaces(schema: dict[str, Any]) -> list[str]:
    """Fibery auto-lists an app's namespace as soon as the space exists.
    We detect presence by looking for ANY type whose qualified name starts
    with '<space>/'. Built-in Fibery namespaces like 'fibery/' don't count."""
    present: set[str] = set()
    for t in schema.get("fibery/types", []):
        name = t.get("fibery/name", "")
        if "/" in name:
            present.add(name.split("/", 1)[0])
    return [s for s in REQUIRED_SPACES if s not in present]


def main() -> None:
    print(f"=== Fibery workspace scaffold — {WORKSPACE} ===\n")

    schema = get_schema()

    print("[1/5] Checking spaces…")
    missing = detect_missing_spaces(schema)
    if missing:
        print("\n  ❌ The following spaces don't exist yet. Create them in the")
        print("     Fibery UI first (`+` next to Spaces → Blank space → name it).")
        print("     Then re-run this script.\n")
        for s in missing:
            print(f"       · {s}")
        print()
        print("     Also: delete the 'Experimental Lab' space via the UI if you")
        print("     haven't already (its data blocks programmatic removal).")
        sys.exit(2)
    print("  all 11 spaces present")

    print("\n[2/5] Types…")
    for type_qn in TYPES.keys():
        ensure_type(schema, type_qn)
    schema = get_schema()

    print("\n[3/5] Relations…")
    for rel in RELATIONS:
        ensure_relation(schema, rel)
    schema = get_schema()

    print("\n[4/5] Seed entities…")
    for type_qn, names in SEEDS.items():
        for nm in names:
            seed_entity(type_qn, nm)

    print("\n[5/5] Done.\n")
    print("Register webhook on each database you care about:")
    print("  URL: https://assistant.jacarendalabs.com/webhooks/fibery")
    print("  Suggested databases for Social Media Manager agent:")
    print("    Brand, Service Line, Campaign, Content, Case Study, Testimonial,")
    print("    Press Mention, Channel Performance")


if __name__ == "__main__":
    main()
