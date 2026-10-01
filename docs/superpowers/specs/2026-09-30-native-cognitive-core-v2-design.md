# Native Cognitive Core v2

## Goal
Upgrade LegendaryAI Native Core from a bounded intent/tool dispatcher into a modular cognitive layer that is more context-aware, emotionally calibrated, uncertainty-aware, and verifiable without pretending to be a general-purpose LLM.

## Architecture
Input -> normalization -> context resolution + emotion signals + intent candidates -> confidence/ambiguity gate -> cognitive planner -> native tools/rules -> verifier -> response composer -> tone calibration -> output.

## Principles
1. Truthful capability reporting.
2. Deterministic where possible.
3. Confidence-aware clarification instead of guessing.
4. Emotion-aware, not emotion-pretending.
5. Modular and model-agnostic.
6. Regression-tested.

## Modules
### Emotion Engine
Return primary/secondary emotion, intensity 0..1, confidence 0..1, explicit/linguistic/contextual signals, and sarcasm likelihood. Initial classes: neutral, joy, sadness, frustration, anger, anxiety, confusion, disappointment, excitement, gratitude, sarcasm-likely. Never diagnose mental health or assert weak inferences as certain.

### Context Engine
Maintain bounded state: active task, active entity/reference, recent user goal, unresolved clarification, previous action/result, topic continuity. Resolve common Vietnamese/English references such as "nó", "cái đó", "cái này", "vừa nói", "the first one", "the second one" using recent context.

### Intent Engine 2.0
Generate intent candidates with confidence and evidence rather than single first-match regex ordering. Low-confidence/conflicting candidates should trigger the smallest useful clarification.

### Cognitive Planner
Represent goal, constraints, ordered steps, dependencies, tool selection, expected output, and verification requirements. Add bounded primitives for decomposition, sequencing, comparison, constraint checking, contradiction detection, and result verification.

### Response Composer
Native execution returns structured results before prose: answer, confidence, tone, empathy_level, verbosity, structure, caveats. Tone uses emotion signals, mode, task type, and requested verbosity. It should acknowledge frustration briefly without claiming subjective feelings.

### Memory Boundary
Use relevant conversation context and explicit stored memories only. Do not infer durable preferences from one emotional message. Never store secrets or credentials.

### Verification
Check non-empty output, allowed tools, numeric validity, structured-data validity, context/reference consistency, contradiction checks where applicable, and bounded output. Internal metadata must not leak.

## EQ Benchmark
Create 40-50 deterministic scenarios covering emotion recognition, empathy calibration, sarcasm, frustration, conflict, ambiguity, social reasoning, tone adaptation, user correction, uncertainty, and boundaries. Score observable criteria, not niceness. Add regression tests.

## Compatibility
Keep existing safe_math, unit_convert, json_format, extractive_summary, code_diagnostics, and safe_template tools. Keep Ollama-compatible and Hugging Face routing unchanged until the cognitive layer is independently tested.

## Non-goals
No fake LLM behavior, no hidden chain-of-thought exposure, no unsupported factual verification claims, no psychological diagnosis, no automatic HF activation, no unbounded memory/autonomous action.

## Rollout
1. Add pure modules and unit tests.
2. Add EQ/context regression suite.
3. Integrate structured output behind a feature flag.
4. Run existing tests plus EQ benchmark.
5. Enable by default only after regression checks pass.
6. Preserve bounded fallback.
