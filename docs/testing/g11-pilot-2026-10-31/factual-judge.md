# G11 factual-consistency judge (eval only)

Model groq/openai/gpt-oss-120b, set pilot, code c9d3f86. 4 call attempt(s), 4 provider call(s) including SDK retries; 197 s elapsed.

**Tokens:** 14839 reported (12278 input, 2561 output); 22248 conservatively charged against the budget. The charge is budget accounting, not measured usage: a call without reported usage is charged at its full allowance.

| Call | Attempt | Status | Failure | Input | Output | ms | Provider calls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pilot 1 of 4 | 1 | completed |  | 4100 | 870 | 2517 | 1 |
| pilot 2 of 4 | 1 | provider failure | status 400, malformed tool call | 0 | 0 | 3701 | 1 |
| pilot 3 of 4 | 1 | completed |  | 4086 | 955 | 2654 | 1 |
| pilot 4 of 4 | 1 | completed |  | 4092 | 736 | 2301 | 1 |

## development

**Provider completion:** 3 of 4 call attempt(s) returned a tool call.

**Valid-result coverage of 8 cases:** provider failures 2; not run 0; invalid responses 6; valid judgments 0.

**Overall, over every labeled case (missing and invalid results count as failures):** defects whose whole false detail a non-supported assertion quotes 0 of 4 (necessary, not sufficient: whether each rejection challenges that detail is confirmed by hand, from the review table below); accurate texts accepted 0 of 4. These measure judgments against the labels, not call completion.

**Valid judgments:**

| Result | Count | Cases |
| --- | --- | --- |
| Defects whose whole false detail is quoted in a rejection (pending manual confirmation) | 0 | none |
| Defects detected on another detail | 0 | none |
| …misclassified (contradicted vs unsupported) | 0 | none |
| Missed defects (judged supported) | 0 | none |
| False positives (accurate text rejected) | 0 | none |
| Unclear on labeled cases | 0 | none |
| Boundary violations (counted as unsupported) | 0 | none |
| Ambiguous (not scored) | 0 |  |

**Invalid responses:**
- C07: claim words no assertion quotes: but
- C09: claim not quoted exactly; claim words no assertion quotes: but; assertion 1 (state): quotation not in Hour 60 outcome: "Power is restored but the building’s central heating is slow"; assertion 2 (state): quotation not in Hour 60 outcome: "central heating is slow to recover, keeping indoor temperatu"
- C16: assertion 1: its quote isn't a span of the claim ("Stored: 1 gallon of stored water (about 1.0 days a"); claim words no assertion quotes: your, would, have, run, out
- C19: claim not quoted exactly; assertion 1: its quote isn't a span of the claim ("the circuit breaker trips"); claim words no assertion quotes: showed; assertion 1 (state): quotation not in Hour 72 outcome: "the heater runs for a short time before the breaker trips ag"; assertion 2 (state): quotation not in Hour 72 outcome: "you locate a small 1500‑watt space heater ... Within about 1"; assertion 2 (state): quotation not in Hour 72 outcome: "the heater runs for a short time before the breaker trips ag"
- C56: claim words no assertion quotes: story, introduced
- C58: assertion 1: its quote isn't a span of the claim ("You locate a small 1500‑watt space heater stored i"); assertion 2: its quote isn't a span of the claim ("Within about 10 minutes the circuit breaker trips,"); claim words no assertion quotes: tripped, twice, when, plugged

## Note checks


## Rejected assertions on defects, for manual review

Does each rejection challenge the false detail itself, rather than another part of the quote?

| Case | False detail | Rejected assertion | Verdict | Evidence cited | Missing | Explanation |
| --- | --- | --- | --- | --- | --- | --- |
| C07 | six hours later | (none rejected) | | | | Both power restoration and delayed heating are described in the hour‑60 and hour‑72 outcomes. |
| C16 | 72-hour | (none rejected) | | | | Baseline stored water insufficient for 72 h duration. |
| C19 | cannot support | (none rejected) | | | |  |

## Every case

| Case | Set | Household | Kind | Type | Expected | Verdict | Outcome | Invalid | Boundary | Explanation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C07 | development | alex | defect | heating timeline | contradicted | - | invalid response | claim words no assertion quotes: but |  | Both power restoration and delayed heating are described in the hour‑60 and hour‑72 outcomes. |
| C09 | development | alex | accurate | accurate rewrite (heating timeline) | supported | - | invalid response | claim not quoted exactly; claim words no assertion quotes: but; assertion 1 (state): quotation not in Hour 60 outcome: "Power is restored but the building’s central heating is slow"; assertion 2 (state): quotation not in Hour 60 outcome: "central heating is slow to recover, keeping indoor temperatu" |  |  |
| C25 | development | alex | defect | equipment provenance | contradicted | - | provider failure |  |  |  |
| C16 | development | alex | defect | outage length | contradicted | - | invalid response | assertion 1: its quote isn't a span of the claim ("Stored: 1 gallon of stored water (about 1.0 days a"); claim words no assertion quotes: your, would, have, run, out |  | Baseline stored water insufficient for 72 h duration. |
| C19 | development | alex | defect | causal conclusion | unsupported | - | invalid response | claim not quoted exactly; assertion 1: its quote isn't a span of the claim ("the circuit breaker trips"); claim words no assertion quotes: showed; assertion 1 (state): quotation not in Hour 72 outcome: "the heater runs for a short time before the breaker trips ag"; assertion 2 (state): quotation not in Hour 72 outcome: "you locate a small 1500‑watt space heater ... Within about 1"; assertion 2 (state): quotation not in Hour 72 outcome: "the heater runs for a short time before the breaker trips ag" |  |  |
| C56 | development | alex | accurate | accurate rewrite (equipment provenance) | supported | - | invalid response | claim words no assertion quotes: story, introduced |  | The hour‑72 outcome mentions the heater’s presence. |
| C57 | development | alex | accurate | accurate rewrite (outage length) | supported | - | provider failure |  |  |  |
| C58 | development | alex | accurate | accurate rewrite (causal conclusion) | supported | - | invalid response | assertion 1: its quote isn't a span of the claim ("You locate a small 1500‑watt space heater stored i"); assertion 2: its quote isn't a span of the claim ("Within about 10 minutes the circuit breaker trips,"); claim words no assertion quotes: tripped, twice, when, plugged |  | Hour 72 outcome describes two trips after plugging heater. |
