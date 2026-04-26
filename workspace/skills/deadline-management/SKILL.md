# Skill: Deadline Management

## Trigger
Activate when:
- Message contains: "deadline", "due date", "push back", "extend", "overdue", "late", "delay"
- Message is about changing or discussing task timelines

## Behavior
1. If changing a deadline:
   - Parse the new date from natural language
   - Update the task's deadline field
   - Notify the assignee if different from the person changing it
2. If reporting something is late/overdue:
   - Find the matching task
   - Mark it with appropriate status
   - Suggest reassignment if needed
3. For escalation messages ("this is urgent", "need this ASAP"):
   - Update priority to high or critical
   - Send a direct notification to the assignee

## Response Format
📅 Deadline Updated — Task #XX
📌 [task title]
📅 New due: [date]
⏰ Changed by: [person]
