# Trae AI IDE & Autonomous Agent

**AI Native Integrated Development Environment with Autonomous Agents**

Trae AI IDE is a modern, AI-native development platform that integrates an Autonomous Agent capable of understanding context, planning tasks, and executing complex software engineering workflows. It goes beyond a simple code editor by combining a full-featured frontend IDE, Git version control, and a backend Agent core with "Plan-Act-Reflect" capabilities.

## Key Features

### 1. High-Transparency Real-Time Interaction (WebSocket + Streaming UI)
- **Bidirectional Real-Time Communication**: Built on WebSocket architecture to establish a standardized message flow between the backend Agent and frontend UI.
- **Fine-Grained Message Protocol**: Defines specific message types including `think` (Chain of Thought), `tool_call`, `tool_result`, and `file_changed`.
- **Streaming Rendering Engine**: Dynamically renders the Agent's thought process (CoT), Shell command execution status, and code modification previews in real-time, significantly enhancing system explainability and user trust.

### 2. Modern AI IDE Frontend
- **Monaco Editor Integration**: High-performance code editing environment with multi-file management, syntax highlighting, and intelligent code completion.
- **Streaming Console & Chat Panel**: Deeply integrated with the real-time message flow, supporting Markdown rendering, Diff Viewing, and Interactive Capsules.
- **Visual Git Management**: Direct UI manipulation of underlying Git commands, supporting diff viewing, staging, committing, and history backtracking.
- **Global State Management**: Powered by Zustand for efficient handling of file trees, terminal states, and AI session contexts.

### 3. Autonomous Agent Core
- **Sequential Thinking**: Implements a mechanism for the Agent to decompose vague user requirements into executable steps (Plans).
- **Comprehensive Tool Registry**: Includes file operations (StrReplace/JSON Edit), Shell command execution (BashTool), and Docker container operations, giving the Agent the ability to modify code and run environments.
- **Reflection & Quality Review**: The Agent automatically performs quality checks (Quality Review Tool) and verifies task completion after execution to ensure code delivery quality.
- **MCP (Model Context Protocol)**: Standardized extension for tools and knowledge, supporting integration with external knowledge bases and services.

### 4. Backend Services & Data Infrastructure
- **FastAPI Backend**: High-performance service providing file system operations, Git command encapsulation, and Agent session management APIs.
- **PostgreSQL Database**: Persists Prompt templates, Chat Sessions, Knowledge Base metadata, and Agent Trajectories using SQLAlchemy.
- **Code Knowledge Graph (CKG) & RAG**: Supports semantic search (Search Function/Class) over the codebase, enabling the Agent to have project-level context understanding.

### 5. Secure Sandbox & Containerized Deployment
- **Docker Isolation**: All destructive operations by the Agent (e.g., Shell commands) are executed in isolated containers to ensure host security.
- **Docker Compose Orchestration**: Out-of-the-box local deployment solution orchestrating Frontend, Backend API, and Database services.

## Technology Stack

- **Frontend**: React 18, TypeScript, Vite 5, Tailwind CSS, Monaco Editor, Zustand, WebSocket
- **Backend/AI**: Python, FastAPI, PostgreSQL (SQLAlchemy), Docker, Pydantic, AsyncIO
- **AI Models & Integration**: OpenAI/Anthropic/Google API, MCP (Model Context Protocol), RAG

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js & npm (for local frontend development)
- Python 3.10+ (for local backend development)

### Installation & Running

1. **Clone the repository**
   ```bash
   git clone git@github.com:sushanglewis/AI-Document-IDE.git
   cd AI-Document-IDE
   ```

2. **Start with Docker Compose**
   ```bash
   docker compose up -d --build
   ```
   This will start the PostgreSQL database, Backend API, and Frontend application.

3. **Access the IDE**
   Open your browser and navigate to `http://localhost:5173` (or the configured port).

## License

[MIT License](LICENSE)
