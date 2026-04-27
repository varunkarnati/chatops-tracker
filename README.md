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

## 🚀 Quick Start (How to Run)

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   Copy `.env.example` to `.env` (or create a `.env` file) and set up your LLM provider.
   ```env
   # Choose one: openai | anthropic | gemini | openai_compatible
   LLM_PROVIDER=openai_compatible
   LLM_MODEL=qwen/qwen3-32b
   OPENAI_API_KEY=your_api_key_here
   
   # Optional: Restrict bot to specific WhatsApp groups
   ALLOWED_GROUPS=
   ```

3. **Start the Development Server**
   ```bash
   npm run dev
   ```

4. **Connect WhatsApp**
   When the server starts, a QR code will print in the terminal. Scan it with your WhatsApp mobile app (Linked Devices) to connect the bot.

5. **Interact**
   Send a message in any WhatsApp group the bot is in, such as *"Can you create a task to fix the login bug and assign it to @John?"*

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