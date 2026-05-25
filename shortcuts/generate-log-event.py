#!/usr/bin/env python3
"""
Reference generator for the "Mark" shortcut family.

The canonical, hand-maintained shortcuts live next to this file as backups:
    mark.shortcut        the real core (exported from the Shortcuts app)
    mark-monk.shortcut   a real wrapper example

This script is a *reference* that reproduces their structure. It writes to a
generated/ subfolder so it NEVER overwrites those backups. Structure mirrors
the real exports (verified against mark.shortcut):
  - has-any-value conditional uses WFCondition 100
  - source = Device Details → "Device Type"
  - dictionary maps display labels + lowercase + aliases to event_type

Hub-and-spoke design (Apple does NOT support inline Siri parameters for
Shortcuts-app shortcuts, so "Hey Siri, Mark Food" only works if the whole
phrase is a shortcut name):
  - core "Mark"   reads Shortcut Input if a wrapper passed one, else menu.
  - wrappers      "Mark Coffee" etc. run the core with their label as input.

Usage:
    python3 shortcuts/generate-log-event.py   # writes to shortcuts/generated/
"""

import plistlib
import uuid
import os

CORE_NAME = "Mark"

# Menu order matches the real core (mark.shortcut).
LIST_ITEMS = [
    "Monk",
    "Chairmaxxing",
    "Coffee",
    "Food",
    "Water",
    "Custom",
]

# Dictionary used for label → event_type lookup. Includes lowercase variants so
# Siri input works whether or not the spoken word is capitalised. Aliases:
# monk → nof, chair → chairmaxxing.
# NOTE: the real mark.shortcut currently maps "chair" → "chair" (a typo); the
# intended mapping is chair → chairmaxxing as below. Fix it in the app's
# Dictionary action so "Mark Chair" logs chairmaxxing, not chair.
EVENT_TYPE_MAP = {
    "Coffee":       "caffeine",
    "coffee":       "caffeine",
    "Food":         "food",
    "food":         "food",
    "Water":        "water",
    "water":        "water",
    "Monk":         "nof",
    "monk":         "nof",
    "Chairmaxxing": "chairmaxxing",
    "chairmaxxing": "chairmaxxing",
    "Chair":        "chairmaxxing",
    "chair":        "chairmaxxing",
    "Custom":       "custom",
    "custom":       "custom",
}

# Wrappers: (name suffix, value passed to the core). Aliases keep Siri reliable
# and discreet: "Mark Monk" passes "monk" → nof, "Mark Chair" passes "chair"
# → chairmaxxing (both resolved by the dictionary above).
WRAPPERS = [
    ("Coffee", "Coffee"),
    ("Food",   "Food"),
    ("Water",  "Water"),
    ("Monk",   "Monk"),
    ("Chair",  "chair"),
    ("Custom", "Custom"),
]

# workflowIdentifier of the existing "Mark" core on the device, taken from the
# user's working "Mark Chair" wrapper. Generated wrappers reference Mark by this
# id + name so they bind to the existing core on import.
MARK_IDENTIFIER = "AAB25E6A-FBD2-4C49-BFA3-C18D59977D64"

# ── Token helpers ─────────────────────────────────────────────────────────────

def literal(text):
    """Plain text token with no variable attachments."""
    return {
        "Value": {"string": text, "attachmentsByRange": {}},
        "WFSerializationType": "WFTextTokenString",
    }

def var_ref(name):
    """Single-character text token that resolves to a named variable."""
    return {
        "Value": {
            "string": "￼",  # U+FFFC Object Replacement Character
            "attachmentsByRange": {
                "{0, 1}": {"Type": "Variable", "VariableName": name},
            },
        },
        "WFSerializationType": "WFTextTokenString",
    }

# ── Action builders ───────────────────────────────────────────────────────────

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

def set_variable_from(name, token):
    """Store an explicit token (e.g. Shortcut Input) into a named variable."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {"WFVariableName": name, "WFInput": token},
    }

def shortcut_input_token():
    """Magic variable reference to the shortcut's input (Siri spoken words)."""
    return {
        "Value": {"Type": "ExtensionInput"},
        "WFSerializationType": "WFTextTokenAttachment",
    }

def list_action(items):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.list",
        "WFWorkflowActionParameters": {
            "WFItems": [
                {
                    "WFItemType": 0,
                    "WFValue": literal(item),
                }
                for item in items
            ]
        },
    }

def choose_from_list(prompt):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.choosefromlist",
        "WFWorkflowActionParameters": {
            "WFChooseFromListActionPrompt": prompt,
        },
    }

def get_dictionary(mapping):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getdictionary",
        "WFWorkflowActionParameters": {
            "WFInput": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {"WFItemType": 0, "WFKey": literal(k), "WFValue": literal(v)}
                        for k, v in mapping.items()
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            }
        },
    }

def get_value_for_key(key_token):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
        "WFWorkflowActionParameters": {
            "WFDictionaryKey": key_token,
        },
    }

IF_INPUT_UUID = str(uuid.uuid4()).upper()
IF_CUSTOM_UUID = str(uuid.uuid4()).upper()

def if_equals(var_name, equals_value, group_uuid):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "WFControlFlowMode": 0,
            "GroupingIdentifier": group_uuid,
            "WFCondition": 4,  # "is" (equals)
            "WFInput": {
                "Value": {"Type": "Variable", "VariableName": var_name},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFConditionalActionString": equals_value,
        },
    }

def if_has_value(token, group_uuid):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "WFControlFlowMode": 0,
            "GroupingIdentifier": group_uuid,
            "WFCondition": 100,  # "has any value" (verified against real mark.shortcut)
            "WFInput": {
                "Type": "Variable",
                "Variable": token,
            },
        },
    }

def if_else(group_uuid):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "WFControlFlowMode": 1,
            "GroupingIdentifier": group_uuid,
        },
    }

def if_end(group_uuid):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.conditional",
        "WFWorkflowActionParameters": {
            "WFControlFlowMode": 2,
            "GroupingIdentifier": group_uuid,
        },
    }

def ask_for_input(prompt):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.ask",
        "WFWorkflowActionParameters": {
            "WFAskActionPrompt": prompt,
            "WFInputType": "Text",
        },
    }

def dict_field(key_str, value_token):
    return {
        "WFItemType": 0,
        "WFKey": literal(key_str),
        "WFValue": value_token,
    }

def post_to_url():
    """GET Contents of URL — POST with JSON body. URL filled in at import time."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "WFURL": literal(""),  # replaced by WFWorkflowImportQuestions
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "WFRequestVariable": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        dict_field("event_type", var_ref("event_type")),
                        dict_field("value",      literal("")),
                        dict_field("notes",      var_ref("custom_value")),
                        dict_field("source",     var_ref("source")),
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

def device_details_action():
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getdevicedetails",
        "WFWorkflowActionParameters": {
            "WFDeviceDetail": "Device Type",  # matches the real mark.shortcut
        },
    }

def speak_action(text):
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.speak",
        "WFWorkflowActionParameters": {"WFText": literal(text)},
    }

def gettext_action(text, action_uuid):
    """Text action emitting a plain literal string, tagged with a UUID."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFTextActionText": text,
        },
    }

def setvariable_from_output(name, output_uuid, output_name="Text"):
    """Set a variable from a previous action's output (referenced by UUID)."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {
            "WFVariableName": name,
            "WFInput": {
                "Value": {
                    "OutputName": output_name,
                    "OutputUUID": output_uuid,
                    "Type": "ActionOutput",
                },
                "WFSerializationType": "WFTextTokenAttachment",
            },
        },
    }

def run_workflow(target_name, target_identifier, input_var):
    """Run another shortcut (by id + name), passing a variable as its input."""
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.runworkflow",
        "WFWorkflowActionParameters": {
            "UUID": str(uuid.uuid4()).upper(),
            "WFInput": {
                "Value": {"Type": "Variable", "VariableName": input_var},
                "WFSerializationType": "WFTextTokenAttachment",
            },
            "WFWorkflow": {
                "isSelf": False,
                "workflowIdentifier": target_identifier,
                "workflowName": target_name,
            },
            "WFWorkflowName": target_name,
        },
    }

ICON = {
    "WFWorkflowIconGlyphNumber": 59511,
    "WFWorkflowIconStartColor": 1284543743,
}

def build_core():
    """The core 'Mark' shortcut — does the lookup + POST."""
    actions = [
        # 1. Use Shortcut Input if present (from a wrapper), else show the menu
        if_has_value(shortcut_input_token(), IF_INPUT_UUID),
        set_variable_from("label", shortcut_input_token()),
        if_else(IF_INPUT_UUID),
        list_action(LIST_ITEMS),
        choose_from_list("What are you logging?"),
        set_variable("label"),
        if_end(IF_INPUT_UUID),

        # 2. Map label → lowercase event_type (dictionary has both cases)
        get_dictionary(EVENT_TYPE_MAP),
        get_value_for_key(var_ref("label")),
        set_variable("event_type"),

        # 3. Initialise custom_value to empty string
        text_action(""),
        set_variable("custom_value"),

        # 4. If custom → ask for free text and overwrite custom_value
        if_equals("event_type", "custom", IF_CUSTOM_UUID),
        ask_for_input("Describe the event"),
        set_variable("custom_value"),
        if_end(IF_CUSTOM_UUID),

        # 5. Capture device model automatically
        device_details_action(),
        set_variable("source"),
    ]
    post_index = len(actions)
    actions.append(post_to_url())
    actions.append(speak_action("Got it"))

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2600.1",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowIcon": ICON,
        "WFWorkflowImportQuestions": [
            {
                "ActionIndex": post_index,
                "Category": "Parameter",
                "DefaultValue": "",
                "ParameterKey": "WFURL",
                "Text": "Paste your Apps Script webhook URL",
            }
        ],
        "WFWorkflowHasShortcutInputVariables": True,
        "WFWorkflowInputContentItemClasses": ["WFStringContentItem"],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": CORE_NAME,
        "WFWorkflowTypes": ["WFSiriType", "Watch"],
    }

def build_wrapper(suffix, value):
    """A wrapper named e.g. 'Mark Coffee': Text → Set Variable → Run Shortcut.

    Mirrors the structure of a wrapper built by hand in the Shortcuts app.
    """
    text_uuid = str(uuid.uuid4()).upper()
    actions = [
        gettext_action(value, text_uuid),
        setvariable_from_output("mark_input", text_uuid),
        run_workflow(CORE_NAME, MARK_IDENTIFIER, "mark_input"),
    ]
    return {
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "4407",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": ICON,
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": f"{CORE_NAME} {suffix}",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["Watch", "WFWorkflowTypeShowInSearch"],
    }

# ── Write all .shortcut files ─────────────────────────────────────────────────
# Output goes to generated/ so the real backups (mark.shortcut, mark-monk.shortcut)
# next to this script are never overwritten.

here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, "generated")
os.makedirs(out_dir, exist_ok=True)

def write_shortcut(shortcut_dict, filename):
    path = os.path.join(out_dir, filename)
    with open(path, "wb") as f:
        plistlib.dump(shortcut_dict, f, fmt=plistlib.FMT_BINARY)
    print(f"✓ generated/{filename}")

print("Generating Mark shortcut family into generated/ :")
write_shortcut(build_core(), "mark.shortcut")
for suffix, value in WRAPPERS:
    write_shortcut(build_wrapper(suffix, value), f"mark-{suffix.lower()}.shortcut")

print()
print("Wrappers reference the real Mark by id:", MARK_IDENTIFIER)
print("Reminder: in the app, fix the Dictionary so 'chair' → 'chairmaxxing' (it currently maps chair → chair).")
