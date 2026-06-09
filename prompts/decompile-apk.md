---
description: Decompile an Android APK/XAPK/JAR/AAR and analyze its structure
---
Use subagent android-reverse-engineer to perform the tasks.

# /decompile

Decompile an Android application and perform initial structure analysis.

## Instructions

You are starting the Android reverse engineering workflow. Follow these steps:

### Step 1: Get the target file

If the user provided a file path as an argument, use that. Otherwise, ask the user for the path to the APK, XAPK, JAR, or AAR file they want to decompile.

### Step 2: Check and install dependencies

Run the dependency check:

```bash
bash ~/.pi/agent/skills/android-reverse-engineering/scripts/check-deps.sh
```

Parse the output looking for `INSTALL_REQUIRED:` and `INSTALL_OPTIONAL:` lines.

**If required dependencies are missing**, stop the follow and mention which are missing.

### Step 3: Decompile

Run the decompile script on the target file. Choose the engine based on the input:

- **APK or XAPK** → use jadx first (handles resources natively; XAPK is auto-extracted):

  ```bash
  bash ~/.pi/agent/skills/android-reverse-engineering/scripts/decompile.sh <file>
  ```

- **JAR/AAR** and Vineflower or Fernflower is available → prefer vineflower for better Java output:

  ```bash
  bash ~/.pi/agent/skills/android-reverse-engineering/scripts/decompile.sh --engine fernflower <file>
  ```

- **If jadx output has warnings** or the user wants the best quality → run both and compare:

  ```bash
  bash ~/.pi/agent/skills/android-reverse-engineering/scripts/decompile.sh --engine both <file>
  ```

For obfuscated apps (if the user mentions it or you detect single-letter package names), add `--deobf`:

```bash
bash ~/.pi/agent/skills/android-reverse-engineering/scripts/decompile.sh --deobf <file>
```

### Step 4: Analyze structure

After decompilation completes:

1. Read `AndroidManifest.xml` from the resources directory. For XAPK, check the base APK's output first.
2. If XAPK, review `xapk-manifest.json` in the output directory to understand the split structure.
3. List the top-level package structure
4. Identify the app's main Activity, Application class, and architecture pattern
5. Report a summary to the user

### Step 5: Offer next steps

Tell the user what they can do next:

- **Trace call flows**: "I can follow the execution flow from any Activity to its API calls"
- **Extract APIs**: "I can search for all HTTP endpoints and document them"
- **Analyze specific classes**: "Point me to a specific class or feature to analyze"
- **Re-decompile with Fernflower**: If jadx output has warnings, offer to re-run with `--engine both` for comparison

Refer to the full skill documentation in `~/.pi/agent/skills/android-reverse-engineering/SKILL.md` for the complete workflow.
