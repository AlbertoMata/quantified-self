#!/usr/bin/env python3
"""
Reference generator for the "Health Sync" shortcut.

Health Sync reads Apple Health with native Shortcuts actions and POSTs one daily
row to the health webhook (sheets/health-webhook.gs), which upserts it into
quantified-self-health by date. Full hand-build guide: health-sync.md.

WHAT THIS GENERATOR PRODUCES — read this before importing:
The deterministic *backbone* is generated fully and correctly, so the file always
imports cleanly and the plumbing is already wired:
  - Current Date → Format Date → `date`
  - `exported_at`
  - the 12-key Dictionary referencing every metric variable
  - the POST (Get Contents of URL), with an import question for the webhook URL

The 11 Health *reads* themselves are emitted as labelled Comment placeholders,
each followed by an empty-init Set Variable so the Dictionary/JSON body stays
wired. This is deliberate: the Find Health Samples / Calculate Statistics /
Repeat-loop / Find Workouts action identifiers vary across iOS versions and are
not reliable to emit blind, so generating them risks a broken import. Instead you
get a clean scaffold — import it, then replace each commented block with the real
Health action following health-sync.md (which is the authoritative guide).

So: import → paste webhook URL → fill in the 11 reads. Faster than from scratch,
and it never fails to import.

Usage:
    python3 shortcuts/generate-health-sync.py   # writes shortcuts/generated/health-sync.shortcut
"""

import plistlib
import os

NAME = "Health Sync"

# (variable name, JSON key, human description of the Health read to add in-app).
# Order here = order of the commented blocks in the shortcut. Keys/columns must
# match sheets/health-webhook.gs COLS and sheets/schema-health.md.
METRICS = [
    ("steps",             "steps",             "Find Health Samples: Steps (today) → Calculate Statistics: Sum"),
    ("sleep_hours",       "sleep_hours",       "Find Health Samples: Sleep Analysis 'Asleep' (Start Date in last 18h) → Repeat-sum Duration → ÷3600"),
    ("hrv_ms",            "hrv_ms",            "Find Health Samples: Heart Rate Variability (today) → Calculate Statistics: Average"),
    ("resting_hr_bpm",    "resting_hr_bpm",    "Find Health Samples: Resting Heart Rate (today) → Calculate Statistics: Average"),
    ("active_calories",   "active_calories",   "Find Health Samples: Active Energy (today) → Calculate Statistics: Sum"),
    ("stand_hours",       "stand_hours",       "Find Health Samples: Apple Stand Hour (today) → Count Items"),
    ("workout_minutes",   "workout_minutes",   "Find Workouts (today) → Repeat-sum Duration → ÷60"),
    ("blood_oxygen_pct",  "blood_oxygen_pct",  "Find Health Samples: Blood Oxygen Saturation (today) → Calculate Statistics: Average"),
    ("noise_exposure_db", "noise_exposure_db", "Find Health Samples: Environmental Sound Levels (today) → Calculate Statistics: Average"),
    ("mindful_minutes",   "mindful_minutes",   "Find Health Samples: Mindful Session (today) → Repeat-sum Duration → ÷60"),
]

# Final JSON body order (matches schema-health.md columns A→L).
BODY_KEYS = [
    ("date",              "date"),
    ("steps",             "steps"),
    ("sleep_hours",       "sleep_hours"),
    ("hrv_ms",            "hrv_ms"),
    ("resting_hr_bpm",    "resting_hr_bpm"),
    ("active_calories",   "active_calories"),
    ("stand_hours",       "stand_hours"),
    ("workout_minutes",   "workout_minutes"),
    ("blood_oxygen_pct",  "blood_oxygen_pct"),
    ("noise_exposure_db", "noise_exposure_db"),
    ("mindful_minutes",   "mindful_minutes"),
    ("exported_at",       "exported_at"),
]

# ── Token helpers (same idioms as generate-log-event.py) ───────────────────────

def literal(text):
    return {
        "Value": {"string": text, "attachmentsByRange": {}},
        "WFSerializationType": "WFTextTokenString",
    }

def var_ref(name):
    """Single-character text token that resolves to a named variable."""
    return {
        "Value": {
            "string": "￼",  # Object Replacement Character
            "attachmentsByRange": {
                "{0, 1}": {"Type": "Variable", "VariableName": name},
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }

# ── Action builders ────────────────────────────────────────────────────────────

def comment(text):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.comment",
        "WFWorkflowActionParameters": {"WFCommentActionText": text},
    }

def text_action(text):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.text",
        "WFWorkflowActionParameters": {"WFTextActionText": literal(text)},
    }

def set_variable(name):
    """Store the output of the previous action into a named variable."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {"WFVariableName": name},
    }

def current_date():
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.date",
        "WFWorkflowActionParameters": {},
    }

def format_date(fmt):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
        "WFWorkflowActionParameters": {
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": fmt,
        },
    }

def dict_field(key_str, value_token):
    return {"WFItemType": 0, "WFKey": literal(key_str), "WFValue": value_token}

def dictionary_action(pairs):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        dict_field(k, var_ref(v)) for k, v in pairs
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            }
        },
    }

def post_to_url():
    """Get Contents of URL — POST JSON (the previous Dictionary). URL set on import."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "WFURL": literal(""),  # filled by WFWorkflowImportQuestions
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFJSONValues": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        dict_field(k, var_ref(v)) for k, v in BODY_KEYS
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        dict_field("Content-Type", literal("application/json")),
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }

ICON = {
    "WFWorkflowIconGlyphNumber": 59511,
    "WFWorkflowIconStartColor": 1284543743,
}

def build():
    actions = [
        comment(
            "Health Sync — reads Apple Health and POSTs a daily row.\n"
            "Backbone (date, dictionary, POST + URL prompt) is ready.\n"
            "Replace each '>> ADD:' comment below with the real Health action\n"
            "from shortcuts/health-sync.md, then delete the empty Set Variable\n"
            "init that follows it."
        ),

        # date  (real, correct)
        current_date(),
        format_date("yyyy-MM-dd"),
        set_variable("date"),
    ]

    # One commented placeholder + empty init per metric, so the JSON body stays wired.
    for var, _key, how in METRICS:
        actions.append(comment(f">> ADD ({var}): {how}"))
        actions.append(text_action(""))
        actions.append(set_variable(var))

    # exported_at  (real, correct)
    actions.append(current_date())
    actions.append(set_variable("exported_at"))

    # Dictionary preview (handy in-app) + POST carrying the JSON body.
    actions.append(dictionary_action(BODY_KEYS))
    post_index = len(actions)
    actions.append(post_to_url())

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2600.1",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": ICON,
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": post_index,
                "Category": "Parameter",
                "DefaultValue": "",
                "ParameterKey": "WFURL",
                "Text": "Paste your Health webhook URL (the quantified-self-health Web App)",
            }
        ],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": NAME,
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["Watch", "WFWorkflowTypeShowInSearch"],
    }

# ── Write ──────────────────────────────────────────────────────────────────────
# Output goes to generated/ (gitignored), like generate-log-event.py.

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, "generated")
os.makedirs(out_dir, exist_ok=True)

path = os.path.join(out_dir, "health-sync.shortcut")
with open(path, "wb") as f:
    plistlib.dump(build(), f, fmt=plistlib.FMT_BINARY)

print("✓ generated/health-sync.shortcut")
print("Import it, paste the Health webhook URL when asked, then fill in the 11")
print("Health reads marked '>> ADD' following shortcuts/health-sync.md.")
