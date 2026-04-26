# Skill: Bug/Issue Triage

## Trigger
Activate when:
- Message contains words: "bug", "broken", "not working", "error", "crash", "down"
- Message is clearly a problem report, not a task update

## Behavior
1. Create task with status "todo" and priority based on severity:
   - Mention of "production", "live", "users affected" → critical
   - Mention of "blocker", "can't proceed" → high
   - Default → medium
2. Auto-assign based on component keywords:
   - "API", "backend", "server" → Backend team
   - "UI", "frontend", "CSS", "page" → Frontend team
   - "database", "DB", "query" → Backend team
3. If reporter @mentions someone, assign to that person instead
4. Add the original message as the task description

## Response Format
🐛 Bug Report → Task #XX
📌 [auto-generated title]
🔴 Priority: [severity]
👤 Assigned to: [person]
💬 "[original message snippet]"
