# ChatOps Tracker

ChatOps Tracker is a system that converts WhatsApp team conversations into structured, actionable tasks.

While it looks like a task manager on the surface, the core idea is to explore how **agent-native systems** can be designed beyond traditional chatbots.

---

## 🚀 Why this project?

Most chatbots only respond.

This system is built to **act** — by understanding context, managing state, and executing workflows.

It is inspired by agent-oriented architectures (like OpenClaw), where an agent is not just a prompt, but a system that:
- maintains context
- orchestrates tools
- executes actions

---

## 🧠 Core Concepts

### 1. Gateway-first architecture
A **WhatsApp Adapter** acts as the entry point, decoupling messaging from core logic.

### 2. Context Assembly
A **Context Assembler** reconstructs conversation history and resolves references like:
> “it”, “that”, “this task”

This happens *before* the LLM is invoked.

### 3. Provider-agnostic LLM layer
A **Provider Factory** supports:
- OpenAI
- Anthropic
- Gemini

This avoids vendor lock-in and allows flexible routing.

### 4. Agentic Skills & Execution
Instead of static responses:
- **Skill Manager** handles task execution
- **Cron Manager** supports recurring workflows (e.g., standups, reminders)

---

## ⚙️ Tech Stack

- **Backend:** Node.js, TypeScript  
- **Database:** SQLite (local-first approach)  
- **LLMs:** OpenAI, Anthropic, Gemini  
- **Realtime:** WebSockets (live dashboard updates)  

---

## 🏗️ System Flow

1. User sends message on WhatsApp  
2. WhatsApp Adapter receives input  
3. Context Assembler builds session state  
4. LLM processes enriched context  
5. Skill Manager executes actions  
6. Results are stored + synced to dashboard  

---

## 📌 Example Use Cases

- Convert chat messages into tasks  
- Assign and track team work from WhatsApp  
- Schedule recurring updates (daily standups, reminders)  
- Maintain conversational context across threads  

---

## 🧩 Key Idea

This is not just a chatbot.

It’s an attempt to build a **lightweight agent runtime**, where:
- context is persistent  
- tools are first-class  
- execution is structured  

---

## 🔮 Future Improvements

- Multi-agent coordination  
- Better memory handling (long-term context)  
- UI for workflow customization  
- Plugin-based skill system  

---

## 🤝 Contributing

Open to ideas, feedback, and improvements.  
If you're exploring similar agent-based systems, feel free to connect or raise an issue.

---

## 📬 Notes

This project is part of my exploration into **GenAI system design**, especially around moving from prompt-based systems to **agent-driven architectures**.