# Capture workflow logs for debugging image save

Use these steps to capture the server logs from a Generate run so we can see why `cover_photo_path` is null.

## Step 1: Start the dev server and capture logs

In your project root, run:

```bash
cd "/Users/prestonschlagheck/Downloads/Code Projects/diffuse.ai" && npm run dev 2>&1 | tee workflow-debug.log
```

Leave this running. The app will work as usual, and everything the server prints (including `[workflow]` lines) will also be written to `workflow-debug.log`.

## Step 2: Trigger a Generate

In the browser:

1. Open a project that has inputs.
2. Go to the **Outputs** tab.
3. Click **Generate** (or Quick) and complete the flow so one new output is created with an image.

Wait until the run finishes (you see the new output).

## Step 3: Get the workflow lines from the log

In a **new** terminal (don’t stop the dev server), run:

```bash
cd "/Users/prestonschlagheck/Downloads/Code Projects/diffuse.ai" && grep '\[workflow\]' workflow-debug.log | tail -60
```

That prints the last 60 lines that contain `[workflow]` from the log file.

**Or** to see the last 80 lines of the whole log (includes any other errors):

```bash
cd "/Users/prestonschlagheck/Downloads/Code Projects/diffuse.ai" && tail -80 workflow-debug.log
```

## Step 4: Share the output

Copy the terminal output from Step 3 and paste it here (or into the chat). From that we can see:

- Whether the image **download** failed (e.g. `Generated image fetch failed: 403`) or
- Whether the **upload** to Supabase failed (e.g. `Generated image upload failed:`) or
- Whether the **DB update** failed (e.g. `DB update failed (cover_photo_path)`) or
- That upload + update succeeded (e.g. `Image uploaded to storage at ...` and `output row updated`).

---

**One-liner** (run after you’ve already done one Generate with the server running and tee):

```bash
grep '\[workflow\]' "/Users/prestonschlagheck/Downloads/Code Projects/diffuse.ai/workflow-debug.log" | tail -60
```
