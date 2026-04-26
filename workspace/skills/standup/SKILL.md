# Skill: Daily Standup

## Trigger
Activate when:
- Cron job fires the daily standup (9:00 AM)
- Someone asks "what's the status?" or "standup update"
- Someone gives an update like "yesterday I did X, today I'll do Y"

## Behavior
1. Collect updates from team members for the last 24 hours
2. Cross-reference with task board:
   - Tasks marked done since yesterday → celebrate
   - Tasks still in_progress with no update → flag
   - Overdue tasks → highlight with ⚠️
3. Format as:
   ```
   🌅 Daily Standup — Mon, Apr 28
   ━━━━━━━━━━━━━━━━━
   ✅ Completed yesterday (3):
     #12 Login page — Rahul
     #15 API docs — Priya
     #18 Bug fix — Amit

   🔄 In Progress (2):
     #20 Payment gateway — Rahul (due: Wed)
     #22 Dashboard UI — Priya (due: Fri)

   ⚠️ Needs Attention:
     #14 Database migration — Amit (OVERDUE by 2 days)
   ```

## Anti-patterns
- Don't create new tasks from standup messages unless explicitly asked
- Don't nag people who haven't sent updates — just note "no update"
