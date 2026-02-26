# Architecture

## System Overview

```mermaid
graph TB
    Client([Client / curl])

    subgraph AgentCore["BedrockAgentCoreApp (Fastify :8080)"]
        Ping["GET /ping"]
        Invoke["POST /invocations"]
    end

    subgraph StrandsAgent["Strands Agent"]
        Model["BedrockModel<br/>Claude Haiku 4.5"]
        SystemPrompt["System Prompt<br/>(extraction rules)"]
        FetchTool["fetch_url tool"]
    end

    subgraph Processing["Response Processing"]
        ExtractJSON["extractJson()<br/>parse LLM text output"]
        ZodValidation["RecipeSchema.parse()<br/>Zod v4 validation"]
    end

    subgraph FetchToolInternals["fetch_url internals"]
        HTTPFetch["Node fetch()"]
        LinkedOM["linkedom<br/>HTML parser"]
        JSONLD["JSON-LD extractor<br/>schema.org/Recipe"]
        StripHTML["Strip nav, header,<br/>footer, scripts"]
    end

    ExternalSite[(Recipe Website)]
    Bedrock[(Amazon Bedrock<br/>us-east-1)]

    Client -->|"POST {url}"| Invoke
    Client -->|health check| Ping
    Invoke --> StrandsAgent
    Model <-->|Converse API| Bedrock
    Model -->|tool_use| FetchTool
    FetchTool --> HTTPFetch
    HTTPFetch -->|GET| ExternalSite
    ExternalSite -->|HTML| LinkedOM
    LinkedOM --> JSONLD
    LinkedOM --> StripHTML
    StripHTML -->|"text + jsonLd"| Model
    JSONLD -->|"text + jsonLd"| Model
    Model -->|JSON text| ExtractJSON
    ExtractJSON --> ZodValidation
    ZodValidation -->|"typed Recipe"| Client

    style AgentCore fill:#1a1a2e,stroke:#e94560,color:#fff
    style StrandsAgent fill:#16213e,stroke:#0f3460,color:#fff
    style Processing fill:#0f3460,stroke:#533483,color:#fff
    style FetchToolInternals fill:#1a1a2e,stroke:#533483,color:#fff
```

## Request Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant App as BedrockAgentCoreApp
    participant A as Strands Agent
    participant B as Amazon Bedrock
    participant T as fetch_url Tool
    participant W as Recipe Website

    C->>+App: POST /invocations<br/>{"url": "https://..."}
    Note over App: Validate request via Zod<br/>Extract sessionId from header

    App->>+A: agent.invoke("Extract recipe from URL")

    A->>+B: Converse API<br/>(system prompt + user message)
    B-->>-A: tool_use: fetch_url({url})

    A->>+T: fetch_url({url})
    T->>+W: GET https://...
    W-->>-T: HTML response

    Note over T: Parse HTML with linkedom
    Note over T: Extract JSON-LD (schema.org/Recipe)
    Note over T: Strip script, style, nav, header, footer
    Note over T: Collapse whitespace, truncate at 30k chars

    T-->>-A: {text, jsonLd}

    A->>+B: Converse API<br/>(tool result with text + jsonLd)
    B-->>-A: Recipe JSON as text response

    A-->>-App: AgentResult

    Note over App: extractJson() — parse raw text,<br/>code block, or brace extraction
    Note over App: RecipeSchema.parse() — Zod validation

    App-->>-C: 200 OK<br/>typed Recipe JSON
```

## Key Design Decisions

| Decision | Rationale |
|---|---|
| **Non-streaming handler** | Returns single JSON object — structured data doesn't benefit from SSE streaming |
| **`agent.invoke()` + JSON parse** | `structuredOutputSchema` is typed in the SDK but docs say "not supported in TypeScript" — manual parse is reliable |
| **`extractJson()` fallback chain** | LLM may wrap JSON in markdown code blocks; tries direct parse → code block regex → brace extraction |
| **JSON-LD extraction** | Many recipe sites embed `schema.org/Recipe` structured data — passing it alongside page text improves accuracy |
| **linkedom over jsdom** | ~200KB vs ~70MB; sufficient for text extraction and DOM traversal |
| **Claude Haiku 4.5** | Fast, cheap, accurate enough for structured extraction — ~5-9s per request |
| **temperature: 0** | Deterministic output for consistent JSON formatting |
