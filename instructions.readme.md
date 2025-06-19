use the systemPrompt.yml for your system-level instructions.
Review /logs/*.log files for any failing builds or tests.
Someone else worked on this code-base to add the Svelte UI. However, they broke all the Tools and Services. So we reversed those to their previous working state. now everything builds, but the integration tests fail.
PLease fix the integration and e2e tests first, and afterwards we will discuss the plan to implement the svelte UI with less risk.